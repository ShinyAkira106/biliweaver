// Engine tests in Node: the page modules run in a VM context with a simulated set of CDN
// hosts behind fetch. Run with `node tests/engine-test.mjs`.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import assert from "node:assert/strict";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const FILE_SIZE = 8 * 1024 * 1024 + 12345;
const fileBytes = new Uint8Array(FILE_SIZE);
for (let i = 0; i < FILE_SIZE; i += 1) fileBytes[i] = (i * 31 + (i >> 9)) & 255;
const PATH = "/upgcxcode/12/34/56789/56789-1-30080.m4s";
const QUERY = "?deadline=1&upsig=abc&os=cosbv";

// host → behaviour
let cdn = {};
let requests = [];
let nativeCalls = [];
function resetCdn(map) {
  cdn = map;
  requests = [];
  nativeCalls = [];
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fakeFetch(input, init = {}) {
  const url = new URL(typeof input === "string" ? input : input.url);
  nativeCalls.push(url.href);
  if (url.pathname.includes("playurl")) {
    return new Response(JSON.stringify(playurlAnswer), { headers: { "content-type": "application/json" } });
  }
  const behaviour = cdn[url.hostname];
  const range = new Headers(init.headers).get("range");
  requests.push({ host: url.hostname, range });
  if (init.signal?.aborted) throw new DOMException("aborted", "AbortError");
  if (!behaviour) throw new TypeError("Failed to fetch");
  await sleep(behaviour.latency ?? 5);
  if (behaviour.status) return new Response("no", { status: behaviour.status });
  const size = behaviour.size ?? FILE_SIZE;
  let start = 0;
  let end = size - 1;
  const match = /bytes=(\d+)-(\d*)/.exec(range || "");
  if (match && !behaviour.ignoreRange) {
    start = Number(match[1]);
    end = Math.min(size - 1, match[2] ? Number(match[2]) : size - 1);
  }
  const body = fileBytes.slice(start, end + 1);
  const bps = behaviour.bps ?? 200 * 1024 * 1024;
  const stream = new ReadableStream({
    async start(controller) {
      const step = 64 * 1024;
      for (let offset = 0; offset < body.length; offset += step) {
        if (init.signal?.aborted) { controller.error(new DOMException("aborted", "AbortError")); return; }
        const part = body.slice(offset, offset + step);
        await sleep((part.length / bps) * 1000);
        controller.enqueue(part);
      }
      controller.close();
    }
  });
  const headers = { "content-type": "video/mp4" };
  if (match && !behaviour.ignoreRange) headers["content-range"] = `bytes ${start}-${end}/${size}`;
  return new Response(stream, { status: match && !behaviour.ignoreRange ? 206 : 200, headers });
}

const playurlAnswer = {
  code: 0,
  data: {
    dash: {
      video: [{
        id: 80,
        baseUrl: `https://upos-sz-mirrorcos.bilivideo.com${PATH}${QUERY}`,
        backupUrl: [`https://upos-sz-mirrorali.bilivideo.com${PATH}${QUERY}`, `https://cn-backup-01.bilivideo.com${PATH}${QUERY}`]
      }]
    }
  }
};

class FakeXHR extends EventTarget {}
FakeXHR.prototype.open = function open() {};
FakeXHR.prototype.send = function send() {};
FakeXHR.prototype.setRequestHeader = function setRequestHeader() {};
FakeXHR.prototype.abort = function abort() {};

const storage = new Map();
const context = vm.createContext({
  console, setTimeout, clearTimeout, setInterval, clearInterval, URL, Headers, Response, Request, ReadableStream,
  AbortController, DOMException, TextDecoder, TextEncoder, Blob, Event, EventTarget, CustomEvent,
  performance, Promise, Uint8Array, ArrayBuffer, JSON, Math, Date, Map, Set, WeakMap, Object, Array, Number, String, Error, TypeError, RegExp, Symbol,
  ProgressEvent: class ProgressEvent extends Event { constructor(type, init = {}) { super(type); Object.assign(this, init); } },
  fetch: fakeFetch,
  XMLHttpRequest: FakeXHR,
  location: { href: "https://www.bilibili.com/video/BV1test", hostname: "www.bilibili.com" },
  localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)), removeItem: (key) => storage.delete(key) },
  document: new EventTarget(),
  __BILIWEAVER_TEST__: true
});
context.globalThis = context;
context.window = context;
for (const file of ["shared/settings.js", "page/core.js", "page/transfer.js", "page/intercept.js", "page/vod.js", "page/live.js", "page/selftest.js"]) {
  vm.runInContext(readFileSync(join(root, file), "utf8"), context, { filename: file });
}
const bw = context.__biliweaver;
const setSettings = (patch) => context.document.dispatchEvent(new CustomEvent("biliweaver:settings", { detail: JSON.stringify({ ...context.BiliweaverSettings.DEFAULTS, ...patch }) }));
setSettings({});
await bw.ready;

