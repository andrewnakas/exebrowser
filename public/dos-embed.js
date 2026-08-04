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
    <p style="margin:.5rem 0 0;"><button id="dos-fullscreen" type="button" class="button" hidden>&#9974; Fullscreen</button> <button id="dos-sound" type="button" class="button" hidden aria-pressed="true">&#128266; Sound on</button></p>
    <p id="dos-mouse-speed" class="muted small" style="margin:.4rem 0 0;" hidden><label for="dos-speed">Mouse speed</label> <input type="range" id="dos-speed" min="0.5" max="2.5" step="0.1" value="1" style="vertical-align:middle;width:9rem;"> <span id="dos-speed-val">1.0&times;</span></p>
    <p id="dos-mouse-hint" class="muted small" style="margin:.25rem 0 0;">Click the game screen to capture keyboard &amp; mouse. Press <kbd>Ctrl+F10</kbd> to release mouse.</p>
    <p id="dos-save-info" class="muted small" style="margin:.25rem 0 0;" hidden><span id="dos-save-state">Progress saves in this browser</span> · <a href="#" id="dos-save-reset">reset saved progress</a></p>
    <details id="dos-console" style="margin-top:.5rem;" hidden>
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
  const soundBtn = document.getElementById("dos-sound");
  const mouseHint = document.getElementById("dos-mouse-hint");
  const speedWrap = document.getElementById("dos-mouse-speed");
  const speedInput = document.getElementById("dos-speed");
  const speedVal = document.getElementById("dos-speed-val");

  // Only games that actually use the mouse should grab the pointer — locking
  // it in a keyboard-only game would hide the cursor for no reason. Pages opt
  // in with data-pointer-lock="true".
  const WANTS_POINTER_LOCK = host.dataset.pointerLock === "true";

  // How far DOSBox moves the emulated cursor per unit of relative motion we
  // send. Measured, not guessed: stepping the Scorched Earth cursor from the
  // left wall in +50 unit increments put it at emulated columns 26, 52, 78,
  // 104 and 130 — a flat 0.52 px per unit. Cancelling this is what makes hand
  // movement and cursor movement agree.
  const DOSBOX_GAIN = 0.52;
  // User-facing multiplier on top of 1:1. Some games run their own
  // acceleration, so one number can't feel right everywhere; this is the knob.
  const SPEED_KEY = "exe_mouse_speed";
  const readSpeed = () => {
    try {
      const v = parseFloat(localStorage.getItem(SPEED_KEY));
      return v >= 0.25 && v <= 4 ? v : 1;
    } catch { return 1; }
  };
  let MOUSE_SPEED = readSpeed();

  // Only mouse-driven games get the slider; it would mean nothing elsewhere.
  if (WANTS_POINTER_LOCK && speedWrap && speedInput && speedVal) {
    speedWrap.hidden = false;
    speedInput.value = String(MOUSE_SPEED);
    speedVal.textContent = MOUSE_SPEED.toFixed(1) + "×";
    speedInput.addEventListener("input", () => {
      MOUSE_SPEED = parseFloat(speedInput.value) || 1;
      speedVal.textContent = MOUSE_SPEED.toFixed(1) + "×";
      try { localStorage.setItem(SPEED_KEY, String(MOUSE_SPEED)); } catch { /* private mode */ }
    });
  }

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
    // Entering or leaving fullscreen drops any pointer lock and resizes the
    // canvas. Re-acquire it once the new layout has settled, so a mouse game
    // doesn't silently lose its cursor on the way into fullscreen.
    setTimeout(() => {
      canvas.focus();
      if (WANTS_POINTER_LOCK && !document.pointerLockElement && canvas.requestPointerLock) {
        try { canvas.requestPointerLock(); } catch { /* needs a fresh gesture */ }
      }
    }, 50);
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
    const box = document.getElementById("dos-console");
    if (box) box.hidden = false;
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

  const fmtMB = (n) => (n / 1048576).toFixed(1) + " MB";

  // Progress shown inside the overlay, where the visitor is already looking.
  // Falls back to an indeterminate message when the server doesn't send
  // content-length (our local dev server doesn't, production does).
  function showProgress(received, total, startedAt) {
    const bar = document.getElementById("dos-progress-bar");
    const label = document.getElementById("dos-progress-label");
    if (!bar || !label) return;
    if (total > 0) {
      const pct = Math.min(100, Math.round((received / total) * 100));
      bar.style.width = pct + "%";
      bar.parentElement.setAttribute("aria-valuenow", String(pct));
      // Only estimate once there's enough of a sample to not be nonsense.
      const secs = (performance.now() - startedAt) / 1000;
      let eta = "";
      if (secs > 2.5 && received > 0) {
        const remaining = Math.round(((total - received) / (received / secs)));
        if (remaining > 3) {
          eta = remaining > 90
            ? ` · about ${Math.ceil(remaining / 60)} min left`
            : ` · about ${remaining}s left`;
        }
      }
      label.textContent = `${pct}% — ${fmtMB(received)} of ${fmtMB(total)}${eta}`;
    } else {
      bar.style.width = "100%";
      bar.parentElement.classList.add("indeterminate");
      label.textContent = `Downloading… ${fmtMB(received)} so far`;
    }
  }

  async function fetchBundle(url) {
    setStatus("Downloading " + cfg.appName + "…");
    showLoadingOverlay();
    const startedAt = performance.now();
    const resp = await fetch(url);
    if (!resp.ok) throw new Error("HTTP " + resp.status + " fetching " + url);
    const total = parseInt(resp.headers.get("content-length") || "0", 10);
    const reader = resp.body.getReader();
    const chunks = [];
    let received = 0;
    let lastPaint = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      // Repaint at most ~8x/sec; the read loop fires far more often than that.
      if (performance.now() - lastPaint > 120) {
        lastPaint = performance.now();
        showProgress(received, total, startedAt);
        if (total > 0) {
          setStatus("Downloading " + cfg.appName + "… " + Math.round(received / total * 100) + "%");
        }
      }
    }
    showProgress(received, total || received, startedAt);
    const out = new Uint8Array(received);
    let off = 0;
    for (const c of chunks) { out.set(c, off); off += c.length; }
    return out;
  }

  // ─── Audio ────────────────────────────────────────────────────────────
  //
  // DOSBox has been generating sound all along — the wasm calls
  // emsc_ws_client_sound_push on every audio block. Where those samples go
  // depends on whether an "audio port" exists: with one they're posted
  // straight to an AudioWorklet, without one they fall back to a
  // ws-sound-push message that lands in an empty consumer list and is
  // discarded. We never passed the option that creates the port, so every
  // game ran silently.
  //
  // js-dos can build that port itself (dosDirect's `audioWorklet` option), but
  // we deliberately don't use it, for two reasons. It is hard-pinned to
  // 44100 Hz — on a device that won't give it that rate it logs an error,
  // returns undefined, and you get silence with no exception, and plenty of
  // hardware defaults to 48000. And it hands back a bare MessagePort with no
  // reference to its AudioContext, so there is nothing to attach a volume
  // control to. Driving the samples ourselves off onSoundPush costs a few
  // lines and gives us any sample rate plus a real mute.
  const SOUND_KEY = "exe_sound_on";
  const soundPref = () => {
    try { return localStorage.getItem(SOUND_KEY) !== "0"; } catch { return true; }
  };
  const setSoundPref = (on) => {
    try { localStorage.setItem(SOUND_KEY, on ? "1" : "0"); } catch { /* private mode */ }
  };

  // Pull samples off js-dos's event bus and push them through a
  // ScriptProcessor. ScriptProcessor rather than an AudioWorklet because it
  // accepts whatever rate the device runs at and needs no separate module
  // file; it's deprecated but universally supported, and this is one mono
  // stream, not a mixing graph.
  function startAudio(ci) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    // DOSBox's mixer runs at 44100 (js-dos's own default config sets
    // `[mixer] rate=44100`), and soundFrequency() isn't populated until the
    // emulator sends its sound-init message, which hasn't happened yet at
    // boot. So ask for 44100 up front. A ScriptProcessor does no resampling
    // of its own, so if the device insists on another rate — 48000 is common
    // — we have to convert in the drain loop or everything plays sharp.
    const SRC_RATE = 44100;
    let ctx;
    try {
      ctx = new AC({ sampleRate: SRC_RATE });
    } catch {
      ctx = new AC();   // some browsers reject an explicit rate outright
    }

    // Ring buffer. Sized well above one processor block so normal jitter
    // never underruns, and capped so a stalled tab can't grow it forever.
    const CAP = 32768;
    const ring = new Float32Array(CAP);
    let writeAt = 0, readAt = 0, queued = 0;

    ci.events().onSoundPush((samples) => {
      // Past a couple of blocks of backlog the emulator is ahead of the
      // clock; dropping is better than growing latency, which is what
      // js-dos's own worklet does too.
      if (queued > 8192) { readAt = writeAt; queued = 0; }
      for (let i = 0; i < samples.length; i++) {
        ring[writeAt] = samples[i];
        writeAt = (writeAt + 1) % CAP;
        if (queued < CAP) queued++;
        else readAt = (readAt + 1) % CAP;
      }
    });

    const node = ctx.createScriptProcessor(1024, 0, 1);
    const gain = ctx.createGain();
    // Samples to consume per output frame. 1 when the device gave us 44100;
    // ~1.088 when it runs at 48000, which we cover by stepping through the
    // ring fractionally and interpolating.
    const step = SRC_RATE / ctx.sampleRate;
    let frac = 0;

    const take = () => {
      const v = ring[readAt];
      readAt = (readAt + 1) % CAP;
      queued--;
      return v;
    };

    node.onaudioprocess = (e) => {
      const out = e.outputBuffer.getChannelData(0);
      if (step === 1) {
        for (let i = 0; i < out.length; i++) {
          out[i] = queued > 0 ? take() : 0;
        }
        return;
      }
      // Fractional read: advance by `step` source samples per output sample,
      // dropping whole samples and holding the current one in between. Linear
      // interpolation would need a lookahead the ring can't cheaply give us,
      // and at ~8% the audible difference here is negligible.
      let cur = 0;
      for (let i = 0; i < out.length; i++) {
        if (queued <= 0) { out[i] = 0; continue; }
        cur = take();
        frac += step - 1;
        while (frac >= 1 && queued > 0) { cur = take(); frac -= 1; }
        out[i] = cur;
      }
    };
    // Honour a remembered mute from the start, so a muted visitor never hears
    // a burst of sound before the toggle gets wired up.
    gain.gain.value = soundPref() ? 1 : 0;
    node.connect(gain);
    gain.connect(ctx.destination);

    const resume = () => { if (ctx.state === "suspended") ctx.resume().catch(() => {}); };
    resume();
    document.addEventListener("pointerdown", resume, { capture: true });
    document.addEventListener("keydown", resume, { capture: true });

    log(`Audio: ${Math.round(ctx.sampleRate)} Hz.`);
    return { ctx, gain };
  }

  // Wire the mute button to the gain node, and remember the choice: a visitor
  // who muted once shouldn't have to mute again on the next game.
  function setupSoundToggle(audio) {
    if (!soundBtn || !audio) return;
    let on = soundPref();

    // Show the control straight away. Several games are legitimately silent
    // until you press a key past their title screen — waiting for a non-zero
    // sample before offering a mute button would leave it missing exactly when
    // someone wants to pre-emptively mute.
    soundBtn.hidden = false;

    const apply = () => {
      audio.gain.gain.value = on ? 1 : 0;
      if (on) audio.ctx.resume().catch(() => {});
      soundBtn.textContent = on ? "\u{1F50A} Sound on" : "\u{1F507} Sound off";
      soundBtn.setAttribute("aria-pressed", on ? "true" : "false");
    };

    apply();
    soundBtn.addEventListener("click", () => {
      on = !on;
      setSoundPref(on);
      apply();
      track("sound_toggle", { on: on ? 1 : 0 });
    });
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

    // Mouse motion.
    //
    // Mouse-driven DOS games run their own cursor: they read *movement* from
    // the driver and apply their own sensitivity and acceleration on top. Feed
    // them an absolute position and the two cursors disagree — measured on
    // Scorched Earth, sending 1.0 (far edge) moved its cursor only a third of
    // the way across, and the error grew with distance. There is no single
    // scale factor that fixes this, because each game scales differently.
    //
    // Pointer lock is the correct primitive: the browser hides the system
    // cursor and hands us raw deltas, so the game's cursor becomes *the*
    // cursor and can't disagree with anything. Clicking the screen engages it;
    // Esc releases, which is the same convention every browser game uses.
    let pointerLocked = false;
    // Sub-pixel carry for the fractional deltas trackpads report. DOSBox
    // truncates whatever it is handed, so dropping the remainder every event
    // makes the cursor travel short, with the error growing over a long sweep.
    let accX = 0, accY = 0;
    document.addEventListener("pointerlockchange", () => {
      const wasLocked = pointerLocked;
      pointerLocked = document.pointerLockElement === canvas;
      if (pointerLocked !== wasLocked) accX = accY = 0;
      // Re-seat the emulated cursor on capture, so it starts from a known
      // position instead of wherever it drifted to before the lock.
      if (pointerLocked && ci.sendMouseSync) ci.sendMouseSync();
      if (mouseHint) {
        mouseHint.textContent = pointerLocked
          ? "Mouse captured — press Esc to release it."
          : "Click the game screen to capture keyboard & mouse.";
      }
    });
    // If the browser refuses the lock (user gesture rules, an exiting
    // fullscreen transition), fall back to absolute positioning rather than
    // leaving the game with no motion at all.
    document.addEventListener("pointerlockerror", () => {
      pointerLocked = false;
      accX = accY = 0;
    });

    canvas.addEventListener("mousemove", e => {
      if (pointerLocked) {
        // Move the in-game pointer as far as the hand actually moved.
        //
        // Getting here took measuring rather than reasoning. DOSBox does not
        // treat one unit as one pixel: driving the Scorched Earth cursor from
        // the left wall in +50 unit steps landed it at emulated columns
        // 26, 52, 78, 104, 130 — a steady 26 px per 50 units, so the emulator
        // applies its own ~0.52 gain. On top of that the emulated frame is
        // scaled to fit the stage (720 px wide shown in 640, so 0.889 css px
        // per emulated px).
        //
        // Multiply those and the old code delivered ~0.52 css px of cursor
        // travel per css px of hand movement — the cursor moved at half speed,
        // which is exactly the "crawling across multiple screens" complaint.
        // Cancelling both terms is what makes it 1:1.
        //
        // No devicePixelRatio anywhere: movementX is already in css pixels, so
        // a Retina display must not double it.
        const r = canvas.getBoundingClientRect();
        // css px per emulated px, i.e. how much the frame is zoomed to fit.
        const zoom = canvas.width && r.width ? r.width / canvas.width : 1;
        // Undo the emulator's gain and the zoom, then apply the user's taste.
        const scale = MOUSE_SPEED / (DOSBOX_GAIN * zoom);
        accX += (e.movementX || 0) * scale;
        accY += (e.movementY || 0) * scale;
        // Carry the sub-pixel remainder: trackpads report fractional deltas and
        // DOSBox truncates whatever it is handed, so dropping the remainder
        // every event makes a slow drag cover less ground than a fast one.
        const dx = Math.trunc(accX);
        const dy = Math.trunc(accY);
        accX -= dx;
        accY -= dy;
        if (dx || dy) ci.sendMouseRelativeMotion(dx, dy);
        return;
      }
      // Before capture, absolute positioning at least lets the cursor track
      // roughly, so menus are usable without locking first.
      const r = canvas.getBoundingClientRect();
      if (!r.width || !r.height) return;
      ci.sendMouseMotion((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
    });

    // Click-to-key. Most DOS games of this era ship with the mouse disabled and
    // offer no way to turn it on (Blake Stone's menus are explicitly
    // keyboard-only), so a click lands in the emulator and nothing happens —
    // which reads as broken. Where a page declares data-click-key, a click on
    // the canvas also sends that key, so clicking does the obvious thing: shoot.
    // Pages whose game genuinely reads the mouse (DOOM, Freedoom) omit it.
    const CLICK_KEYS = {
      left:  parseInt(host.dataset.clickKey || "", 10) || 0,
      right: parseInt(host.dataset.clickKeyRight || "", 10) || 0,
    };
    function clickKeyFor(button) {
      if (button === 0) return CLICK_KEYS.left;
      if (button === 2) return CLICK_KEYS.right;
      return 0;
    }

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
      // Games that use the mouse need pointer lock to track it correctly.
      if (WANTS_POINTER_LOCK && !pointerLocked && canvas.requestPointerLock) {
        canvas.requestPointerLock();
      }
      const btn = DOS_BTN[e.button] ?? 0;
      pressedAt.set(btn, performance.now());
      ci.sendMouseButton(btn, true);
      const key = clickKeyFor(e.button);
      if (key) ci.sendKeyEvent(key, true);
      e.preventDefault();
    });
    canvas.addEventListener("mouseup", e => {
      const btn = DOS_BTN[e.button] ?? 0;
      const held = performance.now() - (pressedAt.get(btn) ?? 0);
      const key = clickKeyFor(e.button);
      pressedAt.delete(btn);
      const release = () => {
        ci.sendMouseButton(btn, false);
        if (key) ci.sendKeyEvent(key, false);
      };
      if (held >= MIN_HOLD_MS) release();
      else setTimeout(release, MIN_HOLD_MS - held);
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

  // The overlay is re-rendered when a boot fails, so the play button must be
  // looked up when it's used rather than captured once at startup.
  const currentPlayBtn = () => document.getElementById("dos-play");

  // Swap the play button for a progress bar. Doing this in the overlay (rather
  // than only in the status line below) means the play area stops looking
  // frozen during a multi-megabyte fetch.
  function showLoadingOverlay() {
    overlay.style.display = "flex";
    overlay.innerHTML = `
      <p style="margin:0 0 .6rem;font-weight:600;">Loading ${esc(cfg.appName)}…</p>
      <div class="dos-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
        <div id="dos-progress-bar" class="dos-progress-fill"></div>
      </div>
      <p id="dos-progress-label" class="muted small" style="margin:.5rem 0 0;">Starting…</p>
      <p class="muted small" style="margin:.35rem 0 0;text-align:center;padding:0 1rem;">Cached after the first load, so next time is instant.</p>`;
  }

  async function play() {
    const btn = currentPlayBtn();
    if (btn) { btn.disabled = true; btn.textContent = "Loading…"; }
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

      // Boot without the `audioWorklet` option on purpose — see startAudio.
      const ci = await window.emulators.dosDirect(saved ? [bundle, saved] : bundle);
      if (saved) track("persist_restore", { bytes: saved.length });

      setupRenderer(ci);
      setupInput(ci);
      try {
        // Attach the sound consumer before the game gets far enough to make
        // any: pushes that arrive with no consumer are dropped, not buffered.
        const audio = startAudio(ci);
        setupSoundToggle(audio);
        if (audio) track("audio_start", { rate: Math.round(audio.ctx.sampleRate) });
      } catch (err) {
        // Sound is a nicety — never let it stop a game from booting.
        log("Audio unavailable: " + err.message);
      }

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
        const b = currentPlayBtn();
        if (b) { b.disabled = false; b.textContent = "▶ Play " + cfg.appName; }
      });

      setStatus("");
      canvas.focus();
      fsBtn.hidden = false;
      window.rememberPlayed?.(slug, cfg.appName);
      track("boot_success", { boot_ms: Math.round(performance.now() - t0) });
      startHeartbeat();

    } catch (err) {
      showFailure(err);
      log("Error: " + err.message);
      track("boot_error", { error_message: String(err.message).slice(0, 120) });
    }
  }

  // A failed boot used to surface the raw exception ("HTTP 404 fetching
  // /apps/…"), which tells a player nothing they can act on. Explain the
  // likely cause in plain language and always leave a way forward.
  function explainFailure(err) {
    const m = String(err && err.message || "");
    if (/HTTP 4\d\d/.test(m)) {
      return "We couldn't find this game's files on the server. That's our bug, not yours — it should be fixed shortly.";
    }
    if (/HTTP 5\d\d/.test(m)) {
      return "The server had a problem sending this game. Trying again usually works.";
    }
    if (/NetworkError|Failed to fetch|network|ERR_/i.test(m)) {
      return "The download didn't finish — this is usually a dropped connection. Check your network and try again.";
    }
    if (/WebAssembly|wasm|SharedArrayBuffer|compile/i.test(m)) {
      return "Your browser couldn't start the emulator. This needs a current version of Chrome, Firefox, Edge or Safari.";
    }
    if (/emulators\.js|Failed to load/i.test(m)) {
      return "The emulator itself failed to load. A reload usually clears this.";
    }
    return "Something went wrong starting the game.";
  }

  function showFailure(err) {
    stopHeartbeat();
    overlay.style.display = "flex";
    overlay.innerHTML = `
      <p style="margin:0 0 .75rem;text-align:center;padding:0 1.25rem;max-width:34rem;">${esc(explainFailure(err))}</p>
      <p style="margin:0;display:flex;gap:.5rem;flex-wrap:wrap;justify-content:center;">
        <button id="dos-retry" class="embed-play" type="button">Try again</button>
        <a class="button" href="/run/">Browse other games</a>
      </p>
      <details style="margin-top:.9rem;max-width:34rem;">
        <summary class="muted small" style="text-align:center;cursor:pointer;">Technical details</summary>
        <p class="muted small" style="margin:.4rem 0 0;word-break:break-word;">${esc(String(err && err.message || err))}</p>
      </details>`;
    const retry = document.getElementById("dos-retry");
    if (retry) {
      retry.addEventListener("click", () => {
        // Restore the original overlay so a retry looks like a fresh start.
        overlay.innerHTML = `
          <button id="dos-play" class="embed-play" type="button">&#9654; Play ${esc(cfg.appName)}</button>
          <p class="muted small" style="margin-top:.75rem;text-align:center;padding:0 1rem;">Runs in your browser with DOSBox + WebAssembly.<br>Nothing is uploaded. Runtime (~1.4 MB) is cached after first load.</p>`;
        const fresh = document.getElementById("dos-play");
        fresh.addEventListener("click", play);
        setStatus("");
        track("boot_retry");
        fresh.click();
      });
    }
  }

  playBtn.addEventListener("click", play);
  if (cfg.autoboot) play();
})();
