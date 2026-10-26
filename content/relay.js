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

  // "Stay on the mainland site": the user_site cookie asks bilibili for the mainland pages,
  // and an international address is replaced by the same page there. Only the cookie this
  // setting set is removed again when it goes off; one the viewer chose stays.
  const SITE_FLAG = "biliweaver:user-site";
  const REDIRECTS = "biliweaver:site-redirects";
  const COOKIE_SCOPE = "domain=.bilibili.com; path=/";
  const userSite = () => (/(?:^|;\s*)user_site=([^;]*)/.exec(document.cookie) || [])[1] || "";
  // Two trips back within 15 seconds mean bilibili keeps sending this tab to the
  // international site (some accounts are only allowed there), so it is left alone.
  const mayRedirect = () => {
    try {
      const now = Date.now();
      const recent = JSON.parse(sessionStorage.getItem(REDIRECTS) || "[]").filter((at) => now - at < 15000);
      if (recent.length >= 2) return false;
      sessionStorage.setItem(REDIRECTS, JSON.stringify([...recent, now]));
      return true;
    } catch (_error) {
      return false;
    }
  };
  let leaving = false;
  const applySite = (settings) => {
    if (leaving || window.top !== window || location.hostname !== "www.bilibili.com") return;
    try {
      if (settings.enabled && settings.blockIntl) {
        if (userSite() !== "CN") {
          document.cookie = `user_site=CN; ${COOKIE_SCOPE}; max-age=31536000`;
          localStorage.setItem(SITE_FLAG, "1");
        }
        const target = globalThis.BiliweaverSite.mainlandUrl(location.href);
        if (target && target !== location.href) {
          if (mayRedirect()) {
            leaving = true;
            location.replace(target);
          }
          else console.info("[Biliweaver] bilibili keeps sending this tab to the international site, so it stays there.");
        }
      } else if (localStorage.getItem(SITE_FLAG)) {
        if (userSite() === "CN") document.cookie = `user_site=; ${COOKIE_SCOPE}; max-age=0`;
        localStorage.removeItem(SITE_FLAG);
      }
    } catch (_error) {}
  };
  // The copy kept in localStorage is read at once, so the redirect happens before the page
  // has loaded; the stored settings confirm it a moment later.
  try {
    const cached = localStorage.getItem(Settings.STORAGE_CACHE_KEY);
    if (cached) applySite(Settings.normalize(JSON.parse(cached)));
  } catch (_error) {}

  const load = () => {
    try {
      chrome.storage.sync.get(null, (stored) => {
        if (chrome.runtime.lastError) return;
        current = Settings.normalize({ ...Settings.DEFAULTS, ...stored });
        send();
        applySite(current);
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
