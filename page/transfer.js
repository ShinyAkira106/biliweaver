// Biliweaver page engine, part 2: the parallel range downloader.
//
// One byte range the player asks for becomes several smaller ranges ("pieces") fetched at
// the same time from whichever CDN hosts are currently fastest. Pieces are kept in a small
// per-file cache, so a range that a prefetch already loaded, or that two requests share, is
// downloaded once. Every piece is checked against the Content-Range the server sends back
// and against the file size seen before, so bytes from a wrong or truncated answer never
// reach the player.
(function defineBiliweaverTransfer(root) {
  "use strict";
  const bw = root.__biliweaver;
  if (!bw || bw.transfer) return;
  const { util, hosts, slots, stats, native } = bw;

  // Less memory on smaller machines: the player keeps its own buffer as well.
  const DEVICE_GB = Number(root.navigator?.deviceMemory) || 8;
  const CACHE_BUDGET = (DEVICE_GB <= 2 ? 48 : DEVICE_GB <= 4 ? 96 : 160) * 1024 * 1024;
  const MAX_ATTEMPTS = 6;
  const HEADER_TIMEOUT_MS = 8000;
  const MIN_SPEED_FOR_TIMEOUT = 24 * 1024; // bytes per second before a piece counts as stalled

  class TransferError extends Error {
    constructor(message, { hard = false, status = 0 } = {}) {
      super(message);
      this.name = "TransferError";
      this.hard = hard;
      this.status = status;
    }
  }

  // ---------------------------------------------------------------------------------
  // Per-file state and the piece cache.
  // ---------------------------------------------------------------------------------
  const files = new Map();
  let cachedBytes = 0;

  function fileState(key) {
    let file = files.get(key);
    if (!file) {
      file = { key, total: null, contentType: "", entries: [], lastUse: Date.now() };
      files.set(key, file);
    }
    file.lastUse = Date.now();
    return file;
  }

  function dropEntry(file, entry) {
    const at = file.entries.indexOf(entry);
    if (at >= 0) file.entries.splice(at, 1);
    if (entry.data) cachedBytes -= entry.data.byteLength;
    entry.data = null;
  }

  function evict() {
    if (cachedBytes <= CACHE_BUDGET) return;
    const done = [];
    for (const file of files.values()) for (const entry of file.entries) if (entry.data && entry.waiters <= 0) done.push([file, entry]);
    done.sort((a, b) => a[1].lastUse - b[1].lastUse);
    for (const [file, entry] of done) {
      if (cachedBytes <= CACHE_BUDGET * 0.8) break;
      dropEntry(file, entry);
    }
  }

  // ---------------------------------------------------------------------------------
  // One HTTP request for one piece on one host.
  // ---------------------------------------------------------------------------------
  async function requestPiece(file, candidate, start, end, outerSignal) {
    const controller = new AbortController();
    const abortFromOuter = () => controller.abort();
    outerSignal?.addEventListener("abort", abortFromOuter, { once: true });
    const host = candidate.host;
    const entry = hosts.get(host);
    entry.inflight += 1;
    const began = native.now();
    let headerTimer = setTimeout(() => controller.abort(), HEADER_TIMEOUT_MS);
    let stallTimer = null;
    try {
      const response = await native.fetch(candidate.url, {
        method: "GET",
        headers: { Range: `bytes=${start}-${end}` },
        credentials: "omit",
        mode: "cors",
        cache: "no-store",
        signal: controller.signal
      });
      clearTimeout(headerTimer);
      headerTimer = null;
      if (response.status === 416) throw new TransferError("range not satisfiable", { status: 416 });
      // 429 is always rate limiting. A 403 from a host that has already served this page
      // well is too; a 403 from a host never used is just a host that cannot serve the file.
      if (response.status === 429 || (response.status === 403 && entry.requests > 0)) bw.guard.rateLimited(host, response.status);
      if (response.status === 429) throw new TransferError("HTTP 429", { status: 429 });
      if (response.status === 403 || response.status === 404) throw new TransferError(`HTTP ${response.status}`, { hard: true, status: response.status });
      if (response.status !== 206) {
        // A server that ignores Range would send the whole file; that host is useless here.
        throw new TransferError(`HTTP ${response.status} instead of 206`, { hard: response.status === 200, status: response.status });
      }
      const range = util.parseContentRange(response.headers.get("content-range"));
      if (!range || range.start !== start) throw new TransferError("bad Content-Range", { hard: true });
      if (range.total !== null) {
        if (file.total !== null && file.total !== range.total) throw new TransferError("file size differs from other hosts", { hard: true });
        if (file.total === null) file.total = range.total;
      }
      const wantedEnd = file.total !== null ? Math.min(end, file.total - 1) : end;
      if (range.end !== wantedEnd) throw new TransferError("short Content-Range", { hard: false });
      if (!file.contentType) file.contentType = response.headers.get("content-type") || "";

      const length = wantedEnd - start + 1;
      const data = new Uint8Array(length);
      let offset = 0;
      const reader = response.body.getReader();
      const allowedMs = Math.max(6000, (length / MIN_SPEED_FOR_TIMEOUT) * 1000);
      stallTimer = setTimeout(() => controller.abort(), allowedMs);
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (offset + value.byteLength > length) throw new TransferError("more bytes than asked for", { hard: true });
        data.set(value, offset);
        offset += value.byteLength;
        stats.addBytes(value.byteLength);
      }
      if (offset !== length) throw new TransferError(`body ended after ${offset} of ${length} bytes`);
      hosts.success(host, length, native.now() - began);
      return data;
    } catch (error) {
      if (outerSignal?.aborted) throw util.abortError();
      const transfer = error instanceof TransferError ? error : new TransferError(controller.signal.aborted ? "timed out" : String(error?.message || error));
      if (transfer.status !== 416) hosts.failure(host, transfer.message, { hard: transfer.hard });
      throw transfer;
    } finally {
      if (headerTimer) clearTimeout(headerTimer);
      if (stallTimer) clearTimeout(stallTimer);
      outerSignal?.removeEventListener("abort", abortFromOuter);
      entry.inflight -= 1;
    }
  }

  // A piece with retries on other hosts, and a duplicate on a second host when the first
  // one is much slower than expected (the slowest piece decides when the player gets data).
  async function fetchPiece(file, candidates, start, end, ref, signal) {
    const tried = new Set();
    let lastError = null;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      const release = await slots.acquire(ref, signal);
      try {
        let candidate = hosts.pick(candidates, tried);
        if (!candidate) {
          tried.clear();
          candidate = hosts.pick(candidates) || candidates[0];
        }
        tried.add(candidate.host);
        return await hedged(file, candidates, candidate, start, end, signal, tried);
      } catch (error) {
        if (signal?.aborted || error?.name === "AbortError") throw util.abortError();
        if (error?.status === 416) throw error;
        lastError = error;
      } finally {
        release();
      }
    }
    throw lastError || new TransferError("no host could serve this range");
  }

  function hedged(file, candidates, candidate, start, end, signal, tried) {
    return new Promise((resolve, reject) => {
      const racers = [];
      let settled = false;
      let failures = 0;
      let timer = null;
      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        for (const racer of racers) racer.controller.abort();
        fn(value);
      };
      const launch = (choice, release) => {
        const controller = new AbortController();
        const onAbort = () => controller.abort();
        signal?.addEventListener("abort", onAbort, { once: true });
        const racer = { controller };
        racers.push(racer);
        requestPiece(file, choice, start, end, controller.signal).then(
          (data) => finish(resolve, data),
          (error) => {
            failures += 1;
            if (failures >= racers.length) finish(reject, error);
          }
        ).finally(() => {
          signal?.removeEventListener("abort", onAbort);
          release?.();
        });
      };
      launch(candidate, null);
      const speed = Math.max(hosts.get(candidate.host).speed, 0.2); // bytes per ms; 0.2 ≈ 200 KB/s
      const expectedMs = (end - start + 1) / speed;
      timer = setTimeout(() => {
        if (settled) return;
        const other = hosts.pick(candidates, new Set([...tried]));
        if (!other) return;
        const release = slots.tryAcquire();
        if (!release) return;
        tried.add(other.host);
        bw.log("hedge", file.key, start, end, candidate.host, "→", other.host);
        launch(other, release);
      }, Math.min(15000, expectedMs * 2.5 + 1200));
      signal?.addEventListener("abort", () => finish(reject, util.abortError()), { once: true });
    });
  }

  // ---------------------------------------------------------------------------------
  // Cache entries: a piece of one file, loading or loaded.
  // ---------------------------------------------------------------------------------
  function createEntry(file, candidates, start, end, priority) {
    const controller = new AbortController();
    const ref = { priority };
    const entry = { start, end, data: null, done: false, failed: false, waiters: 0, lastUse: Date.now(), controller, ref, promise: null };
    entry.promise = fetchPiece(file, candidates, start, end, ref, controller.signal).then(
      (data) => {
        entry.done = true;
        // The file may be shorter than this piece claimed; keep what really exists.
        entry.end = start + data.byteLength - 1;
        if (files.get(file.key) === file && file.entries.includes(entry)) {
          entry.data = data;
          cachedBytes += data.byteLength;
          evict();
        }
        return data;
      },
      (error) => {
        entry.failed = true;
        dropEntry(file, entry);
        throw error;
      }
    );
    // Errors are handled by whoever waits on the entry; this only silences prefetches.
    entry.promise.catch(() => {});
    file.entries.push(entry);
    return entry;
  }

  function findEntry(file, position) {
    return file.entries.find((entry) => !entry.failed && entry.start <= position && entry.end >= position) || null;
  }

  function nextEntryStart(file, position) {
    let next = Infinity;
    for (const entry of file.entries) if (!entry.failed && entry.start > position && entry.start < next) next = entry.start;
    return next;
  }

  // The pieces that make up [start, end]: cached or loading entries where they exist, new
  // ones for the gaps between them.
  function plan(file, candidates, start, end, priority) {
    const pieces = [];
    const threads = bw.settings.threads;
    const minChunk = bw.settings.chunkKB * 1024;
    let position = start;
    while (position <= end) {
      const entry = findEntry(file, position);
      if (entry) {
        const pieceEnd = Math.min(entry.end, end);
        pieces.push({ entry, from: position - entry.start, length: pieceEnd - position + 1 });
        position = pieceEnd + 1;
        continue;
      }
      const gapEnd = Math.min(end, nextEntryStart(file, position) - 1);
      const gapLength = gapEnd - position + 1;
      const count = Math.max(1, Math.min(threads, Math.ceil(gapLength / minChunk)));
      // Round piece sizes up to 16 KiB so neighbouring requests line up.
      const size = Math.ceil(gapLength / count / 16384) * 16384;
      for (let pieceStart = position; pieceStart <= gapEnd; pieceStart += size) {
        const pieceEnd = Math.min(gapEnd, pieceStart + size - 1);
        const created = createEntry(file, candidates, pieceStart, pieceEnd, priority);
        pieces.push({ entry: created, from: 0, length: pieceEnd - pieceStart + 1 });
      }
      position = gapEnd + 1;
    }
    return pieces;
  }

  // Load ahead of what the player asked for, at low priority, so its next request is
  // already on the way. Stops at the file end and at a few seconds' worth of data.
  function prefetchAfter(file, candidates, end, requested) {
    if (!bw.settings.prefetch || file.total === null || bw.media.prefetchHeld()) return;
    let position = end + 1;
    if (position >= file.total) return;
    const budget = Math.min(24 * 1024 * 1024, Math.max(2 * 1024 * 1024, requested * 2));
    const limit = Math.min(file.total - 1, end + budget);
    while (position <= limit) {
      const entry = findEntry(file, position);
      if (entry) { position = entry.end + 1; continue; }
      const gapEnd = Math.min(limit, nextEntryStart(file, position) - 1);
      const size = Math.max(bw.settings.chunkKB * 1024, 1024 * 1024);
      for (let pieceStart = position; pieceStart <= gapEnd; pieceStart += size) {
        createEntry(file, candidates, pieceStart, Math.min(gapEnd, pieceStart + size - 1), "low");
      }
      position = gapEnd + 1;
    }
  }

  // ---------------------------------------------------------------------------------
  // The public call.
  // ---------------------------------------------------------------------------------
  async function fetchRange({ key, candidates, start, end = null, signal = null }) {
    if (!candidates?.length) throw new TransferError("no candidates");
    const file = fileState(key);
    const used = [];
    // Let go of every entry this request holds. On abort, pieces nobody else waits for stop
    // downloading; a finished or prefetched piece stays in the cache.
    const releaseAll = (aborting) => {
      signal?.removeEventListener("abort", onAbort);
      for (const entry of used) {
        entry.waiters -= 1;
        if (aborting && entry.waiters <= 0 && !entry.done && entry.ref.priority === "high") {
          entry.controller.abort();
          dropEntry(file, entry);
        }
      }
      used.length = 0;
    };
    const onAbort = () => releaseAll(true);
    if (signal?.aborted) throw util.abortError();
    signal?.addEventListener("abort", onAbort, { once: true });
    const adopt = (pieces) => {
      for (const piece of pieces) {
        piece.entry.waiters += 1;
        piece.entry.lastUse = Date.now();
        if (piece.entry.done) stats.counters.cacheHits += 1;
        else slots.boost(piece.entry.ref);
        used.push(piece.entry);
      }
      return pieces;
    };

    let pieces = [];
    if (file.total === null) {
      // The size is unknown until one host answers; ask for the first piece alone.
      const probeEnd = end === null ? start + bw.settings.chunkKB * 1024 - 1 : Math.min(end, start + bw.settings.chunkKB * 1024 - 1);
      const first = adopt(plan(file, candidates, start, probeEnd, "high"));
      try {
        await Promise.all(first.map((piece) => piece.entry.promise));
        if (file.total === null) throw new TransferError("server did not report the file size");
      } catch (error) {
        releaseAll(false);
        throw error;
      }
      pieces = first;
    }
    if (start >= file.total) {
      releaseAll(false);
      throw new TransferError("range not satisfiable", { status: 416 });
    }
    const last = Math.min(end === null ? file.total - 1 : end, file.total - 1);
    const covered = pieces.reduce((sum, piece) => sum + Math.min(piece.length, piece.entry.end - piece.entry.start + 1 - piece.from), 0);
    if (start + covered <= last) pieces = pieces.concat(adopt(plan(file, candidates, start + covered, last, "high")));
    prefetchAfter(file, candidates, last, last - start + 1);
    stats.counters.acceleratedRequests += 1;

    const cleanup = () => releaseAll(false);
    const slice = async (piece) => {
      const data = await piece.entry.promise;
      return data.subarray(piece.from, piece.from + piece.length);
    };

    let index = 0;
    const stream = () => new ReadableStream({
      async pull(controller) {
        try {
          if (index >= pieces.length) {
            cleanup();
            controller.close();
            return;
          }
          const part = await slice(pieces[index]);
          index += 1;
          stats.counters.acceleratedBytes += part.byteLength;
          controller.enqueue(part);
        } catch (error) {
          cleanup();
          controller.error(error);
        }
      },
      cancel() {
        releaseAll(true);
      }
    });
    const body = async () => {
      try {
        const parts = await Promise.all(pieces.map(slice));
        const out = new Uint8Array(last - start + 1);
        let offset = 0;
        for (const part of parts) { out.set(part, offset); offset += part.byteLength; }
        stats.counters.acceleratedBytes += out.byteLength;
        return out;
      } finally {
        cleanup();
      }
    };
    return { total: file.total, start, end: last, contentType: file.contentType || "video/mp4", stream, body };
  }

  bw.transfer = Object.freeze({
    fetchRange,
    TransferError,
    _files: files,
    cacheSize: () => cachedBytes,
    cacheBudget: CACHE_BUDGET
  });
})(globalThis);
