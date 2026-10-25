// Renders docs/images/button-hover.gif: the player button's hover animation, enlarged.
//   node scripts/hover-gif.js   (needs Playwright; Python with Pillow assembles the GIF)
"use strict";
const path = require("node:path");
const fs = require("node:fs");
const { execFileSync } = require("node:child_process");
const { chromium } = require("playwright");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "content", "player-button.js"), "utf8");
const svg = /const ICON = `([\s\S]*?)`;/.exec(source)[1].replace('width="22" height="22"', 'width="120" height="120"');
const frames = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "bw-gif-"));
const STEP = 40;
const LENGTH = 1000;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 200, height: 200 } });
  await page.setContent(`<style>
    body{margin:0;width:200px;height:200px;display:grid;place-items:center;background:radial-gradient(circle at 50% 40%,#2a3236,#16191c)}
    .f{color:#fff}.f .bw-weft{stroke-dasharray:1 1}.f .bw-warp{transform-box:fill-box;transform-origin:center}
    @keyframes w{from{stroke-dashoffset:1}to{stroke-dashoffset:0}}
    @keyframes v{0%,100%{transform:scaleY(1)}35%{transform:scaleY(1.08)}}
    .f .bw-weft{animation:w var(--t) linear var(--d) both}.f .bw-warp{animation:v .8s ease-in-out both}
  </style><div class="f">${svg}</div>`);
  let index = 0;
  for (let time = 0; time <= LENGTH; time += STEP, index += 1) {
    await page.evaluate((at) => { for (const animation of document.getAnimations()) { animation.pause(); animation.currentTime = at; } }, time);
    await page.screenshot({ path: path.join(frames, `${String(index).padStart(3, "0")}.png`) });
  }
  await browser.close();
  const output = path.join(root, "docs", "images", "button-hover.gif");
  execFileSync("python3", ["-I", "-c", `
import glob, sys
from PIL import Image
files = sorted(glob.glob(sys.argv[1] + "/*.png"))
images = [Image.open(f).convert("RGB").quantize(colors=64, method=Image.Quantize.MEDIANCUT) for f in files]
durations = [${STEP}] * len(images)
durations[-1] = 1400
images[0].save(sys.argv[2], save_all=True, append_images=images[1:], duration=durations, loop=0, optimize=True)
`, frames, output]);
  console.log(output);
})();
