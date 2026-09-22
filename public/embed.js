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

  // ── Translation ─────────────────────────────────────────────────────────
  // Same contract as dos-embed.js: the generator injects window.__I18N on
  // localised pages only, so an English page is byte-for-byte the old
  // behaviour and ships no extra bytes. Every visible string routes through
  // T(), and the English text stays here as the fallback — a missing key
  // shows English rather than a blank button.
  //
  // This file and app.js were the gap: dos-embed.js has had T() since the
  // localisation work, so a Spanish DOOM page was Spanish all the way down
  // while a Spanish loader page would have been a Spanish frame around an
  // English application.
  function T(key, fallback, vars) {
    let s = (window.__I18N && window.__I18N[key]) || fallback;
    if (vars) for (const k in vars) s = s.split("{" + k + "}").join(vars[k]);
    return s;
  }

  const host = document.getElementById("exe-embed");
  if (!host) return;

  const cfg = {
    variant: host.dataset.variant || "default",
    appUrl: host.dataset.appUrl || "",
    entry: host.dataset.entry || "",
    appName: host.dataset.appName || "this app",
    autoboot: host.dataset.autoboot === "true",
    loaderOpen: host.dataset.loaderOpen === "true",
    emptyState: host.dataset.emptyState || "",
    variantPicker: host.dataset.variantPicker === "true",
  };

  // Honest CTA: only pages with a hosted payload may promise one-click play.
  // Without one, the button's job is to reveal the load-your-own-copy flow.
  const hosted = !!cfg.appUrl;
  const playLabel = hosted
    ? escapeHtml(T("play", "▶ Play {name}", { name: cfg.appName }))
    : escapeHtml(T("wineLoadYours", "Load your copy of {name}", { name: cfg.appName }));
  const emptyState = cfg.emptyState
    ? escapeHtml(cfg.emptyState)
    : hosted
      ? escapeHtml(T("wineEmptyHosted", "Press play to boot {name} in your browser.", { name: cfg.appName }))
      : escapeHtml(T("wineEmptyOwn", "{name} isn't hosted here — load your own copy below and it runs right on this page.", { name: cfg.appName }));
  const hint = hosted
    ? T("wineHintHosted", "Runs entirely in your browser tab with WebAssembly + Wine. Nothing is uploaded. First boot fetches the runtime (~30–60&nbsp;MB), then it's cached.")
    : T("wineHintOwn", "We can't redistribute {name}, so nothing is hosted here. Your own copy runs entirely in your browser tab with WebAssembly + Wine — nothing is uploaded. First boot fetches the runtime (~30–60&nbsp;MB), then it's cached.", { name: escapeHtml(cfg.appName) });

  // The Wine engine choice. Hidden on app pages (the guide already knows which
  // engine its app needs); visible on /load-exe/, where the visitor's file is
  // the unknown and the wrong engine is the most common reason nothing runs.
  // "x64" is deliberately absent: it is a separate page with its own loader,
  // and app.js only redirects to it from the home page's Boot button, so
  // offering it here would set a variant that never loads.
  const variantPickerHtml = cfg.variantPicker
    ? `<div class="embed-variant">
      <label for="wineVariant"><strong>${escapeHtml(T("wineEngine", "Wine engine:"))}</strong></label>
      <select id="wineVariant">
        <option value="default" selected>${escapeHtml(T("wineVariantDefault", "Wine 1.7.55 · Win32 — almost everything from 1995–2008"))}</option>
        <option value="gecko">${escapeHtml(T("wineVariantGecko", "Wine 1.7.55 · Win32 + Gecko — apps that ask for Internet Explorer"))}</option>
        <option value="win3x">${escapeHtml(T("wineVariant16", "Wine 3.1 · 16-bit Windows 3.x — 1990–1994 apps"))}</option>
        <option value="r18">${escapeHtml(T("wineVariantR18", "Boxedwine 18R2 — older engine, sometimes runs what the default won't"))}</option>
      </select>
    </div>`
    : "";
  const variantHiddenHtml = cfg.variantPicker
    ? ""
    : `<select id="wineVariant" hidden>
      <option value="default">default</option>
      <option value="gecko">gecko</option>
      <option value="win3x">win3x</option>
      <option value="r18">r18</option>
      <option value="x64">x64</option>
    </select>`;

  // The engine in app.js queries these exact IDs. We render real, hidden-where-
  // appropriate controls so binding succeeds; the boot/loader sections are the
  // ones the user actually sees once they choose to load their own file.
  host.innerHTML = `
    <div class="embed-stage" id="embed-stage">
      <div id="screen-container">
        <div id="screen"></div>
        <canvas id="canvas" tabindex="0" oncontextmenu="event.preventDefault()"></canvas>
        <div id="screen-empty-state" class="muted center">${emptyState}</div>
      </div>
      <div class="embed-overlay" id="embed-overlay">
        <button id="embed-play" class="embed-play" type="button">${playLabel}</button>
        <p class="embed-hint muted small">${hint}</p>
      </div>
    </div>

    <div id="bootStatus" class="status" role="status" aria-live="polite" hidden>${escapeHtml(T("wineIdle", "Idle."))}</div>
    <progress id="bootProgress" max="100" value="0" hidden></progress>

    <div class="screen-actions">
      <button id="saveStateBtn" type="button" disabled>${escapeHtml(T("wineDownloadFiles", "Download files written by this app"))}</button>
      <p class="muted small" style="margin:.4rem 0 0;">${escapeHtml(T("wineFilesKept", "Files this app saves are kept in this browser and restored next time you open this page. Use the download button for a copy you keep."))}</p>
      <p class="muted small">${escapeHtml(T("wineCaptures", "Captures save files / generated content the app wrote to its in-memory C:\\ drive."))}</p>
    </div>

    <!-- Manual loader: hidden until needed (no hosted asset, or user wants their
         own copy). Wired by app.js exactly as on the home page. -->
    <div class="embed-loader card" id="loader-section" hidden>
      <h3 style="margin-top:0;">${escapeHtml(T("wineLoadOwnCopy", "Load your own copy"))}</h3>
      <p class="muted small">${T("wineHaveFiles", "Have the files on your device? Drop the app's folder or a zip here — the entry <code>.exe</code> plus any data files beside it.")}</p>
      ${variantPickerHtml}
      <div id="dropzone" class="dropzone" tabindex="0">
        <input type="file" id="exeInput" accept=".exe,.EXE,application/x-msdownload" hidden />
        <input type="file" id="folderInput" webkitdirectory directory multiple hidden />
        <input type="file" id="zipInput" accept=".zip,application/zip" hidden />
        <p>${escapeHtml(T("wineDropFiles", "Drop files here, or pick:"))}
          <button id="pickBtn" type="button" class="link">${escapeHtml(T("winePickExe", "a single EXE"))}</button> ·
          <button id="pickFolderBtn" type="button" class="link">${escapeHtml(T("winePickFolder", "a folder"))}</button> ·
          <button id="pickZipBtn" type="button" class="link">${escapeHtml(T("winePickZip", "a zip"))}</button>
        </p>
        <p id="fileInfo" class="muted"></p>
      </div>
      <div id="entryPickerWrap" class="entry-picker" hidden>
        <label for="entryPicker"><strong>${escapeHtml(T("wineEntryExe", "Entry EXE:"))}</strong></label>
        <select id="entryPicker"></select>
      </div>
      <button id="runBtn" class="primary" disabled>${escapeHtml(T("wineRun", "Run in Wine"))}</button>
    </div>

    <details class="embed-console-wrap">
      <summary>${escapeHtml(T("consoleOutput", "Console output"))}</summary>
      <pre id="logOutput" aria-live="polite"></pre>
    </details>

    <!-- Hidden controls app.js expects to exist. When the page offers a
         visible picker, the same <select> is moved into the loader card
         instead of duplicated — app.js binds one element by id, so a second
         copy would be a control that silently does nothing. -->
    ${variantHiddenHtml}
    <button id="bootBtn" hidden>Boot Wine</button>
  `;

  const overlay = document.getElementById("embed-overlay");
  const playBtn = document.getElementById("embed-play");
  const status = document.getElementById("bootStatus");
  const progress = document.getElementById("bootProgress");
  const loader = document.getElementById("loader-section");

  function showStatus() { status.hidden = false; progress.hidden = false; }

  // /load-exe/ has nothing to reveal — the uploader *is* the page. Skip the
  // play-to-reveal step so the visitor's first click is on their own file.
  if (cfg.loaderOpen && !hosted) {
    overlay.classList.add("hidden");
    loader.hidden = false;
    // With no reveal step, the uploader belongs directly under the screen. The
    // "download what this app wrote" block sits between them by default, which
    // on this page describes a program that has not run yet.
    document.getElementById("embed-stage")?.after(loader);
  }

  // A visible engine picker has to reach the engine. app.js commits the variant
  // on its Boot button, which this embed never shows, so state.selectedVariant
  // would otherwise stay on "default" no matter what the <select> says.
  if (cfg.variantPicker) {
    document.getElementById("wineVariant")?.addEventListener("change", async (e) => {
      try { (await waitForEngine()).setVariant(e.target.value); } catch { /* engine not up yet; play() sets it */ }
    });
  }

  // Same affordance as the DOS embed: if there's something to come back to,
  // show the frame they left on and let them click it. Wine can't snapshot a
  // running program either, so the promise stays "your files are here".
  if (hosted) {
    const rec = window.SaveCore?.get((location.pathname.match(/\/run\/([^/]+)/) || [])[1] || "");
    if (rec && rec.updatedAt) {
      const art = rec.thumb || `/run/${rec.slug}/screenshot.png`;
      playBtn.classList.add("embed-play-resume");
      playBtn.innerHTML =
        `<img src="${escapeHtml(art)}" alt="" class="resume-shot" onerror="this.remove()">` +
        `<span>▶ Resume ${escapeHtml(cfg.appName)}</span>`;
      const note = document.querySelector("#embed-overlay .embed-hint");
      if (note) {
        note.innerHTML =
          `The files you saved last time are restored when it boots. ` +
          `<a href="#" id="embed-start-over">Start over</a>`;
        note.querySelector("#embed-start-over")?.addEventListener("click", async e => {
          e.preventDefault();
          if (!confirm(`Delete the files ${cfg.appName} saved in this browser?`)) return;
          await window.SaveCore?.drop(rec.slug);
          location.reload();
        });
      }
    }
  }

  async function waitForEngine(timeoutMs = 8000) {
    const start = Date.now();
    while (!window.ExeBrowser) {
      if (Date.now() - start > timeoutMs) throw new Error("Engine failed to load.");
      await new Promise((r) => setTimeout(r, 50));
    }
    return window.ExeBrowser;
  }

  // Same derivation as app.js's track(), so one page reports one slug across
  // both files rather than "load-exe" here and "/load-exe/" there.
  const slug = (location.pathname.match(/\/run\/([^/]+)/) || [])[1]
    || (location.pathname === "/" ? "home" : location.pathname.replace(/^\/|\/$/g, "") || "home");
  function track(name, params) {
    if (typeof window.gtag === "function") {
      window.gtag("event", name, Object.assign({ app_slug: slug, runtime: "boxedwine" }, params || {}));
    }
  }

  // Raw exception text ("HTTP 404 fetching /apps/…") tells a visitor nothing
  // they can act on. Say what likely went wrong instead; the uploader below
  // stays the recovery path either way.
  function explainFailure(err) {
    const m = String(err && err.message || "");
    if (/HTTP 4\d\d/.test(m)) return "We couldn't find this app's files on the server — that's our bug, not yours.";
    if (/HTTP 5\d\d/.test(m)) return "The server had a problem sending this app; trying again usually works.";
    if (/NetworkError|Failed to fetch|network|ERR_/i.test(m)) return "The download didn't finish — usually a dropped connection.";
    if (/WebAssembly|wasm|SharedArrayBuffer|compile/i.test(m)) return "Your browser couldn't start the Wine runtime. This needs a current Chrome, Firefox, Edge or Safari.";
    if (/Engine failed to load/i.test(m)) return "The Wine engine didn't load. A reload usually clears this.";
    if (/No runnable/i.test(m)) return "We couldn't find a runnable program inside this package.";
    return "Something went wrong starting this app.";
  }

  async function play(trigger) {
    playBtn.disabled = true;
    if (hosted) playBtn.textContent = "Booting…";
    showStatus();
    const params = { hosted: hosted ? 1 : 0 };
    if (typeof trigger === "string") params.trigger = trigger;
    track("play_click", params);
    try {
      const EB = await waitForEngine();
      const chosen = cfg.variantPicker
        ? (document.getElementById("wineVariant")?.value || cfg.variant)
        : cfg.variant;
      EB.setVariant(chosen);

      if (cfg.appUrl) {
        // Hosted, license-clean payload: fetch, stage, pick entry, boot. The
        // whole "play X online, no download" experience in one click.
        status.textContent = "Fetching " + cfg.appName + "…";
        await EB.stageHostedZip(cfg.appUrl);
        if (cfg.entry) EB.preferEntry(cfg.entry);
        if (!EB.isReady()) throw new Error("No runnable .exe found in the hosted package.");
        overlay.classList.add("hidden");
        await EB.run(); // boot_success/boot_error are tracked inside app.js (bootAndRun owns the outcome)
        window.SaveCore?.markPlayed(slug, cfg.appName, "wine");
        window.rememberPlayed?.(slug, cfg.appName);
      } else {
        // No hosted asset (commercial app, or we can't redistribute it). Reveal
        // the in-page uploader — still no trip to the home page.
        overlay.classList.add("hidden");
        loader.hidden = false;
        status.textContent = "Load the app's files below to play.";
        loader.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    } catch (err) {
      track("boot_error", { error_message: String(err.message).slice(0, 120) });
      status.textContent = explainFailure(err) + " You can still load your own copy below.";
      if (loader) loader.hidden = false;
      overlay.classList.remove("hidden");
      playBtn.disabled = false;
      playBtn.textContent = hosted ? "▶ Play " + cfg.appName : "Load your copy of " + cfg.appName;
    }
  }

  playBtn.addEventListener("click", play);

  // Same contract as dos-embed.js: a Resume link elsewhere on the site ends in
  // #resume, and that click already asked to play. Boot at once when the save
  // it promised is here; otherwise treat this as an ordinary visit.
  const resumeRequested = location.hash === "#resume";
  if (resumeRequested) {
    try { history.replaceState(null, "", location.pathname + location.search); } catch (_) { /* cosmetic */ }
  }
  let autoResume = false;
  if (resumeRequested && hosted) {
    try { const r = window.SaveCore && window.SaveCore.get(slug); autoResume = !!(r && r.updatedAt); } catch (_) {}
  }
  if (autoResume) {
    try { host.scrollIntoView({ block: "start" }); } catch (_) { /* older browsers */ }
    play("resume_link");
  } else if (cfg.autoboot) {
    play("autoboot");
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => (
      { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
    ));
  }
})();
