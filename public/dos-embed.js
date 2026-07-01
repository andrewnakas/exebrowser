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

    // DOS scan codes keyed by browser keyCode
    // Keyed by KeyboardEvent.code (layout-independent, unambiguous for specials)
    const CODE_MAP = {
      Escape:1, Backquote:41, Minus:12, Equal:13, Backspace:14, Tab:15,
      KeyQ:16, KeyW:17, KeyE:18, KeyR:19, KeyT:20, KeyY:21, KeyU:22, KeyI:23, KeyO:24, KeyP:25,
      BracketLeft:26, BracketRight:27, Enter:28, ControlLeft:29, ControlRight:29,
      KeyA:30, KeyS:31, KeyD:32, KeyF:33, KeyG:34, KeyH:35, KeyJ:36, KeyK:37, KeyL:38,
      Semicolon:39, Quote:40, ShiftLeft:42, Backslash:43,
      KeyZ:44, KeyX:45, KeyC:46, KeyV:47, KeyB:48, KeyN:49, KeyM:50,
      Comma:51, Period:52, Slash:53, ShiftRight:54, NumpadMultiply:55,
      AltLeft:56, AltRight:56, Space:57, CapsLock:58,
      F1:59, F2:60, F3:61, F4:62, F5:63, F6:64, F7:65, F8:66, F9:67, F10:68,
      NumLock:69, ScrollLock:70,
      Numpad7:71, Numpad8:72, Numpad9:73, NumpadSubtract:74,
      Numpad4:75, Numpad5:76, Numpad6:77, NumpadAdd:78,
      Numpad1:79, Numpad2:80, Numpad3:81, Numpad0:82, NumpadDecimal:83,
      F11:87, F12:88,
      // Arrow keys — extended scan codes (0xE0 prefix), DOSBox uses same values
      ArrowUp:72, ArrowDown:80, ArrowLeft:75, ArrowRight:77,
      Home:71, End:79, PageUp:73, PageDown:81, Insert:82, Delete:83,
      NumpadEnter:28,
      // Number row
      Digit1:2, Digit2:3, Digit3:4, Digit4:5, Digit5:6,
      Digit6:7, Digit7:8, Digit8:9, Digit9:10, Digit0:11,
    };

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
