// ExeBrowser — run user-supplied Windows EXE files inside Boxedwine (Wine +
// x86 emulator) in WebAssembly. No upload; everything stays in the browser.
//
// How it integrates with Boxedwine's shell:
//   1. Load boxedwine-shell.js + browserfs.boxedwine.js + jszip.min.js
//      (these come from /boxedwine/build/default/, served same-origin).
//   2. Configure shell.js via the global `Config` it exports:
//        Config.locateRootBaseUrl  = where the Wine root zip lives
//        Config.locateAppBaseUrl   = where the per-app zip lives
//        Config.locateOverlayBaseUrl = where DLL/font overlays live
//        Config.urlParams = "root=...&app=...&p=EXENAME.EXE&..."
//   3. Inject boxedwine.js — Emscripten runtime that pulls boxedwine.wasm.
//
// For step 2, the app zip is normally a static file on the server. We don't
// have one — the user just picked an EXE. We zip it client-side with JSZip,
// stash the Blob URL, and intercept the XHR for that specific filename so
// shell.js receives our blob instead of hitting the network.

(() => {
  "use strict";

  const RUNTIME_BASE = "/boxedwine/build/default/";
  // Same-origin path proxied to the Cloudflare Worker (see functions/api/fs).
  // browserfs.boxedwine.js originally hardcoded lazy fetches to /boxedwine/fs/;
  // we patched that line to /api/fs/ to dodge a stale Cloudflare edge cache
  // entry that briefly served index.html at the old path.
  const ROOT_FS_BASE = "/api/fs/";
  const ROOT_FS_URL = ROOT_FS_BASE + "fullWine1.7.55-v8.zip";

  // Wine "variants" — only the overlay differs.
  // - default: vanilla 50MB Wine root + small min-online overlay (fast boot).
  // - gecko:   same root + larger overlay that pre-stages wine_gecko-2.40-x86.msi
  //            under /share/wine/gecko/, so appwiz.cpl can install Gecko offline
  //            instead of trying to download it over a blocked ws://8.8.8.8:53.
  const WINE_VARIANTS = {
    default: {
      overlayBaseUrl: "/boxedwine/apps/",
      overlayBasename: "wine1.7.55-v8-min-online",
    },
    gecko: {
      overlayBaseUrl: "/api/overlay/",
      overlayBasename: "wine1.7.55-v8-with-gecko",
    },
  };

  const VIRTUAL_APP_ZIP = "userapp.zip"; // the filename shell.js will request

  const els = {
    bootBtn: document.getElementById("bootBtn"),
    bootStatus: document.getElementById("bootStatus"),
    bootProgress: document.getElementById("bootProgress"),
    wineVariant: document.getElementById("wineVariant"),
    loaderSection: document.getElementById("loader-section"),
    dropzone: document.getElementById("dropzone"),
    exeInput: document.getElementById("exeInput"),
    folderInput: document.getElementById("folderInput"),
    zipInput: document.getElementById("zipInput"),
    pickBtn: document.getElementById("pickBtn"),
    pickFolderBtn: document.getElementById("pickFolderBtn"),
    pickZipBtn: document.getElementById("pickZipBtn"),
    entryPickerWrap: document.getElementById("entryPickerWrap"),
    entryPicker: document.getElementById("entryPicker"),
    fileInfo: document.getElementById("fileInfo"),
    runBtn: document.getElementById("runBtn"),
    saveStateBtn: document.getElementById("saveStateBtn"),
    logOutput: document.getElementById("logOutput"),
    canvas: document.getElementById("canvas"),
    screenContainer: document.getElementById("screen-container"),
  };

  const state = {
    depsLoaded: false,
    // Files staged for the virtual app zip. Each: { path: "RELATIVE/IN/ZIP", bytes: Uint8Array }
    // path uses forward slashes and is what Wine sees relative to its working dir.
    stagedFiles: [],
    // EXEs found among stagedFiles, populated for the entry-EXE picker.
    candidateExes: [],
    // The selected entry. { name: "FOO.EXE", path: "subdir/FOO.EXE", originalName: "Foo.exe" }
    pickedExe: null,
    appZipBlob: null,
    bootInFlight: false,
    booted: false,
    // Locked in when the user clicks Boot Wine; reused on Run.
    selectedVariant: "default",
  };

  // ─── helpers ───────────────────────────────────────────────────────────

  function log(msg, level = "info") {
    const ts = new Date().toLocaleTimeString();
    const prefix = level === "error" ? "[!]" : level === "warn" ? "[~]" : "[·]";
    els.logOutput.textContent += `${ts} ${prefix} ${msg}\n`;
    els.logOutput.scrollTop = els.logOutput.scrollHeight;
  }

  function setStatus(text) {
    els.bootStatus.textContent = text;
  }

  // Exposed for the inlined shell+config script (which runs in its own scope)
  // to call back into us for logging/status.
  window.__exeBrowserLog = log;
  window.__exeBrowserStatus = setStatus;

  function sanitizeExeName(name) {
    // Wine wants an 8.3-friendly DOS-safe name; uppercase, alnum + underscore.
    let base = name.replace(/^.*[\\/]/, "").replace(/\.exe$/i, "");
    base = base.replace(/[^A-Za-z0-9_]/g, "_").toUpperCase();
    if (base.length === 0) base = "USERAPP";
    if (base.length > 8) base = base.slice(0, 8);
    return base + ".EXE";
  }

  // Sanitize a relative path inside the virtual app zip. Splits on / and \,
  // strips ".." segments, normalizes each segment to alnum + a few safe chars,
  // and 8.3-truncates the final EXE basename so Wine's loader is happy.
  function sanitizeRelPath(rel) {
    const parts = rel.split(/[\\/]+/).filter((s) => s && s !== "." && s !== "..");
    if (parts.length === 0) return null;
    const out = parts.map((seg, i) => {
      const isLast = i === parts.length - 1;
      if (isLast && /\.exe$/i.test(seg)) return sanitizeExeName(seg);
      // Allow letters, digits, underscore, dash, dot, parentheses for non-final segments.
      let s = seg.replace(/[^A-Za-z0-9_.()\- ]/g, "_");
      if (s.length === 0) s = "_";
      return s.toUpperCase();
    });
    return out.join("/");
  }

  function formatBytes(n) {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(2)} MB`;
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.async = false; // preserve execution order
      s.onload = () => resolve();
      s.onerror = () => reject(new Error(`Failed to load ${src}`));
      document.head.appendChild(s);
    });
  }

  // Inject inline JS code as a <script> tag and wait for it to execute.
  function runInlineScript(code) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.textContent = code;
      s.onerror = (e) => reject(new Error("inline script error"));
      try {
        document.head.appendChild(s);
        // Inline scripts execute synchronously on append for classic scripts.
        resolve();
      } catch (e) {
        reject(e);
      }
    });
  }

  async function fetchText(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status} fetching ${url}`);
    return await r.text();
  }

  // Ensure DOM elements that boxedwine-shell.js queries exist. Checkbox-style
  // stubs (showConsole/sound-checkbox/soundToggle) MUST be real <input
  // type="checkbox"> nodes so reads of .checked don't throw on null/undefined.
  function ensureShellDomStubs() {
    const stubs = [
      // [id, tag, extras]
      ["status", "div"], ["progress", "progress"], ["spinner", "div"],
      ["output", "pre"],
      ["startbtn", "button"], ["uploadbtn", "button"], ["downloadbtn", "button"],
      ["inline-runbtn", "button"], ["inline", "div"], ["run-inline", "button"],
      ["loading", "div"],
      ["showConsole", "input", { type: "checkbox" }],
      ["sound-checkbox", "input", { type: "checkbox" }],
      ["soundToggle", "input", { type: "checkbox" }],
      ["message", "div"], ["modalLink", "a"], ["modalLinkExe", "a"],
      ["openModalExeClick", "button"], ["tree", "div"], ["items", "div"],
      ["selectedItem", "div"], ["loadStatus", "div"],
    ];
    for (const [id, tag, attrs] of stubs) {
      if (!document.getElementById(id)) {
        const el = document.createElement(tag);
        el.id = id;
        if (attrs) for (const [k, v] of Object.entries(attrs)) el[k] = v;
        el.style.display = "none";
        document.body.appendChild(el);
      }
    }
    // shell.js calls dropzone.addEventListener; our existing #dropzone works.
  }

  // ─── XHR interception ──────────────────────────────────────────────────
  // Boxedwine's shell.js uses XMLHttpRequest to fetch the app zip:
  //     locateAppBaseUrl + appZipFile
  // We monkey-patch XHR.open to detect requests for our virtual app zip,
  // and override responses with the in-memory Blob.

  function installXhrInterceptor() {
    const NativeXHR = window.XMLHttpRequest;
    const origOpen = NativeXHR.prototype.open;
    const origSend = NativeXHR.prototype.send;
    const origSetRequestHeader = NativeXHR.prototype.setRequestHeader;
    const origGetResponseHeader = NativeXHR.prototype.getResponseHeader;

    NativeXHR.prototype.open = function (method, url, async, user, pass) {
      this.__exebrowser_url = String(url);
      return origOpen.call(this, method, url, async !== false, user, pass);
    };

    NativeXHR.prototype.setRequestHeader = function (k, v) {
      if (this.__exebrowser_url && this.__exebrowser_url.includes(VIRTUAL_APP_ZIP)) {
        // Suppress — we'll handle responses ourselves.
        this.__exebrowser_headers = this.__exebrowser_headers || {};
        this.__exebrowser_headers[k.toLowerCase()] = v;
        return;
      }
      return origSetRequestHeader.call(this, k, v);
    };

    NativeXHR.prototype.send = function (body) {
      const url = this.__exebrowser_url || "";
      if (!url.includes(VIRTUAL_APP_ZIP)) {
        return origSend.call(this, body);
      }

      if (!state.appZipBlob) {
        log("Internal: XHR for user app zip but no blob ready.", "error");
        this.readyState = 4;
        this.status = 500;
        this.onreadystatechange && this.onreadystatechange();
        return;
      }

      // Synthesize a response from the in-memory Blob, honoring Range.
      const reader = new FileReader();
      reader.onload = () => {
        const bytes = new Uint8Array(reader.result);
        const headers = this.__exebrowser_headers || {};
        let responseBytes = bytes;
        let status = 200;

        // Honor Range: bytes=N-M (Boxedwine OnDemand mode uses this)
        if (headers["range"]) {
          const m = /bytes=(\d+)-(\d+)?/.exec(headers["range"]);
          if (m) {
            const start = parseInt(m[1], 10);
            const end = m[2] ? Math.min(parseInt(m[2], 10) + 1, bytes.length) : bytes.length;
            responseBytes = bytes.slice(start, end);
            status = 206;
          }
        }

        Object.defineProperty(this, "readyState", { value: 4, writable: true });
        Object.defineProperty(this, "status", { value: status, writable: true });
        // Shell uses overrideMimeType('text/plain; charset=x-user-defined') and reads .responseText
        // as a binary-ish string. We need to reconstruct that.
        let responseText = "";
        for (let i = 0; i < responseBytes.length; i++) {
          responseText += String.fromCharCode(responseBytes[i]);
        }
        Object.defineProperty(this, "responseText", { value: responseText, writable: true });
        Object.defineProperty(this, "response", { value: responseBytes.buffer, writable: true });

        // Override header getter for Content-Length
        this.getResponseHeader = function (name) {
          if (name.toLowerCase() === "content-length") return String(state.appZipBlob.size);
          return null;
        };

        if (this.onreadystatechange) this.onreadystatechange();
        if (this.onload) this.onload();
      };
      reader.readAsArrayBuffer(state.appZipBlob);
    };
  }

  // ─── boot Boxedwine ────────────────────────────────────────────────────

  // Stage 1: load dependencies that shell.js needs (BrowserFS, JSZip).
  async function loadBoxedwineDeps() {
    if (state.depsLoaded) return;
    setStatus("Loading Boxedwine runtime…");
    els.bootProgress.hidden = false;
    els.bootProgress.value = 10;

    await loadScript(RUNTIME_BASE + "jszip.min.js");
    els.bootProgress.value = 25;
    // ?v=8 forces a fresh cache entry — we patched the hardcoded
    // /boxedwine/fs/ path to /api/fs/ inside this file.
    await loadScript(RUNTIME_BASE + "browserfs.boxedwine.js?v=8");
    els.bootProgress.value = 40;

    ensureShellDomStubs();
    state.depsLoaded = true;
    log("Dependencies loaded.");
  }

  // Stage 2: build a single combined script: shell.js source + our Config
  // mutations. They share scope so we can reach the `let Config` shell.js
  // declares. Then inject boxedwine.js which triggers preRun → initialSetup.
  async function runShellWithConfig() {
    setStatus("Configuring Wine launch…");
    els.bootProgress.value = 50;

    const shellSrc = await fetchText(RUNTIME_BASE + "boxedwine-shell.js");
    els.bootProgress.value = 60;

    // Match Boxedwine demo conventions exactly:
    //   root=<basename-no-ext>            (the OnDemand-range-fetched root zip)
    //   inline-default-ondemand-root-overlay=<basename-no-ext>  (preloaded overlay)
    //   ondemand=root                     (range-fetch root, preload overlay)
    // The full root (50MB) contains all DLLs including winmm/ddraw/dsound.
    // The overlay zip is recursiveCopy'd into the writable layer at /, so its
    // tree mirrors the Wine prefix layout. Variants only differ in overlay.
    const variant = WINE_VARIANTS[state.selectedVariant] || WINE_VARIANTS.default;
    const rootBasename = ROOT_FS_URL.split("/").pop().replace(/\.zip$/, "");
    const overlayBasename = variant.overlayBasename;
    const overlayBaseUrl = variant.overlayBaseUrl;
    // Wine wants Windows-style separators. The path is relative to D:/userapp.
    const exeName = state.pickedExe.path.replace(/\//g, "\\");

    // The Config object inside shell.js is `let`-scoped, so we can only mutate
    // it from inside the same <script> block. We append our setup at the end
    // of the shell.js source and run the combined whole as one inline script.
    const configCode = `
      // ── ExeBrowser-injected configuration ──
      Config.isRunningInline = true;
      Config.locateRootBaseUrl  = ${JSON.stringify(ROOT_FS_BASE)};
      Config.locateAppBaseUrl   = ${JSON.stringify("/boxedwine/apps/")};
      Config.locateOverlayBaseUrl = ${JSON.stringify(overlayBaseUrl)};
      Config.urlParams = ${JSON.stringify([
        "ondemand=root",
        "root=" + encodeURIComponent(rootBasename),
        "inline-default-ondemand-root-overlay=" + encodeURIComponent(overlayBasename),
        "app=" + encodeURIComponent(VIRTUAL_APP_ZIP),
        "p=" + encodeURIComponent(exeName),
        "auto=true",
        "sound=true",
        "bpp=32",
      ].join("&"))};

      // shell.js declares its own var Module; reach in and add our hooks.
      var __originalPreRun = Module.preRun ? Module.preRun.slice() : [];
      Module.canvas = document.getElementById("canvas");
      Module.print = function (t) { window.__exeBrowserLog(String(t)); };
      Module.printErr = function (t) { window.__exeBrowserLog(String(t), "warn"); };
      Module.setStatus = function (t) { if (t) window.__exeBrowserStatus(t); };
      Module.locateFile = function (path) { return ${JSON.stringify(RUNTIME_BASE)} + path; };
      // Expose for our outer code to verify.
      window.__BoxedwineConfig = Config;
      window.__BoxedwineModule = Module;
    `;

    await runInlineScript(shellSrc + "\n;\n" + configCode);

    if (!window.__BoxedwineConfig) {
      throw new Error("Combined shell+config script failed to expose Config.");
    }

    log("Wine shell configured (variant=" + state.selectedVariant + ", root=" + rootBasename + ", overlay=" + overlayBasename + ", program=" + exeName + ").");
  }

  // Stage 3: inject the Emscripten runtime. Its preRun calls initialSetup
  // which reads Config.urlParams and builds the filesystem.
  async function startEmulator() {
    setStatus("Starting emulator…");
    els.bootProgress.value = 75;
    await loadScript(RUNTIME_BASE + "boxedwine.js");
    els.bootProgress.value = 100;
    installAudioReviver();
  }

  // Chrome blocks AudioContext until a user gesture. Boxedwine creates one
  // inside SDL_OpenAudio and never resumes it, so apps run silently. Poll
  // for Module.SDL2.audioContext and resume on the next user interaction
  // (or immediately, since the run-button click that brought us here counts).
  function installAudioReviver() {
    let resumed = false;
    const tryResume = () => {
      const ctx = window.Module && window.Module.SDL2 && window.Module.SDL2.audioContext;
      if (!ctx) return false;
      if (ctx.state === "suspended") {
        ctx.resume().then(
          () => { log("AudioContext resumed."); },
          (e) => { log("AudioContext resume failed: " + e, "warn"); }
        );
      }
      resumed = true;
      return true;
    };

    // Poll for up to 30s while Wine is booting.
    const start = Date.now();
    const poll = setInterval(() => {
      if (resumed || Date.now() - start > 30000) {
        clearInterval(poll);
        return;
      }
      tryResume();
    }, 250);

    // Belt + suspenders: any future click/keydown will also nudge it.
    const onGesture = () => { tryResume(); };
    window.addEventListener("click", onGesture, { capture: true });
    window.addEventListener("keydown", onGesture, { capture: true });
  }

  // ─── app payload handling ──────────────────────────────────────────────
  // The user can supply: (a) one EXE, (b) a folder with one or more EXEs +
  // assets, or (c) a zip. We normalize all three into `state.stagedFiles`
  // — a list of { path, bytes } — then build the virtual app zip at boot.

  function clearStaged() {
    state.stagedFiles = [];
    state.candidateExes = [];
    state.pickedExe = null;
    els.entryPickerWrap.hidden = true;
    els.entryPicker.innerHTML = "";
    els.fileInfo.textContent = "";
    els.runBtn.disabled = true;
  }

  // After stagedFiles is populated, find EXEs, refresh the entry-picker, and
  // default to the only one (or the first if multiple).
  function refreshEntryPicker() {
    state.candidateExes = state.stagedFiles
      .filter((f) => /\.exe$/i.test(f.path))
      .sort((a, b) => a.path.localeCompare(b.path));

    if (state.candidateExes.length === 0) {
      els.entryPickerWrap.hidden = true;
      els.runBtn.disabled = true;
      state.pickedExe = null;
      log("No .exe found in the supplied files.", "warn");
      return;
    }

    if (state.candidateExes.length === 1) {
      els.entryPickerWrap.hidden = true;
      setEntry(state.candidateExes[0]);
      return;
    }

    // Multiple EXEs — show the picker.
    els.entryPicker.innerHTML = "";
    for (const f of state.candidateExes) {
      const opt = document.createElement("option");
      opt.value = f.path;
      opt.textContent = `${f.path} (${formatBytes(f.bytes.length)})`;
      els.entryPicker.appendChild(opt);
    }
    els.entryPickerWrap.hidden = false;
    setEntry(state.candidateExes[0]);
  }

  function setEntry(stagedFile) {
    // Wine launch path is just the basename (we cd into the right subdir).
    const baseName = stagedFile.path.split("/").pop();
    state.pickedExe = {
      path: stagedFile.path,
      name: baseName,
      originalName: baseName,
      bytes: stagedFile.bytes,
    };
    const exeCount = state.candidateExes.length;
    const totalSize = state.stagedFiles.reduce((n, f) => n + f.bytes.length, 0);
    const suffix = state.stagedFiles.length > 1
      ? ` · ${state.stagedFiles.length} files, ${formatBytes(totalSize)} total`
      : "";
    els.fileInfo.textContent = `Entry: ${stagedFile.path}${suffix}` +
      (exeCount > 1 ? ` · ${exeCount} EXEs available` : "");
    els.runBtn.disabled = false;
  }

  // Check PE magic on every EXE the user gives us; warn (not fail) on misses.
  function warnIfNotPe(path, bytes) {
    if (bytes.length < 64 || bytes[0] !== 0x4d || bytes[1] !== 0x5a) {
      log(`Warning: ${path} doesn't start with PE 'MZ' magic.`, "warn");
    }
  }

  async function handleSingleExe(file) {
    if (!file) return;
    clearStaged();
    const bytes = new Uint8Array(await file.arrayBuffer());
    warnIfNotPe(file.name, bytes);
    const safe = sanitizeExeName(file.name);
    state.stagedFiles.push({ path: safe, bytes });
    log(`Loaded ${file.name} → ${safe} (${formatBytes(file.size)}).`);
    refreshEntryPicker();
  }

  async function handleFolder(fileList) {
    if (!fileList || fileList.length === 0) return;
    clearStaged();

    // webkitRelativePath looks like "MyApp/subdir/foo.dll". Drop the common
    // top-level folder so the zip root matches the folder root.
    const files = Array.from(fileList);
    const firstSlash = (p) => p.indexOf("/");
    const topLevel = files
      .map((f) => f.webkitRelativePath || f.name)
      .map((p) => (firstSlash(p) >= 0 ? p.slice(0, firstSlash(p)) : ""))
      .filter(Boolean);
    const allSameTop = topLevel.length > 0 && topLevel.every((t) => t === topLevel[0]);

    for (const f of files) {
      const raw = f.webkitRelativePath || f.name;
      const stripped = allSameTop ? raw.slice(topLevel[0].length + 1) : raw;
      if (!stripped) continue;
      const safe = sanitizeRelPath(stripped);
      if (!safe) continue;
      const bytes = new Uint8Array(await f.arrayBuffer());
      if (/\.exe$/i.test(safe)) warnIfNotPe(safe, bytes);
      state.stagedFiles.push({ path: safe, bytes });
    }
    log(`Loaded folder: ${files.length} files staged.`);
    refreshEntryPicker();
  }

  async function handleZip(file) {
    if (!file) return;
    if (typeof JSZip === "undefined") {
      log("JSZip isn't loaded yet — try again in a moment.", "error");
      return;
    }
    clearStaged();
    const buf = await file.arrayBuffer();
    const zip = await loadZip(buf);
    const entries = listZipEntries(zip);
    for (const e of entries) {
      const safe = sanitizeRelPath(e.path);
      if (!safe) continue;
      const bytes = await readZipEntry(zip, e);
      if (/\.exe$/i.test(safe)) warnIfNotPe(safe, bytes);
      state.stagedFiles.push({ path: safe, bytes });
    }
    log(`Loaded zip: ${state.stagedFiles.length} files extracted.`);
    refreshEntryPicker();
  }

  // ─── JSZip 2.x compatibility helpers ───────────────────────────────────
  // Boxedwine bundles JSZip 2.6.x (no async API). It accepts ArrayBuffer in
  // its constructor and returns string/Uint8Array from .asUint8Array().
  function loadZip(arrayBuffer) {
    // JSZip 2.x: `new JSZip(data)` or `new JSZip().load(data)`. Both sync.
    return new JSZip(arrayBuffer);
  }
  function listZipEntries(zip) {
    const out = [];
    // JSZip 2.x exposes .files as a name->ZipObject map.
    for (const name of Object.keys(zip.files)) {
      const obj = zip.files[name];
      if (obj.dir) continue;
      out.push({ path: name, obj });
    }
    return out;
  }
  function readZipEntry(zip, e) {
    // .asUint8Array() exists in JSZip 2.6+. Synchronous despite the function name.
    return Promise.resolve(e.obj.asUint8Array());
  }

  // ─── save writable layer ───────────────────────────────────────────────
  // Boxedwine's home overlay is an OverlayFS whose writable side is an
  // InMemory BFS. We reach it via BrowserFS.BFSRequire('fs').getRootFS() and
  // pull the writable layer out with getOverlayedFileSystems(). That layer
  // contains *only* files the running app wrote during this session — no
  // boilerplate Wine prefix — so zipping it gives us a clean delta.

  // Boxedwine mounts two OverlayFS instances:
  //   '/root/base'  → rootOverlay  (Wine system; writable side captures
  //                    installer output under C:\windows, C:\Program Files, …
  //                    because C:\ maps to /root/base/home/username/.wine/drive_c)
  //   '/root/files' → homeOverlay (the app's working dir; user-app writes)
  // Return both writable layers so we can zip the union and not miss either.
  function getWritableLayers() {
    const BFS = window.BrowserFS;
    if (!BFS) throw new Error("BrowserFS not initialized — boot Wine first.");
    const fs = BFS.BFSRequire("fs");
    const root = fs.getRootFS && fs.getRootFS();
    if (!root || !root.mntMap) throw new Error("BrowserFS root not mounted.");
    const cfg = window.__BoxedwineConfig;
    if (!cfg || !cfg.appDirPrefix) throw new Error("Config.appDirPrefix missing.");

    const homeMount = cfg.appDirPrefix.replace(/\/$/, "");
    const homeOverlay = root.mntMap[homeMount];
    const rootOverlay = root.mntMap["/root/base"];

    const out = [];
    for (const [mount, ov] of [["/root/base", rootOverlay], [homeMount, homeOverlay]]) {
      if (ov && typeof ov.getOverlayedFileSystems === "function") {
        const { writable } = ov.getOverlayedFileSystems();
        if (writable) out.push({ mount, writable });
      }
    }
    if (out.length === 0) throw new Error("No OverlayFS layers found.");
    return out;
  }

  // Walk a BrowserFS layer synchronously (sync API works on InMemory) and
  // collect { path, bytes } pairs. Skip /.deletedFiles.log (BFS bookkeeping).
  function collectWritableFiles(fs, dir = "/") {
    const out = [];
    let entries;
    try {
      entries = fs.readdirSync(dir);
    } catch (e) {
      return out;
    }
    for (const name of entries) {
      const full = dir === "/" ? "/" + name : dir + "/" + name;
      if (full === "/.deletedFiles.log") continue;
      let stat;
      try { stat = fs.statSync(full); } catch (e) { continue; }
      if (stat.isDirectory()) {
        out.push(...collectWritableFiles(fs, full));
      } else if (stat.isFile()) {
        let buf;
        try { buf = fs.readFileSync(full); } catch (e) { continue; }
        out.push({ path: full.replace(/^\//, ""), bytes: buf });
      }
    }
    return out;
  }

  async function downloadWritableLayer() {
    try {
      const layers = getWritableLayers();
      const zip = new JSZip();
      let totalBytes = 0;
      let totalFiles = 0;
      const perLayerCounts = [];

      for (const { mount, writable } of layers) {
        const files = collectWritableFiles(writable);
        perLayerCounts.push(`${mount}: ${files.length}`);
        // Top-level folder in the output zip mirrors the BFS mount so users
        // can see which writes came from where. `/root/base` → "system",
        // `/root/files` → "appdir" — friendlier than raw mount paths.
        const folder = mount === "/root/base" ? "system" : "appdir";
        for (const f of files) {
          const bytes = f.bytes.buffer
            ? new Uint8Array(f.bytes.buffer, f.bytes.byteOffset, f.bytes.byteLength)
            : new Uint8Array(f.bytes);
          zip.file(`${folder}/${f.path}`, bytes);
          totalBytes += bytes.length;
          totalFiles += 1;
        }
      }

      log(`Writable layer scan: ${perLayerCounts.join(", ")}.`);

      if (totalFiles === 0) {
        log("Writable layers are empty — nothing to download.", "warn");
        return;
      }

      const zipBytes = zip.generate({ type: "uint8array", compression: "DEFLATE" });
      const blob = new Blob([zipBytes], { type: "application/zip" });
      const url = URL.createObjectURL(blob);
      const ts = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
      const a = document.createElement("a");
      a.href = url;
      a.download = `exebrowser-output-${ts}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      log(`Downloaded ${totalFiles} file(s), ${formatBytes(totalBytes)} (zipped to ${formatBytes(zipBytes.length)}).`);
    } catch (err) {
      log("Save failed: " + err.message, "error");
    }
  }

  async function buildAppZip() {
    if (typeof JSZip === "undefined") {
      throw new Error("JSZip not loaded — boot Wine first.");
    }
    if (state.stagedFiles.length === 0 || !state.pickedExe) {
      throw new Error("No files staged.");
    }
    // Boxedwine's shell.js uses the zip basename (sans .zip) as the working-dir
    // folder name. So we wrap every staged file under `userapp/...` and that
    // becomes `D:/userapp` at runtime — which matches our app-zip filename
    // (userapp.zip). Entry EXE keeps its relative subpath so assets resolve.
    const zip = new JSZip();
    const ROOT = "userapp/";
    for (const f of state.stagedFiles) {
      zip.file(ROOT + f.path, f.bytes);
    }
    const bytes = zip.generate({ type: "uint8array", compression: "STORE" });
    state.appZipBlob = new Blob([bytes], { type: "application/zip" });
    log(`Packaged ${state.stagedFiles.length} file(s) under userapp/ into ${formatBytes(state.appZipBlob.size)} virtual zip.`);
  }

  // ─── orchestrator ──────────────────────────────────────────────────────

  async function bootAndRun() {
    if (state.bootInFlight) return;
    if (!state.pickedExe) {
      log("Pick an EXE first.", "error");
      return;
    }

    state.bootInFlight = true;
    els.runBtn.disabled = true;
    els.bootBtn.disabled = true;

    try {
      installXhrInterceptor();
      await loadBoxedwineDeps();
      await buildAppZip();
      await runShellWithConfig();

      els.screenContainer.classList.add("has-content");

      await startEmulator();
      state.booted = true;
      els.saveStateBtn.disabled = false;
      setStatus(`Running ${state.pickedExe.originalName}…`);
      log("Launch dispatched. Canvas will activate when Wine is ready.");
    } catch (err) {
      log("Boot failed: " + err.message, "error");
      setStatus("Boot failed. See console.");
      els.bootBtn.disabled = false;
      els.runBtn.disabled = false;
      state.bootInFlight = false;
    }
  }

  // ─── wiring ────────────────────────────────────────────────────────────

  els.bootBtn.addEventListener("click", () => {
    // The "Boot Wine" button now just enables the loader section; actual boot
    // happens on Run (we need an EXE before we know what to launch). We lock
    // in the variant selection here so the dropdown can be disabled to make it
    // clear the choice is committed.
    const choice = els.wineVariant ? els.wineVariant.value : "default";
    state.selectedVariant = WINE_VARIANTS[choice] ? choice : "default";
    if (els.wineVariant) els.wineVariant.disabled = true;

    els.loaderSection.classList.remove("disabled");
    setStatus("Pick an EXE, then click Run.");
    els.bootBtn.disabled = true;
    els.bootBtn.textContent = "Wine ready — load an EXE";
    log("Wine ready to load (variant: " + state.selectedVariant + "). Drop an EXE below.");
  });

  els.pickBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    els.exeInput.click();
  });
  els.pickFolderBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    els.folderInput.click();
  });
  els.pickZipBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    els.zipInput.click();
  });
  els.exeInput.addEventListener("change", (e) => handleSingleExe(e.target.files[0]));
  els.folderInput.addEventListener("change", (e) => handleFolder(e.target.files));
  els.zipInput.addEventListener("change", (e) => handleZip(e.target.files[0]));
  els.entryPicker.addEventListener("change", (e) => {
    const f = state.candidateExes.find((c) => c.path === e.target.value);
    if (f) setEntry(f);
  });

  // Dropzone drop: route by file shape. A single .exe → exe handler; a single
  // .zip → zip handler; otherwise treat as a folder/files drop.
  els.dropzone.addEventListener("click", () => els.exeInput.click());
  els.dropzone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      els.exeInput.click();
    }
  });
  els.dropzone.addEventListener("dragover", (e) => {
    e.preventDefault();
    els.dropzone.classList.add("hover");
  });
  els.dropzone.addEventListener("dragleave", () => els.dropzone.classList.remove("hover"));
  els.dropzone.addEventListener("drop", async (e) => {
    e.preventDefault();
    els.dropzone.classList.remove("hover");
    const files = Array.from(e.dataTransfer.files || []);
    if (files.length === 0) return;
    if (files.length === 1 && /\.exe$/i.test(files[0].name)) {
      handleSingleExe(files[0]);
    } else if (files.length === 1 && /\.zip$/i.test(files[0].name)) {
      handleZip(files[0]);
    } else {
      // Browsers don't populate webkitRelativePath for dragged-in items unless
      // we walk e.dataTransfer.items (which we keep deferred). For now treat
      // dropped multi-file as flat list at zip root.
      clearStaged();
      for (const f of files) {
        const safe = sanitizeRelPath(f.name);
        if (!safe) continue;
        const bytes = new Uint8Array(await f.arrayBuffer());
        if (/\.exe$/i.test(safe)) warnIfNotPe(safe, bytes);
        state.stagedFiles.push({ path: safe, bytes });
      }
      log(`Dropped ${state.stagedFiles.length} files (flat).`);
      refreshEntryPicker();
    }
  });

  els.runBtn.addEventListener("click", bootAndRun);
  els.saveStateBtn.addEventListener("click", downloadWritableLayer);

  log("ExeBrowser ready. Click 'Boot Wine' to begin.");

  // Preload JSZip so the zip-upload path works before Wine has booted.
  loadScript(RUNTIME_BASE + "jszip.min.js").catch((e) => {
    log("Warning: failed to preload JSZip — zip uploads will wait until boot.", "warn");
  });

  // SharedArrayBuffer check (Boxedwine needs it for threads)
  if (typeof SharedArrayBuffer === "undefined") {
    log("Warning: SharedArrayBuffer is unavailable. Check that COOP/COEP headers are set. Performance will be degraded.", "warn");
  }
})();