const mediaUrl = `https://upos-sz-mirrorcos.bilivideo.com${PATH}${QUERY}`;
const pageFetch = (url, init) => context.fetch(url, init);
const bytesOf = async (response) => new Uint8Array(await response.arrayBuffer());
const same = (actual, start, end) => {
  assert.equal(actual.length, end - start + 1, "length");
  for (let i = 0; i < actual.length; i += 4099) assert.equal(actual[i], fileBytes[start + i], `byte ${start + i}`);
  assert.equal(actual[actual.length - 1], fileBytes[end], "last byte");
};
const fresh = async () => {
  // Let downloads left over from the previous test finish first.
  for (let i = 0; i < 100 && (bw.slots.inUse || bw.slots.queued); i += 1) await sleep(50);
  bw.transfer._files.clear();
  bw.vod.alternates.clear();
  bw.hosts.reset();
};

const healthy = () => ({
  "upos-sz-mirrorcos.bilivideo.com": { bps: 40 * 1024 * 1024 },
  "upos-sz-mirrorali.bilivideo.com": { bps: 40 * 1024 * 1024 },
  "upos-sz-mirrorhw.bilivideo.com": { bps: 40 * 1024 * 1024 },
  "upos-sz-mirror08c.bilivideo.com": { bps: 40 * 1024 * 1024 }
});

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test("splits one range into parallel pieces on several hosts", async () => {
  await fresh();
  resetCdn(healthy());
  setSettings({ prefetch: false });
  const response = await pageFetch(mediaUrl, { headers: { Range: "bytes=0-4194303" } });
  assert.equal(response.status, 206);
  assert.equal(response.headers.get("content-range"), `bytes 0-4194303/${FILE_SIZE}`);
  same(await bytesOf(response), 0, 4194303);
  const pieceRequests = requests.filter((item) => item.range);
  assert.ok(pieceRequests.length >= 4, `expected several pieces, got ${pieceRequests.length}`);
  assert.ok(new Set(pieceRequests.map((item) => item.host)).size >= 2, "expected more than one host");
});

test("a host answering 403 is cooled down and the bytes still arrive", async () => {
  await fresh();
  resetCdn({ ...healthy(), "upos-sz-mirrorali.bilivideo.com": { status: 403 } });
  setSettings({ prefetch: false });
  const response = await pageFetch(mediaUrl, { headers: { Range: "bytes=1000-3000000" } });
  same(await bytesOf(response), 1000, 3000000);
  const ali = bw.hosts.snapshot().find((item) => item.host === "upos-sz-mirrorali.bilivideo.com");
  assert.ok(!ali || ali.cooling, "403 host should be cooling");
});

test("a host reporting a different file size is never trusted", async () => {
  await fresh();
  resetCdn({ ...healthy(), "upos-sz-mirrorhw.bilivideo.com": { size: FILE_SIZE - 1 } });
  setSettings({ prefetch: false, threads: 16 });
  const response = await pageFetch(mediaUrl, { headers: { Range: "bytes=0-2097151" } });
  same(await bytesOf(response), 0, 2097151);
});

