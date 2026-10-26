// Biliweaver page engine, part 1: shared state that every other page module uses.
// Runs in the page's own JavaScript world (manifest "world": "MAIN") so it can wrap the
// fetch and XMLHttpRequest the bilibili player calls. It never touches chrome.* APIs; the
// content relay (content/relay.js) brings settings in and carries stats out through DOM
// events carrying JSON text.
(function defineBiliweaverCore(root) {
  "use strict";
  const NS = "__biliweaver";
  if (root[NS]) return;
  const Settings = root.BiliweaverSettings;
  if (!Settings) return;

  const bw = { version: "__BW_VERSION__" };
  Object.defineProperty(root, NS, { value: bw, configurable: false, enumerable: false, writable: false });

  // Keep the browser's own functions before anything wraps them.
  bw.native = Object.freeze({
    fetch: root.fetch.bind(root),
    XHR: root.XMLHttpRequest,
    open: root.XMLHttpRequest.prototype.open,
    send: root.XMLHttpRequest.prototype.send,
    setRequestHeader: root.XMLHttpRequest.prototype.setRequestHeader,
    abort: root.XMLHttpRequest.prototype.abort,
    Response: root.Response,
    Headers: root.Headers,
    now: () => (root.performance?.now ? root.performance.now() : Date.now())
  });

  // ---------------------------------------------------------------------------------
  // Settings. The relay mirrors the stored settings into this origin's localStorage, so a
  // page load after the first one has them synchronously, before the player starts.
  // ---------------------------------------------------------------------------------
  let readyResolve;
  bw.ready = new Promise((resolve) => { readyResolve = resolve; });
  bw.isReady = false;
  bw.settings = Settings.normalize(Settings.DEFAULTS);
  const settingsListeners = new Set();
  bw.onSettings = (listener) => settingsListeners.add(listener);

  function applySettings(next, final) {
    bw.settings = Settings.normalize(next);
    for (const listener of settingsListeners) {
      try { listener(bw.settings); } catch (error) { console.warn("[Biliweaver] settings listener", error); }
    }
    if (final && !bw.isReady) {
      bw.isReady = true;
      readyResolve(bw.settings);
    }
  }

  try {
    const cached = root.localStorage?.getItem(Settings.STORAGE_CACHE_KEY);
    if (cached) applySettings(JSON.parse(cached), true);
  } catch (_error) {
    // Storage blocked: wait for the relay instead.
  }

  root.document?.addEventListener("biliweaver:settings", (event) => {
    try { applySettings(JSON.parse(event.detail), true); } catch (_error) {}
  });
  // Without an answer the defaults apply, so a missing relay never stalls the player.
  setTimeout(() => { if (!bw.isReady) applySettings(bw.settings, true); }, 600);
  root.document?.dispatchEvent(new CustomEvent("biliweaver:hello"));

  // ---------------------------------------------------------------------------------
  // Small helpers.
  // ---------------------------------------------------------------------------------
  const util = {};
  bw.util = util;

  util.absoluteUrl = (value) => {
    try { return new URL(String(value), root.location?.href).href; } catch (_error) { return ""; }
  };

  // "bytes=100-199" → { start: 100, end: 199 }; "bytes=100-" → { start: 100, end: null }.
  // Multi-range or suffix requests are not handled and return null.
  util.parseRangeHeader = (value) => {
    const match = /^\s*bytes\s*=\s*(\d+)\s*-\s*(\d*)\s*$/i.exec(String(value || ""));
    if (!match) return null;
    const start = Number(match[1]);
    const end = match[2] === "" ? null : Number(match[2]);
    if (!Number.isSafeInteger(start) || (end !== null && (!Number.isSafeInteger(end) || end < start))) return null;
    return { start, end };
  };

  // "bytes 0-99/1000" → { start: 0, end: 99, total: 1000 }; total is null for "*".
  util.parseContentRange = (value) => {
    const match = /^\s*bytes\s+(\d+)-(\d+)\/(\d+|\*)\s*$/i.exec(String(value || ""));
    if (!match) return null;
    return { start: Number(match[1]), end: Number(match[2]), total: match[3] === "*" ? null : Number(match[3]) };
  };

  // Hosts that belong to the peer CDN (home routers and small edge boxes). They are often
  // much slower than the main store and may disappear in the middle of a file.
  util.isPcdn = (url) => {
    try {
      const parsed = new URL(url);
      const host = parsed.hostname;
      if (/\.mcdn\.bilivideo\.(?:cn|com)$/i.test(host) || /(?:^|\.)szbdyd\.com$/i.test(host)) return true;
      if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || host.includes(":")) return true;
      if (parsed.port && parsed.port !== "443") return true;
      return /^(?:mcdn|pcdn)$/i.test(parsed.searchParams.get("os") || "");
    } catch (_error) {
      return false;
    }
  };

  util.withHost = (url, host) => {
    try {
      const parsed = new URL(url);
      parsed.protocol = "https:";
      parsed.hostname = host;
      parsed.port = "";
      return parsed.href;
    } catch (_error) {
      return "";
    }
  };

  util.hostOf = (url) => {
    try { return new URL(url).host; } catch (_error) { return ""; }
  };

  // One file has the same path on every mirror; the last path part names it uniquely.
  util.fileKey = (url) => {
    try {
      const path = new URL(url).pathname;
      const store = path.indexOf("/upgcxcode/");
      return store >= 0 ? path.slice(store) : path.split("/").pop() || path;
    } catch (_error) {
      return "";
    }
  };

  util.sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  util.abortError = () => new DOMException("The operation was aborted.", "AbortError");

  // The last few things that went wrong, for the diagnostics report. Only host names and
  // short reasons are kept, never full addresses (they carry signatures).
  const errorLog = [];
  bw.recordError = (kind, host, message) => {
    errorLog.push({ at: Date.now(), kind: String(kind), host: String(host || ""), message: String(message || "").slice(0, 160) });
    if (errorLog.length > 30) errorLog.shift();
  };
  bw.recentErrors = () => errorLog.slice(-10);

  // ---------------------------------------------------------------------------------
  // Host pool: what Biliweaver has learned about each CDN host on this page.
  // ---------------------------------------------------------------------------------
  const hosts = new Map();
  bw.hosts = {
    get(host) {
      let entry = hosts.get(host);
      if (!entry) {
        entry = { host, speed: 0, samples: 0, inflight: 0, failures: 0, cooldownUntil: 0, bytes: 0, requests: 0, errors: 0, lastError: "" };
        hosts.set(host, entry);
      }
      return entry;
    },
    usable(host) {
      return bw.hosts.get(host).cooldownUntil <= Date.now();
    },
    success(host, bytes, ms) {
      const entry = bw.hosts.get(host);
      const sample = bytes / Math.max(1, ms);
      // Short requests mostly measure latency; weigh them less.
      const weight = Math.min(1, bytes / (256 * 1024)) * 0.35 + 0.05;
      entry.speed = entry.samples ? entry.speed * (1 - weight) + sample * weight : sample;
      entry.samples += 1;
      entry.failures = 0;
      entry.bytes += bytes;
      entry.requests += 1;
    },
    failure(host, reason, { hard = false } = {}) {
      const entry = bw.hosts.get(host);
      entry.failures += 1;
      entry.errors += 1;
      entry.lastError = String(reason || "error").slice(0, 120);
      bw.recordError("host", host, entry.lastError);
      const wait = hard ? 10 * 60 * 1000 : Math.min(5 * 60 * 1000, 3000 * 2 ** Math.min(entry.failures - 1, 7));
      entry.cooldownUntil = Date.now() + wait;
      entry.speed *= 0.5;
    },
    // The host expected to finish a request soonest, from the given ones.
    pick(candidates, exclude = new Set()) {
      const now = Date.now();
      const known = [...hosts.values()].filter((entry) => entry.samples > 0).map((entry) => entry.speed).sort((a, b) => a - b);
      const median = known.length ? known[Math.floor(known.length / 2)] : 1;
      let best = null;
      let bestScore = -Infinity;
      for (const candidate of candidates) {
        if (exclude.has(candidate.host)) continue;
        const entry = bw.hosts.get(candidate.host);
        if (entry.cooldownUntil > now) continue;
        // An untried host is assumed a bit better than the median, so each gets tried once.
        const speed = entry.samples ? entry.speed : median * 1.15 + 0.001;
        const score = speed / (entry.inflight + 1) - (candidate.penalty || 0) * median;
        if (score > bestScore) {
          bestScore = score;
          best = candidate;
        }
      }
      return best;
    },
    reset() {
      hosts.clear();
    },
    snapshot() {
      const now = Date.now();
      return [...hosts.values()]
        .filter((entry) => entry.requests || entry.errors || entry.inflight)
        .sort((a, b) => b.bytes - a.bytes)
        .slice(0, 16)
        .map((entry) => ({
          host: entry.host,
          speedKBps: Math.round(entry.speed * 1000 / 1024),
          inflight: entry.inflight,
          bytes: entry.bytes,
          requests: entry.requests,
          errors: entry.errors,
          cooling: entry.cooldownUntil > now,
          lastError: entry.lastError
        }));
    }
  };

  // ---------------------------------------------------------------------------------
  // Protection: what the engine does on its own when things go wrong.
  // ---------------------------------------------------------------------------------
  const PAUSE_AFTER_FAILURES = 5;
  const FAILURE_WINDOW_MS = 60 * 1000;
  const PAUSE_MS = 5 * 60 * 1000;
  const RATE_LIMIT_HITS = 3;
  const RATE_LIMIT_WINDOW_MS = 30 * 1000;
  const RECOVER_EVERY_MS = 60 * 1000;
  const MIN_THREADS = 2;

  const guard = {
    failures: [],
    pausedUntil: 0,
    pausedReason: "",
    rateHits: [],
    threadLimit: Infinity,
    lastRateHit: 0,
    lastCut: 0,
    hlsFallback: false
  };
  bw.guard = {
    // Requests that Biliweaver had to hand back to the browser. Several in a short time
    // mean something is wrong with this page; stop trying for a while.
    failure(reason) {
      const now = Date.now();
      guard.failures = guard.failures.filter((at) => now - at < FAILURE_WINDOW_MS);
      guard.failures.push(now);
      if (guard.failures.length >= PAUSE_AFTER_FAILURES && guard.pausedUntil <= now) {
        guard.pausedUntil = now + PAUSE_MS;
        guard.pausedReason = String(reason || "").slice(0, 120);
        guard.failures = [];
        bw.recordError("paused", "", guard.pausedReason);
      }
    },
    success() {
      guard.failures = [];
    },
    paused() {
      return guard.pausedUntil > Date.now();
    },
    resume() {
      guard.pausedUntil = 0;
      guard.pausedReason = "";
      guard.failures = [];
    },
    // The CDN said "too many requests". Halve the threads after a few of those, then give
    // them back one step a minute while it stays quiet.
    rateLimited(host, status) {
      const now = Date.now();
      guard.lastRateHit = now;
      guard.rateHits = guard.rateHits.filter((at) => now - at < RATE_LIMIT_WINDOW_MS);
      guard.rateHits.push(now);
      // One burst of refusals (several pieces failing at once) counts as one signal: after
      // a cut, wait a little before cutting again.
      if (guard.rateHits.length >= RATE_LIMIT_HITS && now - guard.lastCut > 10 * 1000) {
        guard.lastCut = now;
        const current = Math.min(guard.threadLimit, bw.settings.threads);
        guard.threadLimit = Math.max(MIN_THREADS, Math.floor(current / 2));
        guard.rateHits = [];
        bw.recordError("throttled", host, `HTTP ${status}; threads lowered to ${guard.threadLimit}`);
      }
    },
    threads() {
      const now = Date.now();
      if (guard.threadLimit !== Infinity && now - guard.lastRateHit > RECOVER_EVERY_MS) {
        guard.threadLimit = guard.threadLimit * 2 >= bw.settings.threads ? Infinity : guard.threadLimit * 2;
        guard.lastRateHit = now;
      }
      return Math.max(1, Math.min(bw.settings.threads, guard.threadLimit));
    },
    markHlsFallback() { guard.hlsFallback = true; },
    reset() {
      Object.assign(guard, { failures: [], pausedUntil: 0, pausedReason: "", rateHits: [], threadLimit: Infinity, lastRateHit: 0, lastCut: 0, hlsFallback: false });
    },
    snapshot() {
      const now = Date.now();
      return {
        paused: guard.pausedUntil > now,
        pausedReason: guard.pausedReason,
        resumeInMs: Math.max(0, guard.pausedUntil - now),
        threadLimit: guard.threadLimit === Infinity ? null : guard.threadLimit,
        hlsFallback: guard.hlsFallback,
        prefetchHeld: bw.media.prefetchHeld()
      };
    }
  };
  root.document?.addEventListener("biliweaver:resume", () => bw.guard.resume());

  // ---------------------------------------------------------------------------------
  // Saving bandwidth: no prefetch while the video is paused or the browser asks to save
  // data. The video element's own events tell which.
  // ---------------------------------------------------------------------------------
  let videoPaused = false;
  let lastVideo = null;
  // Bytes per second of each stream, from the bandwidth the play address answer lists.
  const bitrates = new Map();
  const findVideo = () => {
    if (lastVideo && lastVideo.isConnected) return lastVideo;
    lastVideo = root.document?.querySelector?.("video") || null;
    return lastVideo;
  };
  bw.media = {
    update(paused) { videoPaused = paused === true; },
    saveData() { return root.navigator?.connection?.saveData === true; },
    prefetchHeld() {
      if (this.saveData()) return "saveData";
      if (videoPaused) return "paused";
      return null;
    },
    setBitrate(key, bitsPerSecond) {
      const value = Number(bitsPerSecond);
      if (key && Number.isFinite(value) && value > 0) bitrates.set(key, value / 8);
    },
    // How many bytes of this file one second of video takes: the listed bandwidth, or else
    // the file size over the video's length. 0 when neither is known.
    bytesPerSecond(key, total) {
      if (bitrates.has(key)) return bitrates.get(key);
      const duration = Number(findVideo()?.duration);
      return total > 0 && Number.isFinite(duration) && duration > 1 ? total / duration : 0;
    },
    // Seconds into the video, or null when there is no video element to ask.
    position() {
      const time = Number(findVideo()?.currentTime);
      return Number.isFinite(time) ? time : null;
    }
  };
  for (const type of ["play", "playing", "pause", "ended", "loadedmetadata", "seeking"]) {
    root.document?.addEventListener(type, (event) => {
      if (event.target?.tagName !== "VIDEO") return;
      lastVideo = event.target;
      if (type === "play" || type === "playing" || type === "pause" || type === "ended") bw.media.update(type === "pause" || type === "ended");
    }, true);
  }

  // ---------------------------------------------------------------------------------
  // Connection slots. Foreground requests (the player waits for them) always go ahead of
  // prefetch requests.
  // ---------------------------------------------------------------------------------
  const waiting = { high: [], low: [] };
  let inUse = 0;
  function pump() {
    while (inUse < bw.guard.threads() && (waiting.high.length || waiting.low.length)) {
      const next = waiting.high.shift() || waiting.low.shift();
      if (next.cancelled) continue;
      next.cancelled = true;
      inUse += 1;
      next.resolve(release());
    }
  }
  function release() {
    let done = false;
    return () => {
      if (done) return;
      done = true;
      inUse -= 1;
      pump();
    };
  }
  bw.slots = {
    // `ref` is { priority: "high" | "low" }; boost(ref) later moves a waiting low request up.
    acquire(ref = { priority: "high" }, signal) {
      return new Promise((resolve, reject) => {
        if (signal?.aborted) return reject(util.abortError());
        const ticket = { resolve, cancelled: false };
        ref.ticket = ticket;
        signal?.addEventListener("abort", () => {
          if (ticket.cancelled) return;
          ticket.cancelled = true;
          reject(util.abortError());
        }, { once: true });
        (ref.priority === "low" ? waiting.low : waiting.high).push(ticket);
        pump();
      });
    },
    boost(ref) {
      ref.priority = "high";
      const ticket = ref.ticket;
      const at = ticket ? waiting.low.indexOf(ticket) : -1;
      if (at < 0) return;
      waiting.low.splice(at, 1);
      waiting.high.push(ticket);
      pump();
    },
    // A slot right now, or null; used for hedged duplicates, which must never queue.
    tryAcquire() {
      if (inUse >= bw.guard.threads() || waiting.high.length) return null;
      inUse += 1;
      return release();
    },
    get inUse() { return inUse; },
    get queued() { return waiting.high.length + waiting.low.length; }
  };
  bw.onSettings(() => pump());

  // ---------------------------------------------------------------------------------
  // Stats, sent to the relay once a second while something changes.
  // ---------------------------------------------------------------------------------
  const window3s = [];
  const counters = { acceleratedRequests: 0, acceleratedBytes: 0, cacheHits: 0, fallbacks: 0, liveSegments: 0 };
  bw.stats = {
    counters,
    addBytes(bytes) {
      window3s.push([Date.now(), bytes]);
    },
    speedBps() {
      const now = Date.now();
      while (window3s.length && window3s[0][0] < now - 3000) window3s.shift();
      return Math.round(window3s.reduce((sum, item) => sum + item[1], 0) / 3);
    }
  };

  let lastSent = "";
  let lastSentAt = 0;
  setInterval(() => {
    const snapshot = {
      version: bw.version,
      enabled: bw.settings.enabled,
      page: root.location?.hostname === "live.bilibili.com" ? "live" : "video",
      activeThreads: inUse,
      queued: bw.slots.queued,
      speedBps: bw.stats.speedBps(),
      ...counters,
      hosts: bw.hosts.snapshot(),
      recentErrors: bw.recentErrors(),
      protection: bw.guard.snapshot(),
      memory: bw.transfer?.memorySnapshot?.() || null
    };
    const text = JSON.stringify(snapshot);
    // Unchanged stats still go out every few seconds, so the service worker knows the
    // frame is alive.
    if (text === lastSent && Date.now() - lastSentAt < 5000) return;
    lastSent = text;
    lastSentAt = Date.now();
    root.document?.dispatchEvent(new CustomEvent("biliweaver:stats", { detail: text }));
  }, 1000);

  bw.log = (...args) => {
    if (root.localStorage?.getItem("biliweaver:debug") === "1") console.debug("[Biliweaver]", ...args);
  };
})(globalThis);
