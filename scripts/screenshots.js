// Renders the README images into docs/images from the built extension (dist/biliweaver):
//   node scripts/build.mjs && node scripts/screenshots.js
// Needs Playwright with Chromium. The player is a drawn mock, not bilibili footage; the
// CDN answers come from a local simulation, so the numbers are illustrative.
"use strict";
const path = require("node:path");
const fs = require("node:fs");
const { chromium } = require("playwright");

const root = path.resolve(__dirname, "..");
const extensionPath = path.join(root, "dist", "biliweaver");
const out = path.join(root, "docs", "images");
fs.mkdirSync(out, { recursive: true });

const SIZE = 48 * 1024 * 1024;
const PATH = "/upgcxcode/11/22/33/33-1-30080.m4s?deadline=1&upsig=x&os=cosbv";
const cors = { "access-control-allow-origin": "*", "access-control-expose-headers": "content-range, content-length, content-type" };
const icon = (d, extra = "") => `<svg viewBox="0 0 22 22" width="22" height="22"${extra}>${d}</svg>`;

const PLAYER = `<!doctype html><html><head><meta charset="utf-8"><script>
window.__playinfo__ = { data: { dash: { video: [{ baseUrl: "https://upos-sz-mirrorcos.bilivideo.com${PATH}", backupUrl: ["https://upos-sz-mirrorali.bilivideo.com${PATH}"] }] } } };
</script><style>
html,body{margin:0;background:#101114;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Hiragino Sans","Microsoft YaHei",sans-serif}
.stage{position:relative;width:1280px;height:720px;overflow:hidden;
  background:radial-gradient(60% 70% at 72% 30%,#3b5d7a 0%,transparent 60%),radial-gradient(50% 60% at 22% 75%,#6b4a5e 0%,transparent 60%),radial-gradient(40% 40% at 45% 45%,#2f5f57 0%,transparent 70%),linear-gradient(160deg,#1b2230,#14161c 60%,#1d1a22)}
.stage::before{content:"";position:absolute;inset:0;background:repeating-linear-gradient(115deg,rgba(255,255,255,.035) 0 2px,transparent 2px 22px)}
.sun{position:absolute;right:220px;top:120px;width:180px;height:180px;border-radius:50%;background:radial-gradient(circle,#f3d9a4 0%,#e9a96a 45%,transparent 70%);opacity:.55;filter:blur(2px)}
.hill{position:absolute;left:-10%;right:-10%;bottom:-120px;height:360px;border-radius:50%;background:linear-gradient(#24343a,#151b1f)}
.hill.two{bottom:-170px;left:30%;right:-30%;height:330px;background:linear-gradient(#2c3b33,#141a17)}
.bpx-player-control-wrap{position:absolute;left:0;right:0;bottom:0;height:96px;background:linear-gradient(transparent,rgba(0,0,0,.72))}
.progress{position:absolute;left:20px;right:20px;bottom:58px;height:3px;border-radius:2px;background:rgba(255,255,255,.22)}
.progress .buf{position:absolute;left:0;top:0;bottom:0;width:71%;background:rgba(255,255,255,.45);border-radius:2px}
.progress .played{position:absolute;left:0;top:0;bottom:0;width:26%;background:#00aeec;border-radius:2px}
.progress .dot{position:absolute;left:26%;top:50%;width:12px;height:12px;margin:-6px 0 0 -6px;border-radius:50%;background:#fff;box-shadow:0 0 0 3px rgba(0,174,236,.35)}
.left{position:absolute;left:14px;bottom:10px;height:36px;display:flex;align-items:center;gap:6px;color:hsla(0,0%,100%,.9);font-size:14px}
.bpx-player-control-bottom-right{position:absolute;right:12px;bottom:10px;display:flex;align-items:center;height:36px}
.bpx-player-ctrl-btn{width:36px;height:36px;margin:0 4px;display:flex;align-items:center;justify-content:center;color:hsla(0,0%,100%,.9);font-size:14px}
.bpx-player-ctrl-btn.text{width:auto;padding:0 8px}
</style></head><body><div class="stage" id="player"><div class="sun"></div><div class="hill"></div><div class="hill two"></div>
<div class="bpx-player-control-wrap"><div class="progress"><div class="buf"></div><div class="played"></div><div class="dot"></div></div>
<div class="left"><div class="bpx-player-ctrl-btn">${icon('<path d="M7 4.5v13l11-6.5z" fill="currentColor"/>')}</div><span>02:14 / 08:37</span></div>
<div class="bpx-player-control-bottom-right" id="right">
<div class="bpx-player-ctrl-btn text">1080P 高清</div><div class="bpx-player-ctrl-btn text">倍速</div>
<div class="bpx-player-ctrl-btn">${icon('<path d="M3.5 8.5h3.5l5-4v13l-5-4H3.5z" fill="currentColor"/><path d="M15 8a4 4 0 0 1 0 6M17.2 5.8a7 7 0 0 1 0 10.4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>')}</div>
<div class="bpx-player-ctrl-btn bpx-player-ctrl-setting">${icon('<path fill="currentColor" d="M18.2 12.1a6.6 6.6 0 0 0 0-2.2l1.8-1.4-1.8-3.1-2.1.9a6.8 6.8 0 0 0-1.9-1.1L13.9 3h-3.6L10 5.2a6.8 6.8 0 0 0-1.9 1.1L6 5.4 4.2 8.5 6 9.9a6.6 6.6 0 0 0 0 2.2l-1.8 1.4L6 16.6l2.1-.9a6.8 6.8 0 0 0 1.9 1.1l.3 2.2h3.6l.3-2.2a6.8 6.8 0 0 0 1.9-1.1l2.1.9 1.8-3.1zM12.1 14a3 3 0 1 1 0-6 3 3 0 0 1 0 6z" transform="translate(-1 0)"/>')}</div>
<div class="bpx-player-ctrl-btn">${icon('<rect x="3" y="5" width="16" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><rect x="11" y="11" width="6" height="4.5" rx="1" fill="currentColor"/>')}</div>
<div class="bpx-player-ctrl-btn">${icon('<rect x="3" y="5" width="16" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8 9l-2 2 2 2M14 9l2 2-2 2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>')}</div>
<div class="bpx-player-ctrl-btn">${icon('<path d="M4 8V4h4M14 4h4v4M18 14v4h-4M8 18H4v-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>')}</div>
</div></div></div></body></html>`;

