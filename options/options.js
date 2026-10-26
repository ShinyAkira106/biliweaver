"use strict";
// The full settings page: a sidebar of sections, and in each section one row per setting
// with its title and a short explanation on the left and the control on the right.
const Settings = globalThis.BiliweaverSettings;
const I18n = globalThis.BiliweaverI18n;
const $ = (id) => document.getElementById(id);

let current = Settings.normalize(Settings.DEFAULTS);
let lang = I18n.resolve("auto", navigator.language);
let statusTimer = null;

// What each section holds. A row is a setting key with its control type; "custom" rows
// draw themselves.
const SECTIONS = [
  { id: "basic", nav: "navBasic", rows: [
    { key: "enabled", type: "switch", title: "enabled", desc: "enabledDesc" },
    { key: "language", type: "select", title: "language", desc: "languageDesc", options: () => [["auto", I18n.t(lang, "langAuto")], ...I18n.LANGS.map((code) => [code, I18n.NAMES[code]])] },
    { key: "playerButton", type: "switch", title: "playerButton", desc: "playerButtonDesc" },
    { key: "badge", type: "switch", title: "badge", desc: "badgeDesc" },
    { key: "blockIntl", type: "switch", title: "blockIntl", desc: "blockIntlDesc" }
  ] },
  { id: "video", nav: "navVideo", rows: [
    { key: "threads", type: "select", number: true, title: "threads", desc: "threadsDesc", options: () => Settings.THREAD_CHOICES.map((value) => [value, String(value)]) },
    { key: "chunkKB", type: "select", number: true, title: "chunk", desc: "chunkDesc", options: () => Settings.CHUNK_CHOICES_KB.map((value) => [value, value >= 1024 ? `${value / 1024} MB` : `${value} KB`]) },
    { key: "prefetch", type: "switch", title: "prefetch", desc: "prefetchDesc" },
    { key: "bufferSeconds", type: "select", number: true, title: "bufferSeconds", desc: "bufferSecondsDesc", options: () => Settings.BUFFER_CHOICES_S.map((value) => [value, I18n.t(lang, "secondsOption").replace("{n}", String(value))]) },
    { key: "secondaryBuffer", type: "switch", title: "secondaryBuffer", desc: "secondaryBufferDesc" },
    { key: "avoidPcdn", type: "switch", title: "avoidPcdnLong", desc: "avoidPcdnDesc" }
  ] },
  { id: "cdn", nav: "navCdn", rows: [
    { key: "cdn", type: "select", title: "cdn", desc: "cdnDesc", options: () => [["auto", I18n.t(lang, "cdnAutoLong")], ["mainland", I18n.t(lang, "cdnMainlandLong")], ["overseas", I18n.t(lang, "cdnOverseasLong")], ["original", I18n.t(lang, "cdnOriginalLong")], ["custom", I18n.t(lang, "cdnCustom")]] },
    { key: "customHosts", type: "hosts", title: "customHosts", desc: "customHostsDesc" },
    { type: "mirrors", title: "mirrorsTitle", desc: "mirrorsDesc" }
  ] },
  { id: "live", nav: "navLive", rows: [
    { key: "live", type: "switch", title: "live", desc: "liveDesc" },
    { key: "preferHls", type: "switch", title: "preferHls", desc: "preferHlsDesc" }
  ] },
  { id: "status", nav: "navStatus", rows: [{ type: "status" }] },
  { id: "data", nav: "navData", rows: [
    { type: "export", title: "exportTitle", desc: "exportDesc" },
    { type: "import", title: "importTitle", desc: "importDesc" },
    { type: "diagnostics", title: "diagTitle", desc: "diagDesc" }
  ] },
  { id: "about", nav: "navAbout", rows: [{ type: "about" }] }
];

function element(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(props)) {
    if (name === "class") node.className = value;
    else if (name === "text") node.textContent = value;
    else if (name.startsWith("on")) node.addEventListener(name.slice(2), value);
    else node.setAttribute(name, value);
  }
  node.append(...[].concat(children).filter(Boolean));
  return node;
}