test("open-ended range runs to the end of the file", async () => {
  await fresh();
  resetCdn(healthy());
  setSettings({ prefetch: false });
  const response = await pageFetch(mediaUrl, { headers: { Range: `bytes=${FILE_SIZE - 900000}-` } });
  assert.equal(response.headers.get("content-range"), `bytes ${FILE_SIZE - 900000}-${FILE_SIZE - 1}/${FILE_SIZE}`);
  same(await bytesOf(response), FILE_SIZE - 900000, FILE_SIZE - 1);
});

test("a request without Range gets the whole file with status 200", async () => {
  await fresh();
  resetCdn(healthy());
  setSettings({ prefetch: false });
  const response = await pageFetch(mediaUrl);
  assert.equal(response.status, 200);
  same(await bytesOf(response), 0, FILE_SIZE - 1);
});

test("prefetch answers the next sequential request from the cache", async () => {
  await fresh();
  resetCdn(healthy());
  setSettings({ prefetch: true });
  const hitsBefore = bw.stats.counters.cacheHits;
  await bytesOf(await pageFetch(mediaUrl, { headers: { Range: "bytes=0-1048575" } }));
  await sleep(300);
  const before = requests.length;
  same(await bytesOf(await pageFetch(mediaUrl, { headers: { Range: "bytes=1048576-2097151" } })), 1048576, 2097151);
  // New requests may only be the prefetch moving further ahead, never the range itself.
  const overlapping = requests.slice(before).filter((item) => Number(/bytes=(\d+)-(\d+)/.exec(item.range)?.[2]) >= 1048576 && Number(/bytes=(\d+)-/.exec(item.range)?.[1]) <= 2097151);
  assert.equal(overlapping.length, 0, `second range was fetched again: ${JSON.stringify(overlapping)}`);
  assert.ok(bw.stats.counters.cacheHits > hitsBefore);
});

test("a very slow host is raced by a second one", async () => {
  await fresh();
  resetCdn({
    "upos-sz-mirrorcos.bilivideo.com": { bps: 30 * 1024 },
    "upos-sz-mirrorali.bilivideo.com": { bps: 30 * 1024 * 1024 }
  });
  setSettings({ prefetch: false, cdn: "original", threads: 2 });
  bw.vod.scan(playurlAnswer);
  // The slow host looks like the fastest one, so it is picked first and has to be raced.
  bw.hosts.success("upos-sz-mirrorcos.bilivideo.com", 10 * 1024 * 1024, 100);
  bw.hosts.success("upos-sz-mirrorali.bilivideo.com", 1024 * 1024, 100);
  bw.hosts.failure("cn-backup-01.bilivideo.com", "test");
  const began = Date.now();
  same(await bytesOf(await pageFetch(mediaUrl, { headers: { Range: "bytes=0-524287" } })), 0, 524287);
  assert.ok(Date.now() - began < 6000, `took ${Date.now() - began} ms`);
  assert.deepEqual(requests.map((item) => item.host), ["upos-sz-mirrorcos.bilivideo.com", "upos-sz-mirrorali.bilivideo.com"]);
});

test("aborting the request rejects with AbortError", async () => {
  await fresh();
  resetCdn({ "upos-sz-mirrorcos.bilivideo.com": { bps: 200 * 1024 } });
  setSettings({ prefetch: false, cdn: "original" });
  const controller = new AbortController();
  const pending = pageFetch(mediaUrl, { headers: { Range: "bytes=0-4194303" }, signal: controller.signal }).then(bytesOf);
  setTimeout(() => controller.abort(), 100);
  await assert.rejects(pending, (error) => error.name === "AbortError");
});

