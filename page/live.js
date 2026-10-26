// Biliweaver page module: live rooms on live.bilibili.com (the player may sit in an iframe
// there, so this runs in every live frame).
//
// Live streams cannot be split into byte ranges the way stored videos can: an FLV stream
// is one endless response, and HLS segments are short and only exist for a moment. What
// helps instead:
//   the room's play info lists several CDN hosts per stream; they are put in order of how
//   fast each host has been on this page;
//   with "prefer HLS" on, the FLV entries are removed when HLS is offered, so the player
//   uses HLS (fMP4 first);
//   every time the player loads the HLS playlist, the newest segments it lists start
//   downloading at once, in parallel, and the player's own request for one of them is
//   answered from that download.
(function defineBiliweaverLive(root) {
  "use strict";
  const bw = root.__biliweaver;
  if (!bw || !bw.intercept || bw.live) return;
  if (!/^live\.bilibili\.com$/i.test(root.location?.hostname || "") && root.__BILIWEAVER_TEST__ !== true) return;
  const { util, intercept, native, hosts, slots, stats } = bw;

  const active = () => bw.settings.enabled && bw.settings.live;

  // ---------------------------------------------------------------------------------
  // Play info: reorder hosts, prefer HLS.
  // ---------------------------------------------------------------------------------
  function hostScore(name) {
    const entry = hosts.get(util.hostOf(`https://${String(name).replace(/^https?:\/\//, "")}`) || name);
    if (entry.cooldownUntil > Date.now()) return -1;
    return entry.samples ? entry.speed : 0;
  }

  // ---------------------------------------------------------------------------------
  // HLS fallback: if a room fails to play after HLS was chosen for it, remember that for a
  // day and leave its FLV streams alone from the next load on.
  // ---------------------------------------------------------------------------------
  const HLS_FAILED_KEY = "biliweaver:hls-failed:";
  const HLS_FAILED_MS = 24 * 60 * 60 * 1000;
  const HLS_START_TIMEOUT_MS = 20 * 1000;
  const roomId = () => (/\/(?:blanc\/)?(\d+)/.exec(root.location?.pathname || "") || [])[1] || "";
  let hlsChosen = false;
  let hlsVerdict = false;

  function hlsFailedHere() {
    const room = roomId();
    if (!room) return false;
    try {
      const at = Number(root.localStorage?.getItem(HLS_FAILED_KEY + room)) || 0;
      if (at && Date.now() - at < HLS_FAILED_MS) return true;
      if (at) root.localStorage.removeItem(HLS_FAILED_KEY + room);
    } catch (_error) {}
    return false;
  }

  function markHlsFailed(reason) {
    if (!hlsChosen || hlsVerdict) return;
    hlsVerdict = true;
    const room = roomId();
    try { if (room) root.localStorage?.setItem(HLS_FAILED_KEY + room, String(Date.now())); } catch (_error) {}
    bw.guard.markHlsFallback();
    bw.recordError("hls", "", `HLS failed in room ${room || "?"}: ${reason}; FLV from the next load`);
  }

  function watchHlsStart() {
    root.document?.addEventListener("error", (event) => {
      if (event.target?.tagName === "VIDEO") markHlsFailed("video error");
    }, true);
    root.document?.addEventListener("playing", (event) => {
      if (event.target?.tagName === "VIDEO") hlsVerdict = true;
    }, true);
    setTimeout(() => {
      if (hlsVerdict || root.document?.visibilityState !== "visible") return;
      const videos = [...(root.document?.querySelectorAll("video") || [])];
      if (!videos.some((video) => video.readyState >= 3 || video.currentTime > 0)) markHlsFailed("did not start within 20 s");
    }, HLS_START_TIMEOUT_MS);
  }

  function transformPlayInfo(data) {
    const playurl = data?.playurl_info?.playurl;
    const streams = playurl?.stream;
    if (!Array.isArray(streams) || !active()) return false;
    const usable = (stream) => Array.isArray(stream?.format) && stream.format.some((format) => Array.isArray(format?.codec) && format.codec.some((codec) => Array.isArray(codec?.url_info) && codec.url_info.length));
    const hlsAllowed = !hlsFailedHere();
    if (!hlsAllowed && bw.settings.preferHls) bw.guard.markHlsFallback();
    if (bw.settings.preferHls && hlsAllowed && streams.some((stream) => stream?.protocol_name === "http_hls" && usable(stream))) {
      playurl.stream = streams.filter((stream) => stream?.protocol_name !== "http_stream");
      if (!hlsChosen) {
        hlsChosen = true;
        watchHlsStart();
      }
    }
    for (const stream of playurl.stream) {
      if (!Array.isArray(stream?.format)) continue;
      if (stream.protocol_name === "http_hls") {
        stream.format.sort((a, b) => (a?.format_name === "fmp4" ? 0 : 1) - (b?.format_name === "fmp4" ? 0 : 1));
      }
      for (const format of stream.format) {
        for (const codec of Array.isArray(format?.codec) ? format.codec : []) {
          if (!Array.isArray(codec?.url_info)) continue;
          // Stable sort: hosts never measured keep the order bilibili gave.
          codec.url_info = codec.url_info
            .map((info, index) => ({ info, index, score: hostScore(info?.host || "") }))
            .sort((a, b) => (b.score - a.score) || (a.index - b.index))
            .map((item) => item.info);
        }
      }
    }
    return true;
  }

  const PLAY_INFO = /\/xlive\/web-room\/v2\/index\/getRoomPlayInfo(?:[/?]|$)/;
  intercept.addRoute((request) => {
    if (request.method !== "GET" || !PLAY_INFO.test(request.url)) return null;
    if (bw.isReady && !active()) return null;
    return async () => {
      await bw.ready;
      if (!active()) throw intercept.PASS;
      const headers = new native.Headers(request.headers);
      const response = await native.fetch(request.url, {
        headers,
        credentials: request.credentials === "omit" ? "omit" : "include",
        signal: request.signal
      });
      const text = await response.text();
      let json = null;
      try { json = JSON.parse(text); } catch (_error) {}
      const changed = json ? transformPlayInfo(json.data) : false;
      return intercept.makeResponse(changed ? JSON.stringify(json) : text, {
        status: response.status,
        statusText: response.statusText,
        headers: { "content-type": response.headers.get("content-type") || "application/json; charset=utf-8" },
        url: request.url
      });
    };
  });

  // The first play info comes inside the page itself, in a global the page assigns while
  // it loads. Catch that assignment and adjust it the same way.
  try {
    const GLOBAL = "__NEPTUNE_IS_MY_WAIFU__";
    if (!Object.prototype.hasOwnProperty.call(root, GLOBAL)) {
      let stored;
      Object.defineProperty(root, GLOBAL, {
        configurable: true,
        enumerable: true,
        get: () => stored,
        set: (value) => {
          try { transformPlayInfo(value?.roomInitRes?.data); } catch (_error) {}
          stored = value;
        }
      });
    }
  } catch (_error) {}

  // ---------------------------------------------------------------------------------
  // HLS: download the newest segments as soon as the playlist lists them.
  // ---------------------------------------------------------------------------------
  const SEGMENT_TTL_MS = 90 * 1000;
  const MAX_SEGMENTS = 32;
  const AHEAD = 3;
  const segments = new Map(); // absolute URL → { promise, at, used }

  function expire() {
    const now = Date.now();
    for (const [url, entry] of segments) if (now - entry.at > SEGMENT_TTL_MS) segments.delete(url);
    while (segments.size > MAX_SEGMENTS) segments.delete(segments.keys().next().value);
  }

  function parsePlaylist(text, base) {
    const out = { map: null, segments: [], master: false };
    for (const raw of String(text).split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      if (line.startsWith("#EXT-X-STREAM-INF")) out.master = true;
      if (line.startsWith("#EXT-X-MAP")) {
        const uri = /URI="([^"]+)"/.exec(line)?.[1];
        if (uri) out.map = new URL(uri, base).href;
        continue;
      }
      if (line.startsWith("#")) continue;
      try { out.segments.push(new URL(line, base).href); } catch (_error) {}
    }
    return out;
  }

  function prefetchSegment(url) {
    if (segments.has(url)) return;
    const entry = { at: Date.now(), used: false, promise: null };
    entry.promise = (async () => {
      const release = await slots.acquire({ priority: "low" });
      const host = util.hostOf(url);
      const began = native.now();
      hosts.get(host).inflight += 1;
      try {
        const response = await native.fetch(url, { credentials: "omit", mode: "cors", cache: "no-store" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const bytes = new Uint8Array(await response.arrayBuffer());
        stats.addBytes(bytes.byteLength);
        hosts.success(host, bytes.byteLength, native.now() - began);
        return { bytes, status: response.status, contentType: response.headers.get("content-type") || "" };
      } catch (error) {
        hosts.failure(host, String(error?.message || error));
        segments.delete(url);
        throw error;
      } finally {
        hosts.get(host).inflight -= 1;
        release();
      }
    })();
    entry.promise.catch(() => {});
    segments.set(url, entry);
  }

  intercept.observe((url) => /\.m3u8(?:[?#]|$)/i.test(url), (text, url) => {
    if (!active() || bw.guard.paused()) return;
    const playlist = parsePlaylist(text, url);
    if (playlist.master) return;
    expire();
    if (playlist.map) prefetchSegment(playlist.map);
    for (const segment of playlist.segments.slice(-AHEAD)) prefetchSegment(segment);
  });

  intercept.addRoute((request) => {
    if (request.method !== "GET" || request.headers.has("range")) return null;
    const entry = segments.get(request.url);
    if (!entry || entry.used) return null;
    return async () => {
      const result = await entry.promise;
      entry.used = true;
      stats.counters.liveSegments += 1;
      stats.counters.acceleratedBytes += result.bytes.byteLength;
      return intercept.makeResponse(result.bytes, {
        status: result.status,
        headers: { "content-type": result.contentType || "video/mp4", "content-length": String(result.bytes.byteLength), "x-biliweaver": "1" },
        url: request.url
      });
    };
  });

  bw.live = Object.freeze({ transformPlayInfo, parsePlaylist, segments, markHlsFailed, hlsFailedHere });
})(globalThis);
