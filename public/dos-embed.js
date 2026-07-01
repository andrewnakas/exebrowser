(() => {
  "use strict";

  const host = document.getElementById("dos-embed");
  if (!host) return;

  const cfg = {
    appUrl: host.dataset.appUrl || "",
    appName: host.dataset.appName || "this game",
    autoboot: host.dataset.autoboot === "true",
  };

  function esc(s) {
    return String(s).replace(/[&<>"']/g, c =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }

  host.innerHTML = `
    <div style="position:relative;width:100%;max-width:640px;margin:0 auto;background:#000;aspect-ratio:4/3;">
      <canvas id="dos-canvas" tabindex="0"
        style="display:block;width:100%;height:100%;image-rendering:pixelated;"
        oncontextmenu="return false;"></canvas>
      <div id="dos-overlay" style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;background:rgba(0,0,0,.85);">
        <button id="dos-play" class="embed-play" type="button">&#9654; Play ${esc(cfg.appName)}</button>
        <p class="muted small" style="margin-top:.75rem;text-align:center;padding:0 1rem;">Runs in your browser with DOSBox + WebAssembly.<br>Nothing is uploaded. Runtime (~1.4 MB) is cached after first load.</p>
      </div>
    </div>
    <p id="dos-status" class="muted small" style="margin:.5rem 0 0;" hidden></p>
    <p class="muted small" style="margin:.25rem 0 0;">Click the game screen to capture keyboard &amp; mouse. Press <kbd>Ctrl+F10</kbd> to release mouse.</p>
    <details style="margin-top:.5rem;">
      <summary class="muted small">Console output</summary>
      <pre id="dos-log" style="font-size:.7rem;max-height:8rem;overflow:auto;background:#111;padding:.5rem;"></pre>
    </details>
  `;

  const overlay  = document.getElementById("dos-overlay");
  const playBtn  = document.getElementById("dos-play");
  const statusEl = document.getElementById("dos-status");
  const canvas   = document.getElementById("dos-canvas");
  const logEl    = document.getElementById("dos-log");

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
    canvas.addEventListener("mousedown", e => {
      canvas.focus();
      ci.sendMouseButton(e.button, true);
      e.preventDefault();
    });
    canvas.addEventListener("mouseup", e => {
      ci.sendMouseButton(e.button, false);
      e.preventDefault();
    });
    // Right-click default is "walk forward" in vanilla DOOM — suppress context menu.
    canvas.addEventListener("contextmenu", e => e.preventDefault());
  }

  async function play() {
    playBtn.disabled = true;
    playBtn.textContent = "Loading…";
    try {
      setStatus("Loading DOSBox runtime…");
      await loadEmulators();

      const bundle = await fetchBundle(cfg.appUrl);

      setStatus("Starting " + cfg.appName + "…");
      overlay.style.display = "none";

      const ci = await window.emulators.dosDirect(bundle);

      setupRenderer(ci);
      setupInput(ci);

      // Expose for mobile gamepad buttons injected by gen-app-pages.mjs
      window.__dosEmitKey = (scanCode, pressed) => ci.sendKeyEvent(scanCode, pressed);

      ci.events().onStdout(msg => log(msg));
      ci.events().onExit(() => {
        setStatus(cfg.appName + " exited.");
        overlay.style.display = "flex";
        playBtn.disabled = false;
        playBtn.textContent = "▶ Play " + cfg.appName;
      });

      setStatus("");
      canvas.focus();

    } catch (err) {
      setStatus("Could not start: " + err.message);
      overlay.style.display = "flex";
      playBtn.disabled = false;
      playBtn.textContent = "▶ Play " + cfg.appName;
      log("Error: " + err.message);
    }
  }

  playBtn.addEventListener("click", play);
  if (cfg.autoboot) play();
})();
