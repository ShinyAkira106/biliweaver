// Interface text in Simplified Chinese, English and Japanese. The language is a setting
// ("auto" follows the browser), so it can change without reloading the extension; that is
// why this is a plain dictionary rather than chrome.i18n, which only the manifest uses.
(function defineBiliweaverI18n(scope) {
  "use strict";
  if (scope.BiliweaverI18n) return;

  const LANGS = Object.freeze(["zh-CN", "en", "ja"]);
  const NAMES = Object.freeze({ "zh-CN": "简体中文", en: "English", ja: "日本語" });

  // key: [zh-CN, en, ja]
  const TEXT = {
    tagline: ["多 CDN 并发下载，让 B 站缓冲更快", "Faster bilibili buffering with parallel multi CDN downloads", "複数 CDN の並列ダウンロードで bilibili の読み込みを高速化"],
    enabled: ["加速", "Acceleration", "高速化"],
    enabledDesc: ["关闭后所有请求都按 B 站原来的方式发出。", "When off, every request goes out the way bilibili sends it.", "オフにすると、すべてのリクエストが bilibili 本来の方法で送信されます。"],
    speed: ["速度", "Speed", "速度"],
    threadsNow: ["线程", "Threads", "スレッド"],
    accelerated: ["已加速", "Accelerated", "高速化済み"],
    threads: ["并发线程", "Parallel threads", "同時スレッド数"],
    threadsDesc: ["一个标签页同时进行的分片下载数量。越多越快，也越占带宽。", "How many pieces a tab downloads at once. More is faster and uses more bandwidth.", "1 つのタブで同時にダウンロードする分割数。多いほど速く、帯域も多く使います。"],
    chunk: ["最小分片", "Minimum piece size", "最小分割サイズ"],
    chunkDesc: ["一段请求最少按多大切分。网络延迟高时调大一些。", "The smallest piece a request is cut into. Raise it on high latency networks.", "リクエストを分割する最小単位。遅延が大きい回線では大きめにします。"],
    cdn: ["CDN 线路", "CDN route", "CDN ルート"],
    cdnDesc: ["从哪些主机下载视频。", "Which hosts video is downloaded from.", "動画をどのホストから取得するか。"],
    cdnAuto: ["自动", "Auto", "自動"],
    cdnAutoLong: ["自动（原线路加大陆镜像）", "Auto (bilibili's hosts and mainland mirrors)", "自動（公式ホストと中国本土ミラー）"],
    cdnMainland: ["大陆", "Mainland", "本土"],
    cdnMainlandLong: ["只用大陆镜像", "Mainland mirrors only", "中国本土ミラーのみ"],
    cdnOverseas: ["海外", "Overseas", "海外"],
    cdnOverseasLong: ["海外镜像", "Overseas mirrors", "海外ミラー"],
    cdnOriginal: ["原线路", "Original", "公式"],
    cdnOriginalLong: ["只用 B 站给的线路", "bilibili's hosts only", "公式ホストのみ"],
    cdnCustom: ["自定义", "Custom", "カスタム"],
    customHosts: ["自定义主机", "Custom hosts", "カスタムホスト"],
    customHostsDesc: ["每行一个主机名，选择“自定义”线路时使用。", "One host name per line, used with the Custom route.", "1 行に 1 つのホスト名。「カスタム」ルートで使用します。"],
    prefetch: ["提前下载", "Prefetch", "先読み"],
    prefetchDesc: ["用空闲线程提前下载后面的内容，下一段直接从缓存返回。视频暂停时和浏览器开启省流量模式时会自动停止。", "Idle threads download ahead, so the next piece comes straight from the cache. It stops while the video is paused or the browser's data saver is on.", "空いているスレッドで先の部分を取得し、次の部分をキャッシュから返します。一時停止中やブラウザのデータセーバーが有効なときは自動で止まります。"],
    avoidPcdn: ["避开 PCDN", "Avoid PCDN", "PCDN を避ける"],
    avoidPcdnLong: ["避开 PCDN 节点", "Avoid PCDN nodes", "PCDN ノードを避ける"],
    avoidPcdnDesc: ["尽量不用家用路由器一类的边缘节点，它们常常很慢，还会中途断开。", "Keeps away from home router edge nodes, which are often slow and drop out mid download.", "家庭用ルーターなどのエッジノードは遅く途中で切れやすいため、なるべく使いません。"],
    live: ["直播加速", "Live acceleration", "ライブ高速化"],
    liveDesc: ["按速度给直播线路排序，并提前下载 HLS 分片。", "Orders live CDN hosts by speed and prefetches HLS segments.", "ライブの CDN ホストを速度順に並べ、HLS セグメントを先読みします。"],
    preferHls: ["直播优先 HLS", "Prefer HLS for live", "ライブで HLS を優先"],
    preferHlsDesc: ["直播间同时提供 FLV 和 HLS 时使用 HLS。某个直播间放不出来时关掉这一项。", "Uses HLS when a room offers both FLV and HLS. Turn this off if a room stops playing.", "FLV と HLS の両方がある配信では HLS を使います。再生できない場合はオフにしてください。"],
    badge: ["图标上显示线程数", "Thread count on the toolbar icon", "アイコンにスレッド数を表示"],
    badgeDesc: ["在工具栏图标上显示当前标签页正在运行的下载线程数。", "Shows how many download threads the current tab is running.", "現在のタブで動いているダウンロードスレッド数をアイコンに表示します。"],
    playerButton: ["播放器里的按钮", "Button in the player", "プレーヤー内のボタン"],
    playerButtonDesc: ["在播放器控制栏里显示 Biliweaver 按钮，点开可以快速调整。", "Shows the Biliweaver button in the player's control bar for quick changes.", "プレーヤーのコントロールバーに Biliweaver ボタンを表示し、すばやく調整できます。"],
    language: ["语言", "Language", "言語"],
    languageDesc: ["设置页、弹窗和播放器面板使用的语言。", "Language of the settings, the popup and the player panel.", "設定画面、ポップアップ、プレーヤーパネルの言語。"],
    langAuto: ["跟随浏览器", "Follow browser", "ブラウザに合わせる"],
    langAutoShort: ["自动", "Auto", "自動"],
    allSettings: ["全部设置", "All settings", "すべての設定"],
    noteReload: ["线路改动刷新后完全生效", "Route changes fully apply after a reload", "ルート変更は再読み込み後に反映"],
    reloadHint: ["改动设置后刷新页面会更稳定。", "Reload the page after changing settings for best results.", "設定を変えたらページを再読み込みすると確実です。"],
    paused: ["暂停", "Paused", "停止中"],
    buttonOn: ["Biliweaver：加速中", "Biliweaver: accelerating", "Biliweaver：高速化中"],
    buttonOff: ["Biliweaver：已关闭", "Biliweaver: off", "Biliweaver：オフ"],
    openHint: ["打开一个 B 站视频或直播间后，这里会显示实时数据。", "Open a bilibili video or live room to see live stats here.", "bilibili の動画かライブを開くと、ここに状態が表示されます。"],
    secVideo: ["视频", "Video", "動画"],
    secLive: ["直播", "Live", "ライブ"],
    secOther: ["其它", "Other", "その他"],
    navBasic: ["基本设置", "General", "基本設定"],
    navVideo: ["视频加速", "Video", "動画の高速化"],
    navCdn: ["CDN 线路", "CDN routes", "CDN ルート"],
    navLive: ["直播", "Live", "ライブ"],
    navStatus: ["运行状态", "Status", "動作状況"],
    navData: ["导入/导出", "Import and export", "インポート/エクスポート"],
    navAbout: ["关于", "About", "概要"],
    reset: ["重置设置", "Reset settings", "設定をリセット"],
    resetConfirm: ["确定恢复默认设置吗？", "Restore the default settings?", "初期設定に戻しますか？"],
    exportTitle: ["导出设置", "Export settings", "設定をエクスポート"],
    exportDesc: ["把当前设置保存成 JSON 文件。", "Saves the current settings as a JSON file.", "現在の設定を JSON ファイルに保存します。"],
    exportButton: ["导出", "Export", "エクスポート"],
    importTitle: ["导入设置", "Import settings", "設定をインポート"],
    importDesc: ["从之前导出的 JSON 文件恢复设置。", "Restores settings from a JSON file exported earlier.", "以前エクスポートした JSON ファイルから設定を復元します。"],
    importButton: ["选择文件", "Choose file", "ファイルを選択"],
    importOk: ["已导入", "Imported", "インポートしました"],
    importFail: ["这个文件无法读取", "That file couldn't be read", "このファイルは読み込めません"],
    saved: ["已保存", "Saved", "保存しました"],
    statusTitle: ["正在加速的页面", "Pages being accelerated", "高速化中のページ"],
    statusDesc: ["每秒刷新一次。", "Updates every second.", "1 秒ごとに更新します。"],
    statusEmpty: ["现在没有打开 B 站视频或直播间。", "No bilibili video or live room is open right now.", "bilibili の動画やライブは開かれていません。"],
    pageVideo: ["视频", "Video", "動画"],
    pageLive: ["直播", "Live", "ライブ"],
    colHost: ["主机", "Host", "ホスト"],
    colSpeed: ["速度", "Speed", "速度"],
    colData: ["数据", "Data", "データ"],
    mirrorsTitle: ["内置镜像", "Built in mirrors", "内蔵ミラー"],
    mirrorsDesc: ["“自动”和“大陆”使用前一组，“海外”使用后一组。不响应的主机会被自动暂停。", "Auto and Mainland use the first group, Overseas the second. Hosts that don't answer are paused automatically.", "「自動」と「本土」は前のグループ、「海外」は後のグループを使います。応答しないホストは自動的に停止されます。"],
    aboutVersion: ["版本", "Version", "バージョン"],
    aboutAuthor: ["作者", "Author", "作者"],
    aboutAuthorDesc: ["由 ShinyAkira 开发和维护。", "Made and maintained by ShinyAkira.", "ShinyAkira が開発・メンテナンスしています。"],
    aboutGithub: ["GitHub", "GitHub", "GitHub"],
    aboutGithubDesc: ["源代码、更新和问题反馈都在 GitHub 上。", "Source code, updates and issue reports are on GitHub.", "ソースコード、更新情報、不具合の報告は GitHub で。"],
    aboutLicenseDesc: ["基于 MIT 许可证开源，可以自由使用、修改和分发，需保留版权声明。", "Open source under the MIT License: free to use, modify and share, as long as the copyright notice is kept.", "MIT ライセンスのオープンソースです。著作権表示を残せば、自由に使用・改変・再配布できます。"],
    licenseName: ["MIT 许可证", "MIT License", "MIT ライセンス"],
    aboutIssues: ["问题反馈", "Report a problem", "不具合の報告"],
    aboutIssuesDesc: ["遇到问题或有建议，可以在 GitHub Issues 里提出。", "Found a problem or have an idea? Open an issue on GitHub.", "不具合や提案は GitHub の Issues へどうぞ。"],
    openIssues: ["打开 Issues", "Open Issues", "Issues を開く"],
    aboutReleases: ["下载新版本", "Get new versions", "新しいバージョン"],
    aboutReleasesDesc: ["扩展不会自动更新，新版本发布在 GitHub Releases。", "The extension doesn't update itself; new versions are published on GitHub Releases.", "拡張機能は自動更新されません。新しいバージョンは GitHub Releases で公開しています。"],
    openReleases: ["打开 Releases", "Open Releases", "Releases を開く"],
    selfTest: ["线路自检", "Route self test", "ルートの自己診断"],
    selfTestDesc: ["向当前视频的每条候选线路请求一小段数据，看哪些能用、延迟和速度各是多少。", "Asks every candidate host for a small piece of the current video and shows which work, with latency and speed.", "現在の動画の候補ホストすべてに小さなデータを要求し、使えるかどうかと遅延・速度を表示します。"],
    runSelfTest: ["开始自检", "Run test", "診断を開始"],
    rerunSelfTest: ["重新测试", "Test again", "もう一度"],
    selfTestRunning: ["正在测试…", "Testing…", "診断中…"],
    selfTestNoVideo: ["这个页面还没有可测试的视频，先播放一下再试。", "No video to test on this page yet. Play it for a moment and try again.", "このページにはまだ診断できる動画がありません。少し再生してからもう一度お試しください。"],
    selfTestLive: ["直播间不支持线路自检，请在视频页面使用。", "The self test works on video pages, not live rooms.", "自己診断は動画ページで使えます。ライブ配信には対応していません。"],
    selfTestError: ["自检没有完成。", "The test didn't finish.", "診断を完了できませんでした。"],
    selfTestSummary: ["{working} / {tested} 条线路可用", "{working} of {tested} hosts work", "{tested} 件中 {working} 件のホストが利用可能"],
    selfTestHint: ["测试会让 Biliweaver 立刻优先使用更快的线路。", "Running the test also makes Biliweaver prefer the faster hosts right away.", "診断結果はすぐに反映され、速いホストが優先されます。"],
    colSource: ["来源", "Source", "種類"],
    colLatency: ["首字节", "First byte", "初回応答"],
    unavailable: ["不可用", "Unavailable", "利用不可"],
    sourceBilibili: ["B 站线路", "bilibili", "公式"],
    sourceMainland: ["大陆镜像", "Mainland mirror", "本土ミラー"],
    sourceOverseas: ["海外镜像", "Overseas mirror", "海外ミラー"],
    sourceCustom: ["自定义", "Custom", "カスタム"],
    diagTitle: ["导出诊断信息", "Export diagnostics", "診断情報をエクスポート"],
    diagDesc: ["把版本、浏览器、设置、线路状态、最近的错误和上次自检结果整理成一段文本，方便在 Issues 里附上。不包含页面标题和视频地址。", "Collects version, browser, settings, host status, recent errors and the last self test into text you can attach to an issue. Page titles and video addresses are left out.", "バージョン、ブラウザ、設定、ホストの状態、最近のエラー、前回の診断結果をまとめます。Issues に添付できます。ページタイトルや動画アドレスは含みません。"],
    copyDiag: ["复制", "Copy", "コピー"],
    downloadDiag: ["下载", "Download", "ダウンロード"],
    copied: ["已复制", "Copied", "コピーしました"],
    pausedNotice: ["连续出错，加速已暂停，{min} 分钟后自动恢复", "Paused after repeated errors; resumes in {min} min", "エラーが続いたため一時停止中。{min} 分後に再開します"],
    resumeNow: ["立即恢复", "Resume now", "今すぐ再開"],
    throttledNotice: ["检测到限流，线程暂时降到 {n}", "Rate limited; threads lowered to {n} for now", "制限を検出したため、スレッド数を一時的に {n} にしています"],
    hlsFallbackNotice: ["这个直播间用 HLS 播放失败，已改用 FLV", "HLS failed in this room, so FLV is used", "この配信では HLS が再生できなかったため FLV を使用しています"],
    prefetchHeldPaused: ["视频已暂停，暂不提前下载", "Prefetch is on hold while the video is paused", "一時停止中は先読みを止めています"],
    prefetchHeldSaveData: ["浏览器开启了省流量模式，已停止提前下载", "Data saver is on, so prefetch is off", "データセーバーが有効なため先読みを停止しています"],
    updateAvailable: ["发现新版本 {version}", "Version {version} is available", "新しいバージョン {version} があります"],
    updateCurrent: ["你正在使用 {current}。扩展不会自动更新，下载后用新文件覆盖原来的文件夹，再在扩展管理页点一下刷新。", "You have {current}. The extension doesn't update itself: download it, replace the old folder's files and click reload on the extensions page.", "現在のバージョンは {current} です。自動更新されないため、ダウンロードして元のフォルダを上書きし、拡張機能ページで再読み込みしてください。"],
    downloadUpdate: ["下载", "Download", "ダウンロード"],
    releaseNotes: ["更新说明", "Release notes", "リリースノート"],
    viewLicense: ["查看许可证", "View license", "ライセンスを表示"],
    copyright: ["版权所有 © 2026 ShinyAkira", "Copyright © 2026 ShinyAkira", "Copyright © 2026 ShinyAkira"],
    madeBy: ["ShinyAkira 作品", "By ShinyAkira", "ShinyAkira 作"],
    aboutLicense: ["许可", "License", "ライセンス"],
    aboutText: ["Biliweaver 把播放器的视频分段请求拆成多路，同时从多个 CDN 下载，再按顺序交回播放器。任何一步出错，请求都会原样交回浏览器。", "Biliweaver splits the player's segment requests into several parallel downloads from multiple CDN hosts and hands the bytes back in order. If anything fails, the request goes back to the browser unchanged.", "Biliweaver はプレーヤーのセグメント要求を複数に分け、複数の CDN から同時に取得して順番どおりに返します。失敗した場合、リクエストはそのままブラウザに戻されます。"],
    aboutCredit: ["多 CDN 并发下载的思路受到 Bilibili-thread-ripper 的启发。本项目与哔哩哔哩官方无关。", "The parallel multi CDN idea was inspired by Bilibili-thread-ripper. Not affiliated with bilibili.", "複数 CDN 並列ダウンロードのアイデアは Bilibili-thread-ripper に着想を得ました。bilibili 公式とは関係ありません。"],
    on: ["开", "On", "オン"],
    off: ["关", "Off", "オフ"]
  };

  function resolve(setting, browserLanguage) {
    if (LANGS.includes(setting)) return setting;
    const language = String(browserLanguage || "").toLowerCase();
    if (language.startsWith("ja")) return "ja";
    if (language.startsWith("zh")) return "zh-CN";
    return "en";
  }

  function t(lang, key) {
    const entry = TEXT[key];
    if (!entry) return key;
    return entry[Math.max(0, LANGS.indexOf(lang))] ?? entry[0];
  }

  // Fills every element with data-i18n (text), data-i18n-title and data-i18n-placeholder.
  function apply(root, lang) {
    root.querySelectorAll("[data-i18n]").forEach((element) => { element.textContent = t(lang, element.dataset.i18n); });
    root.querySelectorAll("[data-i18n-title]").forEach((element) => { element.title = t(lang, element.dataset.i18nTitle); });
    root.querySelectorAll("[data-i18n-aria]").forEach((element) => { element.setAttribute("aria-label", t(lang, element.dataset.i18nAria)); });
    if (root.documentElement) root.documentElement.lang = lang;
  }

  // Who made Biliweaver; shown on the About page, in the popup and in the README.
  const ABOUT = Object.freeze({
    author: "ShinyAkira",
    profile: "https://github.com/ShinyAkira106",
    github: "https://github.com/ShinyAkira106/biliweaver",
    issues: "https://github.com/ShinyAkira106/biliweaver/issues/new",
    releases: "https://github.com/ShinyAkira106/biliweaver/releases",
    year: 2026,
    license: "MIT"
  });

  const api = Object.freeze({ LANGS, NAMES, ABOUT, resolve, t, apply, keys: Object.freeze(Object.keys(TEXT)) });
  Object.defineProperty(scope, "BiliweaverI18n", { value: api, configurable: false, enumerable: false, writable: false });
})(globalThis);
