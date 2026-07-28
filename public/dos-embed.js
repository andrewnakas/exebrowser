(() => {
  "use strict";

  const host = document.getElementById("dos-embed");
  if (!host) return;

  const cfg = {
    appUrl: host.dataset.appUrl || "",
    appName: host.dataset.appName || "this game",
    autoboot: host.dataset.autoboot === "true",
  };

  const slug = (location.pathname.match(/\/run\/([^/]+)/) || [])[1] || location.pathname;

  function track(name, params) {
    if (typeof window.gtag === "function") {
      window.gtag("event", name, Object.assign({ app_slug: slug, runtime: "dosbox" }, params || {}));
    }
  }

  // Playtime heartbeat: one event per minute while the game runs, partial flush on tab-hide.
  let hbTimer = null, lastBeat = 0;
  function startHeartbeat() {
    if (hbTimer) return;
    lastBeat = performance.now();
    hbTimer = setInterval(() => {
      lastBeat = performance.now();
      track("playtime_heartbeat", { seconds: 60 });
    }, 60000);
  }
  function stopHeartbeat() {
    clearInterval(hbTimer);
    hbTimer = null;
  }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "hidden" || !hbTimer) return;
    const partial = Math.round((performance.now() - lastBeat) / 1000);
    if (partial >= 5) {
      lastBeat = performance.now();
      track("playtime_heartbeat", { seconds: partial });
    }
  });

  function esc(s) {
    return String(s).replace(/[&<>"']/g, c =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }

  // ─── save persistence ──────────────────────────────────────────────────
  //
  // js-dos can hand back a "changes bundle": a zip of everything the game
  // wrote to its filesystem since boot (savegames, config, high scores).
  // We stash that in IndexedDB per slug and layer it back over the base game
  // on the next boot — dosDirect takes [baseBundle, changesBundle].
  //
  // Best-effort by design: browsers evict IndexedDB (iOS drops it after ~7
  // days unused), so the UI never promises saves are permanent.
  const PERSIST_ON = new URLSearchParams(location.search).get("persist") !== "0";
  const DB_NAME = "dosSaves";
  const STORE = "bundles";
  const MAX_SAVE_BYTES = 16 * 1024 * 1024; // guard against a runaway write loop
  const SAVE_INTERVAL_MS = 15000;

  function idb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function idbGet(key) {
    return idb().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
      tx.onsuccess = () => resolve(tx.result || null);
      tx.onerror = () => reject(tx.error);
    }));
  }

  function idbPut(key, value) {
    return idb().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite").objectStore(STORE).put(value, key);
      tx.onsuccess = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }

  function idbDel(key) {
    return idb().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite").objectStore(STORE).delete(key);
      tx.onsuccess = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }

  host.innerHTML = `
    <div id="dos-stage">
      <canvas id="dos-canvas" tabindex="0" oncontextmenu="return false;"></canvas>
      <div id="dos-overlay" style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;background:rgba(0,0,0,.85);">
        <button id="dos-play" class="embed-play" type="button">&#9654; Play ${esc(cfg.appName)}</button>
        <p class="muted small" style="margin-top:.75rem;text-align:center;padding:0 1rem;">Runs in your browser with DOSBox + WebAssembly.<br>Nothing is uploaded. Runtime (~1.4 MB) is cached after first load.</p>
      </div>
    </div>
    <p id="dos-status" class="muted small" style="margin:.5rem 0 0;" hidden></p>
    <p style="margin:.5rem 0 0;"><button id="dos-fullscreen" type="button" class="button" hidden>&#9974; Fullscreen</button></p>
    <p class="muted small" style="margin:.25rem 0 0;">Click the game screen to capture keyboard &amp; mouse. Press <kbd>Ctrl+F10</kbd> to release mouse.
      <span id="dos-save-info" hidden> · <span id="dos-save-state">Progress saves in this browser</span> · <a href="#" id="dos-save-reset">reset saved progress</a></span>
    </p>
    <details style="margin-top:.5rem;">
      <summary class="muted small">Console output</summary>
      <pre id="dos-log" style="font-size:.7rem;max-height:8rem;overflow:auto;background:#111;padding:.5rem;"></pre>
    </details>
  `;

  const stage    = document.getElementById("dos-stage");
  const overlay  = document.getElementById("dos-overlay");
  const playBtn  = document.getElementById("dos-play");
  const statusEl = document.getElementById("dos-status");
  const canvas   = document.getElementById("dos-canvas");
  const logEl    = document.getElementById("dos-log");
  const saveInfo = document.getElementById("dos-save-info");
  const saveState = document.getElementById("dos-save-state");
  const saveReset = document.getElementById("dos-save-reset");
  const fsBtn    = document.getElementById("dos-fullscreen");

  // Fullscreen. iOS Safari has no Fullscreen API for arbitrary elements, so
  // fall back to a fixed-position "maximise" class that fills the viewport.
  const canFullscreen = typeof stage.requestFullscreen === "function";
  function toggleFullscreen() {
    if (canFullscreen) {
      if (document.fullscreenElement) document.exitFullscreen();
      else stage.requestFullscreen().catch(() => stage.classList.toggle("dos-maximised"));
    } else {
      stage.classList.toggle("dos-maximised");
      document.body.classList.toggle("dos-playing");
    }
    setTimeout(() => canvas.focus(), 50);
  }
  fsBtn.addEventListener("click", toggleFullscreen);
  document.addEventListener("keydown", e => {
    // Esc leaves the CSS fallback; the real Fullscreen API handles its own Esc.
    if (e.key === "Escape" && stage.classList.contains("dos-maximised")) {
      stage.classList.remove("dos-maximised");
      document.body.classList.remove("dos-playing");
    }
  });

  // Frame dimensions tracked via onFrameSize
  let frameW = 320, frameH = 200;

  function log(msg) {
    logEl.textContent += msg + "\n";
    logEl.scrollTop = logEl.scrollHeight;
  }

  function setStatus(msg) {
    statusEl.hidden = !msg;
    statusEl.textContent = msg;
  }

  async function loadEmulators() {
    if (window.emulators) return;
    await new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "/dosbox/emulators.js";
      s.onload = resolve;
      s.onerror = () => reject(new Error("Failed to load emulators.js"));
      document.head.appendChild(s);
    });
    window.emulators.pathPrefix = "/dosbox/";
  }

  async function fetchBundle(url) {
    setStatus("Downloading " + cfg.appName + "…");
    const resp = await fetch(url);
    if (!resp.ok) throw new Error("HTTP " + resp.status + " fetching " + url);
    const total = parseInt(resp.headers.get("content-length") || "0", 10);
    const reader = resp.body.getReader();
    const chunks = [];
    let received = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      if (total > 0) {
        const pct = Math.round(received / total * 100);
        setStatus("Downloading " + cfg.appName + "… " + pct + "%");
      }
    }
    const out = new Uint8Array(received);
    let off = 0;
    for (const c of chunks) { out.set(c, off); off += c.length; }
    return out;
  }

  function setupRenderer(ci) {
    const ctx = canvas.getContext("2d");
    let firstFrame = true;

    ci.events().onFrameSize((w, h) => {
      frameW = w;
      frameH = h;
      canvas.width = w;
      canvas.height = h;
    });

    ci.events().onFrame((rgb) => {
      const w = frameW, h = frameH;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      const img = ctx.createImageData(w, h);
      const src = rgb;
      const dst = img.data;
      for (let i = 0, j = 0; i < src.length; i += 3, j += 4) {
        dst[j]     = src[i];
        dst[j + 1] = src[i + 1];
        dst[j + 2] = src[i + 2];
        dst[j + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      if (firstFrame) {
        firstFrame = false;
        canvas.focus();
      }
    });
  }

  function setupInput(ci) {
    canvas.style.outline = "none";
    canvas.addEventListener("click", () => canvas.focus());

    // GLFW KBD_KEYS values — what js-dos/dosbox _addKey actually expects.
    // Source: js-dos/dosbox include/keyboard.h (GLFW-based enum, not SDL, not DOS scan codes)
    const CODE_MAP = {
      // Digits (GLFW = ASCII)
      Digit0:48, Digit1:49, Digit2:50, Digit3:51, Digit4:52,
      Digit5:53, Digit6:54, Digit7:55, Digit8:56, Digit9:57,
      // Letters (GLFW = ASCII uppercase)
      KeyA:65, KeyB:66, KeyC:67, KeyD:68, KeyE:69, KeyF:70, KeyG:71,
      KeyH:72, KeyI:73, KeyJ:74, KeyK:75, KeyL:76, KeyM:77, KeyN:78,
      KeyO:79, KeyP:80, KeyQ:81, KeyR:82, KeyS:83, KeyT:84, KeyU:85,
      KeyV:86, KeyW:87, KeyX:88, KeyY:89, KeyZ:90,
      // Symbols (GLFW = ASCII)
      Space:32, Quote:39, Comma:44, Minus:45, Period:46, Slash:47,
      Semicolon:59, Equal:61, BracketLeft:91, Backslash:92, BracketRight:93, Backquote:96,
      // Control keys
      Escape:256, Enter:257, Tab:258, Backspace:259,
      Insert:260, Delete:261,
      // Arrow keys (GLFW: right=262, left=263, down=264, up=265)
      ArrowRight:262, ArrowLeft:263, ArrowDown:264, ArrowUp:265,
      PageUp:266, PageDown:267, Home:268, End:269,
      CapsLock:280, ScrollLock:281, NumLock:282,
      // Modifiers
      ShiftLeft:340, ControlLeft:341, AltLeft:342,
      ShiftRight:344, ControlRight:345, AltRight:346,
      // Function keys
      F1:290, F2:291, F3:292, F4:293, F5:294, F6:295,
      F7:296, F8:297, F9:298, F10:299, F11:300, F12:301,
      // Numpad
      Numpad0:320, Numpad1:321, Numpad2:322, Numpad3:323, Numpad4:324,
      Numpad5:325, Numpad6:326, Numpad7:327, Numpad8:328, Numpad9:329,
      NumpadDecimal:330, NumpadDivide:331, NumpadMultiply:332,
      NumpadSubtract:333, NumpadAdd:334, NumpadEnter:335,
    };

    // WASD → arrow GLFW codes so DOOM movement works without remapping in-game
    CODE_MAP.KeyW = 265; // KBD_up    = forward
    CODE_MAP.KeyS = 264; // KBD_down  = back
    CODE_MAP.KeyA = 263; // KBD_left  = turn left
    CODE_MAP.KeyD = 262; // KBD_right = turn right

    const onKey = (pressed) => (e) => {
      const sc = CODE_MAP[e.code];
      if (sc !== undefined) {
        ci.sendKeyEvent(sc, pressed);
        e.preventDefault();
        e.stopPropagation();
      }
    };
    // Attach to both document (capture) and canvas so keys are never lost.
    document.addEventListener("keydown", onKey(true),  { capture: true });
    document.addEventListener("keyup",   onKey(false), { capture: true });

    canvas.addEventListener("mousemove", e => {
      const r = canvas.getBoundingClientRect();
      ci.sendMouseMotion(
        (e.clientX - r.left) / r.width,
        (e.clientY - r.top) / r.height
      );
    });
    // Keep all mouse buttons out of the browser and into DOSBox.
    // JS MouseEvent.button: 0=left, 1=middle, 2=right. DOSBox: 0=left, 1=right, 2=middle.
    const DOS_BTN = { 0: 0, 1: 2, 2: 1 };
    // A real click's press and release can land inside one emulated frame, which
    // DOS games poll right past — they never see the button held. Keep every
    // press down for at least MIN_HOLD_MS of wall clock before releasing.
    const MIN_HOLD_MS = 90;
    const pressedAt = new Map();

    canvas.addEventListener("mousedown", e => {
      canvas.focus();
      const btn = DOS_BTN[e.button] ?? 0;
      pressedAt.set(btn, performance.now());
      ci.sendMouseButton(btn, true);
      e.preventDefault();
    });
    canvas.addEventListener("mouseup", e => {
      const btn = DOS_BTN[e.button] ?? 0;
      const held = performance.now() - (pressedAt.get(btn) ?? 0);
      pressedAt.delete(btn);
      if (held >= MIN_HOLD_MS) {
        ci.sendMouseButton(btn, false);
      } else {
        setTimeout(() => ci.sendMouseButton(btn, false), MIN_HOLD_MS - held);
      }
      e.preventDefault();
    });
    // Right-click default is "walk forward" in vanilla DOOM — suppress context menu.
    canvas.addEventListener("contextmenu", e => e.preventDefault());
  }

  // Pull the changes bundle out of the running game and stash it. Serialised
  // through `saving` so an interval tick can't overlap a visibilitychange flush
  // (persist() would return the same in-flight promise and we'd double-write).
  let saving = null;
  function saveProgress(ci, reason) {
    if (!PERSIST_ON || saving) return saving || Promise.resolve();
    saving = ci.persist(true)
      .then(bytes => {
        if (!bytes || !bytes.length) return;
        if (bytes.length > MAX_SAVE_BYTES) {
          log(`Save skipped: ${Math.round(bytes.length / 1048576)} MB exceeds the ${MAX_SAVE_BYTES / 1048576} MB limit.`);
          return;
        }
        return idbPut(slug, bytes).then(() => {
          if (saveState) saveState.textContent = "Progress saved in this browser";
          track("persist_save", { bytes: bytes.length, reason });
        });
      })
      .catch(err => log("Save failed: " + err.message))
      .finally(() => { saving = null; });
    return saving;
  }

  async function play() {
    playBtn.disabled = true;
    playBtn.textContent = "Loading…";
    track("play_click");
    const t0 = performance.now();
    try {
      setStatus("Loading DOSBox runtime…");
      await loadEmulators();

      const bundle = await fetchBundle(cfg.appUrl);

      // Layer any previously saved changes over the base game.
      let saved = null;
      if (PERSIST_ON) {
        try {
          saved = await idbGet(slug);
        } catch (err) {
          log("Could not read saved progress: " + err.message);
        }
      }

      setStatus("Starting " + cfg.appName + "…");
      overlay.style.display = "none";

      const ci = await window.emulators.dosDirect(saved ? [bundle, saved] : bundle);
      if (saved) track("persist_restore", { bytes: saved.length });

      setupRenderer(ci);
      setupInput(ci);

      // Expose for mobile gamepad buttons injected by gen-app-pages.mjs
      window.__dosEmitKey = (scanCode, pressed) => ci.sendKeyEvent(scanCode, pressed);
      window.__dosCi = ci; // debugging handle

      if (PERSIST_ON) {
        // Ask for durable storage so the browser is less eager to evict us.
        navigator.storage?.persist?.().catch(() => {});
        saveInfo.hidden = false;
        if (saved) saveState.textContent = "Progress restored from this browser";

        const saveTimer = setInterval(() => saveProgress(ci, "interval"), SAVE_INTERVAL_MS);
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "hidden") saveProgress(ci, "hidden");
        });
        window.addEventListener("pagehide", () => saveProgress(ci, "pagehide"));
        ci.events().onExit(() => clearInterval(saveTimer));

        saveReset.addEventListener("click", async e => {
          e.preventDefault();
          try {
            await idbDel(slug);
            saveState.textContent = "Saved progress cleared — reload to start fresh";
            track("persist_reset");
          } catch (err) {
            log("Could not clear saved progress: " + err.message);
          }
        });
      }

      ci.events().onStdout(msg => log(msg));
      ci.events().onExit(() => {
        stopHeartbeat();
        setStatus(cfg.appName + " exited.");
        overlay.style.display = "flex";
        playBtn.disabled = false;
        playBtn.textContent = "▶ Play " + cfg.appName;
      });

      setStatus("");
      canvas.focus();
      fsBtn.hidden = false;
      window.rememberPlayed?.(slug, cfg.appName);
      track("boot_success", { boot_ms: Math.round(performance.now() - t0) });
      startHeartbeat();

    } catch (err) {
      setStatus("Could not start: " + err.message);
      overlay.style.display = "flex";
      playBtn.disabled = false;
      playBtn.textContent = "▶ Play " + cfg.appName;
      log("Error: " + err.message);
      track("boot_error", { error_message: String(err.message).slice(0, 120) });
    }
  }

  playBtn.addEventListener("click", play);
  if (cfg.autoboot) play();
})();
