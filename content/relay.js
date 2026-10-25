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

  // The route self test runs in the page. The settings page asks for it through here, and
  // every finished run (from there or from the player panel) is kept for diagnostics.
  const waiting = new Map();
  document.addEventListener("biliweaver:selftest-result", (event) => {
    let message = null;
    try { message = JSON.parse(event.detail); } catch (_error) { return; }
    if (message?.result?.ok) {
      try { chrome.storage.local.set({ lastSelfTest: { ...message.result, page: location.hostname === "live.bilibili.com" ? "live" : "video" } }); } catch (_error) {}
    }
    const reply = waiting.get(message?.id);
    if (reply) {
      waiting.delete(message.id);
      reply(message.result);
    }
  });
  try {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type !== "selfTest" || window.top !== window) return false;
      const id = `relay-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const timer = setTimeout(() => {
        if (!waiting.has(id)) return;
        waiting.delete(id);
        sendResponse({ ok: false, reason: "noVideo" });
      }, 25000);
      waiting.set(id, (result) => {
        clearTimeout(timer);
        sendResponse(result);
      });
      document.dispatchEvent(new CustomEvent("biliweaver:selftest", { detail: JSON.stringify({ id }) }));
      return true;
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