let savedTimer = null;
function save(patch) {
  current = Settings.normalize({ ...current, ...patch });
  chrome.storage.sync.set(current, () => flash(chrome.runtime.lastError ? "!" : I18n.t(lang, "saved")));
  render();
}
function flash(text) {
  $("saved").textContent = text;
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => { $("saved").textContent = ""; }, 1600);
}

function settingRow(row, control, wide = false) {
  return element("div", { class: wide ? "setting wide" : "setting" }, [
    element("div", {}, [
      element("div", { class: "title", text: I18n.t(lang, row.title) }),
      row.desc ? element("div", { class: "desc", text: I18n.t(lang, row.desc) }) : null
    ]),
    element("div", { class: "control" }, control)
  ]);
}

function buildRow(row) {
  if (row.type === "switch") {
    return settingRow(row, element("button", {
      class: "switch", role: "switch", "aria-checked": String(current[row.key] === true), "aria-label": I18n.t(lang, row.title),
      onclick: () => save({ [row.key]: !current[row.key] })
    }));
  }
  if (row.type === "select") {
    const select = element("select", { "aria-label": I18n.t(lang, row.title), onchange: (event) => save({ [row.key]: row.number ? Number(event.target.value) : event.target.value }) },
      row.options().map(([value, label]) => element("option", { value: String(value), text: label })));
    select.value = String(current[row.key]);
    return settingRow(row, select);
  }
  if (row.type === "hosts") {
    const area = element("textarea", { spellcheck: "false", placeholder: "upos-sz-mirrorcos.bilivideo.com", "aria-label": I18n.t(lang, row.title),
      onchange: (event) => save({ customHosts: Settings.cleanHosts(event.target.value) }) });
    area.value = current.customHosts.join("\n");
    return settingRow(row, area, true);
  }
  if (row.type === "mirrors") {
    const chips = (list) => element("div", { class: "chips" }, list.map((name) => element("span", { text: name })));
    return settingRow(row, element("div", {}, [chips(Settings.MIRRORS.mainland), chips(Settings.MIRRORS.overseas)]), true);
  }
  if (row.type === "diagnostics") {
    return settingRow(row, [
      element("button", { class: "field-button", text: I18n.t(lang, "copyDiag"), onclick: copyDiagnostics }),
      element("button", { class: "field-button", text: I18n.t(lang, "downloadDiag"), onclick: downloadDiagnostics })
    ]);
  }
  if (row.type === "export") {
    return settingRow(row, element("button", { class: "field-button", text: I18n.t(lang, "exportButton"), onclick: exportSettings }));
  }
  if (row.type === "import") {
    const input = element("input", { type: "file", accept: "application/json,.json", hidden: "", onchange: importSettings });
    return settingRow(row, [input, element("button", { class: "field-button", text: I18n.t(lang, "importButton"), onclick: () => input.click() })]);
  }
  if (row.type === "status") {
    return element("div", { id: "status" });
  }
  if (row.type === "about") {
    const manifest = chrome.runtime.getManifest();
    const about = I18n.ABOUT;
    const link = (href, text) => element("a", { class: "text-link", href, target: "_blank", rel: "noopener noreferrer", text });
    const githubIcon = () => {
      const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      icon.setAttribute("viewBox", "0 0 16 16");
      icon.setAttribute("width", "16");
      icon.setAttribute("height", "16");
      icon.setAttribute("aria-hidden", "true");
      icon.innerHTML = '<path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8Z"/>';
      return icon;
    };
    return element("div", { class: "about" }, [
      element("div", { class: "about-hero" }, [
        element("img", { src: "../icons/icon-128.png", alt: "", width: "64", height: "64" }),
        element("div", {}, [
          element("div", { class: "about-name", text: "Biliweaver" }),
          element("div", { class: "desc", text: `${I18n.t(lang, "aboutVersion")} ${manifest.version}` }),
          element("div", { class: "desc", text: I18n.t(lang, "tagline") })
        ])
      ]),
      settingRow({ title: "aboutAuthor", desc: "aboutAuthorDesc" }, link(about.profile, about.author)),
      settingRow({ title: "aboutGithub", desc: "aboutGithubDesc" }, element("a", { class: "field-button github", href: about.github, target: "_blank", rel: "noopener noreferrer" }, [githubIcon(), element("span", { text: about.github.replace("https://github.com/", "") })])),
      settingRow({ title: "aboutIssues", desc: "aboutIssuesDesc" }, link(about.issues, I18n.t(lang, "openIssues"))),
      settingRow({ title: "aboutReleases", desc: "aboutReleasesDesc" }, link(about.releases, I18n.t(lang, "openReleases"))),
      settingRow({ title: "aboutLicense", desc: "aboutLicenseDesc" }, link(chrome.runtime.getURL("LICENSE.txt"), `${about.license} · ${I18n.t(lang, "viewLicense")}`)),
      element("p", { text: I18n.t(lang, "aboutText") }),
      element("p", { text: I18n.t(lang, "aboutCredit") }),
      element("p", { class: "copyright", text: I18n.t(lang, "copyright") })
    ]);
  }
  return null;
}

