// Biliweaver page module: the route self test.
//
// Asks every host that could serve the current video for its first 256 KB: the addresses
// bilibili listed, the built in mirrors (mainland and overseas) and any custom hosts. For
// each it reports whether the host answered a byte range correctly, how long the first
// byte took and how fast the rest came. The results also feed the engine's host scores,
// so a test run immediately helps the next real request.
//
// Requested with a "biliweaver:selftest" event ({ id }); answered with
// "biliweaver:selftest-result" ({ id, result }). Both carry JSON text.
(function defineBiliweaverSelfTest(root) {
  "use strict";
  const bw = root.__biliweaver;
  if (!bw || bw.selfTest) return;
  const { util, native, hosts } = bw;
  const { MIRRORS } = root.BiliweaverSettings;
  const PROBE_BYTES = 256 * 1024;
  const TIMEOUT_MS = 8000;

  async function probe(url, source) {
    const host = util.hostOf(url);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const began = native.now();
    try {
      const response = await native.fetch(url, {
        headers: { Range: `bytes=0-${PROBE_BYTES - 1}` },
        credentials: "omit",
        mode: "cors",
        cache: "no-store",
        signal: controller.signal
      });
      const firstByteMs = native.now() - began;
      if (response.status !== 206) throw new Error(`HTTP ${response.status}`);
      const range = util.parseContentRange(response.headers.get("content-range"));
      if (!range || range.start !== 0) throw new Error("bad Content-Range");
      const bytes = (await response.arrayBuffer()).byteLength;
      const totalMs = native.now() - began;
      hosts.success(host, bytes, totalMs);
      // Speed of the body alone, so a slow first byte shows up as latency, not as speed.
      const bodyMs = Math.max(1, totalMs - firstByteMs);
      return { host, source, ok: true, firstByteMs: Math.round(firstByteMs), speedKBps: Math.round((bytes / bodyMs) * 1000 / 1024), total: range.total };
    } catch (error) {
      const message = controller.signal.aborted ? "timed out" : String(error?.message || error).slice(0, 80);
      hosts.failure(host, message);
      return { host, source, ok: false, error: message };
    } finally {
      clearTimeout(timer);
    }
  }

  let running = null;
  async function run() {
    if (!bw.vod) return { ok: false, reason: bw.live ? "live" : "noVideo" };
    const url = bw.vod.testTarget();
    if (!url) return { ok: false, reason: "noVideo" };
    const { template, rewritable, known } = bw.vod.templateFor(url);
    const list = [];
    const seen = new Set();
    const add = (candidate, source) => {
      const host = util.hostOf(candidate);
      if (!host || seen.has(host)) return;
      seen.add(host);
      list.push({ url: candidate, source, pcdn: util.isPcdn(candidate) });
    };
    for (const item of known) add(item, "bilibili");
    if (rewritable) {
      for (const name of MIRRORS.mainland) add(util.withHost(template, name), "mainland");
      for (const name of MIRRORS.overseas) add(util.withHost(template, name), "overseas");
      for (const name of bw.settings.customHosts) add(util.withHost(template, name), "custom");
    }
    const results = await Promise.all(list.map((item) => probe(item.url, item.source).then((result) => ({ ...result, pcdn: item.pcdn }))));

    // Every host serves the same file, so the size most of them report is the true one;
    // a host that reports another size is serving something else.
    const counts = new Map();
    for (const result of results) if (result.ok && result.total) counts.set(result.total, (counts.get(result.total) || 0) + 1);
    const expected = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    for (const result of results) {
      if (result.ok && expected && result.total !== expected) {
        result.ok = false;
        result.error = "file size differs";
        hosts.failure(result.host, result.error, { hard: true });
      }
      delete result.total;
    }
    results.sort((a, b) => (Number(b.ok) - Number(a.ok)) || ((b.speedKBps || 0) - (a.speedKBps || 0)));
    return { ok: true, at: Date.now(), tested: results.length, working: results.filter((result) => result.ok).length, results };
  }

  bw.selfTest = () => {
    if (!running) running = run().catch((error) => ({ ok: false, reason: "error", message: String(error?.message || error) })).finally(() => { running = null; });
    return running;
  };

  root.document?.addEventListener("biliweaver:selftest", (event) => {
    let id = "";
    try { id = String(JSON.parse(event.detail).id || ""); } catch (_error) { return; }
    bw.selfTest().then((result) => {
      root.document.dispatchEvent(new CustomEvent("biliweaver:selftest-result", { detail: JSON.stringify({ id, result }) }));
    });
  });
})(globalThis);
