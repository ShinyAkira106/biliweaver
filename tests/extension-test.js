// End-to-end test: loads the unpacked extension into Chromium (Playwright), serves stub
// bilibili pages and a simulated CDN through request routing, and checks what the page
// receives. Run with `node tests/extension-test.js` (Playwright must be resolvable, for
// example through NODE_PATH).
"use strict";
const path = require("node:path");
const assert = require("node:assert/strict");
const { chromium } = require("playwright");

const extensionPath = path.resolve(process.argv[2] || path.join(__dirname, ".."));
const SIZE = 6 * 1024 * 1024 + 777;
const file = Buffer.alloc(SIZE);
for (let i = 0; i < SIZE; i += 1) file[i] = (i * 7 + (i >> 11)) & 255;
const PATH = "/upgcxcode/11/22/33/33-1-30080.m4s?deadline=1&upsig=x&os=cosbv";
const CDN_HOSTS = ["upos-sz-mirrorcos.bilivideo.com", "upos-sz-mirrorali.bilivideo.com", "upos-sz-mirrorhw.bilivideo.com"];
const cors = { "access-control-allow-origin": "*", "access-control-expose-headers": "content-range, content-length, content-type", "access-control-allow-headers": "range" };

const VIDEO_PAGE = `<!doctype html><html><head><script>
window.__playinfo__ = { data: { dash: { video: [{ baseUrl: "https://upos-sz-mirrorcos.bilivideo.com${PATH}", backupUrl: ["https://upos-sz-mirrorali.bilivideo.com${PATH}"] }] } } };
</script>
<style>
body{margin:0;background:#f1f2f3;font-family:sans-serif}
.bpx-player-container{position:relative;width:960px;height:540px;margin:20px;background:linear-gradient(135deg,#223,#445);overflow:visible}
.bpx-player-control-wrap{position:absolute;left:0;right:0;bottom:0;height:46px;background:linear-gradient(transparent,rgba(0,0,0,.6))}
.bpx-player-control-bottom-right{position:absolute;right:12px;bottom:6px;display:flex;align-items:center;height:30px}
.bpx-player-ctrl-btn{width:36px;height:30px;margin:0 6px;display:flex;align-items:center;justify-content:center;color:hsla(0,0%,100%,.8);font-size:14px}
.bpx-player-ctrl-btn-icon{display:flex;align-items:center;justify-content:center}
</style></head><body><h1>video</h1>
<div class="bpx-player-container" id="player">
  <div class="bpx-player-control-wrap"><div class="bpx-player-control-bottom-right" id="right">
    <div class="bpx-player-ctrl-btn bpx-player-ctrl-quality">1080P</div>
    <div class="bpx-player-ctrl-btn bpx-player-ctrl-volume"><svg viewBox="0 0 22 22" width="22" height="22"><path d="M4 8h4l5-4v14l-5-4H4z" fill="currentColor"/></svg></div>
    <div class="bpx-player-ctrl-btn bpx-player-ctrl-full"><svg viewBox="0 0 22 22" width="22" height="22"><path d="M4 8V4h4M14 4h4v4M18 14v4h-4M8 18H4v-4" fill="none" stroke="currentColor" stroke-width="2"/></svg></div>
  </div></div>
</div>
<script>setTimeout(() => {
  const gear = document.createElement("div");
  gear.className = "bpx-player-ctrl-btn bpx-player-ctrl-setting";
  gear.innerHTML = '<svg viewBox="0 0 88 88" width="36" height="36"><circle cx="44" cy="44" r="24" fill="currentColor"/></svg>';
  document.getElementById("right").insertBefore(gear, document.querySelector(".bpx-player-ctrl-full"));
}, 1500);</script>
<script>window.playerClicks = 0; document.getElementById("player").addEventListener("click", () => { window.playerClicks += 1; });</script>
</body></html>`;
const LIVE_PAGE = `<!doctype html><html><head><script>
window.__NEPTUNE_IS_MY_WAIFU__ = { roomInitRes: { data: { playurl_info: { playurl: { stream: [
  { protocol_name: "http_stream", format: [{ format_name: "flv", codec: [{ url_info: [{ host: "https://flv.bilivideo.com" }] }] }] },
  { protocol_name: "http_hls", format: [{ format_name: "fmp4", codec: [{ url_info: [{ host: "https://hls.bilivideo.com" }] }] }] }
] } } } } };
</script></head><body><h1>live</h1></body></html>`;

