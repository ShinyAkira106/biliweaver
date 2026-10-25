// Biliweaver button inside the bilibili player's control bar, with a small settings panel.
// Runs in the extension's isolated world next to relay.js, so it reads and writes
// chrome.storage directly; the page engine picks up changes through the relay as usual.
//
// The button wears the player's own control button classes and, once in place, copies the
// size, spacing and color of the native button next to it, so it reads as one of them. The panel lives in a shadow root, so neither the page's CSS nor ours leaks across.
// The player rebuilds its control bar on episode changes and page navigation; a mutation
// observer puts the button back when that happens.
(function biliweaverPlayerButton() {
  "use strict";
  if (globalThis.__biliweaverPlayerButton) return;
  Object.defineProperty(globalThis, "__biliweaverPlayerButton", { value: true });
  const Settings = globalThis.BiliweaverSettings;
  const I18n = globalThis.BiliweaverI18n;
  let lang = I18n.resolve("auto", navigator.language);
  const t = (key) => I18n.t(lang, key);

  // Where the right-hand control buttons live, newest player first. `before` names the
  // native button ours goes in front of; without it, ours becomes the first one.
  const SLOTS = [
    { bar: ".bpx-player-control-bottom-right", before: ".bpx-player-ctrl-setting", native: "bpx" },
    { bar: ".bilibili-player-video-control-bottom-right", before: ".bilibili-player-video-btn-setting", native: "legacy" },
    { bar: ".web-player-controller-wrap .right-area", before: null, native: "live" },
    { bar: "#live-player .right-area", before: null, native: "live" }
  ];
  const BUTTON_CLASS = "biliweaver-ctrl";
  const ANCHORS = SLOTS.filter((slot) => slot.before).map((slot) => slot.before).join(", ");

  let settings = Settings.normalize(Settings.DEFAULTS);
  let stats = null;
  let alive = true;
  let open = false;
  let host = null; // the button element currently in the page
  let panelRoot = null; // shadow root of the panel

  // The Biliweaver mark (three strands each way, woven over and under, as in the
  // extension icon) drawn as a one color glyph so it sits among the player's own icons.
  // Each weft piece is its own path, so on hover the three weft threads can be woven in
  // again, left to right and one after another.
  // The weave spans 18.8 of the 22 unit canvas once the stroke is counted; a square mark
  // reads larger than the round gear, so it is drawn a touch smaller than the gear.
  const ICON_CANVAS = 22;
  const ICON_EXTENT = 18.8 / 0.92;
  const ICON = `<svg viewBox="0 0 22 22" width="22" height="22" aria-hidden="true" focusable="false">
    <g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
      <path class="bw-warp" d="M6.5 2.6V8.3M6.5 13.7V19.4M11 2.6V3.8M11 9.2V12.8M11 18.2V19.4M15.5 2.6V8.3M15.5 13.7V19.4"/>
      <path class="bw-weft" style="--d:0.060s;--t:0.030s" pathLength="1" d="M2.6 6.5H3.8"/>
      <path class="bw-weft" style="--d:0.225s;--t:0.090s" pathLength="1" d="M9.2 6.5H12.8"/>
      <path class="bw-weft" style="--d:0.450s;--t:0.030s" pathLength="1" d="M18.2 6.5H19.4"/>
      <path class="bw-weft" style="--d:0.220s;--t:0.143s" pathLength="1" d="M2.6 11H8.3"/>
      <path class="bw-weft" style="--d:0.498s;--t:0.142s" pathLength="1" d="M13.7 11H19.4"/>
      <path class="bw-weft" style="--d:0.380s;--t:0.030s" pathLength="1" d="M2.6 15.5H3.8"/>
      <path class="bw-weft" style="--d:0.545s;--t:0.090s" pathLength="1" d="M9.2 15.5H12.8"/>
      <path class="bw-weft" style="--d:0.770s;--t:0.030s" pathLength="1" d="M18.2 15.5H19.4"/>
    </g>
  </svg>`;

  // ---------------------------------------------------------------------------------
  // Settings and stats.
  // ---------------------------------------------------------------------------------
  function loadSettings() {
    try {
      chrome.storage.sync.get(null, (stored) => {
        if (chrome.runtime.lastError) return;
        settings = Settings.normalize({ ...Settings.DEFAULTS, ...stored });
        const nextLang = I18n.resolve(settings.language, navigator.language);
        if (nextLang !== lang) {
          lang = nextLang;
          if (panelRoot) translatePanel();
        }
        if (!settings.playerButton) removeButton();
        else schedule();
        render();
      });
    } catch (_error) {
      alive = false;
    }
  }
  function save(patch) {
    settings = Settings.normalize({ ...settings, ...patch });
    const nextLang = I18n.resolve(settings.language, navigator.language);
    if (nextLang !== lang) {
      lang = nextLang;
      if (panelRoot) translatePanel();
    }
    render();
    try { chrome.storage.sync.set(settings); } catch (_error) { alive = false; }
  }
  try {
    chrome.storage.onChanged.addListener((_changes, area) => { if (area === "sync") loadSettings(); });
  } catch (_error) {}
  loadSettings();

  document.addEventListener("biliweaver:stats", (event) => {
    try { stats = JSON.parse(event.detail); } catch (_error) { return; }
    if (open) renderStats();
  });

  // ---------------------------------------------------------------------------------
  // The button.
  // ---------------------------------------------------------------------------------
  function findSlot() {
    for (const slot of SLOTS) {
      const bar = document.querySelector(slot.bar);
      if (bar) return { ...slot, element: bar };
    }
    return null;
  }

  function removeButton() {
    closePanel();
    document.querySelectorAll(`.${BUTTON_CLASS}`).forEach((element) => element.remove());
    host = null;
    panelRoot = null;
  }

  function createButton(slot) {
    const button = document.createElement("div");
    button.className = BUTTON_CLASS;
    if (slot.native === "bpx") button.classList.add("bpx-player-ctrl-btn");
    if (slot.native === "legacy") button.classList.add("bilibili-player-video-btn");
    button.setAttribute("role", "button");
    button.setAttribute("tabindex", "0");
    button.setAttribute("aria-label", "Biliweaver");
    button.setAttribute("aria-haspopup", "dialog");
    button.setAttribute("aria-expanded", "false");
    button.dataset.slot = slot.native;

    // The panel's shadow host sits inside the button so it follows the control bar into
    // fullscreen and hides with it.
    const iconWrap = document.createElement("div");
    iconWrap.className = slot.native === "bpx" ? "bpx-player-ctrl-btn-icon" : "biliweaver-ctrl-icon";
    iconWrap.innerHTML = ICON;
    const panelHost = document.createElement("div");
    panelHost.className = "biliweaver-panel-host";
    panelRoot = panelHost.attachShadow({ mode: "open" });
    panelRoot.innerHTML = `<style>${PANEL_CSS}</style>${PANEL_HTML}`;
    translatePanel();
    wirePanel(panelRoot);
    button.append(iconWrap, panelHost);

    button.addEventListener("click", (event) => {
      // Clicks inside the panel are the panel's own.
      if (event.composedPath().includes(panelHost)) return;
      event.stopPropagation();
      togglePanel();
    });
    button.addEventListener("keydown", (event) => {
      if (event.target !== button) return;
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        event.stopPropagation();
        togglePanel();
      }
    });
    // The player treats key presses and clicks anywhere on it as playback commands (space
    // pauses, a click toggles play). None of that should happen from inside the panel.
    for (const type of ["click", "dblclick", "mousedown", "pointerdown", "keydown", "keyup", "wheel"]) {
      panelHost.addEventListener(type, (event) => event.stopPropagation());
    }
    return button;
  }

  // The native button ours belongs in front of, if the player has drawn it yet. It may be
  // nested a level down, so it is searched for, not taken from the bar's own children.
  function anchorIn(slot) {
    return slot.before ? slot.element.querySelector(slot.before) : null;
  }

  function placed(slot) {
    if (!host || !slot.element.contains(host)) return false;
    const anchor = anchorIn(slot);
    return !anchor || host.nextElementSibling === anchor;
  }

  function place(slot) {
    const anchor = anchorIn(slot);
    if (anchor?.parentElement) anchor.parentElement.insertBefore(host, anchor);
    else if (!slot.element.contains(host)) slot.element.insertBefore(host, slot.element.firstChild);
    align(slot);
  }

  // Copy the box of a neighbouring native button: its height, side margins and padding,
  // and the size its icon is drawn at. The icon itself is always pure white.
  function align(slot) {
    if (!host) return;
    const anchor = anchorIn(slot);
    const reference = anchor || [...slot.element.children].find((child) => child !== host && !child.classList.contains(BUTTON_CLASS) && child.getBoundingClientRect().width > 0);
    if (!reference) return;
    const style = getComputedStyle(reference);
    const box = reference.getBoundingClientRect();
    Object.assign(host.style, {
      height: style.height !== "auto" ? style.height : `${Math.round(box.height)}px`,
      marginLeft: style.marginLeft,
      marginRight: style.marginRight,
      paddingLeft: style.paddingLeft,
      paddingRight: style.paddingRight,
      color: "#fff"
    });
    // Match the size of the native glyph as drawn, not of its <svg> element: the player's
    // icons sit in a large canvas with empty space around the shape.
    const glyph = drawnGlyphSize(reference.querySelector("svg"));
    const size = Math.max(12, Math.round((glyph || 18) * ICON_CANVAS / ICON_EXTENT));
    const svg = host.querySelector(":scope > div > svg");
    if (svg) {
      svg.setAttribute("width", String(size));
      svg.setAttribute("height", String(size));
    }
    // The button is as wide as the native one, or its icon plus the same breathing room.
    host.style.width = style.width !== "auto" && parseFloat(style.width) > 0 ? style.width : `${size + 14}px`;
  }

  // The larger side, in CSS pixels, of what an <svg> actually paints.
  function drawnGlyphSize(icon) {
    if (!icon) return 0;
    try {
      const box = icon.getBBox();
      const rect = icon.getBoundingClientRect();
      const view = icon.viewBox?.baseVal;
      const scaleX = view && view.width ? rect.width / view.width : 1;
      const scaleY = view && view.height ? rect.height / view.height : 1;
      const scale = Math.min(scaleX, scaleY);
      const size = Math.max(box.width, box.height) * scale;
      if (size > 0 && size <= Math.max(rect.width, rect.height) + 1) return size;
    } catch (_error) {}
    const rect = icon.getBoundingClientRect();
    return rect.width > 0 ? Math.max(rect.width, rect.height) * 0.75 : 0;
  }

  function ensureButton() {
    if (!alive || !settings.playerButton) return;
    const slot = findSlot();
    if (!slot) return;
    if (placed(slot)) return;
    if (!host || !host.isConnected) {
      removeButton();
      host = createButton(slot);
    }
    place(slot);
    render();
  }

  // At most a few looks per second: pages with danmaku change the DOM all the time.
  let pending = false;
  let lastLook = 0;
  function schedule() {
    if (pending) return;
    pending = true;
    const wait = Math.max(0, 250 - (Date.now() - lastLook));
    setTimeout(() => requestAnimationFrame(() => {
      pending = false;
      lastLook = Date.now();
      ensureButton();
    }), wait);
  }

  const PAGE_CSS = `
    .${BUTTON_CLASS}{position:relative;display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;cursor:pointer;outline:none;flex:none;vertical-align:middle}
    .${BUTTON_CLASS} > div:first-child{display:flex;align-items:center;justify-content:center;width:100%;height:100%;line-height:0}
    .${BUTTON_CLASS} svg{display:block;color:#fff;overflow:visible}
    .${BUTTON_CLASS}.is-off svg{opacity:.45}
    .${BUTTON_CLASS} .bw-weft{stroke-dasharray:1 1;stroke-dashoffset:0}
    .${BUTTON_CLASS} .bw-warp{transform-box:fill-box;transform-origin:center}
    @keyframes biliweaver-weft{from{stroke-dashoffset:1}to{stroke-dashoffset:0}}
    @keyframes biliweaver-warp{0%,100%{transform:scaleY(1)}35%{transform:scaleY(1.08)}}
    @media (prefers-reduced-motion:no-preference){
      .${BUTTON_CLASS}:hover:not(.is-open) .bw-weft{animation:biliweaver-weft var(--t) linear var(--d) both}
      .${BUTTON_CLASS}:hover:not(.is-open) .bw-warp{animation:biliweaver-warp .8s ease-in-out}
    }
    .${BUTTON_CLASS}:focus-visible{box-shadow:0 0 0 2px rgba(255,255,255,.6);border-radius:4px}
    .${BUTTON_CLASS}[data-slot=live]{height:100%;margin:0 4px;color:#fff}
    .${BUTTON_CLASS} .biliweaver-panel-host{position:absolute;right:-12px;bottom:calc(100% + 14px);z-index:100;cursor:default;line-height:normal}
  `;
  function installPageCss() {
    if (document.getElementById("biliweaver-ctrl-style")) return;
    const style = document.createElement("style");
    style.id = "biliweaver-ctrl-style";
    style.textContent = PAGE_CSS;
    (document.head || document.documentElement).append(style);
  }

  // ---------------------------------------------------------------------------------
  // The panel.
  // ---------------------------------------------------------------------------------
  const PANEL_HTML = `
    <div class="panel" role="dialog" aria-label="Biliweaver" hidden>
      <div class="view main-view">
      <div class="head">
        <span class="name">Biliweaver</span>
        <button class="toggle" data-key="enabled" role="switch" data-i18n-aria="enabled"><i></i></button>
      </div>
      <div class="stats">
        <div><b data-stat="speed">0 B/s</b><span data-i18n="speed"></span></div>
        <div><b data-stat="threads">0</b><span data-i18n="threadsNow"></span></div>
        <div><b data-stat="bytes">0 B</b><span data-i18n="accelerated"></span></div>
      </div>
      <div class="group">
        <div class="label" data-i18n="threads"></div>
        <div class="segments" data-key="threads">
          <button data-value="4">4</button><button data-value="8">8</button><button data-value="16">16</button><button data-value="32">32</button>
        </div>
      </div>
      <div class="group">
        <div class="label" data-i18n="cdn"></div>
        <div class="segments" data-key="cdn">
          <button data-value="auto" data-i18n="cdnAuto"></button><button data-value="mainland" data-i18n="cdnMainland"></button><button data-value="overseas" data-i18n="cdnOverseas"></button><button data-value="original" data-i18n="cdnOriginal"></button>
        </div>
      </div>
      <div class="row"><span data-i18n="prefetch"></span><button class="toggle" data-key="prefetch" role="switch" data-i18n-aria="prefetch"><i></i></button></div>
      <div class="row"><span data-i18n="avoidPcdn"></span><button class="toggle" data-key="avoidPcdn" role="switch" data-i18n-aria="avoidPcdn"><i></i></button></div>
      <div class="row live-only"><span data-i18n="preferHls"></span><button class="toggle" data-key="preferHls" role="switch" data-i18n-aria="preferHls"><i></i></button></div>
      <button class="row nav-row" data-open="selftest-view"><span data-i18n="selfTest"></span><span class="value"><span data-current="selftest"></span><svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></span></button>
      <button class="row nav-row" data-open="lang-view" aria-haspopup="menu"><span data-i18n="language"></span><span class="value"><span data-current="language"></span><svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></span></button>
      <div class="hosts" data-stat="hosts"></div>
      <div class="foot">
        <span class="note marquee"><span data-i18n="noteReload"></span></span>
        <button class="more" data-i18n="allSettings"></button>
      </div>
      </div>
      <div class="view selftest-view" hidden>
        <div class="sub-head"><button class="back" data-i18n-aria="selfTest"><svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M10 3.5 5.5 8 10 12.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button><span data-i18n="selfTest"></span></div>
        <div class="st-summary" data-st="summary"></div>
        <div class="st-list" data-st="list"></div>
        <div class="foot">
          <span class="note marquee"><span data-i18n="selfTestHint"></span></span>
          <button class="more st-run" data-i18n="runSelfTest"></button>
        </div>
      </div>
      <div class="view lang-view" hidden>
        <div class="sub-head"><button class="back" data-i18n-aria="language"><svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M10 3.5 5.5 8 10 12.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button><span data-i18n="language"></span></div>
        <div class="options" role="menu">
          <button role="menuitemradio" data-language="auto"><span data-i18n="langAuto"></span><svg class="check" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="m3.5 8.5 3 3 6-7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
          <button role="menuitemradio" data-language="zh-CN"><span>简体中文</span><svg class="check" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="m3.5 8.5 3 3 6-7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
          <button role="menuitemradio" data-language="en"><span>English</span><svg class="check" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="m3.5 8.5 3 3 6-7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
          <button role="menuitemradio" data-language="ja"><span>日本語</span><svg class="check" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="m3.5 8.5 3 3 6-7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
        </div>
      </div>
    </div>`;

  function translatePanel() {
    I18n.apply(panelRoot, lang);
    renderSelfTest();
  }

  const PANEL_CSS = `
    :host{all:initial}
    [hidden]{display:none!important}
    .panel{box-sizing:border-box;width:288px;padding:12px 14px 10px;border-radius:8px;background:rgba(21,21,21,.92);
      color:hsla(0,0%,100%,.9);font:13px/1.4 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;
      box-shadow:0 6px 24px rgba(0,0,0,.35);backdrop-filter:blur(6px);text-align:left;user-select:none;
      animation:rise .14s ease-out}
    @keyframes rise{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
    .head{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}
    .name{font-weight:600;font-size:14px;color:#fff;letter-spacing:.01em}
    .stats{display:grid;grid-template-columns:repeat(3,1fr);gap:4px;padding:8px 0;margin-bottom:8px;border-top:1px solid hsla(0,0%,100%,.12);border-bottom:1px solid hsla(0,0%,100%,.12)}
    .stats div{display:flex;flex-direction:column;align-items:center}
    .stats b{font-size:13px;font-weight:600;color:#00aeec;font-variant-numeric:tabular-nums;white-space:nowrap}
    .stats span{font-size:11px;color:hsla(0,0%,100%,.55)}
    .group{margin:8px 0}
    .label{font-size:12px;color:hsla(0,0%,100%,.6);margin-bottom:5px}
    .segments{display:grid;grid-template-columns:repeat(4,1fr);gap:4px}
    button{font:inherit;color:inherit;cursor:pointer;border:0;background:none;padding:0}
    .segments button{height:26px;border-radius:4px;background:hsla(0,0%,100%,.08);font-size:12px}
    .segments button:hover{background:hsla(0,0%,100%,.16)}
    .segments button[aria-pressed=true]{background:#00aeec;color:#fff}
    .row{display:flex;align-items:center;justify-content:space-between;height:30px}
    .toggle{position:relative;width:30px;height:16px;border-radius:999px;background:hsla(0,0%,100%,.25);transition:background .15s;flex:none}
    .toggle i{position:absolute;top:2px;left:2px;width:12px;height:12px;border-radius:50%;background:#fff;transition:transform .15s}
    .toggle[aria-checked=true]{background:#00aeec}
    .toggle[aria-checked=true] i{transform:translateX(14px)}
    button:focus-visible{outline:2px solid #00aeec;outline-offset:2px}
    .hosts{margin-top:6px;font-size:11px;color:hsla(0,0%,100%,.6)}
    .hosts:empty{display:none}
    .hosts .host-row{display:flex;align-items:center;gap:10px;height:20px;font-variant-numeric:tabular-nums}
    .hosts .host-speed{flex:none;min-width:68px;text-align:right;white-space:nowrap}
    .hosts .cool{color:#f69}
    /* One line always. Text that does not fit ends in an ellipsis; hovering it scrolls the
       rest into view and back. */
    .marquee{flex:1;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
    .marquee > span{display:inline}
    .marquee.scrolling{text-overflow:clip}
    .marquee.scrolling > span{display:inline-block;animation:marquee var(--duration) ease-in-out .3s infinite alternate}
    @keyframes marquee{0%,12%{transform:translateX(0)}88%,100%{transform:translateX(var(--shift))}}
    @media (prefers-reduced-motion:reduce){.marquee.scrolling > span{animation:none}.marquee.scrolling{text-overflow:ellipsis}}
    .foot{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:8px;padding-top:8px;border-top:1px solid hsla(0,0%,100%,.12)}
    .note{font-size:11px;color:hsla(0,0%,100%,.45)}
    .segments button{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:0 2px}
    .row > span:first-child,.label{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .more{font-size:12px;color:#00aeec;flex:none}
    .more:hover{text-decoration:underline}
    .off .stats,.off .group,.off .row:not(.head):not(.nav-row){opacity:.45}
    .view{animation:slide .16s ease-out}
    .lang-view,.selftest-view{animation-name:slide-in}
    .st-summary{font-size:12px;color:hsla(0,0%,100%,.7);min-height:18px;margin-bottom:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .st-summary.busy::after{content:"";display:inline-block;width:10px;height:10px;margin-left:8px;vertical-align:-1px;border:2px solid hsla(0,0%,100%,.25);border-top-color:#00aeec;border-radius:50%;animation:spin .8s linear infinite}
    @keyframes spin{to{transform:rotate(360deg)}}
    .st-list{display:flex;flex-direction:column;max-height:228px;overflow-y:auto;font-size:11px;font-variant-numeric:tabular-nums;scrollbar-width:thin}
    .st-row{display:grid;grid-template-columns:minmax(0,1fr) 54px 68px;align-items:center;gap:8px;height:22px;color:hsla(0,0%,100%,.75)}
    .st-row .num{text-align:right;white-space:nowrap}
    .st-row.bad{color:hsla(0,0%,100%,.4)}
    .st-row.bad .num:last-child{color:#f69}
    .st-run[disabled]{opacity:.5;cursor:default}
    @keyframes slide{from{opacity:.4;transform:translateX(-8px)}to{opacity:1;transform:none}}
    @keyframes slide-in{from{opacity:.4;transform:translateX(8px)}to{opacity:1;transform:none}}
    .nav-row{width:calc(100% + 12px);margin:0 -6px;padding:0 6px;border-radius:4px;text-align:left}
    .nav-row:hover{background:hsla(0,0%,100%,.08)}
    .nav-row .value{display:flex;align-items:center;gap:4px;color:hsla(0,0%,100%,.6)}
    .nav-row:hover .value{color:#fff}
    .sub-head{display:flex;align-items:center;gap:6px;height:28px;margin:-2px 0 8px;font-weight:600;color:#fff}
    .back{display:grid;place-items:center;width:24px;height:24px;margin-left:-6px;border-radius:4px}
    .back:hover{background:hsla(0,0%,100%,.1)}
    .options{display:flex;flex-direction:column;gap:2px}
    .options button{display:flex;align-items:center;justify-content:space-between;height:34px;padding:0 8px;margin:0 -6px;border-radius:4px;text-align:left}
    .options button:hover{background:hsla(0,0%,100%,.08)}
    .options .check{visibility:hidden;color:#00aeec}
    .options button[aria-checked=true]{color:#00aeec}
    .options button[aria-checked=true] .check{visibility:visible}
  `;

  // Hovering a truncated line scrolls it: the distance is how much does not fit, and the
  // speed stays about the same whatever the length.
  function wireMarquee(root) {
    root.addEventListener("mouseover", (event) => {
      const box = event.target.closest?.(".marquee");
      if (!box || box.classList.contains("scrolling")) return;
      const overflow = box.scrollWidth - box.clientWidth;
      if (overflow <= 1) return;
      box.style.setProperty("--shift", `${-overflow - 2}px`);
      box.style.setProperty("--duration", `${Math.max(1.2, overflow / 28).toFixed(2)}s`);
      box.classList.add("scrolling");
    });
    root.addEventListener("mouseout", (event) => {
      const box = event.target.closest?.(".marquee");
      if (box && !box.contains(event.relatedTarget)) box.classList.remove("scrolling");
    });
  }

  function wirePanel(root) {
    wireMarquee(root);
    root.querySelectorAll(".toggle").forEach((toggle) => {
      toggle.addEventListener("click", () => save({ [toggle.dataset.key]: !settings[toggle.dataset.key] }));
    });
    root.querySelectorAll(".segments").forEach((group) => {
      group.addEventListener("click", (event) => {
        const button = event.target.closest("button[data-value]");
        if (!button) return;
        const value = group.dataset.key === "threads" ? Number(button.dataset.value) : button.dataset.value;
        save({ [group.dataset.key]: value });
      });
    });
    root.querySelector(".more").addEventListener("click", () => {
      try { chrome.runtime.sendMessage({ type: "openSettings" })?.catch?.(() => {}); } catch (_error) {}
      closePanel();
    });
    root.querySelectorAll(".nav-row[data-open]").forEach((row) => row.addEventListener("click", () => {
      showView(row.dataset.open);
      if (row.dataset.open === "selftest-view" && !selfTestState.result && !selfTestState.running) runSelfTest();
    }));
    root.querySelectorAll(".back").forEach((back) => back.addEventListener("click", () => showView("main-view")));
    root.querySelector(".st-run").addEventListener("click", () => runSelfTest());
    root.querySelectorAll("[data-language]").forEach((button) => {
      button.addEventListener("click", () => {
        save({ language: button.dataset.language });
        showView("main-view");
      });
    });

  }

  function showView(name) {
    if (!panelRoot) return;
    panelRoot.querySelectorAll(".view").forEach((view) => { view.hidden = !view.classList.contains(name); });
    const target = name === "lang-view" ? panelRoot.querySelector("[data-language][aria-checked=true]")
      : name === "selftest-view" ? panelRoot.querySelector(".selftest-view .back")
        : panelRoot.querySelector(".nav-row");
    target?.focus({ preventScroll: true });
  }

  // ---------------------------------------------------------------------------------
  // Route self test, run in the page engine.
  // ---------------------------------------------------------------------------------
  const selfTestState = { running: false, result: null, id: "" };
  document.addEventListener("biliweaver:selftest-result", (event) => {
    let message = null;
    try { message = JSON.parse(event.detail); } catch (_error) { return; }
    if (!message || message.id !== selfTestState.id) return;
    selfTestState.running = false;
    selfTestState.result = message.result;
    renderSelfTest();
  });

  function runSelfTest() {
    if (selfTestState.running) return;
    selfTestState.running = true;
    selfTestState.id = `panel-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    renderSelfTest();
    document.dispatchEvent(new CustomEvent("biliweaver:selftest", { detail: JSON.stringify({ id: selfTestState.id }) }));
    // A page without the engine never answers.
    const id = selfTestState.id;
    setTimeout(() => {
      if (!selfTestState.running || selfTestState.id !== id) return;
      selfTestState.running = false;
      selfTestState.result = { ok: false, reason: "noVideo" };
      renderSelfTest();
    }, 25000);
  }

  function renderSelfTest() {
    if (!panelRoot) return;
    const summary = panelRoot.querySelector("[data-st=summary]");
    const list = panelRoot.querySelector("[data-st=list]");
    const button = panelRoot.querySelector(".st-run");
    const current = panelRoot.querySelector("[data-current=selftest]");
    const result = selfTestState.result;
    button.disabled = selfTestState.running;
    button.textContent = t(result ? "rerunSelfTest" : "runSelfTest");
    summary.classList.toggle("busy", selfTestState.running);
    if (selfTestState.running) {
      summary.textContent = t("selfTestRunning");
      current.textContent = t("selfTestRunning");
      return;
    }
    if (!result) {
      summary.textContent = "";
      current.textContent = "";
      list.replaceChildren();
      return;
    }
    if (!result.ok) {
      summary.textContent = t(result.reason === "live" ? "selfTestLive" : result.reason === "noVideo" ? "selfTestNoVideo" : "selfTestError");
      current.textContent = "";
      list.replaceChildren();
      return;
    }
    const line = t("selfTestSummary").replace("{working}", String(result.working)).replace("{tested}", String(result.tested));
    summary.textContent = line;
    current.textContent = `${result.working} / ${result.tested}`;
    const sourceKey = { bilibili: "sourceBilibili", mainland: "sourceMainland", overseas: "sourceOverseas", custom: "sourceCustom" };
    list.replaceChildren(...result.results.map((item) => {
      const row = document.createElement("div");
      row.className = item.ok ? "st-row" : "st-row bad";
      const name = document.createElement("span");
      name.className = "marquee";
      const text = document.createElement("span");
      text.textContent = item.host.replace(/\.bilivideo\.(?:com|cn)$/, "");
      name.append(text);
      name.title = `${item.host}\n${t(sourceKey[item.source] || "sourceBilibili")}${item.error ? `\n${item.error}` : ""}`;
      const latency = document.createElement("span");
      latency.className = "num";
      latency.textContent = item.ok ? `${item.firstByteMs} ms` : "";
      const speed = document.createElement("span");
      speed.className = "num";
      speed.textContent = item.ok ? `${formatBytes(item.speedKBps * 1024)}/s` : t("unavailable");
      row.append(name, latency, speed);
      return row;
    }));
  }

  function formatBytes(value) {
    const units = ["B", "KB", "MB", "GB"];
    let number = Number(value) || 0;
    let unit = 0;
    while (number >= 1024 && unit < units.length - 1) { number /= 1024; unit += 1; }
    return `${number >= 100 || unit === 0 ? Math.round(number) : number.toFixed(1)} ${units[unit]}`;
  }

  function renderStats() {
    if (!panelRoot) return;
    const set = (name, text) => { const element = panelRoot.querySelector(`[data-stat=${name}]`); if (element) element.textContent = text; };
    set("speed", `${formatBytes(stats?.speedBps)}/s`);
    set("threads", String(stats?.activeThreads || 0));
    set("bytes", formatBytes(stats?.acceleratedBytes));
    // Rows are updated in place, so a name that is scrolling on hover keeps scrolling while
    // the numbers refresh every second.
    const list = panelRoot.querySelector("[data-stat=hosts]");
    const hosts = (stats?.hosts || []).slice(0, 4);
    while (list.children.length > hosts.length) list.lastElementChild.remove();
    hosts.forEach((item, index) => {
      let row = list.children[index];
      if (!row) {
        row = document.createElement("div");
        row.className = "host-row";
        const name = document.createElement("span");
        name.className = "marquee";
        name.append(document.createElement("span"));
        const speed = document.createElement("span");
        speed.className = "host-speed";
        row.append(name, speed);
        list.append(row);
      }
      const [name, speed] = row.children;
      const label = item.host.replace(/\.bilivideo\.(?:com|cn)$/, "");
      if (name.firstChild.textContent !== label) {
        name.firstChild.textContent = label;
        name.classList.remove("scrolling");
      }
      name.title = item.lastError ? `${item.host}\n${item.lastError}` : item.host;
      speed.textContent = item.cooling ? t("paused") : `${formatBytes(item.speedKBps * 1024)}/s`;
      row.classList.toggle("cool", item.cooling === true);
    });
  }

  function render() {
    if (host) {
      host.classList.toggle("is-off", !settings.enabled);
      host.title = t(settings.enabled ? "buttonOn" : "buttonOff");
    }
    if (!panelRoot) return;
    const panel = panelRoot.querySelector(".panel");
    panel.classList.toggle("off", !settings.enabled);
    panelRoot.querySelectorAll(".toggle").forEach((toggle) => toggle.setAttribute("aria-checked", String(settings[toggle.dataset.key] === true)));
    panelRoot.querySelectorAll(".segments").forEach((group) => {
      group.querySelectorAll("button").forEach((button) => {
        const value = group.dataset.key === "threads" ? Number(button.dataset.value) : button.dataset.value;
        button.setAttribute("aria-pressed", String(settings[group.dataset.key] === value));
      });
    });
    panelRoot.querySelector(".live-only").hidden = location.hostname !== "live.bilibili.com";
    panelRoot.querySelector("[data-current=language]").textContent = settings.language === "auto" ? t("langAuto") : I18n.NAMES[settings.language];
    panelRoot.querySelectorAll("[data-language]").forEach((button) => button.setAttribute("aria-checked", String(settings.language === button.dataset.language)));
    renderStats();
  }

  function openPanel() {
    if (!panelRoot || !host) return;
    open = true;
    panelRoot.querySelector(".panel").hidden = false;
    host.classList.add("is-open");
    host.setAttribute("aria-expanded", "true");
    render();
  }
  function closePanel() {
    if (!open) return;
    open = false;
    panelRoot?.querySelector(".panel")?.setAttribute("hidden", "");
    panelRoot?.querySelectorAll(".view").forEach((view) => { view.hidden = !view.classList.contains("main-view"); });
    host?.classList.remove("is-open");
    host?.setAttribute("aria-expanded", "false");
  }
  function togglePanel() {
    if (open) closePanel();
    else openPanel();
  }

  // A click anywhere else closes the panel, as the player's own menus do.
  document.addEventListener("pointerdown", (event) => {
    if (open && host && !event.composedPath().includes(host)) closePanel();
  }, true);
  // Escape steps back out of the submenu first, then closes the panel.
  document.addEventListener("keydown", (event) => {
    if (!open || event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    if (panelRoot && panelRoot.querySelector(".main-view").hidden) showView("main-view");
    else {
      const hadFocus = event.composedPath().includes(host);
      closePanel();
      if (hadFocus) host?.focus();
    }
  }, true);

  // ---------------------------------------------------------------------------------
  // Start once the page has a body, and follow the player as it rebuilds.
  // ---------------------------------------------------------------------------------
  // The player draws its controls larger in fullscreen; measure again when that changes.
  const realign = () => requestAnimationFrame(() => { const slot = findSlot(); if (slot && host) align(slot); });
  document.addEventListener("fullscreenchange", realign);
  window.addEventListener("resize", realign);

  function start() {
    installPageCss();
    schedule();
    new MutationObserver(() => {
      if (!settings.playerButton) return;
      if (host?.isConnected) {
        // In place already, or the button it belongs next to is not drawn yet.
        if (host.nextElementSibling?.matches(ANCHORS)) return;
        if (!document.querySelector(ANCHORS)) return;
      }
      schedule();
    }).observe(document.documentElement, { childList: true, subtree: true });
  }
  if (document.documentElement) start();
  else document.addEventListener("DOMContentLoaded", start, { once: true });
})();