test("switched off, requests go out untouched", async () => {
  await fresh();
  resetCdn(healthy());
  setSettings({ enabled: false });
  const response = await pageFetch(mediaUrl, { headers: { Range: "bytes=0-99" } });
  assert.equal(response.headers.get("x-biliweaver"), null);
  assert.deepEqual(requests.map((item) => item.host), ["upos-sz-mirrorcos.bilivideo.com"]);
  setSettings({});
});

test("play address answers add their backup hosts as candidates", async () => {
  await fresh();
  resetCdn(healthy());
  setSettings({ cdn: "original" });
  await (await pageFetch("https://api.bilibili.com/x/player/wbi/playurl?bvid=BV1test")).text();
  await sleep(20);
  const hostsFound = bw.vod.candidatesFor(mediaUrl).map((item) => item.host);
  assert.ok(hostsFound.includes("upos-sz-mirrorali.bilivideo.com"));
  assert.ok(hostsFound.includes("cn-backup-01.bilivideo.com"));
});

test("PCDN addresses are skipped when better ones exist", async () => {
  await fresh();
  setSettings({ cdn: "auto", avoidPcdn: true });
  const pcdn = `https://xy123x45x67x89xy.mcdn.bilivideo.cn:4483${PATH}${QUERY}`;
  bw.vod.scan({ baseUrl: pcdn, backupUrl: [mediaUrl] });
  const list = bw.vod.candidatesFor(pcdn);
  assert.notEqual(list[0].host, "xy123x45x67x89xy.mcdn.bilivideo.cn:4483");
  assert.ok(list.find((item) => item.host.startsWith("xy123")).penalty >= 4);
});

test("live play info prefers HLS fMP4 and keeps every host", async () => {
  setSettings({});
  const data = { playurl_info: { playurl: { stream: [
    { protocol_name: "http_stream", format: [{ format_name: "flv", codec: [{ url_info: [{ host: "https://a.bilivideo.com" }] }] }] },
    { protocol_name: "http_hls", format: [
      { format_name: "ts", codec: [{ url_info: [{ host: "https://b.bilivideo.com" }] }] },
      { format_name: "fmp4", codec: [{ url_info: [{ host: "https://c.bilivideo.com" }, { host: "https://d.bilivideo.com" }] }] }
    ] }
  ] } } };
  assert.equal(bw.live.transformPlayInfo(data), true);
  const streams = data.playurl_info.playurl.stream;
  assert.deepEqual(streams.map((item) => item.protocol_name), ["http_hls"]);
  assert.equal(streams[0].format[0].format_name, "fmp4");
  assert.equal(streams[0].format[0].codec[0].url_info.length, 2);
});

test("HLS playlists are parsed relative to their own address", async () => {
  const playlist = bw.live.parsePlaylist("#EXTM3U\n#EXT-X-MAP:URI=\"h1.m4s\"\n#EXTINF:1,\n100.m4s\n#EXTINF:1,\n101.m4s\n", "https://x.bilivideo.com/live-bvc/1/live_1/index.m3u8?sig=1");
  assert.equal(playlist.map, "https://x.bilivideo.com/live-bvc/1/live_1/h1.m4s");
  assert.equal(JSON.stringify(playlist.segments), JSON.stringify(["https://x.bilivideo.com/live-bvc/1/live_1/100.m4s", "https://x.bilivideo.com/live-bvc/1/live_1/101.m4s"]));
});