// Host names in the pictures are made up (example.* domains); no real CDN appears.
const FAKE_STATS = JSON.stringify({ version: "", enabled: true, page: "video", speedBps: 11.6 * 1024 * 1024, activeThreads: 8, queued: 0, acceleratedRequests: 42, acceleratedBytes: 186.4 * 1024 * 1024, cacheHits: 17, fallbacks: 0, liveSegments: 0, recentErrors: [], hosts: [
  { host: "edge-sh-01.example-cdn.net", speedKBps: 4710, bytes: 61e6, requests: 40, errors: 0, inflight: 3, cooling: false },
  { host: "edge-bj-02.example-cdn.net", speedKBps: 3980, bytes: 52e6, requests: 35, errors: 0, inflight: 2, cooling: false },
  { host: "global-edge-hk.example-overseas.net", speedKBps: 2350, bytes: 41e6, requests: 28, errors: 0, inflight: 2, cooling: false },
  { host: "edge-gz-03.example-cdn.net", speedKBps: 1460, bytes: 32e6, requests: 22, errors: 1, inflight: 1, cooling: false }
] });

// Plausible self test results for the pictures. A local simulation answers instantly,
// which would show unrealistic speeds; the captions say these are example numbers.
const DEMO_SELF_TEST = { ok: true, tested: 10, working: 8, results: [
  ["edge-sh-01.example-cdn.net", "bilibili", 38, 10040], ["edge-bj-02.example-cdn.net", "bilibili", 45, 8290],
  ["mirror-hz-1.example-mirror.net", "mainland", 52, 7580], ["mirror-sz-2.example-mirror.net", "mainland", 61, 6350],
  ["mirror-cd-3.example-mirror.net", "mainland", 58, 6040], ["mirror-tokyo.example-overseas.net", "overseas", 212, 2150],
  ["mirror-singapore.example-overseas.net", "overseas", 236, 1840], ["mirror-losangeles.example-overseas.net", "overseas", 251, 1630]
].map(([host, source, firstByteMs, speedKBps]) => ({ host, source, ok: true, firstByteMs, speedKBps, pcdn: false })).concat([
  { host: "mirror-wh-4.example-mirror.net", source: "mainland", ok: false, error: "timed out", pcdn: false },
  { host: "global-edge-hk.example-overseas.net", source: "overseas", ok: false, error: "HTTP 403", pcdn: false }
]) };

