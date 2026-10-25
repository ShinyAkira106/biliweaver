// Biliweaver page module: videos and bangumi on www.bilibili.com and m.bilibili.com.
//
// The play address API answers with every address of each video and audio stream (main
// and backup). Biliweaver reads those answers, and the copy the page embeds as
// window.__playinfo__, to know which other hosts serve the same file. When the player then
// asks for a byte range of a stream, the request is answered by the parallel downloader
// with pieces from those hosts and from the public mirrors chosen in the settings.
(function defineBiliweaverVod(root) {
  "use strict";
  const bw = root.__biliweaver;
  if (!bw || !bw.transfer || !bw.intercept || bw.vod) return;
  const host = root.location?.hostname || "";
  if (!/^(?:www|m)\.bilibili\.com$/i.test(host) && root.__BILIWEAVER_TEST__ !== true) return;
  const { util, intercept, transfer } = bw;
  const { MIRRORS } = root.BiliweaverSettings;

  // fileKey → Set of absolute URLs that serve it.
  const alternates = new Map();
  // What the route self test measures: the stream the player fetched last, or else the
  // first one the play address answer listed.
  let lastMediaUrl = "";
  let firstListedUrl = "";

  function remember(urls) {
    const clean = urls.map((url) => util.absoluteUrl(url)).filter((url) => /^https?:/i.test(url));
    if (!firstListedUrl) firstListedUrl = clean.find((url) => /\.(?:m4s|mp4|flv)(?:\?|$)/i.test(url)) || "";
    // A backup may name the same stream under another path, so the group is filed under
    // the key of every address in it.
    for (const key of new Set(clean.map(util.fileKey).filter(Boolean))) {
      let set = alternates.get(key);
      if (!set) {
        set = new Set();
        alternates.set(key, set);
      }
      for (const url of clean) set.add(url);
    }
  }

  // Walks any play address answer and remembers every stream that lists addresses.
  function scan(value, depth = 0) {
    if (!value || typeof value !== "object" || depth > 9) return;
    if (Array.isArray(value)) {
      for (const item of value) scan(item, depth + 1);
      return;
    }
    const main = value.baseUrl || value.base_url || (typeof value.url === "string" && /\/upgcxcode\//.test(value.url) ? value.url : "");
    const backups = value.backupUrl || value.backup_url;
    if (typeof main === "string" && main) remember([main, ...(Array.isArray(backups) ? backups.filter((item) => typeof item === "string") : [])]);
    for (const key of Object.keys(value)) {
      const child = value[key];
      if (child && typeof child === "object") scan(child, depth + 1);
    }
  }

  let scannedPlayinfo = null;
  function scanPlayinfo() {
    const info = root.__playinfo__;
    if (!info || info === scannedPlayinfo) return;
    scannedPlayinfo = info;
    try { scan(typeof info === "string" ? JSON.parse(info) : info); } catch (_error) {}
  }

  const PLAY_API = /\/(?:x\/player\/(?:wbi\/)?playurl|x\/player\/online\/playurl|pgc\/player\/web\/(?:v2\/)?playurl|pgc\/player\/web\/playurl\/html5|ogv\/player\/playview|x\/v2\/playurl)(?:[/?]|$)/;
  intercept.observe((url) => PLAY_API.test(url), (text) => {
    try { scan(JSON.parse(text)); } catch (_error) {}
  });

  function isMedia(url) {
    try {
      const parsed = new URL(url);
      if (!/\/upgcxcode\//.test(parsed.pathname)) return false;
      if (!/\.(?:m4s|mp4|flv)$/i.test(parsed.pathname)) return false;
      return /(?:^|\.)(?:bilivideo\.(?:com|cn)|akamaized\.net|szbdyd\.com|hdslb\.com)$/i.test(parsed.hostname) || util.isPcdn(url) || root.__BILIWEAVER_TEST__ === true;
    } catch (_error) {
      return false;
    }
  }

  // Every address Biliweaver may use for this file, best first. `penalty` makes a host
  // less likely to be picked without ruling it out.
  function candidatesFor(url) {
    const settings = bw.settings;
    const key = util.fileKey(url);
    const known = [url, ...(alternates.get(key) || [])];
    const out = [];
    const seen = new Set();
    const add = (candidateUrl, penalty = 0) => {
      const candidateHost = util.hostOf(candidateUrl);
      if (!candidateHost || seen.has(candidateHost)) return;
      seen.add(candidateHost);
      out.push({ url: candidateUrl, host: candidateHost, penalty });
    };
    const isUpos = (item) => { try { return /^upos-/i.test(new URL(item).hostname); } catch (_error) { return false; } };
    const template = known.find((item) => isUpos(item) && !util.isPcdn(item)) || known.find((item) => !util.isPcdn(item)) || url;
    const rewritable = (() => { try { return new URL(template).pathname.startsWith("/upgcxcode/"); } catch (_error) { return false; } })();
    const mirror = (list, penalty) => {
      if (!rewritable) return;
      for (const name of list) add(util.withHost(template, name), penalty);
    };
    const addKnown = (penalty) => {
      for (const item of known) {
        if (settings.avoidPcdn && util.isPcdn(item)) continue;
        add(item, penalty);
      }
    };

    switch (settings.cdn) {
      case "mainland": addKnown(0.2); mirror(MIRRORS.mainland, 0); break;
      case "overseas": mirror(MIRRORS.overseas, 0); addKnown(0.2); break;
      case "original": addKnown(0); break;
      case "custom": mirror(settings.customHosts, 0); addKnown(0.3); break;
      default: addKnown(0); mirror(MIRRORS.mainland, 0); break;
    }
    // The address the player asked for always stays available as the last resort.
    if (!seen.has(util.hostOf(url))) add(url, !out.length ? 0 : util.isPcdn(url) && settings.avoidPcdn ? 4 : 0.5);
    return out;
  }

  intercept.addRoute((request) => {
    if (request.method !== "GET" || !isMedia(request.url)) return null;
    if (bw.isReady && !bw.settings.enabled) return null;
    const rangeHeader = request.headers.get("range");
    if (rangeHeader && !util.parseRangeHeader(rangeHeader)) return null;
    return async () => {
      await bw.ready;
      if (!bw.settings.enabled) throw intercept.PASS;
      scanPlayinfo();
      lastMediaUrl = request.url;
      const range = rangeHeader ? util.parseRangeHeader(rangeHeader) : { start: 0, end: null };
      const result = await transfer.fetchRange({
        key: util.fileKey(request.url),
        candidates: candidatesFor(request.url),
        start: range.start,
        end: range.end,
        signal: request.signal
      });
      const length = result.end - result.start + 1;
      const headers = {
        "content-type": result.contentType,
        "content-length": String(length),
        "accept-ranges": "bytes",
        "x-biliweaver": "1"
      };
      if (rangeHeader) headers["content-range"] = `bytes ${result.start}-${result.end}/${result.total}`;
      return intercept.makeResponse(result.stream(), { status: rangeHeader ? 206 : 200, headers, url: request.url });
    };
  });

  // The address mirror hosts are swapped into: a main store address if one is known.
  function templateFor(url) {
    const known = [url, ...(alternates.get(util.fileKey(url)) || [])];
    const isUpos = (item) => { try { return /^upos-/i.test(new URL(item).hostname); } catch (_error) { return false; } };
    const template = known.find((item) => isUpos(item) && !util.isPcdn(item)) || known.find((item) => !util.isPcdn(item)) || url;
    let rewritable = false;
    try { rewritable = new URL(template).pathname.startsWith("/upgcxcode/"); } catch (_error) {}
    return { template, rewritable, known };
  }

  function testTarget() {
    if (lastMediaUrl) return lastMediaUrl;
    scanPlayinfo();
    return firstListedUrl;
  }

  bw.vod = Object.freeze({ scan, candidatesFor, isMedia, alternates, templateFor, testTarget });
})(globalThis);