test("the route self test checks every candidate host and flags a wrong file size", async () => {
  await fresh();
  resetCdn({ ...healthy(), "upos-sz-mirrorhw.bilivideo.com": { size: FILE_SIZE + 10 }, "upos-sz-mirror08c.bilivideo.com": { status: 403 } });
  setSettings({});
  bw.vod.scan(playurlAnswer);
  const result = await bw.selfTest();
  assert.equal(result.ok, true);
  const byHost = Object.fromEntries(result.results.map((item) => [item.host, item]));
  assert.equal(byHost["upos-sz-mirrorcos.bilivideo.com"].ok, true);
  assert.equal(byHost["upos-sz-mirrorcos.bilivideo.com"].source, "bilibili");
  assert.equal(byHost["upos-sz-mirrorali.bilivideo.com"].ok, true);
  assert.equal(byHost["upos-sz-mirror08c.bilivideo.com"].error, "HTTP 403");
  assert.equal(byHost["upos-sz-mirrorhw.bilivideo.com"].error, "file size differs");
  assert.ok(byHost["upos-sz-mirroraliov.bilivideo.com"], "overseas mirrors are tested too");
  assert.equal(result.working, result.results.filter((item) => item.ok).length);
  assert.ok(result.results[0].ok, "working hosts come first");
  assert.ok(JSON.stringify(result).indexOf("upsig") < 0, "no signed addresses in the result");
  // The hosts that failed are cooled down for real requests too.
  assert.ok(bw.hosts.snapshot().find((item) => item.host === "upos-sz-mirror08c.bilivideo.com")?.cooling);
  assert.ok(bw.recentErrors().some((error) => error.host === "upos-sz-mirror08c.bilivideo.com"));
});

test("after repeated failures the engine steps aside for a while", async () => {
  await fresh();
  bw.guard.reset();
  const broken = Object.fromEntries(Object.keys(healthy()).map((host) => [host, { status: 500 }]));
  resetCdn(broken);
  setSettings({ prefetch: false, cdn: "original" });
  for (let i = 0; i < 5; i += 1) {
    bw.hosts.reset();
    const response = await pageFetch(mediaUrl, { headers: { Range: "bytes=0-99" } });
    assert.equal(response.headers.get("x-biliweaver"), null, "a failed attempt falls back to the browser");
  }
  assert.ok(bw.guard.paused(), "should pause after five failures in a row");
  assert.ok(bw.guard.snapshot().paused && bw.guard.snapshot().resumeInMs > 4 * 60 * 1000);
  resetCdn(healthy());
  await pageFetch(mediaUrl, { headers: { Range: "bytes=0-99" } });
  assert.deepEqual(requests.map((item) => item.host), ["upos-sz-mirrorcos.bilivideo.com"], "while paused the request goes out unchanged");
  context.document.dispatchEvent(new CustomEvent("biliweaver:resume"));
  assert.equal(bw.guard.paused(), false);
  bw.guard.reset();
});

test("rate limiting halves the threads", async () => {
  await fresh();
  bw.guard.reset();
  resetCdn({ ...healthy(), "upos-sz-mirrorali.bilivideo.com": { status: 429 }, "upos-sz-mirrorhw.bilivideo.com": { status: 429 }, "upos-sz-mirror08c.bilivideo.com": { status: 429 } });
  setSettings({ prefetch: false, threads: 8 });
  same(await bytesOf(await pageFetch(mediaUrl, { headers: { Range: "bytes=0-4194303" } })), 0, 4194303);
  assert.equal(bw.guard.snapshot().threadLimit, 4);
  assert.equal(bw.guard.threads(), 4);
  assert.ok(bw.recentErrors().some((error) => error.kind === "throttled"));
  bw.guard.reset();
});

test("prefetch waits while the video is paused or data saver is on", async () => {
  await fresh();
  bw.guard.reset();
  resetCdn(healthy());
  setSettings({ prefetch: true });
  bw.media.update(true);
  await bytesOf(await pageFetch(mediaUrl, { headers: { Range: "bytes=0-1048575" } }));
  await sleep(200);
  assert.ok(requests.every((item) => Number(/bytes=\d+-(\d+)/.exec(item.range)?.[1]) <= 1048575), "no prefetch while paused");
  assert.equal(bw.guard.snapshot().prefetchHeld, "paused");
  bw.media.update(false);
  context.navigator = { connection: { saveData: true } };
  assert.equal(bw.media.prefetchHeld(), "saveData");
  await fresh();
  resetCdn(healthy());
  await bytesOf(await pageFetch(mediaUrl, { headers: { Range: "bytes=0-1048575" } }));
  await sleep(200);
  assert.ok(requests.every((item) => Number(/bytes=\d+-(\d+)/.exec(item.range)?.[1]) <= 1048575), "no prefetch with data saver");
  delete context.navigator;
  assert.equal(bw.media.prefetchHeld(), null);
});

