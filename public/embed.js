// ExeBrowser — instant-play embed for per-app pages (/run/<app>/).
//
// Goal: turn an app *guide* into an app *destination*. Instead of "read this,
// then go to the home page and upload a file", the visitor lands on the page
// and the runtime is right there: one click on "▶ Play now" boots Wine in-page
// and launches the app. This is what closes the gap with the dos.zone /
// playclassic / solitaire.org style sites that win the "play X online" queries.
//
// It reuses the real engine in app.js verbatim (window.ExeBrowser). This file
// only renders the DOM that app.js binds to, plus a play button and a thin
// orchestration layer. Nothing here re-implements Wine, the filesystem, or the
// upload pipeline — it drives them.
//
// Configuration comes from the host element's data-* attributes:
//   <div id="exe-embed"
//        data-variant="default"            Wine variant to lock in
//        data-app-url="/apps/doom.zip"     hosted, license-clean app zip (optional)
//        data-entry="DOOM95.EXE"           preferred entry EXE basename (optional)
//        data-app-name="DOOM"              label shown in the UI
//        data-autoboot="false">            boot immediately on load (default false)
//   </div>
//
// If data-app-url is absent (e.g. a commercial app we can't host), the embed
// still renders the full runtime in-page and the play button reveals the
// on-page uploader — the visitor never has to leave for the home page.

(() => {
  "use strict";

  const host = document.getElementById("exe-embed");
  if (!host) return;

  const cfg = {
    variant: host.dataset.variant || "default",
    appUrl: host.dataset.appUrl || "",
    entry: host.dataset.entry || "",
    appName: host.dataset.appName || "this app",
    autoboot: host.dataset.autoboot === "true",
  };

  // The engine in app.js queries these exact IDs. We render real, hidden-where-
  // appropriate controls so binding succeeds; the boot/loader sections are the
  // ones the user actually sees once they choose to load their own file.
  host.innerHTML = `
    <div class="embed-stage" id="embed-stage">
      <div id="screen-container">
        <div id="screen"></div>
        <canvas id="canvas" tabindex="0" oncontextmenu="event.preventDefault()"></canvas>
        <div id="screen-empty-state" class="muted center">Press play to boot ${escapeHtml(cfg.appName)} in your browser.</div>
      </div>
      <div class="embed-overlay" id="embed-overlay">
        <button id="embed-play" class="embed-play" type="button">▶ Play ${escapeHtml(cfg.appName)}</button>
        <p class="embed-hint muted small">Runs entirely in your browser tab with WebAssembly + Wine. Nothing is uploaded. First boot fetches the runtime (~30–60&nbsp;MB), then it's cached.</p>
      </div>
    </div>

    <div id="bootStatus" class="status" role="status" aria-live="polite" hidden>Idle.</div>
    <progress id="bootProgress" max="100" value="0" hidden></progress>

    <div class="screen-actions">
      <button id="saveStateBtn" type="button" disabled>Download files written by this app</button>
      <p class="muted small">Captures save files / generated content the app wrote to its in-memory C:\\ drive.</p>
    </div>

    <!-- Manual loader: hidden until needed (no hosted asset, or user wants their
         own copy). Wired by app.js exactly as on the home page. -->
    <div class="embed-loader card" id="loader-section" hidden>
      <h3 style="margin-top:0;">Load your own copy</h3>
      <p class="muted small">Have the files on your device? Drop the app's folder or a zip here — the entry <code>.exe</code> plus any data files beside it.</p>
      <div id="dropzone" class="dropzone" tabindex="0">
        <input type="file" id="exeInput" accept=".exe,.EXE,application/x-msdownload" hidden />
        <input type="file" id="folderInput" webkitdirectory directory multiple hidden />
        <input type="file" id="zipInput" accept=".zip,application/zip" hidden />
        <p>Drop files here, or pick:
          <button id="pickBtn" type="button" class="link">a single EXE</button> ·
          <button id="pickFolderBtn" type="button" class="link">a folder</button> ·
          <button id="pickZipBtn" type="button" class="link">a zip</button>
        </p>
        <p id="fileInfo" class="muted"></p>
      </div>
      <div id="entryPickerWrap" class="entry-picker" hidden>
        <label for="entryPicker"><strong>Entry EXE:</strong></label>
        <select id="entryPicker"></select>
      </div>
      <button id="runBtn" class="primary" disabled>Run in Wine</button>
    </div>

    <details class="embed-console-wrap">
      <summary>Console output</summary>
      <pre id="logOutput" aria-live="polite"></pre>
    </details>

    <!-- Hidden controls app.js expects to exist. -->
    <select id="wineVariant" hidden>
      <option value="default">default</option>
      <option value="gecko">gecko</option>
      <option value="win3x">win3x</option>
      <option value="r18">r18</option>
      <option value="x64">x64</option>
    </select>
    <button id="bootBtn" hidden>Boot Wine</button>
  `;

  const overlay = document.getElementById("embed-overlay");
  const playBtn = document.getElementById("embed-play");
  const status = document.getElementById("bootStatus");
  const progress = document.getElementById("bootProgress");
  const loader = document.getElementById("loader-section");

  function showStatus() { status.hidden = false; progress.hidden = false; }

  async function waitForEngine(timeoutMs = 8000) {
    const start = Date.now();
    while (!window.ExeBrowser) {
      if (Date.now() - start > timeoutMs) throw new Error("Engine failed to load.");
      await new Promise((r) => setTimeout(r, 50));
    }
    return window.ExeBrowser;
  }

  async function play() {
    playBtn.disabled = true;
    playBtn.textContent = "Booting…";
    showStatus();
    try {
      const EB = await waitForEngine();
      EB.setVariant(cfg.variant);

      if (cfg.appUrl) {
        // Hosted, license-clean payload: fetch, stage, pick entry, boot. The
        // whole "play X online, no download" experience in one click.
        status.textContent = "Fetching " + cfg.appName + "…";
        await EB.stageHostedZip(cfg.appUrl);
        if (cfg.entry) EB.preferEntry(cfg.entry);
        if (!EB.isReady()) throw new Error("No runnable .exe found in the hosted package.");
        overlay.classList.add("hidden");
        await EB.run();
      } else {
        // No hosted asset (commercial app, or we can't redistribute it). Reveal
        // the in-page uploader — still no trip to the home page.
        overlay.classList.add("hidden");
        loader.hidden = false;
        status.textContent = "Load the app's files below to play.";
        loader.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    } catch (err) {
      status.textContent = "Couldn't start: " + err.message + " — you can still load your own copy below.";
      if (loader) loader.hidden = false;
      overlay.classList.remove("hidden");
      playBtn.disabled = false;
      playBtn.textContent = "▶ Play " + cfg.appName;
    }
  }

  playBtn.addEventListener("click", play);
  if (cfg.autoboot) play();

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => (
      { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
    ));
  }
})();
