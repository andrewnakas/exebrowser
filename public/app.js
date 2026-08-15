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

  // ─── Wine variants ─────────────────────────────────────────────────────
  // Each variant bundles a Boxedwine runtime build + a Wine root + optional
  // overlay. Two loading modes:
  //   ondemand : large root range-fetched lazily as DLLs are needed (the
  //              boxedwine.org Win32 model). Requires a same-origin proxy that
  //              honors Range requests; browserfs.boxedwine.js was patched to
  //              hardcode fetches to /api/fs/.
  //   inline   : whole root zip downloaded up-front (the 16-bit model + the
  //              older 18R2 build). Smaller roots make this viable.
  // The runtime base controls which boxedwine.js/.wasm/shell.js the page loads.
  // Variants that need the patched browserfs use runtime "default"; others
  // (18R2, win3x) ship their own runtime under /boxedwine/build/<name>/.
  const WINE_VARIANTS = {
    default: {
      label: "Wine 1.7.55 — Win32 (default, range-fetched)",
      runtimeBase: "/boxedwine/build/default/",
      loadMode: "ondemand",
      rootBaseUrl: "/api/fs/",
      rootBasename: "fullWine1.7.55-v8",
      overlayBaseUrl: "/boxedwine/apps/",
      overlayBasename: "wine1.7.55-v8-min-online",
    },
    gecko: {
      label: "Wine 1.7.55 — Win32 + Gecko MSI bundled",
      runtimeBase: "/boxedwine/build/default/",
      loadMode: "ondemand",
      rootBaseUrl: "/api/fs/",
      rootBasename: "fullWine1.7.55-v8",
      overlayBaseUrl: "/api/overlay/",
      overlayBasename: "wine1.7.55-v8-with-gecko",
    },
    win3x: {
      label: "Wine 3.1 — Win3.x 16-bit only (inline, 20 MB)",
      runtimeBase: "/boxedwine/build/default/",
      loadMode: "inline",
      rootBaseUrl: "/api/fs/",
      rootBasename: "minWine31v6",
    },
    r18: {
      label: "Boxedwine 18R2 (experimental, inline, 19 MB)",
      runtimeBase: "/boxedwine/build/18r2/",
      loadMode: "inline",
      // 18R2's bundled root ships inside its own runtime tree.
      rootBaseUrl: "/boxedwine/build/18r2/",
      rootBasename: "boxedwine",
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
      let u = String(url);
      // Variant-specific URL rewrites. Inline-mode variants fetch the root
      // zip with an empty baseUrl, so the request lands at /boxedwine.zip or
      // /minWine31v6.zip on the page origin. Redirect to where we actually
      // ship the assets.
      const variant = activeVariant();
      if (variant.loadMode === "inline") {
        const want = variant.rootBasename + ".zip";
        if (u === want || u.endsWith("/" + want)) {
          u = variant.rootBaseUrl + want;
        }
      }
      this.__exebrowser_url = u;
      return origOpen.call(this, method, u, async !== false, user, pass);
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

  function activeVariant() {
    return WINE_VARIANTS[state.selectedVariant] || WINE_VARIANTS.default;
  }

  // Stage 1: load dependencies that shell.js needs (BrowserFS, JSZip).
  // The browserfs filename + the need for the ?v= cache buster vary by variant:
  //   - default/gecko use the patched browserfs.boxedwine.js (hardcoded path
  //     redirected from /boxedwine/fs/ to /api/fs/), so the bust is mandatory.
  //   - 18r2 ships its own browserfs.min.js — no patch, no cache concern.
  //   - win3x uses default runtime so default rules apply.
  async function loadBoxedwineDeps() {
    if (state.depsLoaded) return;
    setStatus("Loading Boxedwine runtime…");
    els.bootProgress.hidden = false;
    els.bootProgress.value = 10;

    const variant = activeVariant();
    const runtimeBase = variant.runtimeBase;

    await loadScript(runtimeBase + "jszip.min.js");
    els.bootProgress.value = 25;

    if (variant.runtimeBase === "/boxedwine/build/18r2/") {
      await loadScript(runtimeBase + "browserfs.min.js");
    } else {
      await loadScript(runtimeBase + "browserfs.boxedwine.js?v=8");
    }
    els.bootProgress.value = 40;

    ensureShellDomStubs();
    state.depsLoaded = true;
    log("Dependencies loaded (runtime=" + runtimeBase + ").");
  }

  // Stage 2: build a single combined script: shell.js source + our Config
  // mutations. They share scope so we can reach the `let Config` shell.js
  // declares. Then inject boxedwine.js which triggers preRun → initialSetup.
  async function runShellWithConfig() {
    setStatus("Configuring Wine launch…");
    els.bootProgress.value = 50;

    const variant = activeVariant();
    const runtimeBase = variant.runtimeBase;
    const shellSrc = await fetchText(runtimeBase + "boxedwine-shell.js?v=2");
    els.bootProgress.value = 60;

    // urlParams depends on the variant's load mode:
    //   ondemand : range-fetch root; preload overlay; needs locateRootBaseUrl
    //              pointing at the Range-capable proxy (/api/fs/).
    //   inline   : root downloaded whole; no overlay; locateRootBaseUrl just
    //              needs to serve the .zip (Range optional).
    const rootBasename = variant.rootBasename;
    const overlayBasename = variant.overlayBasename;
    const overlayBaseUrl = variant.overlayBaseUrl || "/boxedwine/apps/";
    const exeName = state.pickedExe.path.replace(/\//g, "\\");

    let urlParams;
    if (variant.loadMode === "ondemand") {
      urlParams = [
        "ondemand=root",
        "root=" + encodeURIComponent(rootBasename),
        "inline-default-ondemand-root-overlay=" + encodeURIComponent(overlayBasename),
        "app=" + encodeURIComponent(VIRTUAL_APP_ZIP),
        "p=" + encodeURIComponent(exeName),
        "auto=true",
        "sound=true",
        "bpp=32",
      ].join("&");
    } else {
      urlParams = [
        "root=" + encodeURIComponent(rootBasename),
        "app=" + encodeURIComponent(VIRTUAL_APP_ZIP),
        "p=" + encodeURIComponent(exeName),
        "auto=true",
        "sound=true",
        "bpp=32",
      ].join("&");
    }

    // The Config object inside shell.js is `let`-scoped, so we can only mutate
    // it from inside the same <script> block. We append our setup at the end
    // of the shell.js source and run the combined whole as one inline script.
    const configCode = `
      // ── ExeBrowser-injected configuration ──
      Config.isRunningInline = true;
      Config.locateRootBaseUrl  = ${JSON.stringify(variant.rootBaseUrl)};
      Config.locateAppBaseUrl   = ${JSON.stringify("/boxedwine/apps/")};
      Config.locateOverlayBaseUrl = ${JSON.stringify(overlayBaseUrl)};
      Config.urlParams = ${JSON.stringify(urlParams)};

      // shell.js declares its own var Module; reach in and add our hooks.
      var __originalPreRun = Module.preRun ? Module.preRun.slice() : [];
      Module.canvas = document.getElementById("canvas");
      Module.print = function (t) { window.__exeBrowserLog(String(t)); };
      Module.printErr = function (t) { window.__exeBrowserLog(String(t), "warn"); };
      Module.setStatus = function (t) { if (t) window.__exeBrowserStatus(t); };
      Module.locateFile = function (path) { return ${JSON.stringify(runtimeBase)} + path; };
      // Expose for our outer code to verify.
      window.__BoxedwineConfig = Config;
      window.__BoxedwineModule = Module;
    `;

    await runInlineScript(shellSrc + "\n;\n" + configCode);

    if (!window.__BoxedwineConfig) {
      throw new Error("Combined shell+config script failed to expose Config.");
    }

    log("Wine shell configured (variant=" + state.selectedVariant +
        ", root=" + rootBasename +
        (overlayBasename ? ", overlay=" + overlayBasename : "") +
        ", program=" + exeName + ").");
  }

  // Stage 3: inject the Emscripten runtime. Its preRun calls initialSetup
  // which reads Config.urlParams and builds the filesystem.
  async function startEmulator() {
    setStatus("Starting emulator…");
    els.bootProgress.value = 75;
    await loadScript(activeVariant().runtimeBase + "boxedwine.js");
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
      .filter((f) => /\.(exe|bat)$/i.test(f.path))
      .sort((a, b) => {
        // EXEs before BATs so default pick is still an EXE when both exist
        const aExe = /\.exe$/i.test(a.path) ? 0 : 1;
        const bExe = /\.exe$/i.test(b.path) ? 0 : 1;
        return aExe - bExe || a.path.localeCompare(b.path);
      });

    if (state.candidateExes.length === 0) {
      els.entryPickerWrap.hidden = true;
      els.runBtn.disabled = true;
      state.pickedExe = null;
      log("No .exe or .bat found in the supplied files.", "warn");
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

    // Different Boxedwine runtimes name the home overlay's mount point
    // differently: 'default' uses Config.appDirPrefix (= "/root/files/"),
    // 18R2 uses Config.dirPrefix. Pull whichever exists and don't crash if
    // one is missing — we'll still get the system overlay.
    const cfg = window.__BoxedwineConfig || {};
    const homeMount = ((cfg.appDirPrefix || cfg.dirPrefix || "")).replace(/\/$/, "");

    const out = [];
    for (const [mount, ov] of Object.entries(root.mntMap)) {
      if (mount !== "/root/base" && mount !== homeMount) continue;
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
  //
  // `layer` is the raw writable backend — fine for readdir/stat, but its
  // readFileSync takes (path, encoding, flag) and throws "Cannot read
  // properties of undefined" on the Node-style call. So we enumerate on the
  // layer and read through the mounted fs façade at `mount`, which builds the
  // FileFlag for us. Reading the layer directly silently yielded zero files,
  // which is why the download button produced empty zips.
  function collectWritableFiles(layer, mount = "", dir = "/") {
    const out = [];
    let entries;
    try {
      entries = layer.readdirSync(dir);
    } catch (e) {
      return out;
    }
    const rootFs = mount ? window.BrowserFS.BFSRequire("fs") : null;
    for (const name of entries) {
      const full = dir === "/" ? "/" + name : dir + "/" + name;
      if (full === "/.deletedFiles.log") continue;
      let stat;
      try { stat = layer.statSync(full); } catch (e) { continue; }
      if (stat.isDirectory()) {
        out.push(...collectWritableFiles(layer, mount, full));
      } else if (stat.isFile()) {
        let buf;
        try {
          buf = rootFs ? rootFs.readFileSync(mount + full) : layer.readFileSync(full);
        } catch (e) { continue; }
        out.push({ path: full.replace(/^\//, ""), bytes: buf });
      }
    }
    return out;
  }

  // ─── persist writable layer across visits ──────────────────────────────
  // Same idea as the DOS save layer: the writable side of each OverlayFS
  // holds only what the running app wrote, so it's a clean delta to store.
  // Keyed per app slug so KeePass databases don't leak into PuTTY's session
  // list. Best-effort — browsers evict IndexedDB, and the copy shipped here
  // is a convenience, not a backup (downloadWritableLayer stays the export).
  const WINE_PERSIST_ON = new URLSearchParams(location.search).get("persist") !== "0";
  const WINE_DB = "wineSaves";
  const WINE_STORE = "layers";
  const WINE_MAX_BYTES = 16 * 1024 * 1024;
  // On a game page the slug is the game. Off one — the homepage's bring-your-
  // own-EXE loader — there is no slug, and everything used to share the single
  // key "home": upload KeePass, then upload PuTTY, and PuTTY booted with
  // KeePass's files layered over it. Key on the executable instead.
  const wineSlugBase = (location.pathname.match(/\/run\/([^/]+)/) || [])[1] || "";
  let wineSlug = wineSlugBase || "home";

  function shortHash(s) {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i) & 0xff;
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h.toString(36);
  }

  // Called once the chosen executable is known, before the first save.
  function resolveWineSlug() {
    if (wineSlugBase) return wineSlug;
    const name = state.pickedExe?.originalName || "";
    wineSlug = name ? "byo-" + shortHash(name.toLowerCase()) : "home";
    return wineSlug;
  }

  function wineIdb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(WINE_DB, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(WINE_STORE)) req.result.createObjectStore(WINE_STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  function wineIdbGet(key) {
    return wineIdb().then(db => new Promise((res, rej) => {
      const r = db.transaction(WINE_STORE, "readonly").objectStore(WINE_STORE).get(key);
      r.onsuccess = () => res(r.result || null);
      r.onerror = () => rej(r.error);
    }));
  }
  function wineIdbPut(key, val) {
    return wineIdb().then(db => new Promise((res, rej) => {
      const r = db.transaction(WINE_STORE, "readwrite").objectStore(WINE_STORE).put(val, key);
      r.onsuccess = () => res();
      r.onerror = () => rej(r.error);
    }));
  }

  // Which writable-layer paths are worth carrying between visits. Wine's own
  // prefix scaffolding is rebuilt on every boot, so we keep the user's home
  // and documents, the app's own working directory, and the registry hives
  // that hold app settings — and skip symlink stubs and .keep placeholders.
  function isUserData(path) {
    if (/\.link$/.test(path) || /(^|\/)\.keep$/.test(path)) return false;
    if (/(^|\/)\.deletedFiles\.log$/.test(path)) return false;
    // Booting Wine copies its own runtime into the writable layer — lib/,
    // usr/, bin/, share/ hold ~20 MB of .so files that are identical on every
    // boot. Allow-list the two places user state actually lives instead of
    // trying to name everything to exclude.
    const home = path.match(/^home\/[^/]+\/\.wine\/(.*)$/);
    if (!home) {
      // Anything outside home/ is either Wine's runtime (system layer) or the
      // app's own working directory (/root/files layer). The latter has no
      // home/ prefix at all, so keep only paths that aren't system trees.
      return !/^(lib|usr|bin|etc|share|dev|proc|mnt|tmp|var|sbin|opt)(\/|$)/.test(path);
    }
    const rest = home[1];
    // Registry hives carry app settings and are small.
    if (/^(user|system|userdef)\.reg$/.test(rest)) return true;
    const drivec = rest.match(/^drive_c\/(.*)$/);
    if (!drivec) return false;
    const inC = drivec[1];
    if (/^windows\//i.test(inC)) return false;                          // Wine-generated
    if (/^users\/[^/]+\/Local Settings\/Temp\//i.test(inC)) return false; // scratch
    return true;                                                         // documents, app data, installs
  }

  // Snapshot every writable layer into a plain {mount: {path: bytes}} map.
  let winePersistInFlight = null;
  function persistWineLayers(reason) {
    if (!WINE_PERSIST_ON || !state.booted || winePersistInFlight) return winePersistInFlight || Promise.resolve();
    winePersistInFlight = (async () => {
      try {
        const snapshot = {};
        let total = 0;
        for (const { mount, writable } of getWritableLayers()) {
          const files = {};
          for (const f of collectWritableFiles(writable, mount)) {
            // Booting Wine writes ~26 MB of prefix boilerplate into the
            // writable layer — font links, .keep placeholders, the default
            // registry. That's regenerated on every boot, so persisting it
            // would blow the size cap and save nothing anyone cares about.
            // Keep the parts that represent user state instead.
            if (!isUserData(f.path)) continue;
            const bytes = f.bytes.buffer
              ? new Uint8Array(f.bytes.buffer, f.bytes.byteOffset, f.bytes.byteLength)
              : new Uint8Array(f.bytes);
            total += bytes.length;
            if (total > WINE_MAX_BYTES) throw new Error("saved files exceed " + (WINE_MAX_BYTES / 1048576) + " MB");
            files[f.path] = bytes;
          }
          if (Object.keys(files).length) snapshot[mount] = files;
        }
        if (!total) { log("Nothing new to save yet.", "warn"); return; }
        const key = resolveWineSlug();
        await wineIdbPut(key, snapshot);
        log(`Saved ${formatBytes(total)} of your files in this browser.`);

        window.SaveCore?.note({
          slug: key,
          // On a game page the title people recognise is the page's, not the
          // executable's — nobody is looking for "SKI32.EXE" in a resume card.
          // An uploaded EXE has no page, so there the filename is all there is.
          name: (wineSlugBase && document.getElementById("exe-embed")?.dataset.appName)
            || state.pickedExe?.originalName
            || key,
          runtime: "wine",
          kind: "files",
          payload: { db: WINE_DB, store: WINE_STORE, key },
          bytes: total,
          // Boxedwine draws through Emscripten's Browser.createContext, which
          // may hand back a WebGL context with no preserveDrawingBuffer — that
          // reads back blank. thumbFromCanvas returns null rather than a black
          // rectangle, and the card falls back to the game's poster art. Not
          // worth the per-frame cost of forcing a readable buffer for a
          // thumbnail on something like PuTTY.
          thumb: window.SaveCore.thumbFromCanvas(document.getElementById("canvas")),
        });
        track("persist_save", { bytes: total, reason });
      } catch (err) {
        log("Could not save your files: " + err.message, "warn");
      } finally {
        winePersistInFlight = null;
      }
    })();
    return winePersistInFlight;
  }

  // Poll for the exact state restoreWineLayers needs: both overlays mounted,
  // and Wine's own prefix copy finished. That second part matters — the mounts
  // appear well before Wine has populated them, and restoring into a prefix
  // that's still being written gets the files overwritten a moment later.
  // A non-empty writable layer is the cheapest available proof it's done.
  async function waitForOverlays(timeoutMs = 30000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const layers = getWritableLayers();
        const populated = layers.some(({ writable }) => {
          try { return writable.readdirSync("/").length > 0; } catch { return false; }
        });
        if (populated) return true;
      } catch {
        // Not mounted yet — getWritableLayers throws with a precise reason.
      }
      await new Promise(r => setTimeout(r, 250));
    }
    log("Wine's filesystem never finished mounting — skipping the restore.", "warn");
    return false;
  }

  // Write a stored snapshot back into the fresh overlays after boot.
  async function restoreWineLayers() {
    if (!WINE_PERSIST_ON) return 0;
    let snapshot;
    try {
      snapshot = await wineIdbGet(resolveWineSlug());
      // Everything uploaded on the homepage used to land under "home". Read it
      // once so an existing save isn't stranded by the new per-EXE key; the
      // next save writes it back under the key it should have had.
      if (!snapshot && !wineSlugBase) snapshot = await wineIdbGet("home");
    } catch { return 0; }
    if (!snapshot) return 0;
    let restored = 0;
    try {
      // Write through the mounted fs façade rather than the raw layer: the
      // backend's own writeFileSync takes (path, data, encoding, flag, mode)
      // and throws on the friendlier Node signature. Going through the mount
      // point also lets OverlayFS route the write to the writable side.
      const fs = window.BrowserFS.BFSRequire("fs");
      const Buffer = window.BrowserFS.BFSRequire("buffer").Buffer;
      for (const { mount } of getWritableLayers()) {
        const files = snapshot[mount];
        if (!files) continue;
        for (const [path, bytes] of Object.entries(files)) {
          const full = mount + "/" + path;
          try {
            mkdirpSync(fs, full.slice(0, full.lastIndexOf("/")));
            fs.writeFileSync(full, Buffer.from(bytes));
            restored++;
          } catch { /* one bad file shouldn't sink the restore */ }
        }
      }
    } catch (err) {
      log("Could not restore your files: " + err.message, "warn");
      return 0;
    }
    if (restored) {
      log(`Restored ${restored} file(s) you saved here previously.`);
      track("persist_restore", { files: restored });
    }
    return restored;
  }

  function mkdirpSync(fs, dir) {
    const parts = dir.split("/").filter(Boolean);
    let cur = "";
    for (const p of parts) {
      cur += "/" + p;
      try { fs.mkdirSync(cur); } catch { /* already exists */ }
    }
  }

  async function downloadWritableLayer() {
    try {
      const layers = getWritableLayers();
      const zip = new JSZip();
      let totalBytes = 0;
      let totalFiles = 0;
      const perLayerCounts = [];

      for (const { mount, writable } of layers) {
        const files = collectWritableFiles(writable, mount);
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

  function track(name, params) {
    if (typeof window.gtag === "function") {
      const slug = (location.pathname.match(/\/run\/([^/]+)/) || [])[1] || "home";
      window.gtag("event", name, Object.assign({ app_slug: slug, runtime: "boxedwine" }, params || {}));
    }
  }

  // Playtime heartbeat: one event per minute while an app runs, partial flush on tab-hide.
  let hbTimer = null, lastBeat = 0;
  function startHeartbeat() {
    if (hbTimer) return;
    lastBeat = performance.now();
    hbTimer = setInterval(() => {
      lastBeat = performance.now();
      track("playtime_heartbeat", { seconds: 60 });
    }, 60000);
  }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "hidden" || !hbTimer) return;
    const partial = Math.round((performance.now() - lastBeat) / 1000);
    if (partial >= 5) {
      lastBeat = performance.now();
      track("playtime_heartbeat", { seconds: partial });
    }
  });

  async function bootAndRun() {
    if (state.bootInFlight) return;
    if (!state.pickedExe) {
      log("Pick an EXE first.", "error");
      return;
    }

    state.bootInFlight = true;
    els.runBtn.disabled = true;
    els.bootBtn.disabled = true;
    const t0 = performance.now();

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
      track("boot_success", { boot_ms: Math.round(performance.now() - t0) });
      startHeartbeat();

      if (WINE_PERSIST_ON) {
        // The overlays only exist once Wine has finished mounting, and how
        // long that takes depends on the connection and the machine. Four
        // seconds was a guess, and on a slow boot it fired into nothing —
        // silently, because there was no save to restore *yet*. Wait for the
        // condition instead of the clock.
        waitForOverlays()
          .then(ready => (ready ? restoreWineLayers() : 0))
          .catch(() => {});
        navigator.storage?.persist?.().catch(() => {});

        const flusher = window.SaveCore
          ? window.SaveCore.schedule({
              intervalMs: 30000,
              flush: (reason) => persistWineLayers(reason),
            })
          : null;
        if (!flusher) {
          setInterval(() => persistWineLayers("interval"), 30000);
          document.addEventListener("visibilitychange", () => {
            if (document.visibilityState === "hidden") persistWineLayers("hidden");
          });
          window.addEventListener("pagehide", () => persistWineLayers("pagehide"));
        }
        // Deliberately no `beforeunload` handler clearing the timer: on Safari
        // that could tear the flusher down before the pagehide write ran,
        // which is the one write that matters most.
      }
    } catch (err) {
      track("boot_error", { error_message: String(err.message).slice(0, 120) });
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

    // The experimental 64-bit variant is a SEPARATE, self-contained page
    // (Boxedwine64 / wine64 wasm64-mt build at /64/). It has its own loader,
    // rootfs (split same-origin parts), app launcher, and EXE upload — none of
    // the 32-bit shell wiring below applies. So hand off to it instead of
    // enabling the inline loader. ?chunked=1 tells the launcher to fetch the
    // rootfs via its part manifests up front (we ship only the <25 MB split
    // parts on Pages, not the whole 196 MB wine64.zip).
    if (choice === "x64") {
      window.location.href = "/64/?chunked=1";
      return;
    }

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

  // ─── programmatic API ────────────────────────────────────────────────────
  // Exposed so per-app instant-play pages (/run/<app>/) can drive the same
  // engine without the user hand-picking a file: stage a hosted, license-clean
  // app payload (a zip fetched over the network), pick the entry EXE, and boot —
  // all the real pipeline above, just fed programmatically. Returns helpers that
  // resolve once the launch is dispatched. Everything still runs client-side;
  // the only difference from a manual upload is where the bytes come from.
  async function stageHostedZip(url) {
    if (typeof JSZip === "undefined") {
      // JSZip is preloaded below; wait briefly if a fast click beats it.
      await new Promise((r) => setTimeout(r, 250));
      if (typeof JSZip === "undefined") throw new Error("JSZip not ready yet.");
    }
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status} fetching ${url}`);
    const buf = await r.arrayBuffer();
    clearStaged();
    const zip = await loadZip(buf);
    const entries = listZipEntries(zip);
    for (const e of entries) {
      const safe = sanitizeRelPath(e.path);
      if (!safe) continue;
      const bytes = await readZipEntry(zip, e);
      if (/\.exe$/i.test(safe)) warnIfNotPe(safe, bytes);
      state.stagedFiles.push({ path: safe, bytes });
    }
    log(`Fetched hosted app: ${state.stagedFiles.length} files staged from ${url}.`);
    refreshEntryPicker();
  }

  window.ExeBrowser = {
    // Lock in a Wine variant (e.g. "gecko" for Pinball) before boot.
    setVariant(name) {
      if (WINE_VARIANTS[name]) {
        state.selectedVariant = name;
        if (els.wineVariant) els.wineVariant.value = name;
      }
    },
    // Prefer a specific entry EXE by basename once files are staged (e.g.
    // "DOOM95.EXE"). Sanitizes the name the same way stageHostedZip does so
    // "notepad++.exe" correctly matches the staged "NOTEPAD_.EXE".
    preferEntry(basename) {
      const name = String(basename);
      // .bat files: match by exact name (case-insensitive), no sanitization
      if (/\.bat$/i.test(name)) {
        const hit = state.candidateExes.find(
          (f) => f.path.split("/").pop().toUpperCase() === name.toUpperCase()
        );
        if (hit) { setEntry(hit); return; }
      }
      // .exe files: sanitize to 8.3 DOS name before comparing
      const sanitized = sanitizeExeName(name);
      const hit = state.candidateExes.find(
        (f) => f.path.split("/").pop().toUpperCase() === sanitized
      );
      if (hit) setEntry(hit);
    },
    // Fetch a hosted, license-clean app zip and stage it (no user upload).
    stageHostedZip,
    // Boot the engine and run the staged entry EXE. Same path as the Run button.
    run: bootAndRun,
    saveFiles: () => persistWineLayers("manual"),
    // Introspection for the embed UI.
    isReady: () => !!state.pickedExe,
    isBooting: () => state.bootInFlight,
  };
  document.dispatchEvent(new Event("exebrowser:ready"));

  log("ExeBrowser ready. Click 'Boot Wine' to begin.");

  // Preload JSZip from the default runtime so the zip-upload path works before
  // Wine boots. JSZip is the same across all our variant runtimes.
  loadScript("/boxedwine/build/default/jszip.min.js").catch((e) => {
    log("Warning: failed to preload JSZip — zip uploads will wait until boot.", "warn");
  });

  // The 32-bit Boxedwine build is single-threaded and never touches
  // SharedArrayBuffer, so no cross-origin-isolation check is needed here.
  // (The experimental /64/ pthreads runtime does need it — its page keeps
  // COOP/COEP headers and ships a coi-serviceworker fallback.)
})();
