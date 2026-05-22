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
  const OVERLAY_URL = "/boxedwine/apps/wine1.7.55-v8-min-online.zip";
  const VIRTUAL_APP_ZIP = "userapp.zip"; // the filename shell.js will request

  const els = {
    bootBtn: document.getElementById("bootBtn"),
    bootStatus: document.getElementById("bootStatus"),
    bootProgress: document.getElementById("bootProgress"),
    loaderSection: document.getElementById("loader-section"),
    dropzone: document.getElementById("dropzone"),
    exeInput: document.getElementById("exeInput"),
    pickBtn: document.getElementById("pickBtn"),
    fileInfo: document.getElementById("fileInfo"),
    runBtn: document.getElementById("runBtn"),
    logOutput: document.getElementById("logOutput"),
    canvas: document.getElementById("canvas"),
    screenContainer: document.getElementById("screen-container"),
  };

  const state = {
    depsLoaded: false,
    pickedExe: null, // { name: "FOO.EXE", bytes: Uint8Array }
    appZipBlob: null,
    bootInFlight: false,
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
    // The min-online overlay just preloads /home/.wine for faster boot.
    const rootBasename = ROOT_FS_URL.split("/").pop().replace(/\.zip$/, "");
    const overlayBasename = OVERLAY_URL.split("/").pop().replace(/\.zip$/, "");
    const exeName = state.pickedExe.name;

    // The Config object inside shell.js is `let`-scoped, so we can only mutate
    // it from inside the same <script> block. We append our setup at the end
    // of the shell.js source and run the combined whole as one inline script.
    const configCode = `
      // ── ExeBrowser-injected configuration ──
      Config.isRunningInline = true;
      Config.locateRootBaseUrl  = ${JSON.stringify(ROOT_FS_BASE)};
      Config.locateAppBaseUrl   = ${JSON.stringify("/boxedwine/apps/")};
      Config.locateOverlayBaseUrl = ${JSON.stringify("/boxedwine/apps/")};
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

    log("Wine shell configured (root=" + rootBasename + ", overlay=" + overlayBasename + ", program=" + exeName + ").");
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

  // ─── EXE handling ──────────────────────────────────────────────────────

  async function handleFile(file) {
    if (!file) return;

    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.length < 64 || bytes[0] !== 0x4d || bytes[1] !== 0x5a) {
      log(`Warning: ${file.name} doesn't start with PE 'MZ' magic.`, "warn");
    }

    const safeName = sanitizeExeName(file.name);
    state.pickedExe = { name: safeName, originalName: file.name, bytes };
    els.fileInfo.textContent = `${file.name} (renamed to ${safeName} for Wine) · ${formatBytes(file.size)}`;
    els.runBtn.disabled = false;
    log(`Loaded ${file.name} → ${safeName} (${formatBytes(file.size)}).`);
  }

  async function buildAppZip() {
    if (typeof JSZip === "undefined") {
      throw new Error("JSZip not loaded — boot Wine first.");
    }
    // Boxedwine bundles JSZip 2.x (2014), which has a synchronous .generate()
    // and no .generateAsync(). API: zip.file(name, data); zip.generate({type, compression}).
    const zip = new JSZip();
    zip.file(state.pickedExe.name, state.pickedExe.bytes);
    const bytes = zip.generate({ type: "uint8array", compression: "STORE" });
    state.appZipBlob = new Blob([bytes], { type: "application/zip" });
    log(`Packaged ${state.pickedExe.name} into ${formatBytes(state.appZipBlob.size)} virtual zip.`);
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
    // happens on Run (we need an EXE before we know what to launch).
    els.loaderSection.classList.remove("disabled");
    setStatus("Pick an EXE, then click Run.");
    els.bootBtn.disabled = true;
    els.bootBtn.textContent = "Wine ready — load an EXE";
    log("Wine ready to load. Drop an EXE below.");
  });

  els.pickBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    els.exeInput.click();
  });
  els.exeInput.addEventListener("change", (e) => handleFile(e.target.files[0]));
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
  els.dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    els.dropzone.classList.remove("hover");
    if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
  });

  els.runBtn.addEventListener("click", bootAndRun);

  log("ExeBrowser ready. Click 'Boot Wine' to begin.");

  // SharedArrayBuffer check (Boxedwine needs it for threads)
  if (typeof SharedArrayBuffer === "undefined") {
    log("Warning: SharedArrayBuffer is unavailable. Check that COOP/COEP headers are set. Performance will be degraded.", "warn");
  }
})();
