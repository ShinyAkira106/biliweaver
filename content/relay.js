// Biliweaver content relay. Runs in the extension's isolated world on the same pages as
// the page engine. It is the only part of the page side that can use chrome.* APIs:
//   brings the stored settings to the engine (and keeps a copy in this site's localStorage
//   so the engine has them synchronously on the next page load);
//   forwards the engine's stats to the service worker for the badge and the popup.
(function biliweaverRelay() {
  "use strict";
  if (globalThis.__biliweaverRelay) return;
  Object.defineProperty(globalThis, "__biliweaverRelay", { value: true });
  const Settings = globalThis.BiliweaverSettings;

  let current = Settings.normalize(Settings.DEFAULTS);
  let alive = true;

  const send = () => {
    try { localStorage.setItem(Settings.STORAGE_CACHE_KEY, JSON.stringify(current)); } catch (_error) {}
    document.dispatchEvent(new CustomEvent("biliweaver:settings", { detail: JSON.stringify(current) }));
  };

  const load = () => {
    try {
      chrome.storage.sync.get(null, (stored) => {
        if (chrome.runtime.lastError) return;
        current = Settings.normalize({ ...Settings.DEFAULTS, ...stored });
        send();
      });
    } catch (_error) {
      alive = false;
    }
  };

  load();
  document.addEventListener("biliweaver:hello", send);
  try {
    chrome.storage.onChanged.addListener((_changes, area) => {
      if (area === "sync") load();
    });
  } catch (_error) {}

  let lastStats = null;
  document.addEventListener("biliweaver:stats", (event) => {
    if (!alive) return;
    try {
      lastStats = JSON.parse(event.detail);
      chrome.runtime.sendMessage({ type: "stats", stats: lastStats, top: window.top === window, title: window.top === window ? document.title.slice(0, 120) : "" })?.catch?.(() => {});
    } catch (_error) {
      // The extension was reloaded while this page stayed open; nothing more to do here.
      alive = false;
    }
  });
})();