test("a live room where HLS failed keeps its FLV streams", async () => {
  bw.guard.reset();
  setSettings({});
  context.location.pathname = "/7734";
  storage.set("biliweaver:hls-failed:7734", String(Date.now()));
  const data = { playurl_info: { playurl: { stream: [
    { protocol_name: "http_stream", format: [{ format_name: "flv", codec: [{ url_info: [{ host: "https://a.bilivideo.com" }] }] }] },
    { protocol_name: "http_hls", format: [{ format_name: "fmp4", codec: [{ url_info: [{ host: "https://c.bilivideo.com" }] }] }] }
  ] } } };
  bw.live.transformPlayInfo(data);
  assert.equal(JSON.stringify(data.playurl_info.playurl.stream.map((item) => item.protocol_name)), JSON.stringify(["http_stream", "http_hls"]));
  assert.equal(bw.guard.snapshot().hlsFallback, true);
  storage.delete("biliweaver:hls-failed:7734");
  delete context.location.pathname;
  bw.guard.reset();
});

test("the cache budget follows the device memory and the second buffer", async () => {
  setSettings({});
  assert.equal(bw.transfer.cacheBudget(), 160 * 1024 * 1024);
  setSettings({ secondaryBuffer: true });
  assert.equal(bw.transfer.cacheBudget(), 512 * 1024 * 1024);
  setSettings({});
});

// A video element the engine can ask for the playback position.
const withVideo = (video) => { context.document.querySelector = (selector) => (selector === "video" ? video : null); };
const highestByte = () => Math.max(...requests.map((item) => Number(/bytes=\d+-(\d+)/.exec(item.range)?.[1]) || 0));

test("prefetch reaches the buffer length past the playback position", async () => {
  for (const [seconds, expectedEnd] of [[45, 45 * 100 * 1024 - 1], [30, 30 * 100 * 1024 - 1]]) {
    await fresh();
    bw.guard.reset();
    resetCdn(healthy());
    setSettings({ prefetch: true, bufferSeconds: seconds });
    withVideo({ isConnected: true, currentTime: 0, duration: 600 });
    bw.media.update(false);
    // 800 kbit/s: 100 KB for each second of video.
    bw.media.setBitrate(bw.util.fileKey(mediaUrl), 800 * 1024);
    await bytesOf(await pageFetch(mediaUrl, { headers: { Range: "bytes=0-1048575" } }));
    for (let i = 0; i < 60 && bw.slots.inUse + bw.slots.queued; i += 1) await sleep(25);
    const top = highestByte();
    assert.ok(Math.abs(top - expectedEnd) < 1024 * 1024, `${seconds} s should reach about ${expectedEnd}, reached ${top}`);
    const memory = bw.transfer.memorySnapshot();
    assert.ok(memory.aheadSeconds >= seconds - 11 && memory.aheadSeconds <= seconds + 1, `buffered ${memory.aheadSeconds} s`);
  }
  delete context.document.querySelector;
  setSettings({});
});

test("4K at 180 seconds is held back by memory unless the second buffer is on", async () => {
  withVideo({ isConnected: true, currentTime: 0, duration: 600 });
  const key = "test-4k";
  bw.media.setBitrate(key, 20 * 1000 * 1000);
  const file = { key, total: 1500 * 1024 * 1024 };
  setSettings({ bufferSeconds: 180 });
  assert.equal(Math.round(bw.transfer.prefetchWindow(file, 0, 1) / 1024 / 1024), 64);
  setSettings({ bufferSeconds: 180, secondaryBuffer: true });
  assert.equal(Math.round(bw.transfer.prefetchWindow(file, 0, 1) / 1024 / 1024), 205);
  delete context.document.querySelector;
  setSettings({});
});

