// Renders docs/images/how-it-works.png: the "How it works" card strip for the README, in
// English, Chinese and Japanese at once. Laid out in HTML and captured with Playwright,
// because a README cannot carry its own styles.
//   node scripts/how-it-works.js
"use strict";
const path = require("node:path");
const fs = require("node:fs");
const { chromium } = require("playwright");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "content", "player-button.js"), "utf8");
const weave = /const ICON = `([\s\S]*?)`;/.exec(source)[1].replace(/class="bw-weft"[^>]*?pathLength="1" /g, "");

const icon = (d, size = 18) => `<svg viewBox="0 0 22 22" width="${size}" height="${size}">${d}</svg>`;
const BAR_ICONS = [
  '<path d="M3.5 8.5h3.5l5-4v13l-5-4H3.5z" fill="currentColor"/><path d="M15 8a4 4 0 0 1 0 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  null, // Biliweaver
  '<circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="3" stroke-dasharray="3.2 1.9"/><circle cx="11" cy="11" r="2.4" fill="currentColor"/>',
  '<rect x="3" y="5" width="16" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><rect x="11" y="11" width="6" height="4.5" rx="1" fill="currentColor"/>',
  '<path d="M4 8V4h4M14 4h4v4M18 14v4h-4M8 18H4v-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'
];

const HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
:root{--ink:#111315;--muted:#6e7378;--soft:#9aa0a6;--line:#ececec;--teal:#5fbfa8;--cream:#f2e3c6;--blue:#00aeec}
*{box-sizing:border-box}
html,body{margin:0;background:#fff}
body{width:1200px;padding:56px 64px 60px;font-family:Inter,"Noto Sans CJK SC",sans-serif;color:var(--ink);-webkit-font-smoothing:antialiased}
[lang=ja]{font-family:Inter,"Noto Sans CJK JP",sans-serif}
[lang=zh-CN]{font-family:Inter,"Noto Sans CJK SC",sans-serif}
h1{margin:0;font-size:42px;letter-spacing:-.02em;font-weight:700;line-height:1.1}
h1 small{font-size:22px;font-weight:600;color:var(--soft);letter-spacing:0;margin-left:14px}
.lead{margin:18px 0 0;max-width:860px;font-size:17px;line-height:1.55;color:#4a4f54}
.lead span{display:block;font-size:14.5px;color:var(--muted);line-height:1.6}
.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;margin-top:44px}
.card{border:1px solid var(--line);border-radius:30px;overflow:hidden;display:flex;flex-direction:column;background:#fff}
.top{padding:24px 26px 20px;border-bottom:1px solid var(--line);min-height:218px}
.num{display:grid;place-items:center;width:26px;height:26px;border:1px solid #e3e3e3;border-radius:50%;font-size:12.5px;font-weight:600;color:#5b6065}
.title{margin:20px 0 0;font-size:22px;font-weight:700;letter-spacing:-.01em}
.alt{margin-top:4px;font-size:14px;font-weight:600;color:#3f4448}
.alt i{font-style:normal;color:var(--soft);font-weight:500;margin:0 6px}
.desc{margin-top:12px;font-size:14px;line-height:1.5;color:var(--muted)}
.desc span{display:block;font-size:12.5px;line-height:1.55;color:var(--soft)}
.art{position:relative;height:250px;background:linear-gradient(#fafafa,#f4f5f5);overflow:hidden}

/* 1: the control bar with the new button */
.player{position:absolute;left:26px;right:-30px;top:34px;bottom:-12px;border-radius:16px;background:radial-gradient(70% 90% at 70% 10%,#3a5870,transparent 70%),radial-gradient(60% 80% at 10% 90%,#5a4458,transparent 70%),#171a20;box-shadow:0 18px 40px rgba(0,0,0,.18)}
.progress{position:absolute;left:18px;right:18px;height:3px;border-radius:2px;background:rgba(255,255,255,.22)}
.progress b{position:absolute;left:0;top:0;bottom:0;border-radius:2px}
.bar{position:absolute;right:42px;display:flex;gap:16px;align-items:center;color:rgba(255,255,255,.9)}
.bw{position:relative;color:#fff}
.bw::before{content:"";position:absolute;inset:-10px;border-radius:50%;border:2px solid rgba(95,191,168,.85);box-shadow:0 0 0 7px rgba(95,191,168,.18)}
.cursor{position:absolute;width:20px;height:20px}
.tag{position:absolute;padding:7px 12px;border-radius:999px;background:#fff;color:var(--ink);font-size:12.5px;font-weight:600;box-shadow:0 6px 18px rgba(0,0,0,.18);white-space:nowrap}
.tag em{font-style:normal;color:#2f8f7b}

/* 2: hosts weaving pieces into one range */
.cdn{position:absolute;left:22px;width:90px;display:flex;align-items:center;gap:8px;height:34px;padding:0 12px;border-radius:12px;background:#fff;border:1px solid #e6e6e6;font-size:12px;font-weight:600;color:#3f4448;box-shadow:0 4px 10px rgba(0,0,0,.04)}
.dot{width:9px;height:9px;border-radius:50%}
.lane{position:absolute;left:0;top:0}
.range{position:absolute;right:20px;top:106px;width:126px;height:38px;border-radius:10px;background:#fff;border:1px solid #e6e6e6;display:flex;gap:3px;padding:5px}
.range i{flex:1;border-radius:6px;display:grid;place-items:center;font-style:normal;font-size:11px;font-weight:700;color:#173b33}
.range-label{position:absolute;right:20px;top:152px;width:126px;text-align:center;font-size:11px;line-height:1.5;color:var(--soft)}

/* 3: the buffer racing ahead */
.speed{position:absolute;left:26px;top:30px;display:flex;gap:8px}
.chip{padding:8px 12px;border-radius:12px;background:#fff;border:1px solid #e6e6e6;font-size:12px;color:var(--muted);box-shadow:0 4px 10px rgba(0,0,0,.04)}
.chip b{display:block;font-size:17px;color:#2f8f7b;letter-spacing:-.01em}

.foot{margin-top:34px;display:flex;flex-direction:column;align-items:center;gap:22px}
.chips{display:flex;align-items:center;gap:8px;font-size:15px;color:var(--soft)}
.chips .pill{padding:8px 14px;border-radius:999px;background:#f2f2f2;color:var(--ink);font-weight:600;font-size:14px}
.chips .pill small{font-weight:500;color:var(--muted);margin-left:4px;font-size:12.5px}
.cta{display:flex;align-items:center;gap:10px;height:50px;padding:0 26px;border-radius:999px;background:#0e0f10;color:#fff;font-size:17px;font-weight:600}
.cta span{font-weight:500;color:#b9bdc1;font-size:14px}
</style></head><body>
<h1>How it works. <small lang="zh-CN">工作原理</small><small lang="ja">仕組み</small></h1>
<p class="lead">Install it once, then let it weave: every range the player asks for is split, fetched from several CDNs at once, and stitched back in order.
  <span lang="zh-CN">装好一次就不用管：播放器要的每一段数据都会被拆开，同时从多个 CDN 下载，再按顺序拼回去。</span>
  <span lang="ja">一度入れるだけ。プレーヤーが要求する各区間を分割し、複数の CDN から同時に取得して、順番どおりに組み立て直します。</span></p>

<div class="cards">
  <section class="card">
    <div class="top">
      <div class="num">1</div>
      <div class="title">Install once</div>
      <div class="alt"><span lang="zh-CN">装一次</span><i>·</i><span lang="ja">一度入れるだけ</span></div>
      <div class="desc">Load the extension. A weave button joins the player's controls.
        <span lang="zh-CN">加载扩展，播放器控制栏里会多一个编织按钮。</span>
        <span lang="ja">拡張機能を読み込むと、コントロールバーにボタンが加わります。</span></div>
    </div>
    <div class="art">
      <div class="player">
        <div class="progress" style="bottom:72px"><b style="width:30%;background:var(--blue)"></b></div>
        <div class="bar" style="bottom:36px">
          ${icon(BAR_ICONS[0])}
          <span class="bw">${weave.replace('width="22" height="22"', 'width="20" height="20"')}</span>
          ${icon(BAR_ICONS[2])}${icon(BAR_ICONS[3])}${icon(BAR_ICONS[4])}
        </div>
      </div>
      <div class="tag" style="left:44px;top:62px">Biliweaver <em>ON</em></div>
    </div>
  </section>

  <section class="card">
    <div class="top">
      <div class="num">2</div>
      <div class="title">Just press play</div>
      <div class="alt"><span lang="zh-CN">照常播放</span><i>·</i><span lang="ja">いつも通り再生</span></div>
      <div class="desc">Each request is split into pieces and fetched from several CDNs in parallel.
        <span lang="zh-CN">每段请求被拆成分片，从多个 CDN 同时下载。</span>
        <span lang="ja">各リクエストを分割し、複数の CDN から並列に取得します。</span></div>
    </div>
    <div class="art">
      <svg class="lane" width="345" height="250" viewBox="0 0 345 250">
        <g fill="none" stroke-width="2" stroke-linecap="round">
          <path d="M112 52C170 52 160 116 196 118" stroke="#5fbfa8"/>
          <path d="M112 125H196" stroke="#e7cf9f"/>
          <path d="M112 198C170 198 160 134 196 132" stroke="#9db7e0"/>
        </g>
      </svg>
      <div class="cdn" style="top:35px"><span class="dot" style="background:var(--teal)"></span>CDN A</div>
      <div class="cdn" style="top:108px"><span class="dot" style="background:#e7cf9f"></span>CDN B</div>
      <div class="cdn" style="top:181px"><span class="dot" style="background:#9db7e0"></span>CDN C</div>
      <div class="range"><i style="background:var(--teal)">1</i><i style="background:var(--cream)">2</i><i style="background:var(--teal)">3</i><i style="background:#c9d8f0">4</i></div>
      <div class="range-label">one range<br><span lang="zh-CN">一段请求</span> · <span lang="ja">1 区間</span></div>
    </div>
  </section>

  <section class="card">
    <div class="top">
      <div class="num">3</div>
      <div class="title">The buffer races ahead</div>
      <div class="alt"><span lang="zh-CN">缓冲跑在前面</span><i>·</i><span lang="ja">バッファが先へ</span></div>
      <div class="desc">Pieces are checked and stitched back in order, so playback stays smooth.
        <span lang="zh-CN">分片核对后按顺序拼回，播放更顺畅。</span>
        <span lang="ja">検証した断片を順番どおりに戻し、なめらかに再生します。</span></div>
    </div>
    <div class="art">
      <div class="speed">
        <div class="chip"><b>11.6 MB/s</b>speed · 速度</div>
        <div class="chip"><b>8</b>threads · 线程</div>
      </div>
      <div class="player" style="top:118px">
        <div class="progress" style="top:30px"><b style="width:86%;background:rgba(255,255,255,.55)"></b><b style="width:28%;background:var(--blue)"></b></div>
        <div class="bar" style="top:52px">
          ${icon(BAR_ICONS[0])}
          <span style="color:#fff">${weave.replace('width="22" height="22"', 'width="20" height="20"')}</span>
          ${icon(BAR_ICONS[2])}${icon(BAR_ICONS[3])}${icon(BAR_ICONS[4])}
        </div>
      </div>
    </div>
  </section>
</div>

<div class="foot">
  <div class="chips">Also works on
    <span class="pill">Bangumi<small lang="zh-CN">番剧</small></span>
    <span class="pill">4K · HDR<small lang="zh-CN">高码率</small></span>
    <span class="pill">Live rooms<small lang="ja">ライブ</small><small lang="zh-CN">直播</small></span>
  </div>
  <div class="cta">Download <span lang="zh-CN">下载</span><span lang="ja">ダウンロード</span>
    <svg width="18" height="18" viewBox="0 0 18 18"><path d="M4 9h10M10 5l4 4-4 4" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
</div>
</body></html>`;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 2 });
  await page.setContent(HTML);
  await page.evaluate(() => document.fonts.ready);
  const output = path.join(root, "docs", "images", "how-it-works.png");
  await page.screenshot({ path: output, fullPage: true });
  await browser.close();
  console.log(output);
})();
