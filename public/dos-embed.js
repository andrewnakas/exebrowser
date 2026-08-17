(() => {
  "use strict";

  const host = document.getElementById("dos-embed");
  if (!host) return;

  const cfg = {
    appUrl: host.dataset.appUrl || "",
    appName: host.dataset.appName || "this game",
    autoboot: host.dataset.autoboot === "true",
  };

  // The slug keys saved progress in IndexedDB, so an embed that lives outside
  // /run/<slug>/ (the homepage hero) has to name its game explicitly — otherwise
  // it would save under "/" and a player's homepage progress and game-page
  // progress would be two separate, silently diverging worlds.
  const slug = host.dataset.slug
    || (location.pathname.match(/\/run\/([^/]+)/) || [])[1]
    || location.pathname;

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

  // Localised strings for the handful of things this file puts on screen. The
  // generator injects window.__I18N on translated pages only; everywhere else
  // the English default passed in here is what shows, so this file keeps
  // working unchanged on every existing page.
  function T(key, fallback, vars) {
    let s = (window.__I18N && window.__I18N[key]) || fallback;
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.split("{" + k + "}").join(v);
    return s;
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

  // Which titles have been verified to resume mid-game end to end. Declared up
  // here because the resume card, which renders during first paint, needs it —
  // and because a game with no snapshot support should never pay for fetching
  // the snapshot module at all.
  const SNAPSHOT_SLUGS = new Set([
    "doom",
    "keen4",
    "cosmo",
    "scorched-earth",
    "wolfenstein-3d",
    "tyrian",
    "freedoom",
    "commander-keen",
    "raptor",
    "blake-stone",
    "skyroads",
    "jetpack",
    "one-must-fall-2097",
    "xargon",
    "bio-menace",
  ]);
  const snapshotParam = new URLSearchParams(location.search).get("snapshot");
  const SNAPSHOT_POSSIBLE =
    snapshotParam !== "0" && (SNAPSHOT_SLUGS.has(slug) || snapshotParam === "1");
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
        <button id="dos-play" class="embed-play" type="button">${esc(T("play", "▶ Play {name}", { name: cfg.appName }))}</button>
        <p class="muted small" style="margin-top:.75rem;text-align:center;padding:0 1rem;">${T("overlayNote", "Runs in your browser with DOSBox + WebAssembly.<br>Nothing is uploaded. Runtime (~1.4 MB) is cached after first load.")}</p>
      </div>
    </div>
    <p id="dos-status" class="muted small" style="margin:.5rem 0 0;" hidden></p>
    <p style="margin:.5rem 0 0;"><button id="dos-fullscreen" type="button" class="button" hidden>&#9974; Fullscreen</button> <button id="dos-sound" type="button" class="button" hidden aria-pressed="true">&#128266; Sound on</button></p>
    <p id="dos-mouse-hint" class="muted small" style="margin:.25rem 0 0;">${esc(T("mouseHint", "Click the game screen to give it your keyboard."))}</p>
    <p id="dos-save-info" class="muted small" style="margin:.25rem 0 0;" hidden><span id="dos-save-state">${esc(T("saveHint", "Save inside the game and it's kept in this browser"))}</span> · <a href="#" id="dos-save-reset">${esc(T("resetSaves", "reset saved progress"))}</a></p>
    <details id="dos-keys" style="margin-top:.5rem;" hidden>
      <summary class="muted small">Keyboard — remap any key</summary>
      <p class="muted small" style="margin:.5rem 0;">Click a key below, then press the key you'd rather use. Saved in this browser, per game.</p>
      <div id="dos-keys-list" class="dos-keys-list"></div>
      <p style="margin:.5rem 0 0;"><button type="button" class="button" id="dos-keys-reset">Reset to defaults</button></p>
    </details>
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

  // Someone coming back to a game they have progress in shouldn't have to guess
  // whether it survived — so show them the frame they left on and let them
  // click it. DOSBox can't snapshot a running game yet, so what comes back is
  // the game's own save files: the promise here is deliberately "your saved
  // games are here", not "you'll land exactly where you left off".
  //
  // Read from the shared index rather than IndexedDB, because this has to
  // render during first paint. The old code awaited an IndexedDB open before
  // it could even decide what the button said.
  if (PERSIST_ON) {
    const rec = window.SaveCore?.get(slug);
    if (rec && rec.updatedAt) showResumeOverlay(rec);
  }

  function showResumeOverlay(rec) {
    const btn = document.getElementById("dos-play");
    if (!btn) return;
    const art = rec.thumb || `/run/${slug}/screenshot.png`;
    btn.classList.add("embed-play-resume");
    btn.innerHTML =
      `<img src="${esc(art)}" alt="" class="resume-shot" onerror="this.remove()">` +
      `<span>${esc(T("resume", "▶ Resume {name}", { name: cfg.appName }))}</span>`;
    const note = btn.parentElement?.querySelector("p");
    if (!note) return;

    const FILES_COPY = esc(T("filesRestored", "Your saved games are loaded with it — load them from the game's own menu."));
    const SNAPSHOT_COPY = esc(T("snapshotResume", "You'll pick up exactly where you left off, mid-game."));

    function render(body) {
      note.innerHTML =
        `${esc(T("savedAgo", "Saved {when}.", { when: relativeTime(rec.updatedAt) }))} ${body} ` +
        `<a href="#" id="dos-start-over">${esc(T("startOver", "Start over"))}</a>`;
      note.querySelector("#dos-start-over").addEventListener("click", async e => {
        e.preventDefault();
        if (!confirm(T("confirmDelete", "Delete your saved progress in {name}?", { name: cfg.appName }))) return;
        await window.SaveCore?.drop(slug);
        await dropSnapshotRecord(slug);
        location.reload();
      });
    }

    render(FILES_COPY);

    // A full mid-game snapshot justifies a much stronger promise than "your
    // save files are here". Whether one exists is an IndexedDB question, so the
    // card renders on the weaker copy immediately and upgrades when the answer
    // arrives rather than making first paint wait.
    if (SNAPSHOT_POSSIBLE) {
      hasSnapshotRecord(slug)
        .then(yes => { if (yes && note.isConnected) render(SNAPSHOT_COPY); })
        .catch(() => {});
    }
  }

  // Straight at the snapshot store, so the resume card can ask its question
  // without pulling in the whole snapshot module before anyone clicks play.
  function snapshotStore(mode) {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open("exeSaves", 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains("snapshots")) req.result.createObjectStore("snapshots");
      };
      req.onsuccess = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("snapshots")) return reject(new Error("no store"));
        resolve(db.transaction("snapshots", mode).objectStore("snapshots"));
      };
      req.onerror = () => reject(req.error);
    });
  }

  function hasSnapshotRecord(key) {
    return snapshotStore("readonly").then(store => new Promise((resolve, reject) => {
      const req = store.getKey(key);
      req.onsuccess = () => resolve(req.result !== undefined);
      req.onerror = () => reject(req.error);
    })).catch(() => false);
  }

  function dropSnapshotRecord(key) {
    return snapshotStore("readwrite").then(store => new Promise((resolve) => {
      const req = store.delete(key);
      req.onsuccess = req.onerror = () => resolve();
    })).catch(() => {});
  }

  function relativeTime(ts) {
    const mins = Math.round((Date.now() - ts) / 60000);
    if (mins < 2) return T("justNow", "just now");
    if (mins < 60) return T("minutesAgo", "{n} minutes ago", { n: mins });
    const hours = Math.round(mins / 60);
    if (hours < 24) return hours === 1 ? T("anHourAgo", "an hour ago") : T("hoursAgo", "{n} hours ago", { n: hours });
    const days = Math.round(hours / 24);
    return days === 1 ? T("yesterday", "yesterday") : T("daysAgo", "{n} days ago", { n: days });
  }
  const soundBtn = document.getElementById("dos-sound");
  const mouseHint = document.getElementById("dos-mouse-hint");

  // Which games actually read the mouse. Pages still declare this with
  // data-pointer-lock="true" — the name is now historical, but the meaning it
  // encodes ("this game is mouse-driven") is still the useful bit, and it is
  // set on exactly the right pages.
  const MOUSE_GAME = host.dataset.pointerLock === "true";

  // No sensitivity slider any more. It existed because raw deltas had to be
  // scaled by a per-game factor nobody could pin down; now the emulated cursor
  // is steered to the real one, so speed isn't a setting — the pointer is
  // wherever you put it.

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
    const box = document.getElementById("dos-console");
    if (box) box.hidden = false;
  }

  function setStatus(msg) {
    statusEl.hidden = !msg;
    statusEl.textContent = msg;
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error("Failed to load " + src));
      document.head.appendChild(s);
    });
  }

  // The experimental mid-game savestate. Nothing is fetched, and no page pays
  // for it, unless ?snapshot=1 is set on an allowlisted game.
  let snapshotOn = false;

  async function loadSnapshotModule() {
    if (!SNAPSHOT_POSSIBLE) return false;
    if (!window.DosSnapshot) {
      try { await loadScript("/dos-snapshot.js?v=2"); }
      catch (err) { log("Snapshot module unavailable: " + err.message); return false; }
    }
    return !!window.DosSnapshot?.enabled(slug);
  }

  async function loadEmulators() {
    if (window.emulators) return;
    await loadScript("/dosbox/emulators.js");
    // Same emulators.js either way; only the DOSBox glue differs, and the
    // patched copy shares the (immutable, already-cached) wasm with /dosbox/.
    window.emulators.pathPrefix = snapshotOn ? window.DosSnapshot.pathPrefix : "/dosbox/";
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

    // Per-game remapping, layered over the defaults above. Stored as
    // { "KeyW": 265, … } under one key per game, so rebinding Cosmo doesn't
    // change DOOM.
    const BIND_KEY = "exe_binds_" + slug;
    function loadBinds() {
      try {
        const raw = JSON.parse(localStorage.getItem(BIND_KEY) || "{}");
        const out = {};
        // Trust nothing from storage: only known key names mapping to numbers.
        for (const [code, sc] of Object.entries(raw)) {
          if (code in CODE_MAP && typeof sc === "number" && sc >= 0 && sc <= 400) out[code] = sc;
        }
        return out;
      } catch { return {}; }
    }
    let binds = loadBinds();
    // Declared up here because onKey closes over it and is attached before the
    // rebinding UI below is built.
    let capturing = null;   // the game key awaiting a replacement keypress
    function saveBinds() {
      try { localStorage.setItem(BIND_KEY, JSON.stringify(binds)); } catch { /* private mode */ }
    }
    // The map actually consulted at keypress time.
    const effective = () => Object.assign({}, CODE_MAP, binds);
    let ACTIVE = effective();

    // Keys the browser and the OS want for themselves. Letting these through
    // means Cmd+W closes the tab mid-game and Ctrl+A selects the page behind
    // the canvas — so while the game has focus we swallow them, except for the
    // few a person genuinely needs (reload, devtools, tab switching, quit).
    const OS_SAFE = new Set(["KeyR", "KeyT", "KeyW", "KeyQ", "KeyN", "KeyI", "KeyJ"]);

    const onKey = (pressed) => (e) => {
      // Never fight the browser when the game doesn't have focus, or when the
      // person is typing into the rebinding UI.
      if (!gameHasFocus()) return;

      if (capturing) { if (pressed) captureKey(e); e.preventDefault(); e.stopPropagation(); return; }

      const sc = ACTIVE[e.code];

      // Modifier combinations. A DOS game wants plain Ctrl as a fire button,
      // but Cmd+W and Ctrl+W are the browser's. Pass the bare modifier through
      // to the game and swallow the combination, so holding Ctrl to shoot
      // never trips a shortcut — unless it's one of the few we deliberately
      // leave alone so the tab stays escapable.
      if (e.metaKey || e.ctrlKey || e.altKey) {
        const isBareModifier = /^(Control|Shift|Alt|Meta)(Left|Right)$/.test(e.code);
        if (isBareModifier) {
          if (sc !== undefined) ci.sendKeyEvent(sc, pressed);
          // Don't preventDefault a lone modifier: on macOS that can wedge the
          // key's own state in the browser.
          return;
        }
        if (e.metaKey && OS_SAFE.has(e.code)) return;   // let Cmd+R, Cmd+W, … work
        if (sc !== undefined) ci.sendKeyEvent(sc, pressed);
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      if (sc !== undefined) {
        ci.sendKeyEvent(sc, pressed);
        e.preventDefault();
        e.stopPropagation();
      }
    };

    // Only claim the keyboard when the game is the thing being used. Without
    // this the capture-phase listener would eat keystrokes meant for the page.
    function gameHasFocus() {
      const a = document.activeElement;
      if (a === canvas) return true;
      // Treat the whole embed as "the game" so the fullscreen and sound
      // buttons don't drop keyboard control the moment they're clicked.
      return !!(a && host.contains(a) && a.tagName !== "INPUT" && a.tagName !== "SELECT");
    }

    // Attach to both document (capture) and canvas so keys are never lost.
    document.addEventListener("keydown", onKey(true),  { capture: true });
    document.addEventListener("keyup",   onKey(false), { capture: true });

    // ── Rebinding UI ──────────────────────────────────────────────────────
    //
    // The keys worth offering are the ones DOS games actually use. Pages
    // describe their controls in prose ("Arrow keys", "Ctrl"), which isn't
    // machine-readable, so rather than parse that we expose a fixed set that
    // covers every game the same way. Rebinding "Ctrl" here means "when I
    // press this key on my keyboard, send Ctrl to the game".
    const REBINDABLE = [
      ["ArrowUp", "Up"], ["ArrowDown", "Down"], ["ArrowLeft", "Left"], ["ArrowRight", "Right"],
      ["ControlLeft", "Ctrl"], ["AltLeft", "Alt"], ["ShiftLeft", "Shift"], ["Space", "Space"],
      ["Enter", "Enter"], ["Escape", "Esc"], ["Tab", "Tab"],
    ];
    const keysPanel = document.getElementById("dos-keys");
    const keysList = document.getElementById("dos-keys-list");
    // Which physical key currently drives a given game key. With no override
    // that's the key itself; a rebind points some other physical key at it.
    function physicalFor(target) {
      const want = CODE_MAP[target];
      for (const [code, sc] of Object.entries(binds)) if (sc === want) return code;
      return binds[target] === undefined ? target : null;
    }

    const PRETTY = {
      ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→",
      ControlLeft: "Ctrl", ControlRight: "Right Ctrl", AltLeft: "Alt", AltRight: "Right Alt",
      ShiftLeft: "Shift", ShiftRight: "Right Shift", Space: "Space", Enter: "Enter",
      Escape: "Esc", Tab: "Tab", Backspace: "Backspace",
    };
    const pretty = (code) =>
      PRETTY[code] || (code || "").replace(/^Key|^Digit|^Numpad/, "") || "—";

    function renderKeys() {
      if (!keysList) return;
      keysList.innerHTML = "";
      for (const [target, label] of REBINDABLE) {
        const row = document.createElement("div");
        row.className = "dos-key-row";
        const name = document.createElement("span");
        name.textContent = label;
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "button dos-key-btn";
        const phys = physicalFor(target);
        btn.textContent = capturing === target ? "press a key…" : pretty(phys);
        btn.setAttribute("aria-label", `Change the key for ${label}`);
        btn.addEventListener("click", () => {
          capturing = capturing === target ? null : target;
          renderKeys();
          canvas.focus();   // so the next keypress is ours to catch
        });
        row.append(name, btn);
        keysList.appendChild(row);
      }
    }

    // Called from onKey while a slot is armed.
    function captureKey(e) {
      const target = capturing;
      capturing = null;
      if (!target) return;
      if (e.code === "Escape") { renderKeys(); return; }   // Esc cancels
      if (!(e.code in CODE_MAP)) { renderKeys(); return; } // unknown key, ignore
      // Clear any previous binding that pointed at this game key, then point
      // the newly pressed physical key at it.
      const want = CODE_MAP[target];
      for (const [code, sc] of Object.entries(binds)) if (sc === want) delete binds[code];
      if (e.code !== target) binds[e.code] = want;
      // If the pressed key had its own meaning, it now sends this instead —
      // that is the point of a rebind, so don't try to preserve both.
      saveBinds();
      ACTIVE = effective();
      renderKeys();
    }

    if (keysPanel) {
      keysPanel.hidden = false;
      renderKeys();
      document.getElementById("dos-keys-reset").addEventListener("click", () => {
        binds = {};
        saveBinds();
        ACTIVE = effective();
        capturing = null;
        renderKeys();
      });
    }

    // Mouse motion.
    //
    // This used to hide the system cursor with Pointer Lock and feed the game
    // raw deltas, on the theory that one cursor can't disagree with itself.
    // It worked, but it never felt right: with nothing on screen to aim with,
    // any mismatch between hand movement and cursor movement reads as the
    // game being sluggish or slippery, and no single sensitivity fixed it
    // because every DOS game scales driver input differently.
    //
    // Keeping the real cursor visible and making the game's cursor meet it is
    // both simpler and self-correcting. You aim with the pointer you can see.
    if (mouseHint) {
      mouseHint.textContent = T("mouseHint", "Click the game screen to give it your keyboard.");
    }

    // Drive the game's cursor to sit under the real one.
    //
    // The system cursor stays visible and is the thing you aim with; the
    // emulated cursor is steered to meet it. That removes the whole class of
    // "the two cursors disagree" problems, because there is only one cursor
    // you're actually looking at and the other one chases it.
    //
    // Why not absolute positioning, which is exactly this in one call?
    // Because sendMouseMotion doesn't land where you ask. Measured on Scorched
    // Earth: asking for x=0.9 (648 px into a 720 px frame) put the cursor at
    // column 292, about 45% of the way. DOS games apply their own scaling to
    // whatever the driver reports, so the absolute position is re-scaled on
    // arrival and the request is only ever a suggestion.
    //
    // So: track where the emulated cursor actually is by dead reckoning — we
    // know how far each relative delta moves it, because we measured the gain —
    // and each frame send the delta that closes the gap between there and the
    // real pointer. Errors self-correct rather than accumulating: any drift
    // just becomes part of the next correction.
    let emuX = null, emuY = null;   // believed cursor position, in emulated px
    let wantX = 0, wantY = 0;       // where the real pointer is, in emulated px
    let haveTarget = false;

    // Emulated pixels the cursor travels per unit of relative motion we send.
    // Measured by stepping the cursor from a wall in +50 unit increments and
    // watching which column it landed on. It varies by game, so treat it as a
    // starting estimate that the closed loop can tolerate being wrong about.
    const GAIN = 0.52;

    function pointerToEmulated(e) {
      const r = canvas.getBoundingClientRect();
      if (!r.width || !r.height) return null;
      const fx = (e.clientX - r.left) / r.width;
      const fy = (e.clientY - r.top) / r.height;
      return [fx * canvas.width, fy * canvas.height];
    }

    canvas.addEventListener("mousemove", e => {
      const p = pointerToEmulated(e);
      if (!p) return;
      wantX = p[0];
      wantY = p[1];
      haveTarget = true;
      // Seed the belief at the middle of the screen, which is where a DOS mouse
      // driver parks its cursor at startup. Seeding it at the pointer instead
      // would make the loop think it had already arrived and never move.
      if (emuX === null) {
        emuX = canvas.width / 2;
        emuY = canvas.height / 2;
      }
    });

    // Correct on a timer rather than per mousemove. A fast sweep fires dozens
    // of events between frames, and answering each one floods the emulator with
    // deltas it hasn't applied yet — which is what made the cursor lag behind
    // and overshoot. One correction per frame keeps it locked on.
    let chasing = false;
    function chase() {
      if (!haveTarget || emuX === null) return;
      const errX = wantX - emuX;
      const errY = wantY - emuY;
      // Sub-pixel error isn't worth a message; DOSBox would truncate it anyway.
      if (Math.abs(errX) < 0.5 && Math.abs(errY) < 0.5) return;
      const dx = Math.round(errX / GAIN);
      const dy = Math.round(errY / GAIN);
      if (!dx && !dy) return;
      ci.sendMouseRelativeMotion(dx, dy);
      // Dead reckoning: assume it moved as far as we asked. If the real gain
      // differs the next tick simply sees a smaller error and corrects again.
      emuX += dx * GAIN;
      emuY += dy * GAIN;
      // The game clamps its cursor at the screen edge. Clamp our belief the
      // same way, or pushing into a corner would run the estimate off past the
      // boundary and leave it wrong by however far it overshot.
      emuX = Math.max(0, Math.min(canvas.width, emuX));
      emuY = Math.max(0, Math.min(canvas.height, emuY));
    }
    function startChasing() {
      if (chasing) return;
      chasing = true;
      const tick = () => {
        if (!chasing) return;
        chase();
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }
    // Only for games that read the mouse. Steering a cursor a keyboard-only
    // game never draws would just be a stream of pointless messages.
    if (MOUSE_GAME) startChasing();

    // A game that repaints can move its own cursor (menus, mode switches), and
    // a resize changes the mapping. Re-seat the belief so the loop doesn't
    // spend a second dragging from a stale position.
    window.addEventListener("resize", () => { emuX = wantX; emuY = wantY; });

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

  // Walk the emulated filesystem and pull out the files the game wrote.
  //
  // This used to call `ci.persist(true)`, on the assumption that the argument
  // asked for a changes-only bundle. It does not: this js-dos build returns
  // **null** for persist(true) and a full ~5 MB filesystem image for
  // persist(false). Null failed the `!bytes.length` guard, so every DOS save
  // silently did nothing — the interval fired, the code took the early return,
  // and no one saw an error.
  //
  // Enumerating instead is better than storing the 5 MB image anyway: a save
  // is a handful of small files, and the game's own data (DOOM1.WAD alone is
  // 4 MB) is already on the server. We keep files that appear or change after
  // boot, which is exactly savegames, configs and high-score tables.
  // There are two ways to do the walk.
  //
  // The fast one goes straight at the Emscripten Module behind the
  // CommandInterface — `dosDirect` keeps it on the transport — and stats files
  // synchronously. MEMFS stamps `mtime` on every write, so a pass costs
  // nothing when nothing changed, and no file is read that didn't change.
  //
  // The slow one is the public fsTree/fsReadFile API, kept for any build where
  // the Module isn't reachable (a worker transport, a future js-dos). There the
  // tree reports only a size, and **a savegame written over in place is almost
  // always the same size as before** — which is exactly what the old code
  // compared. Saving over slot 1 a second time was invisible to it and never
  // persisted. So the fallback hashes the bytes of small files instead.
  const SKIP_DIRS = ["/.jsdos/"];
  const FS_HOME = "/home/web_user";
  const HASH_MAX_BYTES = 2 * 1024 * 1024; // savegames are small; game data isn't ours to store
  const baselineSig = new Map();

  const moduleOf = (ci) => ci && ci.transport && ci.transport.module;
  const fsOf = (ci) => moduleOf(ci)?.FS || null;

  function flattenTree(node, path, out) {
    if (!node) return out;
    const here = path + "/" + (node.name || "");
    if (node.nodes) node.nodes.forEach(child => flattenTree(child, here, out));
    // A trailing "/." from the tree root would break fsReadFile's path lookup.
    else out.push({ path: here.replace(/^\/\.\//, "/"), size: node.size || 0 });
    return out;
  }

  // Change detection without reading: mtime alone would miss two writes inside
  // the same millisecond, size alone misses an in-place overwrite. Together
  // they're what the 64-bit launcher already uses for the same job.
  function walkFS(fs, dir, out) {
    let names;
    try { names = fs.readdir(dir); } catch { return out; }
    for (const name of names) {
      if (name === "." || name === "..") continue;
      const full = dir + "/" + name;
      let st;
      try { st = fs.stat(full); } catch { continue; }
      const rel = full.slice(FS_HOME.length);
      if (fs.isDir(st.mode)) {
        if (!SKIP_DIRS.some(d => (rel + "/").includes(d))) walkFS(fs, full, out);
      } else if (fs.isFile(st.mode)) {
        if (SKIP_DIRS.some(d => rel.includes(d))) continue;
        const mtime = st.mtime instanceof Date ? st.mtime.getTime() : Number(st.mtime) || 0;
        out.push({ path: rel, sig: mtime + ":" + st.size });
      }
    }
    return out;
  }

  // Not a cryptographic hash and doesn't need to be — the only question is
  // "are these bytes the ones I saw last time".
  function fnv1a(bytes) {
    let h = 0x811c9dc5;
    for (let i = 0; i < bytes.length; i++) {
      h ^= bytes[i];
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h.toString(36);
  }

  async function listFiles(ci) {
    const fs = fsOf(ci);
    if (fs) return walkFS(fs, FS_HOME, []);

    const files = flattenTree(await ci.fsTree(), "", [])
      .filter(f => !SKIP_DIRS.some(d => f.path.includes(d)));
    for (const f of files) {
      if (f.size > HASH_MAX_BYTES) { f.sig = "big:" + f.size; continue; }
      try {
        const bytes = await ci.fsReadFile(f.path);
        f.bytes = bytes;
        f.sig = f.size + ":" + fnv1a(bytes || new Uint8Array(0));
      } catch {
        f.sig = "err:" + f.size;
      }
    }
    return files;
  }

  function readFile(ci, path) {
    const fs = fsOf(ci);
    if (fs) return fs.readFile(FS_HOME + path, { encoding: "binary" });
    return ci.fsReadFile(path);
  }

  // Everything present at boot is base game data, so anything that appears
  // later — or changes — is the player's.
  async function recordBaseline(ci) {
    baselineSig.clear();
    try {
      for (const f of await listFiles(ci)) baselineSig.set(f.path, f.sig);
    } catch (err) {
      log("Could not index game files: " + err.message);
    }
  }

  // Everything we've written for this slug so far this session, keyed by path.
  // This has to be cumulative: each save writes the *whole* record, so building
  // it from only the files that changed since the last save would drop every
  // file saved before it — an earlier savegame would quietly disappear the
  // first time the game touched its config file.
  let storedFiles = {};

  // True once this session has resumed mid-game from a snapshot, which changes
  // what the save line is allowed to say.
  let resumedFromSnapshot = false;

  let saving = null;
  function saveProgress(ci, reason) {
    if (!PERSIST_ON || saving) return saving || Promise.resolve();
    saving = (async () => {
      const changed = [];
      for (const f of await listFiles(ci)) {
        if (baselineSig.get(f.path) === f.sig) continue;
        const bytes = f.bytes || await readFile(ci, f.path);
        if (!bytes || !bytes.length) continue;
        changed.push({ path: f.path, sig: f.sig, bytes });
      }
      if (!changed.length) return;

      const merged = Object.assign({}, storedFiles);
      for (const f of changed) merged[f.path] = f.bytes;

      let total = 0;
      for (const bytes of Object.values(merged)) total += bytes.length;
      if (total > MAX_SAVE_BYTES) {
        log(`Save skipped: over the ${MAX_SAVE_BYTES / 1048576} MB limit.`);
        return;
      }

      await idbPut(slug, merged);
      storedFiles = merged;
      // Re-baseline so an unchanged file isn't re-read every 15 seconds.
      for (const f of changed) baselineSig.set(f.path, f.sig);
      // Don't talk over the stronger promise: if this session resumed from a
      // snapshot, "progress saved" is a downgrade of what the player was told.
      if (saveState && !resumedFromSnapshot) saveState.textContent = T("progressSaved", "Progress saved in this browser");

      window.SaveCore?.note({
        slug,
        name: cfg.appName,
        runtime: "dosbox",
        kind: "files",
        payload: { db: DB_NAME, store: STORE, key: slug },
        bytes: total,
        thumb: window.SaveCore.thumbFromCanvas(canvas),
      });
      track("persist_save", { bytes: total, files: changed.length, reason });
    })()
      .catch(err => log("Save failed: " + err.message))
      .finally(() => { saving = null; });
    return saving;
  }

  // If save-core.js didn't load (a stale cached page, a hand-written embed),
  // fall back to the flush policy this file used to carry itself. Saving is
  // more important than saving *tidily*.
  function legacyFlusher(ci) {
    const timer = setInterval(() => saveProgress(ci, "interval"), SAVE_INTERVAL_MS);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") saveProgress(ci, "hidden");
    });
    window.addEventListener("pagehide", () => saveProgress(ci, "pagehide"));
    return {
      flushNow: (reason) => saveProgress(ci, reason),
      stop: () => clearInterval(timer),
    };
  }

  // Write stored files back into the booted game. Done after boot rather than
  // layered into dosDirect because what we store is a path->bytes map, not a
  // bundle the loader understands.
  async function restoreProgress(ci, files) {
    const fs = fsOf(ci);
    let restored = 0;
    for (const [path, bytes] of Object.entries(files || {})) {
      try {
        if (fs) {
          const full = FS_HOME + path;
          const dir = full.slice(0, full.lastIndexOf("/"));
          try { fs.mkdirTree(dir); } catch { /* already there */ }
          fs.writeFile(full, bytes);
        } else {
          await ci.fsWriteFile(path, bytes);
        }
        restored++;
      } catch (err) {
        log(`Could not restore ${path}: ${err.message}`);
      }
    }
    return restored;
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
      <p style="margin:0 0 .6rem;font-weight:600;">${esc(T("loadingGame", "Loading {name}…", { name: cfg.appName }))}</p>
      <div class="dos-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
        <div id="dos-progress-bar" class="dos-progress-fill"></div>
      </div>
      <p id="dos-progress-label" class="muted small" style="margin:.5rem 0 0;">${esc(T("starting", "Starting…"))}</p>
      <p class="muted small" style="margin:.35rem 0 0;text-align:center;padding:0 1rem;">${esc(T("cachedNote", "Cached after the first load, so next time is instant."))}</p>`;
  }

  async function play() {
    const btn = currentPlayBtn();
    if (btn) { btn.disabled = true; btn.textContent = T("loading", "Loading…"); }
    track("play_click");
    const t0 = performance.now();
    try {
      setStatus("Loading DOSBox runtime…");
      snapshotOn = await loadSnapshotModule();
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
      const ci = await window.emulators.dosDirect(bundle);

      // Index the untouched filesystem before writing anything into it, so the
      // baseline is the base game and not the base game plus the restore.
      if (PERSIST_ON) await recordBaseline(ci);

      // Saved files are written in after boot rather than layered into
      // dosDirect: what we store is a path->bytes map, not a bundle the loader
      // knows how to merge. Older saves are raw byte arrays from the previous
      // (broken) format and are ignored — there is nothing recoverable in them.
      let restoredCount = 0;
      resumedFromSnapshot = false;

      // A snapshot supersedes the file restore: it already contains the files,
      // and layering the saved ones on top would contradict the heap.
      if (snapshotOn) {
        window.DosSnapshot.recordBaseline(ci);
        if (await window.DosSnapshot.has(slug)) {
          try {
            setStatus("Restoring where you left off…");
            await window.DosSnapshot.restore(ci, slug);
            resumedFromSnapshot = true;
          } catch (err) {
            // Do not carry on with this instance: a failed restore leaves a
            // half-overwritten heap, and a game that runs and is subtly wrong
            // is worse than one that plainly starts again. Stand down for the
            // session and reload into the ordinary boot.
            log("Snapshot restore failed: " + err.message);
            track("snapshot_restore_fallback", { error_message: String(err.message).slice(0, 120) });
            window.DosSnapshot.standDown(slug);
            await window.DosSnapshot.drop(slug).catch(() => {});
            try { ci.exit(); } catch { /* already gone */ }
            location.reload();
            return;
          }
        }
      }

      if (!resumedFromSnapshot && saved && typeof saved === "object" && !ArrayBuffer.isView(saved)) {
        // Seed the cumulative map with what was already on disk, so the next
        // save writes these back out alongside whatever changes next.
        storedFiles = saved;
        restoredCount = await restoreProgress(ci, saved);
        if (restoredCount) {
          // Re-index, or every restored file would read as "changed" on the
          // next tick and be written straight back out.
          await recordBaseline(ci);
          track("persist_restore", { files: restoredCount });
        }
      }

      setupRenderer(ci);
      setupInput(ci);

      // The renderer only exists now, so this is the first moment the restored
      // picture can actually reach the canvas.
      if (resumedFromSnapshot) window.DosSnapshot.present(ci);
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

      // Expose for the mobile gamepad and on-screen keyboard injected by
      // gen-app-pages.mjs.
      //
      // A tap is far shorter than it looks. The press and release of a quick
      // touch can land inside a single emulated frame, and a DOS game polling
      // the keyboard once a frame never sees the key down at all — so the
      // button appears dead. This is the same failure the mouse had before it
      // got a minimum hold; the keyboard path never got one, which is why
      // tapping FIRE in Tyrian did nothing while holding it worked.
      //
      // Every press is therefore held for at least MIN_HOLD_MS of wall clock,
      // and presses on the same key are serialised behind the previous
      // release. Serialising matters for rapid tapping: without it a pending
      // release lands in the middle of the *next* press and cuts it short.
      const KEY_MIN_HOLD_MS = 90;
      const keyDownAt = new Map();
      const keyChain = new Map();
      const wait = (ms) => new Promise(r => setTimeout(r, ms));

      window.__dosEmitKey = (scanCode, pressed) => {
        const prev = keyChain.get(scanCode) || Promise.resolve();
        const next = prev.then(async () => {
          if (pressed) {
            keyDownAt.set(scanCode, performance.now());
            ci.sendKeyEvent(scanCode, true);
            return;
          }
          const downAt = keyDownAt.get(scanCode);
          keyDownAt.delete(scanCode);
          const held = downAt === undefined ? KEY_MIN_HOLD_MS : performance.now() - downAt;
          if (held < KEY_MIN_HOLD_MS) await wait(KEY_MIN_HOLD_MS - held);
          ci.sendKeyEvent(scanCode, false);
        });
        // A thrown link must not wedge the chain for that key forever.
        keyChain.set(scanCode, next.catch(() => {}));
      };
      window.__dosCi = ci; // debugging handle

      if (PERSIST_ON) {
        // Ask for durable storage so the browser is less eager to evict us.
        navigator.storage?.persist?.().catch(() => {});
        saveInfo.hidden = false;
        if (restoredCount) {
          saveState.textContent =
            `Restored ${restoredCount} saved file${restoredCount === 1 ? "" : "s"} — load from the game's own menu`;
        }

        const flusher = window.SaveCore
          ? window.SaveCore.schedule({
              intervalMs: SAVE_INTERVAL_MS,
              flush: (reason) => saveProgress(ci, reason),
            })
          : legacyFlusher(ci);

        // Quitting to the DOS prompt is the one moment a player is most likely
        // to have just saved, and it was the one moment we didn't write: the
        // old handler cleared the timer and nothing else. Flushing first is
        // safe — onExit fires from `ws-exit`, and the filesystem isn't torn
        // down until a later `wc-exit`.
        ci.events().onExit(() => {
          flusher.flushNow("exit").finally(() => flusher.stop());
        });

        saveReset.addEventListener("click", async e => {
          e.preventDefault();
          try {
            await (window.SaveCore ? window.SaveCore.drop(slug) : idbDel(slug));
            // Resetting has to take the snapshot too, or "start fresh" would
            // drop the save files and then resume straight back into the game.
            await dropSnapshotRecord(slug);
            storedFiles = {};
            saveState.textContent = T("savesCleared", "Saved progress cleared — reload to start fresh");
            track("persist_reset");
          } catch (err) {
            log("Could not clear saved progress: " + err.message);
          }
        });
      }

      if (snapshotOn) {
        // Taking a snapshot holds the emulator still for ~200ms, which is a
        // visible hitch if it happens while someone is playing. So the real
        // trigger is leaving — SaveCore.schedule fires this on
        // visibilitychange-hidden and pagehide, which is exactly the moment
        // worth capturing, and a pause nobody is looking at costs nothing. The
        // interval is only a backstop for a tab that dies without warning.
        // The file-level save keeps running at its usual pace alongside, and
        // is what the player falls back on if any of this misbehaves.
        const snapFlusher = window.SaveCore.schedule({
          intervalMs: 300000,
          flush: async (reason) => {
            try {
              const r = await window.DosSnapshot.capture(ci, slug, reason);
              if (r) {
                log(`Snapshot: ${(r.bytes / 1048576).toFixed(1)} MB (${reason})`);
                // Register it, or a game whose only save is a snapshot never
                // shows a resume card: the card reads the shared index, and
                // until now only the file-level save wrote to it.
                window.SaveCore?.note({
                  slug,
                  name: cfg.appName,
                  runtime: "dosbox",
                  kind: "snapshot",
                  payload: { db: "exeSaves", store: "snapshots", key: slug },
                  bytes: r.bytes,
                  thumb: window.SaveCore.thumbFromCanvas(canvas),
                });
                track("snapshot_save", { bytes: r.bytes, files: r.files, reason });
              }
            } catch (err) {
              log("Snapshot failed: " + err.message);
              track("snapshot_save_error", { error_message: String(err.message).slice(0, 120) });
            }
          },
        });
        ci.events().onExit(() => snapFlusher.stop());

        if (resumedFromSnapshot) {
          saveState.textContent = T("resumedExactly", "Resumed exactly where you left off");
          // Prove it kept running. Two false starts here, both worth naming:
          // counting *colours* rejects Commander Keen's five-colour EGA screen,
          // and counting *frames* rejects Scorched Earth, which emits none at
          // all while running normally because its screen is static and DOSBox
          // only sends scanlines that changed. What actually distinguishes a
          // live emulator from a wedged one is whether it is still executing.
          const progress0 = window.DosSnapshot.progress(ci);
          let framesSeen = 0;
          ci.events().onFrame(() => { framesSeen++; });
          setTimeout(() => {
            const advanced = window.DosSnapshot.progress(ci) > progress0;
            if (advanced || framesSeen > 0) {
              track("snapshot_restore_ok", { boot_ms: Math.round(performance.now() - t0), frames: framesSeen });
              return;
            }
            log("Snapshot resumed but the emulator stopped executing — falling back.");
            track("snapshot_restore_fallback", { error_message: "no progress" });
            window.DosSnapshot.standDown(slug);
            window.DosSnapshot.drop(slug).catch(() => {});
            try { ci.exit(); } catch { /* already gone */ }
            location.reload();
          }, 1500);
        }
      }

      ci.events().onStdout(msg => log(msg));
      ci.events().onExit(() => {
        stopHeartbeat();
        setStatus(cfg.appName + " exited.");
        overlay.style.display = "flex";
        const b = currentPlayBtn();
        if (b) { b.disabled = false; b.textContent = T("play", "▶ Play {name}", { name: cfg.appName }); }
      });

      setStatus("");
      canvas.focus();
      fsBtn.hidden = false;
      window.SaveCore?.markPlayed(slug, cfg.appName, "dosbox");
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
          <button id="dos-play" class="embed-play" type="button">${esc(T("play", "▶ Play {name}", { name: cfg.appName }))}</button>
          <p class="muted small" style="margin-top:.75rem;text-align:center;padding:0 1rem;">${T("overlayNote", "Runs in your browser with DOSBox + WebAssembly.<br>Nothing is uploaded. Runtime (~1.4 MB) is cached after first load.")}</p>`;
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
