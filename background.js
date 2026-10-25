// Biliweaver service worker: the badge on the toolbar icon and the stats the popup shows.
// Each frame of a bilibili tab reports its own stats; they are added up per tab.
"use strict";
importScripts("shared/settings.js");
const Settings = globalThis.BiliweaverSettings;

const BADGE_COLOR = "#2f7d6d";
const tabs = new Map(); // tabId → Map(frameId → { stats, at })
const titles = new Map(); // tabId → page title from the top frame
let settings = Settings.normalize(Settings.DEFAULTS);

function loadSettings() {
  chrome.storage.sync.get(null, (stored) => {
    settings = Settings.normalize({ ...Settings.DEFAULTS, ...stored });
    for (const tabId of tabs.keys()) updateBadge(tabId);
  });
}
loadSettings();
chrome.storage.onChanged.addListener((_changes, area) => { if (area === "sync") loadSettings(); });

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason !== "install") return;
  chrome.storage.sync.get(null, (stored) => {
    // Write the defaults once so every part reads the same values from the start.
    if (!Object.keys(stored).length) chrome.storage.sync.set({ ...Settings.DEFAULTS, customHosts: [] });
  });
});

function aggregate(tabId) {
  const frames = tabs.get(tabId);
  if (!frames) return null;
  const now = Date.now();
  const out = { activeThreads: 0, queued: 0, speedBps: 0, acceleratedRequests: 0, acceleratedBytes: 0, cacheHits: 0, fallbacks: 0, liveSegments: 0, hosts: [], recentErrors: [], page: "video", version: "", frames: 0 };
  const hostMap = new Map();
  for (const [frameId, item] of frames) {
    // A frame that has gone quiet for long is gone (navigated or closed).
    if (now - item.at > 15000) { frames.delete(frameId); continue; }
    const stats = item.stats;
    out.frames += 1;
    out.version = stats.version || out.version;
    if (stats.page === "live") out.page = "live";
    for (const key of ["activeThreads", "queued", "speedBps", "acceleratedRequests", "acceleratedBytes", "cacheHits", "fallbacks", "liveSegments"]) out[key] += Number(stats[key]) || 0;
    for (const error of Array.isArray(stats.recentErrors) ? stats.recentErrors : []) out.recentErrors.push(error);
    for (const host of Array.isArray(stats.hosts) ? stats.hosts : []) {
      const seen = hostMap.get(host.host);
      if (!seen) hostMap.set(host.host, { ...host });
      else {
        seen.bytes += host.bytes;
        seen.requests += host.requests;
        seen.errors += host.errors;
        seen.inflight += host.inflight;
        seen.speedKBps = Math.max(seen.speedKBps, host.speedKBps);
        seen.cooling = seen.cooling && host.cooling;
      }
    }
  }
  out.recentErrors = out.recentErrors.sort((a, b) => a.at - b.at).slice(-15);
  out.hosts = [...hostMap.values()].sort((a, b) => b.bytes - a.bytes).slice(0, 16);
  return out;
}

function updateBadge(tabId) {
  const stats = aggregate(tabId);
  const text = settings.enabled && settings.badge && stats ? String(Math.min(999, stats.activeThreads)) : "";
  chrome.action.setBadgeBackgroundColor({ tabId, color: BADGE_COLOR }).catch(() => {});
  chrome.action.setBadgeText({ tabId, text }).catch(() => {});
}

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message?.type === "stats" && Number.isInteger(sender.tab?.id)) {
    const tabId = sender.tab.id;
    if (!tabs.has(tabId)) tabs.set(tabId, new Map());
    tabs.get(tabId).set(sender.frameId ?? 0, { stats: message.stats || {}, at: Date.now() });
    if (message.title) titles.set(tabId, String(message.title));
    updateBadge(tabId);
    return false;
  }
  if (message?.type === "openSettings") {
    chrome.runtime.openOptionsPage().catch(() => {});
    return false;
  }
  if (message?.type === "getAllStats") {
    const pages = [];
    for (const tabId of [...tabs.keys()]) {
      const stats = aggregate(tabId);
      if (stats && stats.frames) pages.push({ tabId, title: titles.get(tabId) || "", stats });
    }
    reply({ pages });
    return false;
  }
  if (message?.type === "getTabStats") {
    reply({ stats: aggregate(message.tabId) });
    return false;
  }
  return false;
});

chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status !== "loading") return;
  tabs.delete(tabId);
  chrome.action.setBadgeText({ tabId, text: "" }).catch(() => {});
});
chrome.tabs.onRemoved.addListener((tabId) => {
  tabs.delete(tabId);
  titles.delete(tabId);
});
