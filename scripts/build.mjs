// Builds the loadable extension into dist/biliweaver/ and a zip next to it.
//
// Chrome injects a given script file only once per frame, even when two content script
// entries (one for the page world, one for the isolated world) both list it. So each
// world gets its own bundle here: the shared settings file is concatenated in front of the
// code that needs it.
//
//   node scripts/build.mjs        (no dependencies)
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync } from "node:zlib";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
const version = manifest.version;
const out = join(root, "dist", "biliweaver");

export const BUNDLES = {
  "bundles/page-video.js": ["shared/settings.js", "page/core.js", "page/transfer.js", "page/intercept.js", "page/vod.js", "page/selftest.js"],
  "bundles/page-live.js": ["shared/settings.js", "page/core.js", "page/transfer.js", "page/intercept.js", "page/live.js", "page/selftest.js"],
  "bundles/relay.js": ["shared/settings.js", "shared/i18n.js", "content/relay.js", "content/player-button.js"]
};
const COPY = ["manifest.json", "background.js", "shared/settings.js", "shared/i18n.js", "popup/popup.html", "popup/popup.css", "popup/popup.js", "options/options.html", "options/options.css", "options/options.js", "_locales/zh_CN/messages.json", "_locales/en/messages.json", "_locales/ja/messages.json", "icons/icon-16.png", "icons/icon-32.png", "icons/icon-48.png", "icons/icon-128.png", "icons/icon-512.png", "LICENSE", "README.md"];

const read = (file) => readFileSync(join(root, file), "utf8").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/__BW_VERSION__/g, version);

rmSync(out, { recursive: true, force: true });
for (const [target, parts] of Object.entries(BUNDLES)) {
  mkdirSync(dirname(join(out, target)), { recursive: true });
  const text = `// Biliweaver ${version}. Built by scripts/build.mjs from ${parts.join(", ")}.\n` + parts.map((part) => `\n// ---- ${part} ----\n${read(part)}`).join("\n");
  writeFileSync(join(out, target), text);
}
for (const file of COPY) {
  mkdirSync(dirname(join(out, file)), { recursive: true });
  if (/\.(?:js|json|html|css|md)$/.test(file) || file === "LICENSE") writeFileSync(join(out, file), read(file));
  else copyFileSync(join(root, file), join(out, file));
}

// A copy with an extension, so the About page can open the license as plain text.
writeFileSync(join(out, "LICENSE.txt"), read("LICENSE"));

// A plain zip with forward slashes, readable everywhere.
const table = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buffer) => {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};
const walk = (folder) => readdirSync(folder).sort().flatMap((name) => (statSync(join(folder, name)).isDirectory() ? walk(join(folder, name)) : [join(folder, name)]));
const local = [];
const central = [];
let offset = 0;
for (const path of walk(out)) {
  const name = Buffer.from(relative(out, path).split("\\").join("/"));
  const data = readFileSync(path);
  const packed = deflateRawSync(data, { level: 9 });
  const crc = crc32(data);
  const head = Buffer.alloc(30);
  head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(0x0800, 6); head.writeUInt16LE(8, 8);
  head.writeUInt16LE(0, 10); head.writeUInt16LE(33, 12); head.writeUInt32LE(crc, 14); head.writeUInt32LE(packed.length, 18);
  head.writeUInt32LE(data.length, 22); head.writeUInt16LE(name.length, 26);
  local.push(head, name, packed);
  const entry = Buffer.alloc(46);
  entry.writeUInt32LE(0x02014b50, 0); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6); entry.writeUInt16LE(0x0800, 8);
  entry.writeUInt16LE(8, 10); entry.writeUInt16LE(0, 12); entry.writeUInt16LE(33, 14); entry.writeUInt32LE(crc, 16);
  entry.writeUInt32LE(packed.length, 20); entry.writeUInt32LE(data.length, 24); entry.writeUInt16LE(name.length, 28); entry.writeUInt32LE(offset, 42);
  central.push(entry, name);
  offset += head.length + name.length + packed.length;
}
const size = central.reduce((sum, part) => sum + part.length, 0);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(central.length / 2, 8); end.writeUInt16LE(central.length / 2, 10);
end.writeUInt32LE(size, 12); end.writeUInt32LE(offset, 16);
const zip = join(root, "dist", `biliweaver-v${version}.zip`);
writeFileSync(zip, Buffer.concat([...local, ...central, end]));
console.log(`Biliweaver ${version}\n  ${out}\n  ${zip}`);