test("a seek stops pieces loaded ahead for the old position", async () => {
  await fresh();
  bw.guard.reset();
  const slow = {};
  for (const [host, value] of Object.entries(healthy())) slow[host] = { ...value, bps: 256 * 1024 };
  resetCdn(slow);
  setSettings({ prefetch: true, bufferSeconds: 180, threads: 2 });
  withVideo({ isConnected: true, currentTime: 0, duration: 600 });
  bw.media.setBitrate(bw.util.fileKey(mediaUrl), 800 * 1024);
  const first = pageFetch(mediaUrl, { headers: { Range: "bytes=0-65535" } });
  await bytesOf(await first);
  const file = bw.transfer._files.get(bw.util.fileKey(mediaUrl));
  assert.ok(file.entries.some((entry) => !entry.done && entry.start > 4 * 1024 * 1024), "loads far ahead first");
  context.document.querySelector("video").currentTime = 75;
  const seekStart = 7 * 1024 * 1024;
  const second = pageFetch(mediaUrl, { headers: { Range: `bytes=${seekStart}-${seekStart + 65535}` } });
  await sleep(20);
  assert.ok(file.entries.every((entry) => entry.done || entry.end >= seekStart), "pieces before the new position stopped");
  await bytesOf(await second);
  delete context.document.querySelector;
  setSettings({});
  await fresh();
});

test("international addresses lead to the same page on the mainland site", async () => {
  const siteContext = vm.createContext({ URL, Intl, Object, String, Set, RegExp, Boolean });
  siteContext.globalThis = siteContext;
  vm.runInContext(readFileSync(join(root, "shared/site.js"), "utf8"), siteContext, { filename: "shared/site.js" });
  const { mainlandUrl } = siteContext.BiliweaverSite;
  const cases = [
    ["https://www.bilibili.com/zh-Hans/video/BV1xx411c7mD/?p=2", "https://www.bilibili.com/video/BV1xx411c7mD/?p=2"],
    ["https://www.bilibili.com/zh-Hans/bangumi/play/ep12345", "https://www.bilibili.com/bangumi/play/ep12345"],
    ["https://www.bilibili.com/en/list/watchlater?bvid=BV1xx", "https://www.bilibili.com/list/watchlater?bvid=BV1xx"],
    ["https://www.bilibili.com/ja/list/ml123456?oid=1", "https://www.bilibili.com/list/ml123456?oid=1"],
    ["https://www.bilibili.com/zh-Hant/", "https://www.bilibili.com/"],
    ["https://www.bilibili.com/video/BV1xx?site=OVERSEAS&lang=en&t=30", "https://www.bilibili.com/video/BV1xx?t=30"],
    ["https://www.bilibili.com/video/BV1xx", ""],
    ["https://www.bilibili.com/", ""],
    ["https://www.bilibili.com/tv/", ""],
    ["https://www.bilibili.com/v/popular/all", ""],
    ["https://www.bilibili.com/id/", "https://www.bilibili.com/"],
    ["https://live.bilibili.com/zh-Hans/123", ""],
    ["not a url", ""]
  ];
  for (const [input, expected] of cases) assert.equal(mainlandUrl(input), expected, input);
});

let failed = 0;
for (const [name, fn] of tests) {
  const began = Date.now();
  try {
    await fn();
    console.log(`ok   ${name} (${Date.now() - began} ms)`);
  } catch (error) {
    failed += 1;
    console.log(`FAIL ${name}\n     ${error.stack || error}`);
  }
}
console.log(failed ? `${failed} of ${tests.length} failed` : `all ${tests.length} passed`);
process.exit(failed ? 1 : 0);