function activeSection() {
  const id = location.hash.slice(1);
  return SECTIONS.find((section) => section.id === id) || SECTIONS[0];
}

function render() {
  lang = I18n.resolve(current.language, navigator.language);
  renderUpdate();
  I18n.apply(document, lang);
  $("version").textContent = chrome.runtime.getManifest().version;
  const section = activeSection();
  document.title = `${I18n.t(lang, section.nav)} · Biliweaver`;

  $("nav").replaceChildren(...SECTIONS.map((item) => element("a", {
    href: `#${item.id}`, text: I18n.t(lang, item.nav), ...(item === section ? { "aria-current": "page" } : {})
  })), element("div", { class: "nav-foot" }, [
    element("a", { class: "nav-github", href: I18n.ABOUT.github, target: "_blank", rel: "noopener noreferrer", text: `GitHub · ${I18n.ABOUT.author}` }),
    element("div", { text: I18n.t(lang, "copyright") }),
    element("div", { text: I18n.t(lang, "licenseName") })
  ]));

  // Keep focus on the control that was just used when the section redraws.
  const focused = document.activeElement?.closest?.(".setting");
  const focusIndex = focused ? [...$("content").querySelectorAll(".setting")].indexOf(focused) : -1;
  $("content").replaceChildren(element("h1", { text: I18n.t(lang, section.nav) }), ...section.rows.map(buildRow).filter(Boolean));
  if (focusIndex >= 0) $("content").querySelectorAll(".setting")[focusIndex]?.querySelector("button, select, textarea")?.focus();

  clearInterval(statusTimer);
  if (section.id === "status") {
    refreshStatus();
    statusTimer = setInterval(refreshStatus, 1000);
  }
}