(async () => {
  const context = await chromium.launchPersistentContext("", {
    headless: true,
    channel: "chromium",
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
  });
  const served = [];
  await context.route(/^https:\/\/(?:www|live)\.bilibili\.com\//, (route) => route.fulfill({ contentType: "text/html", body: route.request().url().includes("live.") ? LIVE_PAGE : VIDEO_PAGE }));
  await context.route(/^https:\/\/upos-[^/]+\.bilivideo\.com\//, (route) => {
    const request = route.request();
    const host = new URL(request.url()).hostname;
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    const range = request.headers().range || "";
    served.push({ host, range });
    const match = /bytes=(\d+)-(\d*)/.exec(range);
    if (!match) return route.fulfill({ status: 200, headers: { ...cors, "content-type": "video/mp4" }, body: file });
    const start = Number(match[1]);
    const end = Math.min(SIZE - 1, match[2] ? Number(match[2]) : SIZE - 1);
    return route.fulfill({ status: 206, headers: { ...cors, "content-type": "video/mp4", "content-range": `bytes ${start}-${end}/${SIZE}` }, body: file.subarray(start, end + 1) });
  });
  await context.route(/^https:\/\/upos-sz-mirror(?!cos|ali|hw)[^/]*\.bilivideo\.com\//, (route) => route.abort());
  await context.route("https://api.live.bilibili.com/**", (route) => {
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: { ...cors, "access-control-allow-origin": "https://live.bilibili.com", "access-control-allow-credentials": "true" } });
    return route.fulfill({
      headers: { "content-type": "application/json", "access-control-allow-origin": "https://live.bilibili.com", "access-control-allow-credentials": "true" },
      body: JSON.stringify({ code: 0, data: { playurl_info: { playurl: { stream: [
        { protocol_name: "http_stream", format: [{ format_name: "flv", codec: [{ url_info: [{ host: "https://flv.bilivideo.com" }] }] }] },
        { protocol_name: "http_hls", format: [{ format_name: "ts", codec: [{ url_info: [{ host: "https://hls.bilivideo.com" }] }] }, { format_name: "fmp4", codec: [{ url_info: [{ host: "https://hls.bilivideo.com" }] }] }] }
      ] } } } })
    });
  });
  const liveHits = [];
  await context.route("https://hls.bilivideo.com/**", (route) => {
    const url = route.request().url();
    liveHits.push(url);
    if (url.includes(".m3u8")) return route.fulfill({ headers: { ...cors, "content-type": "application/vnd.apple.mpegurl" }, body: "#EXTM3U\n#EXT-X-MAP:URI=\"h.m4s\"\n#EXTINF:1,\n41.m4s\n#EXTINF:1,\n42.m4s\n" });
    return route.fulfill({ headers: { ...cors, "content-type": "video/mp4" }, body: Buffer.from(`segment ${url.split("/").pop()}`) });
  });

  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent("serviceworker");
  const extensionId = new URL(worker.url()).host;
  const errors = [];
  const results = [];
  const check = async (name, fn) => {
    try { await fn(); results.push(`ok   ${name}`); }
    catch (error) { results.push(`FAIL ${name}\n     ${error.stack || error}`); }
  };

  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.goto("https://www.bilibili.com/video/BV1test/");
  await page.waitForFunction(() => window.__biliweaver?.isReady === true);

  await check("fetch with Range is answered by Biliweaver with the right bytes", async () => {
    served.length = 0;
    const answer = await page.evaluate(async (url) => {
      const response = await fetch(url, { headers: { Range: "bytes=1000-3000999" } });
      const bytes = new Uint8Array(await response.arrayBuffer());
      let sum = 0;
      for (let i = 0; i < bytes.length; i += 1) sum = (sum + bytes[i] * (i % 13 + 1)) % 1000000007;
      return { status: response.status, mark: response.headers.get("x-biliweaver"), range: response.headers.get("content-range"), length: bytes.length, sum };
    }, `https://upos-sz-mirrorcos.bilivideo.com${PATH}`);
    let sum = 0;
    for (let i = 0; i < 3000000; i += 1) sum = (sum + file[1000 + i] * (i % 13 + 1)) % 1000000007;
    assert.equal(answer.status, 206);
    assert.equal(answer.mark, "1");
    assert.equal(answer.range, `bytes 1000-3000999/${SIZE}`);
    assert.equal(answer.length, 3000000);
    assert.equal(answer.sum, sum);
    assert.ok(new Set(served.map((item) => item.host)).size >= 2, `hosts used: ${JSON.stringify(served)}`);
  });

  await check("XMLHttpRequest with arraybuffer gets the right bytes and events", async () => {
    const answer = await page.evaluate((url) => new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      const events = [];
      xhr.open("GET", url);
      xhr.responseType = "arraybuffer";
      xhr.setRequestHeader("Range", "bytes=0-1048575");
      xhr.onreadystatechange = () => events.push(`rs${xhr.readyState}`);
      xhr.onprogress = () => events.push("progress");
      xhr.onload = () => {
        const bytes = new Uint8Array(xhr.response);
        resolve({ status: xhr.status, length: bytes.length, first: bytes[0], last: bytes[bytes.length - 1], range: xhr.getResponseHeader("content-range"), events });
      };
      xhr.onerror = () => resolve({ error: true, events });
      xhr.send();
    }), `https://upos-sz-mirrorali.bilivideo.com${PATH}`);
    assert.equal(answer.status, 206);
    assert.equal(answer.length, 1048576);
    assert.equal(answer.first, file[0]);
    assert.equal(answer.last, file[1048575]);
    assert.equal(answer.range, `bytes 0-1048575/${SIZE}`);
    assert.ok(answer.events.includes("rs4") && answer.events.includes("progress"), answer.events.join(","));
  });

  await check("ordinary requests are left alone", async () => {
    const text = await page.evaluate(async () => (await fetch("/x/other")).text());
    assert.ok(text.includes("<h1>video</h1>"));
  });

  await check("popup saves settings to chrome.storage.sync", async () => {
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);
    await popup.waitForTimeout(300);
    await popup.selectOption("select[data-key=threads]", "16");
    await popup.waitForTimeout(300);
    const stored = await worker.evaluate(() => chrome.storage.sync.get(["threads", "enabled"]));
    assert.equal(stored.threads, 16);
    await page.waitForFunction(() => window.__biliweaver.settings.threads === 16, null, { timeout: 3000 });
    await popup.screenshot({ path: path.join(process.env.SHOT_DIR || __dirname, "popup.png"), fullPage: true });
    await popup.close();
  });

  await check("a Biliweaver button sits in the player's control bar before the settings button", async () => {
    await page.waitForSelector("#right .biliweaver-ctrl", { timeout: 3000 });
    // The settings button appears later than the bar; the button has to move next to it.
    await page.waitForFunction(() => document.querySelector(".biliweaver-ctrl")?.nextElementSibling?.classList.contains("bpx-player-ctrl-setting"), null, { timeout: 4000 });
    const order = await page.evaluate(() => [...document.querySelectorAll("#right > *")].map((element) => element.className));
    const at = order.findIndex((name) => name.includes("biliweaver-ctrl"));
    assert.ok(at >= 0 && order[at + 1].includes("bpx-player-ctrl-setting"), order.join(" | "));
    assert.ok(order[at].includes("bpx-player-ctrl-btn"), "should wear the native button class");
    const boxes = await page.evaluate(() => {
      const read = (element) => {
        const style = getComputedStyle(element);
        const box = element.getBoundingClientRect();
        const icon = element.querySelector("svg").getBoundingClientRect();
        return { width: Math.round(box.width), height: Math.round(box.height), top: Math.round(box.top), marginLeft: style.marginLeft, marginRight: style.marginRight, color: style.color, icon: Math.round(icon.width), iconTop: Math.round(icon.top) };
      };
      return { ours: read(document.querySelector(".biliweaver-ctrl")), gear: read(document.querySelector(".bpx-player-ctrl-setting")) };
    });
    for (const key of ["width", "height", "top", "marginLeft", "marginRight"]) assert.equal(boxes.ours[key], boxes.gear[key], `${key}: ${JSON.stringify(boxes)}`);
    const iconColor = await page.evaluate(() => getComputedStyle(document.querySelector(".biliweaver-ctrl svg")).color);
    assert.equal(iconColor, "rgb(255, 255, 255)");
    // The painted shapes, not the <svg> boxes, should be about the same size (the gear's
    // circle is 24/88 of a 36 px canvas, about 19.6 px across).
    const painted = await page.evaluate(() => {
      const size = (svg) => {
        const box = svg.getBBox();
        const rect = svg.getBoundingClientRect();
        const view = svg.viewBox.baseVal;
        return Math.max(box.width, box.height) * rect.width / view.width;
      };
      return { ours: size(document.querySelector(".biliweaver-ctrl svg")), gear: size(document.querySelector(".bpx-player-ctrl-setting svg")) };
    });
    // getBBox leaves out the stroke; the weave's stroke adds 2 of its 18.8 units.
    const oursWithStroke = painted.ours * 18.8 / 16.8;
    assert.ok(Math.abs(oursWithStroke - painted.gear * 0.92) <= 1.5, JSON.stringify(painted));
  });

  await check("hovering the button plays the weaving animation, clicking does not need it", async () => {
    await page.mouse.move(10, 10);
    await page.hover("#right .biliweaver-ctrl");
    await page.waitForTimeout(150);
    const running = await page.evaluate(() => document.querySelectorAll(".biliweaver-ctrl .bw-weft").length && [...document.querySelectorAll(".biliweaver-ctrl .bw-weft")].some((path) => path.getAnimations().length > 0));
    assert.ok(running, "no animation while hovering");
    const box = await page.locator("#right .biliweaver-ctrl").boundingBox();
    for (const [index, wait] of [[1, 0], [2, 220], [3, 300]]) {
      if (wait) await page.waitForTimeout(wait);
      await page.screenshot({ path: path.join(process.env.SHOT_DIR || __dirname, `hover-${index}.png`), clip: { x: box.x - 4, y: box.y - 4, width: box.width + 8, height: box.height + 8 }, scale: "device" });
    }
    await page.mouse.move(10, 10);
  });

  await check("the in-player panel opens and changes settings without touching the player", async () => {
    await page.click("#right .biliweaver-ctrl");
    const panel = page.locator("#right .biliweaver-ctrl .panel");
    await panel.waitFor({ state: "visible", timeout: 2000 });
    await panel.locator(".segments[data-key=threads] button[data-value='32']").click();
    await panel.locator(".segments[data-key=cdn] button[data-value='mainland']").click();
    await page.waitForFunction(() => window.__biliweaver.settings.threads === 32 && window.__biliweaver.settings.cdn === "mainland", null, { timeout: 3000 });
    const stored = await worker.evaluate(() => chrome.storage.sync.get(["threads", "cdn"]));
    assert.equal(stored.threads, 32);
    assert.equal(stored.cdn, "mainland");
    assert.equal(await panel.locator(".segments[data-key=threads] button[data-value='32']").getAttribute("aria-pressed"), "true");
    assert.equal(await page.evaluate(() => window.playerClicks), 0, "clicks inside the panel reached the player");
    await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(process.env.SHOT_DIR || __dirname, "player-panel.png"), clip: { x: 0, y: 0, width: 1000, height: 600 } });
    await page.mouse.click(200, 200);
    await panel.waitFor({ state: "hidden", timeout: 2000 });
    await page.screenshot({ path: path.join(process.env.SHOT_DIR || __dirname, "control-bar.png"), clip: { x: 700, y: 560, width: 300, height: 40 }, scale: "device" });
  });

  await check("the button comes back after the player rebuilds its control bar", async () => {
    await page.evaluate(() => {
      const old = document.getElementById("right");
      const fresh = old.cloneNode(false);
      fresh.innerHTML = '<div class="bpx-player-ctrl-btn bpx-player-ctrl-setting"><svg viewBox="0 0 22 22" width="22" height="22"><circle cx="11" cy="11" r="7" fill="currentColor"/></svg></div>';
      old.replaceWith(fresh);
    });
    await page.waitForSelector("#right .biliweaver-ctrl", { timeout: 3000 });
    assert.equal(await page.locator(".biliweaver-ctrl").count(), 1);
  });

  await check("switching the button off in settings removes it", async () => {
    await worker.evaluate(() => chrome.storage.sync.set({ playerButton: false }));
    await page.waitForSelector(".biliweaver-ctrl", { state: "detached", timeout: 3000 });
    await worker.evaluate(() => chrome.storage.sync.set({ playerButton: true }));
    await page.waitForSelector("#right .biliweaver-ctrl", { timeout: 3000 });
  });

  await check("the player panel's language row opens a submenu and switches language", async () => {
    await page.click("#right .biliweaver-ctrl");
    const panel = page.locator("#right .biliweaver-ctrl .panel");
    await panel.waitFor({ state: "visible", timeout: 2000 });
    await page.screenshot({ path: path.join(process.env.SHOT_DIR || __dirname, "panel-main.png"), clip: { x: 600, y: 60, width: 400, height: 540 } });
    await panel.locator(".nav-row").click();
    await panel.locator(".lang-view").waitFor({ state: "visible" });
    assert.equal(await panel.locator(".main-view").isVisible(), false);
    assert.equal(await panel.locator("[data-language=auto]").getAttribute("aria-checked"), "true");
    await page.screenshot({ path: path.join(process.env.SHOT_DIR || __dirname, "panel-language.png"), clip: { x: 600, y: 60, width: 400, height: 540 } });
    await panel.locator("[data-language=en]").click();
    await panel.locator(".main-view").waitFor({ state: "visible" });
    assert.equal(await panel.locator(".group .label").first().textContent(), "Parallel threads");
    assert.equal(await panel.locator("[data-current=language]").textContent(), "English");
    const stored = await worker.evaluate(() => chrome.storage.sync.get("language"));
    assert.equal(stored.language, "en");
    // Escape leaves the submenu first, then closes the panel.
    await panel.locator(".nav-row").click();
    await page.keyboard.press("Escape");
    await panel.locator(".main-view").waitFor({ state: "visible" });
    await page.keyboard.press("Escape");
    await panel.waitFor({ state: "hidden" });
    await worker.evaluate(() => chrome.storage.sync.set({ language: "auto" }));
  });

  await check("the player panel follows the interface language", async () => {
    await worker.evaluate(() => chrome.storage.sync.set({ language: "en" }));
    await page.waitForFunction(() => document.querySelector(".biliweaver-ctrl .biliweaver-panel-host")?.shadowRoot?.querySelector(".label")?.textContent === "Parallel threads", null, { timeout: 3000 });
    await worker.evaluate(() => chrome.storage.sync.set({ language: "ja" }));
    await page.waitForFunction(() => document.querySelector(".biliweaver-ctrl .biliweaver-panel-host")?.shadowRoot?.querySelector(".label")?.textContent === "同時スレッド数", null, { timeout: 3000 });
    await page.click("#right .biliweaver-ctrl");
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(process.env.SHOT_DIR || __dirname, "player-panel-ja.png"), clip: { x: 0, y: 0, width: 1000, height: 600 } });
    await page.mouse.click(200, 200);
    await worker.evaluate(() => chrome.storage.sync.set({ language: "auto" }));
  });

  await check("the full settings page shows each section with titles and explanations", async () => {
    const options = await context.newPage();
    await options.setViewportSize({ width: 1400, height: 900 });
    for (const [language, name] of [["zh-CN", "zh"], ["en", "en"], ["ja", "ja"]]) {
      await worker.evaluate((value) => chrome.storage.sync.set({ language: value }), language);
      await options.goto(`chrome-extension://${extensionId}/options/options.html#basic`);
      await options.waitForSelector(".setting .desc");
      await options.screenshot({ path: path.join(process.env.SHOT_DIR || __dirname, `options-${name}.png`) });
    }
    await options.click("nav a[href='#video']");
    await options.waitForFunction(() => document.querySelector("h1")?.textContent === "動画の高速化");
    await options.locator("select").first().selectOption("24");
    await page.waitForFunction(() => window.__biliweaver.settings.threads === 24, null, { timeout: 3000 });
    await options.goto(`chrome-extension://${extensionId}/options/options.html#status`);
    await options.waitForSelector(".page-card", { timeout: 4000 });
    await options.screenshot({ path: path.join(process.env.SHOT_DIR || __dirname, "options-status.png") });
    await worker.evaluate(() => chrome.storage.sync.set({ language: "auto" }));
    await options.close();
  });

  await check("the About page names the author, links GitHub and shows the copyright in each language", async () => {
    const about = await context.newPage();
    await about.setViewportSize({ width: 1400, height: 900 });
    const expected = { "zh-CN": "版权所有 © 2026 ShinyAkira", en: "Copyright © 2026 ShinyAkira", ja: "Copyright © 2026 ShinyAkira" };
    for (const [language, text] of Object.entries(expected)) {
      await worker.evaluate((value) => chrome.storage.sync.set({ language: value }), language);
      await about.goto(`chrome-extension://${extensionId}/options/options.html#about`);
      await about.waitForSelector(".about .copyright");
      assert.equal(await about.locator(".about .copyright").textContent(), text);
      assert.equal(await about.locator(".about a[href='https://github.com/ShinyAkira106']").count(), 2);
      await about.screenshot({ path: path.join(process.env.SHOT_DIR || __dirname, `about-${language}.png`) });
    }
    const license = await about.evaluate(async () => (await fetch(chrome.runtime.getURL("LICENSE.txt"))).text());
    assert.ok(license.includes("Copyright (c) 2026 ShinyAkira"));
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);
    await popup.waitForTimeout(300);
    assert.equal(await popup.locator(".credit span").textContent(), "Copyright © 2026 ShinyAkira");
    await popup.screenshot({ path: path.join(process.env.SHOT_DIR || __dirname, "popup-credit.png"), fullPage: true });
    await worker.evaluate(() => chrome.storage.sync.set({ language: "auto" }));
    await popup.close();
    await about.close();
  });

  await check("host rows stay on one line and long names scroll on hover", async () => {
    // Keep feeding stats with a long host and a long speed, so the engine's own stats do
    // not replace them during the test.
    await page.evaluate(() => {
      const fake = JSON.stringify({ speedBps: 2400000, activeThreads: 6, acceleratedBytes: 49700000, hosts: [
        { host: "upos-hz-mirrorakam.akamaized.net", speedKBps: 2355, bytes: 9e6, requests: 3, errors: 0, inflight: 1, cooling: false },
        { host: "upos-sz-mirroralib.bilivideo.com", speedKBps: 1434, bytes: 5e6, requests: 3, errors: 0, inflight: 1, cooling: false },
        { host: "cn-gdfs-ct-01-12.bilivideo.com", speedKBps: 571, bytes: 2e6, requests: 3, errors: 0, inflight: 0, cooling: false },
        { host: "upos-sz-mirrorali.bilivideo.com", speedKBps: 99999, bytes: 1e6, requests: 3, errors: 0, inflight: 0, cooling: false }
      ] });
      window.__fakeStats = setInterval(() => document.dispatchEvent(new CustomEvent("biliweaver:stats", { detail: fake })), 100);
    });
    await page.click("#right .biliweaver-ctrl");
    const panel = page.locator("#right .biliweaver-ctrl .panel");
    await panel.waitFor({ state: "visible", timeout: 2000 });
    await page.waitForTimeout(300);
    const rows = await page.evaluate(() => {
      const root = document.querySelector(".biliweaver-ctrl .biliweaver-panel-host").shadowRoot;
      return [...root.querySelectorAll(".host-row")].map((row) => {
        const name = row.querySelector(".marquee");
        const speed = row.querySelector(".host-speed");
        return { height: row.getBoundingClientRect().height, speedHeight: speed.getBoundingClientRect().height, speed: speed.textContent, truncated: name.scrollWidth > name.clientWidth };
      });
    });
    assert.equal(rows.length, 4);
    for (const row of rows) assert.ok(row.height <= 21 && row.speedHeight <= 18, `wrapped: ${JSON.stringify(rows)}`);
    assert.ok(rows[0].truncated, "the long akamaized host should be cut with an ellipsis");
    await page.screenshot({ path: path.join(process.env.SHOT_DIR || __dirname, "hosts-ellipsis.png"), clip: { x: 640, y: 60, width: 340, height: 540 } });
    const first = page.locator("#right .biliweaver-ctrl .host-row .marquee").first();
    await first.hover();
    await page.waitForTimeout(1200);
    const scrolling = await page.evaluate(() => {
      const box = document.querySelector(".biliweaver-ctrl .biliweaver-panel-host").shadowRoot.querySelector(".host-row .marquee");
      return { on: box.classList.contains("scrolling"), animations: box.firstElementChild.getAnimations().length };
    });
    assert.ok(scrolling.on && scrolling.animations > 0, JSON.stringify(scrolling));
    await page.screenshot({ path: path.join(process.env.SHOT_DIR || __dirname, "hosts-scrolling.png"), clip: { x: 640, y: 60, width: 340, height: 540 } });
    await page.mouse.move(200, 200);
    await page.evaluate(() => clearInterval(window.__fakeStats));
    await page.mouse.click(200, 200);
  });

  await check("the service worker sees the tab's stats", async () => {
    await page.waitForTimeout(1500);
    const stats = await worker.evaluate(async () => {
      const tabs = await chrome.tabs.query({});
      for (const tab of tabs) {
        const answer = await new Promise((resolve) => chrome.runtime.sendMessage({ type: "getTabStats", tabId: tab.id }, resolve)).catch(() => null);
        if (answer?.stats) return answer.stats;
      }
      return null;
    }).catch(() => null);
    // A service worker cannot message itself; read its state through the badge instead.
    const badge = await worker.evaluate(async () => {
      const tabs = await chrome.tabs.query({});
      const texts = await Promise.all(tabs.map((tab) => chrome.action.getBadgeText({ tabId: tab.id })));
      return texts.filter(Boolean);
    });
    assert.ok(stats || badge.length, "no stats reached the service worker");
  });

  const live = await context.newPage();
  live.on("pageerror", (error) => errors.push(String(error)));
  await live.goto("https://live.bilibili.com/123");
  await live.waitForFunction(() => window.__biliweaver?.isReady === true);

  await check("the embedded live play info drops FLV when HLS exists", async () => {
    const names = await live.evaluate(() => window.__NEPTUNE_IS_MY_WAIFU__.roomInitRes.data.playurl_info.playurl.stream.map((item) => item.protocol_name));
    assert.deepEqual(names, ["http_hls"]);
  });

  await check("getRoomPlayInfo through XHR comes back with HLS fMP4 first", async () => {
    const answer = await live.evaluate(() => new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open("GET", "https://api.live.bilibili.com/xlive/web-room/v2/index/getRoomPlayInfo?room_id=123&protocol=0,1&format=0,1,2&codec=0,1");
      xhr.withCredentials = true;
      xhr.onload = () => resolve(JSON.parse(xhr.responseText));
      xhr.onerror = () => resolve(null);
      xhr.send();
    }));
    const streams = answer.data.playurl_info.playurl.stream;
    assert.deepEqual(streams.map((item) => item.protocol_name), ["http_hls"]);
    assert.equal(streams[0].format[0].format_name, "fmp4");
  });

  await check("HLS segments are fetched ahead and served from that download", async () => {
    const answer = await live.evaluate(async () => {
      await (await fetch("https://hls.bilivideo.com/live-bvc/1/live_1/index.m3u8?sig=1")).text();
      await new Promise((resolve) => setTimeout(resolve, 400));
      const response = await fetch("https://hls.bilivideo.com/live-bvc/1/live_1/42.m4s");
      return { mark: response.headers.get("x-biliweaver"), text: await response.text() };
    });
    assert.equal(answer.mark, "1");
    assert.equal(answer.text, "segment 42.m4s");
    assert.equal(liveHits.filter((url) => url.endsWith("/42.m4s")).length, 1, "segment should be downloaded once");
  });

  await check("no page errors", async () => assert.deepEqual(errors, []));
  console.log(results.join("\n"));
  await context.close();
  process.exit(results.some((line) => line.startsWith("FAIL")) ? 1 : 0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
