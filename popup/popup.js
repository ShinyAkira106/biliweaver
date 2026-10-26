"use strict";
// The toolbar popup: the settings used most, and the current tab's stats, which the
// service worker collects from the page. Everything else is on the full settings page.
const Settings = globalThis.BiliweaverSettings;
const I18n = globalThis.BiliweaverI18n;
const $ = (id) => document.getElementById(id);
const inputs = [...document.querySelectorAll("[data-key]")];
let current = Settings.normalize(Settings.DEFAULTS);
let lang = I18n.resolve("auto", navigator.language);

$("version").textContent = `v${chrome.runtime.getManifest().version}`;
$("openOptions").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
  window.close();
});

function render() {
  lang = I18n.resolve(current.language, navigator.language);
  I18n.apply(document, lang);
  for (const input of inputs) {
    const value = current[input.dataset.key];
    if (input.type === "checkbox") input.checked = value === true;
    else input.value = String(value);
  }
  document.body.classList.toggle("off", !current.enabled);
}

let savedTimer = null;
function save(patch) {
  current = Settings.normalize({ ...current, ...patch });
  chrome.storage.sync.set(current, () => {
    $("saved").textContent = chrome.runtime.lastError ? "!" : I18n.t(lang, "saved");
    clearTimeout(savedTimer);
    savedTimer = setTimeout(() => { $("saved").textContent = ""; }, 1400);
  });
  render();
}

for (const input of inputs) {
  const key = input.dataset.key;
  input.addEventListener("change", () => {
    if (input.type === "checkbox") save({ [key]: input.checked });
    else save({ [key]: "number" in input.dataset ? Number(input.value) : input.value });
  });
}

chrome.storage.sync.get(null, (stored) => {
  current = Settings.normalize({ ...Settings.DEFAULTS, ...stored });
  render();
  refreshStats();
});
render();

function formatBytes(bytes) {
  const units = ["B", "KB", "MB", "GB"];
  let value = Number(bytes) || 0;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  return `${value >= 100 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

async function refreshStats() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  chrome.runtime.sendMessage({ type: "getTabStats", tabId: tab.id }, (answer) => {
    if (chrome.runtime.lastError) return;
    const stats = answer?.stats;
    $("pageHint").textContent = stats ? "" : I18n.t(lang, "openHint");
    $("speed").textContent = stats ? `${formatBytes(stats.speedBps)}/s` : "0";
    $("threads").textContent = stats ? String(stats.activeThreads) : "0";
    $("bytes").textContent = stats ? formatBytes(stats.acceleratedBytes) : "0";
    const guard = stats?.protection || {};
    const notes = [];
    if (guard.paused) notes.push([I18n.t(lang, "pausedNotice").replace("{min}", String(Math.max(1, Math.ceil((guard.resumeInMs || 0) / 60000)))), false]);
    if (guard.threadLimit && guard.threadLimit < current.threads) notes.push([I18n.t(lang, "throttledNotice").replace("{n}", String(guard.threadLimit)), false]);
    if (guard.hlsFallback && stats?.page === "live") notes.push([I18n.t(lang, "hlsFallbackNotice"), false]);
    if (guard.prefetchHeld && current.prefetch) notes.push([I18n.t(lang, guard.prefetchHeld === "saveData" ? "prefetchHeldSaveData" : "prefetchHeldPaused"), true]);
    $("notices").replaceChildren(...notes.map(([text, info]) => {
      const row = document.createElement("div");
      row.className = info ? "notice info" : "notice";
      row.textContent = text;
      return row;
    }));
    const list = (stats?.hosts || []).slice(0, 6);
    $("hostSection").hidden = !list.length;
    // Updated in place, so a host name scrolling under the mouse keeps scrolling.
    const body = $("hosts");
    while (body.children.length > list.length) body.lastElementChild.remove();
    list.forEach((host, index) => {
      let row = body.children[index];
      if (!row) {
        row = document.createElement("tr");
        const name = document.createElement("td");
        const box = document.createElement("span");
        box.className = "marquee";
        box.append(document.createElement("span"));
        name.append(box);
        row.append(name, document.createElement("td"), document.createElement("td"));
        body.append(row);
      }
      const [name, speed, bytes] = row.children;
      const box = name.firstChild;
      if (box.firstChild.textContent !== host.host) {
        box.firstChild.textContent = host.host;
        box.classList.remove("scrolling");
      }
      box.title = host.lastError ? `${host.host}\n${host.lastError}` : host.host;
      name.className = host.cooling ? "cooling" : "";
      speed.textContent = host.cooling ? I18n.t(lang, "paused") : `${formatBytes(host.speedKBps * 1024)}/s`;
      bytes.textContent = formatBytes(host.bytes);
    });
  });
}
setInterval(refreshStats, 1000);

// Hovering a truncated host name scrolls the rest into view.
document.addEventListener("mouseover", (event) => {
  const box = event.target.closest?.(".marquee");
  if (!box || box.classList.contains("scrolling")) return;
  const overflow = box.scrollWidth - box.clientWidth;
  if (overflow <= 1) return;
  box.style.setProperty("--shift", `${-overflow - 2}px`);
  box.style.setProperty("--duration", `${Math.max(1.2, overflow / 28).toFixed(2)}s`);
  box.classList.add("scrolling");
});
document.addEventListener("mouseout", (event) => {
  const box = event.target.closest?.(".marquee");
  if (box && !box.contains(event.relatedTarget)) box.classList.remove("scrolling");
});
