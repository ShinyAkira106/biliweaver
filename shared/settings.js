// Settings shared by every part of Biliweaver: the page engine, the content relay, the
// service worker and the popup all load this file, so defaults and validation live in one
// place.
(function defineBiliweaverSettings(scope) {
  "use strict";
  if (scope.BiliweaverSettings) return;

  const THREAD_CHOICES = Object.freeze([2, 4, 8, 12, 16, 24, 32]);
  const CHUNK_CHOICES_KB = Object.freeze([256, 512, 1024, 2048]);
  const CDN_MODES = Object.freeze(["auto", "mainland", "overseas", "original", "custom"]);

  // Public mirror hosts of the bilibili video store. Signed video URLs stay valid when only
  // the host changes, so any of these can serve the same file. Hosts that do not answer
  // are cooled down by the engine, so a stale entry here only costs one failed request.
  const MIRRORS = Object.freeze({
    mainland: Object.freeze([
      "upos-sz-mirrorali.bilivideo.com",
      "upos-sz-mirrorcos.bilivideo.com",
      "upos-sz-mirrorhw.bilivideo.com",
      "upos-sz-mirror08c.bilivideo.com",
      "upos-sz-mirroralib.bilivideo.com",
      "upos-sz-mirrorcoso1.bilivideo.com"
    ]),
    overseas: Object.freeze([
      "upos-sz-mirroraliov.bilivideo.com",
      "upos-sz-mirrorcosov.bilivideo.com",
      "upos-sz-mirrorhwov.bilivideo.com",
      "upos-hz-mirrorakam.akamaized.net"
    ])
  });

  const DEFAULTS = Object.freeze({
    enabled: true,
    live: true,
    preferHls: true,
    threads: 8,
    chunkKB: 512,
    prefetch: true,
    cdn: "auto",
    customHosts: Object.freeze([]),
    avoidPcdn: true,
    badge: true,
    playerButton: true,
    language: "auto"
  });

  const HOST_PATTERN = /^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?(?:\.[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?)+$/;

  function cleanHosts(list) {
    const seen = new Set();
    const out = [];
    for (const raw of Array.isArray(list) ? list : String(list || "").split(/[\s,;]+/)) {
      const host = String(raw || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
      if (!host || host.length > 253 || !HOST_PATTERN.test(host) || seen.has(host)) continue;
      seen.add(host);
      out.push(host);
      if (out.length >= 24) break;
    }
    return out;
  }

  function nearest(choices, value, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return choices.reduce((best, item) => (Math.abs(item - number) < Math.abs(best - number) ? item : best), choices[0]);
  }

  function normalize(input) {
    const source = input && typeof input === "object" ? input : {};
    return {
      enabled: source.enabled !== false,
      live: source.live !== false,
      preferHls: source.preferHls !== false,
      threads: nearest(THREAD_CHOICES, source.threads, DEFAULTS.threads),
      chunkKB: nearest(CHUNK_CHOICES_KB, source.chunkKB, DEFAULTS.chunkKB),
      prefetch: source.prefetch !== false,
      cdn: CDN_MODES.includes(source.cdn) ? source.cdn : DEFAULTS.cdn,
      customHosts: cleanHosts(source.customHosts),
      avoidPcdn: source.avoidPcdn !== false,
      badge: source.badge !== false,
      playerButton: source.playerButton !== false,
      language: ["auto", "zh-CN", "en", "ja"].includes(source.language) ? source.language : "auto"
    };
  }

  const api = Object.freeze({ DEFAULTS, MIRRORS, THREAD_CHOICES, CHUNK_CHOICES_KB, CDN_MODES, normalize, cleanHosts, STORAGE_CACHE_KEY: "biliweaver:settings" });
  Object.defineProperty(scope, "BiliweaverSettings", { value: api, configurable: false, enumerable: false, writable: false });
})(globalThis);
