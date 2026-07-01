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
    });
  }

  function setupInput(ci) {
    canvas.addEventListener("click", () => canvas.focus());

    // DOSBox scan codes (not KeyboardEvent.keyCode directly)
    // sendKeyEvent takes a DOS scan code
    const KEY_MAP = {
      27: 1,    // Esc
      49: 2, 50: 3, 51: 4, 52: 5, 53: 6, 54: 7, 55: 8, 56: 9, 57: 10, 48: 11, // 1-9,0
      81: 16, 87: 17, 69: 18, 82: 19, 84: 20, 89: 21, 85: 22, 73: 23, 79: 24, 80: 25, // QWERTYUIOP
      65: 30, 83: 31, 68: 32, 70: 33, 71: 34, 72: 35, 74: 36, 75: 37, 76: 38, // ASDFGHJKL
      90: 44, 88: 45, 67: 46, 86: 47, 66: 48, 78: 49, 77: 50, // ZXCVBNM
      32: 57,   // Space
      13: 28,   // Enter
      8:  14,   // Backspace
      9:  15,   // Tab
      16: 42,   // Shift
      17: 29,   // Ctrl
      18: 56,   // Alt
      20: 58,   // CapsLock
      38: 72, 40: 80, 37: 75, 39: 77, // Arrow keys
      33: 73, 34: 81, 35: 79, 36: 71, // PgUp PgDn End Home
      45: 82, 46: 83, // Ins Del
      112: 59, 113: 60, 114: 61, 115: 62, 116: 63, 117: 64, 118: 65, 119: 66, 120: 67, 121: 68, 122: 87, 123: 88, // F1-F12
    };

    window.addEventListener("keydown", e => {
      const sc = KEY_MAP[e.keyCode];
      if (sc !== undefined) {
        ci.sendKeyEvent(sc, true);
        e.preventDefault();
      }
    });
    window.addEventListener("keyup", e => {
      const sc = KEY_MAP[e.keyCode];
      if (sc !== undefined) {
        ci.sendKeyEvent(sc, false);
        e.preventDefault();
      }
    });

    canvas.addEventListener("mousemove", e => {
      const r = canvas.getBoundingClientRect();
      ci.sendMouseMotion(
        (e.clientX - r.left) / r.width,
        (e.clientY - r.top) / r.height
      );
    });
    canvas.addEventListener("mousedown", e => { ci.sendMouseButton(e.button, true);  e.preventDefault(); });
    canvas.addEventListener("mouseup",   e => { ci.sendMouseButton(e.button, false); e.preventDefault(); });
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

      const ci = await window.emulators.dosboxWorker(bundle);

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