(async () => {
  const context = await chromium.launchPersistentContext("", {
    headless: true, channel: "chromium", deviceScaleFactor: 2, viewport: { width: 1280, height: 720 },
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
  });
  await context.route(/^https:\/\/www\.bilibili\.com\//, (route) => route.fulfill({ contentType: "text/html", body: PLAYER }));
  // Simulated CDN: a few hosts at different speeds, a couple that do not answer.
  const speeds = { "upos-sz-mirrorcos": 9, "upos-sz-mirrorali": 6, "upos-sz-mirrorhw": 3, "upos-sz-mirrorcoso1": 4, "upos-sz-mirroralib": 5, "upos-sz-mirrorcosov": 2, "upos-sz-mirroraliov": 2, "upos-sz-mirrorhwov": 1 };
  await context.route(/^https:\/\/upos-[^/]+\//, async (route) => {
    const host = new URL(route.request().url()).hostname.split(".")[0];
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: { ...cors, "access-control-allow-headers": "range" } });
    if (!speeds[host]) return route.abort();
    const match = /bytes=(\d+)-(\d*)/.exec(route.request().headers().range || "") || [0, "0", String(SIZE - 1)];
    const start = Number(match[1]);
    const end = Math.min(SIZE - 1, match[2] ? Number(match[2]) : SIZE - 1);
    await new Promise((resolve) => setTimeout(resolve, 30 + 200 / speeds[host]));
    return route.fulfill({ status: 206, headers: { ...cors, "content-type": "video/mp4", "content-range": `bytes ${start}-${end}/${SIZE}` }, body: Buffer.alloc(end - start + 1, 7) });
  });

  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent("serviceworker");
  const id = new URL(worker.url()).host;
  const setLanguage = (language) => worker.evaluate((value) => chrome.storage.sync.set({ language: value, threads: 8, cdn: "auto" }), language);

  const page = await context.newPage();
  await page.goto("https://www.bilibili.com/video/demo/");
  await page.waitForSelector("#right .biliweaver-ctrl");
  await page.evaluate((demo) => {
    window.__biliweaver.selfTest = () => new Promise((resolve) => setTimeout(() => resolve({ ...demo, at: Date.now() }), 600));
  }, DEMO_SELF_TEST);
  await page.evaluate((fake) => { window.__fake = setInterval(() => document.dispatchEvent(new CustomEvent("biliweaver:stats", { detail: fake })), 100); }, FAKE_STATS);

  // Player panel, Chinese.
  await setLanguage("zh-CN");
  await page.waitForTimeout(400);
  await page.click("#right .biliweaver-ctrl");
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(out, "player-panel.png"), clip: { x: 640, y: 120, width: 640, height: 600 } });

  // Self test in the panel, English.
  await setLanguage("en");
  await page.waitForTimeout(400);
  const panel = page.locator("#right .biliweaver-ctrl .panel");
  await panel.locator(".nav-row[data-open='selftest-view']").click();
  await panel.locator(".selftest-view .st-row").first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(out, "player-selftest.png"), clip: { x: 640, y: 220, width: 640, height: 500 } });
  await page.keyboard.press("Escape");
  await page.mouse.click(300, 300);

  // Full player with the button in place, no panel.
  await setLanguage("zh-CN");
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(out, "player-bar.png"), clip: { x: 680, y: 640, width: 600, height: 80 } });

  // Settings pages.
  const options = await context.newPage();
  await options.setViewportSize({ width: 1280, height: 760 });
  await setLanguage("zh-CN");
  await options.goto(`chrome-extension://${id}/options/options.html#video`);
  await options.waitForSelector(".setting .desc");
  await options.screenshot({ path: path.join(out, "settings.png") });
  await setLanguage("ja");
  await options.goto(`chrome-extension://${id}/options/options.html#about`);
  await options.waitForSelector(".about .copyright");
  await options.screenshot({ path: path.join(out, "settings-about-ja.png") });
  await setLanguage("en");
  await options.goto(`chrome-extension://${id}/options/options.html#status`);
  await options.locator(".page-card header button").first().click();
  await options.locator(".st-box table tbody tr").first().waitFor({ timeout: 20000 });
  await options.waitForTimeout(800);
  await options.screenshot({ path: path.join(out, "settings-status.png"), fullPage: true });

  // Toolbar popup (opened as a page, which renders the same document).
  await setLanguage("zh-CN");
  const popup = await context.newPage();
  await popup.setViewportSize({ width: 340, height: 600 });
  // Shown dark, as it looks in a browser using the dark theme.
  await popup.emulateMedia({ colorScheme: "dark" });
  // The popup follows the system theme; most people see it dark, as in the real toolbar.
  await popup.emulateMedia({ colorScheme: "dark" });
  await page.bringToFront();
  await popup.goto(`chrome-extension://${id}/popup/popup.html`);
  await popup.waitForTimeout(400);
  await popup.screenshot({ path: path.join(out, "popup.png"), fullPage: true });

  await worker.evaluate(() => chrome.storage.sync.set({ language: "auto" }));
  await context.close();
  console.log(fs.readdirSync(out).join("\n"));
})().catch((error) => { console.error(error); process.exit(1); });
