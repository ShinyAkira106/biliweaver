// bilibili's international site. Viewers outside mainland China may get the same pages with
// a language in front of the path (www.bilibili.com/zh-Hans/video/…, /en/bangumi/play/…)
// or with ?site=OVERSEAS in the address, and a home page without the channel bar. The
// "user_site" cookie tells the server which of the two sites to show.
//
// The engine does not care which site a page is on: it works from the video addresses.
// These helpers are for the "Stay on the mainland site" setting, which the relay applies.
(function defineBiliweaverSite(scope) {
  "use strict";
  if (scope.BiliweaverSite) return;

  // Languages the international site uses today.
  const KNOWN = new Set(["zh-hans", "zh-hant", "en", "ja", "ko", "th", "vi", "id", "ms", "ar", "es", "pt", "ru", "tr", "fr", "de"]);
  // Sections a language can stand in front of, for languages not in the list above.
  const SECTIONS = new Set(["", "video", "bangumi", "list", "medialist", "festival", "cheese", "watchlater", "account", "anime", "movie", "tv", "search"]);
  const TAG = /^[a-z]{2,3}(?:-[a-z]{4})?(?:-(?:[a-z]{2}|\d{3}))?$/i;
  let displayNames = null;
  try { displayNames = new Intl.DisplayNames(["en"], { type: "language", fallback: "none" }); } catch (_error) {}

  function knownToBrowser(tag) {
    try { return Boolean(displayNames && displayNames.of(tag)); } catch (_error) { return false; }
  }

  // Whether the first path segment is a language. A short segment such as "tv" or "v" is a
  // section of the site itself, so an unlisted language counts only when a known section
  // follows it.
  function isLanguage(first, second) {
    const tag = String(first || "");
    if (!TAG.test(tag)) return false;
    if (KNOWN.has(tag.toLowerCase())) return true;
    return knownToBrowser(tag) && SECTIONS.has(String(second || "").toLowerCase());
  }

  // "/zh-Hans/video/BV1xx/" → "/video/BV1xx/". Paths without a language come back as is.
  function stripLanguage(pathname) {
    const path = String(pathname || "/");
    const parts = path.split("/");
    return isLanguage(parts[1], parts[2]) ? "/" + parts.slice(2).join("/") : path;
  }

  // The same page on the mainland site, or "" when the address already is one.
  function mainlandUrl(href) {
    let url;
    try { url = new URL(String(href)); } catch (_error) { return ""; }
    if (url.hostname !== "www.bilibili.com") return "";
    let changed = false;
    const path = stripLanguage(url.pathname);
    if (path !== url.pathname) { url.pathname = path; changed = true; }
    if (String(url.searchParams.get("site") || "").toUpperCase() === "OVERSEAS") {
      url.searchParams.delete("site");
      url.searchParams.delete("lang");
      changed = true;
    }
    return changed ? url.href : "";
  }

  const api = Object.freeze({ isLanguage, stripLanguage, mainlandUrl });
  Object.defineProperty(scope, "BiliweaverSite", { value: api, configurable: false, enumerable: false, writable: false });
})(globalThis);