function formatBytes(bytes) {
  const units = ["B", "KB", "MB", "GB"];
  let value = Number(bytes) || 0;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  return `${value >= 100 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

// Page cards are kept and updated in place, so the self test button and its results do
// not flicker or lose clicks while the numbers refresh every second.
const cards = new Map(); // tabId → { card, figures, hosts, test }
const selfTests = new Map(); // tabId → { running, result }

function statusTable(columns, rows) {
  return element("table", {}, [
    element("thead", {}, element("tr", {}, columns.map((key) => element("th", { text: I18n.t(lang, key) })))),
    element("tbody", {}, rows)
  ]);
}

function renderSelfTestInto(box, tabId) {
  const state = selfTests.get(tabId);
  if (!state) { box.replaceChildren(); return; }
  if (state.running) { box.replaceChildren(element("div", { class: "desc busy", text: I18n.t(lang, "selfTestRunning") })); return; }
  const result = state.result;
  if (!result?.ok) {
    const key = result?.reason === "live" ? "selfTestLive" : result?.reason === "noVideo" ? "selfTestNoVideo" : "selfTestError";
    box.replaceChildren(element("div", { class: "desc", text: I18n.t(lang, key) }));
    return;
  }
  const sourceKey = { bilibili: "sourceBilibili", mainland: "sourceMainland", overseas: "sourceOverseas", custom: "sourceCustom" };
  box.replaceChildren(
    element("div", { class: "st-title", text: `${I18n.t(lang, "selfTest")} · ${I18n.t(lang, "selfTestSummary").replace("{working}", result.working).replace("{tested}", result.tested)}` }),
    statusTable(["colHost", "colSource", "colLatency", "colSpeed"], result.results.map((item) => element("tr", { class: item.ok ? "" : "bad" }, [
      element("td", { text: item.host, title: item.error || item.host }),
      element("td", { text: I18n.t(lang, sourceKey[item.source] || "sourceBilibili") }),
      element("td", { text: item.ok ? `${item.firstByteMs} ms` : "" }),
      element("td", { class: item.ok ? "" : "cooling", text: item.ok ? `${formatBytes(item.speedKBps * 1024)}/s` : I18n.t(lang, "unavailable") })
    ])))
  );
}

function runSelfTestOn(tabId) {
  if (selfTests.get(tabId)?.running) return;
  selfTests.set(tabId, { running: true, result: null });
  refreshStatus();
  chrome.tabs.sendMessage(tabId, { type: "selfTest" }, { frameId: 0 }, (result) => {
    const failed = chrome.runtime.lastError || !result;
    selfTests.set(tabId, { running: false, result: failed ? { ok: false, reason: "error" } : result });
    refreshStatus();
  });
}

function refreshStatus() {
  chrome.runtime.sendMessage({ type: "getAllStats" }, (answer) => {
    const box = $("status");
    if (!box || chrome.runtime.lastError) return;
    const pages = answer?.pages || [];
    // A fresh status section (after switching sections) starts with no cards.
    for (const [tabId, entry] of cards) if (!box.contains(entry.card) || !pages.some((page) => page.tabId === tabId)) { entry.card.remove(); cards.delete(tabId); }
    let empty = box.querySelector(".status-empty");
    if (!box.querySelector(".status-intro")) box.prepend(element("div", { class: "desc status-intro", text: I18n.t(lang, "statusDesc") }));
    if (!pages.length) {
      if (!empty) box.append(element("div", { class: "status-empty", text: I18n.t(lang, "statusEmpty") }));
      return;
    }
    empty?.remove();
    for (const { tabId, title, stats } of pages) {
      let entry = cards.get(tabId);
      if (!entry) {
        const figures = element("div", { class: "figures" });
        const hosts = element("div");
        const test = element("div", { class: "st-box" });
        const button = element("button", { class: "field-button small", onclick: () => runSelfTestOn(tabId) });
        const card = element("section", { class: "page-card" }, [
          element("header", {}, [element("b", { class: "page-title" }), element("span", { class: "page-kind" }), button]),
          figures, hosts, test
        ]);
        entry = { card, figures, hosts, test, button };
        cards.set(tabId, entry);
        box.append(card);
      }
      entry.card.querySelector(".page-title").textContent = title || "bilibili";
      entry.card.querySelector(".page-kind").textContent = I18n.t(lang, stats.page === "live" ? "pageLive" : "pageVideo");
      const state = selfTests.get(tabId);
      entry.button.textContent = I18n.t(lang, state?.result ? "rerunSelfTest" : "selfTest");
      entry.button.disabled = Boolean(state?.running);
      entry.button.hidden = stats.page === "live";
      entry.figures.replaceChildren(
        element("div", {}, [element("b", { text: `${formatBytes(stats.speedBps)}/s` }), element("small", { text: I18n.t(lang, "speed") })]),
        element("div", {}, [element("b", { text: String(stats.activeThreads) }), element("small", { text: I18n.t(lang, "threadsNow") })]),
        element("div", {}, [element("b", { text: formatBytes(stats.acceleratedBytes) }), element("small", { text: I18n.t(lang, "accelerated") })]),
        ...(stats.page !== "live" && stats.memory?.bytes > 0 ? [
          element("div", {}, [element("b", { text: formatBytes(stats.memory.bytes) }), element("small", { text: I18n.t(lang, "memoryCache") })])
        ] : []),
        ...(stats.page !== "live" && Number.isFinite(stats.memory?.aheadSeconds) ? [
          element("div", {}, [element("b", { text: I18n.t(lang, "secondsShort").replace("{n}", String(stats.memory.aheadSeconds)) }), element("small", { text: I18n.t(lang, "bufferedAhead") })])
        ] : [])
      );
      entry.hosts.replaceChildren(...(stats.hosts?.length ? [statusTable(["colHost", "colSpeed", "colData"], stats.hosts.map((host) => element("tr", {}, [
        element("td", { class: host.cooling ? "cooling" : "", text: host.host, title: host.lastError || host.host }),
        element("td", { text: host.cooling ? I18n.t(lang, "paused") : `${formatBytes(host.speedKBps * 1024)}/s` }),
        element("td", { text: formatBytes(host.bytes) })
      ])))] : []));
      if (entry.test.dataset.version !== JSON.stringify(state || null) + lang) {
        entry.test.dataset.version = JSON.stringify(state || null) + lang;
        renderSelfTestInto(entry.test, tabId);
      }
    }
  });
}

// ---------------------------------------------------------------------------------
// Diagnostics: everything useful for a bug report, nothing that says what was watched.
// ---------------------------------------------------------------------------------
function collectDiagnostics() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "getAllStats" }, (answer) => {
      chrome.storage.local.get("lastSelfTest", (stored) => {
        const manifest = chrome.runtime.getManifest();
        const pages = (answer?.pages || []).map(({ stats }) => ({
          page: stats.page,
          engine: stats.version,
          frames: stats.frames,
          speedBps: stats.speedBps,
          activeThreads: stats.activeThreads,
          acceleratedRequests: stats.acceleratedRequests,
          acceleratedBytes: stats.acceleratedBytes,
          cacheHits: stats.cacheHits,
          fallbacks: stats.fallbacks,
          liveSegments: stats.liveSegments,
          hosts: stats.hosts,
          recentErrors: (stats.recentErrors || []).map((error) => ({ ...error, at: new Date(error.at).toISOString() }))
        }));
        const lastSelfTest = stored?.lastSelfTest ? { ...stored.lastSelfTest, at: new Date(stored.lastSelfTest.at).toISOString() } : null;
        resolve({
          report: "Biliweaver diagnostics",
          generatedAt: new Date().toISOString(),
          extension: { version: manifest.version },
          browser: { userAgent: navigator.userAgent, language: navigator.language, deviceMemoryGB: navigator.deviceMemory || null },
          settings: current,
          pages,
          lastSelfTest
        });
      });
    });
  });
}

function copyDiagnostics() {
  collectDiagnostics().then((data) => navigator.clipboard.writeText(JSON.stringify(data, null, 2)))
    .then(() => flash(I18n.t(lang, "copied")), () => flash("!"));
}

function downloadDiagnostics() {
  collectDiagnostics().then((data) => {
    const stamp = new Date().toISOString().slice(0, 19).replace(/[-:]/g, "").replace("T", "_");
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const link = element("a", { href: URL.createObjectURL(blob), download: `biliweaver-diagnostics-${stamp}.json` });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  });
}

function exportSettings() {
  const blob = new Blob([JSON.stringify({ biliweaver: chrome.runtime.getManifest().version, settings: current }, null, 2)], { type: "application/json" });
  const link = element("a", { href: URL.createObjectURL(blob), download: "biliweaver-settings.json" });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function importSettings(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  file.text().then((text) => {
    const data = JSON.parse(text);
    const incoming = data?.settings && typeof data.settings === "object" ? data.settings : data;
    if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) throw new Error("not settings");
    save(incoming);
    flash(I18n.t(lang, "importOk"));
  }).catch(() => flash(I18n.t(lang, "importFail")));
  event.target.value = "";
}

$("reset").addEventListener("click", () => {
  if (!confirm(I18n.t(lang, "resetConfirm"))) return;
  current = Settings.normalize(Settings.DEFAULTS);
  chrome.storage.sync.clear(() => chrome.storage.sync.set(current, () => flash(I18n.t(lang, "saved"))));
  render();
});

// ---------------------------------------------------------------------------------
// New version check: once each time this page opens, ask GitHub for the published
// releases (pre-releases included) and show a banner when one is newer than this copy.
// ---------------------------------------------------------------------------------
function versionParts(value) {
  return String(value || "").replace(/^v/i, "").split(/[.-]/).map((part) => Number.parseInt(part, 10)).map((part) => (Number.isFinite(part) ? part : 0));
}
function isNewer(candidate, installed) {
  const a = versionParts(candidate);
  const b = versionParts(installed);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  }
  return false;
}
let latestRelease = null;
function renderUpdate() {
  const box = $("update");
  document.body.classList.toggle("has-update", Boolean(latestRelease));
  if (!latestRelease) { box.hidden = true; return; }
  const installed = chrome.runtime.getManifest().version;
  $("updateTitle").textContent = I18n.t(lang, "updateAvailable").replace("{version}", latestRelease.tag);
  $("updateDesc").textContent = I18n.t(lang, "updateCurrent").replace("{current}", `v${installed}`);
  $("updateDownload").textContent = I18n.t(lang, "downloadUpdate");
  $("updateDownload").href = latestRelease.download || latestRelease.page;
  $("updateNotes").textContent = I18n.t(lang, "releaseNotes");
  $("updateNotes").href = latestRelease.page;
  box.hidden = false;
}
async function checkForUpdate() {
  try {
    const repo = new URL(I18n.ABOUT.github).pathname.replace(/^\/|\/$/g, "");
    const response = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=20`, { headers: { Accept: "application/vnd.github+json" }, cache: "no-store" });
    if (!response.ok) return;
    const releases = await response.json();
    const installed = chrome.runtime.getManifest().version;
    const best = (Array.isArray(releases) ? releases : [])
      .filter((release) => release && !release.draft && typeof release.tag_name === "string")
      .sort((a, b) => (isNewer(a.tag_name, b.tag_name) ? -1 : isNewer(b.tag_name, a.tag_name) ? 1 : 0))[0];
    if (!best || !isNewer(best.tag_name, installed)) return;
    const asset = (best.assets || []).find((item) => /^biliweaver-v.*\.zip$/i.test(item?.name || "")) || (best.assets || []).find((item) => /\.zip$/i.test(item?.name || ""));
    const safe = (url) => (/^https:\/\/github\.com\//.test(String(url || "")) ? String(url) : "");
    latestRelease = { tag: best.tag_name, page: safe(best.html_url) || I18n.ABOUT.releases, download: safe(asset?.browser_download_url) };
    renderUpdate();
  } catch (_error) {
    // Offline or rate limited by GitHub: no banner, nothing else changes.
  }
}

window.addEventListener("hashchange", render);
chrome.storage.onChanged.addListener((_changes, area) => {
  if (area !== "sync") return;
  chrome.storage.sync.get(null, (stored) => {
    const next = Settings.normalize({ ...Settings.DEFAULTS, ...stored });
    if (JSON.stringify(next) === JSON.stringify(current)) return;
    current = next;
    render();
  });
});
chrome.storage.sync.get(null, (stored) => {
  current = Settings.normalize({ ...Settings.DEFAULTS, ...stored });
  render();
});
render();
checkForUpdate();
