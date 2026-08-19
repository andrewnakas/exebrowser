// Play analytics for the hand-maintained game pages.
//
// dos-embed.js and embed.js already emit play_click / boot_success /
// playtime_heartbeat for every generated /run/ page. The 17 playable pages
// that carry skipGenerate do not go through either of those files, so until
// this existed they emitted no game events at all: Space Cadet, every -open
// title, all four ScummVM adventures, OpenTTD and Micropolis. That is 17 of
// 43 playable titles, so roughly 40% of the catalogue was invisible in the
// activation funnel and the measured play rate was structurally too low.
//
// Event names, parameters and heartbeat timing deliberately match
// dos-embed.js exactly, so the two sources can be added together without
// caring which runtime a title uses.
(() => {
  "use strict";

  const slug = (location.pathname.match(/\/run\/([^/]+)/) || [])[1] || location.pathname;
  const root = document.querySelector("[data-play-track]");
  const runtime = (root && root.dataset.playTrack) || "native";
  const appName = (root && root.dataset.appName) || document.title.split(/[—|]/)[0].trim();

  function track(name, params) {
    if (typeof window.gtag === "function") {
      window.gtag("event", name, Object.assign({ app_slug: slug, runtime }, params || {}));
    }
  }

  // One event per minute while the game runs, plus a partial flush when the
  // tab is hidden. Copied from dos-embed.js so a minute of Solitaire and a
  // minute of DOOM are the same measurement.
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

  const t0 = performance.now();
  let clickAt = null;
  let booted = false;

  function playClick() {
    if (clickAt !== null) return;
    clickAt = performance.now();
    track("play_click");
  }

  // `at` is when the game actually became playable, which is not always now:
  // the DOM-game path below waits out a settle window before it is willing to
  // conclude anything, and billing that wait to the game would overstate every
  // card game's boot time by the length of the window.
  function bootSuccess(at) {
    if (booted) return;
    booted = true;
    // Measure from the click when there was one, otherwise from page load.
    // Titles that start themselves (ScummVM, the JS games) have no click, and
    // reporting their boot_ms from navigation start is the honest number.
    const end = at ?? performance.now();
    track("boot_success", { boot_ms: Math.max(0, Math.round(end - (clickAt ?? t0))) });
    startHeartbeat();
  }

  // Explicit API, for pages that know exactly when they started.
  window.ExePlay = { click: playClick, booted: bootSuccess, track };

  // ── Automatic wiring ─────────────────────────────────────────────────────
  // These pages are hand-written and none of them share a play-button class,
  // so match on what they do have in common: an element that says "play", and
  // then either an iframe that loads or a canvas that gets sized by a real
  // engine. Both signals are idempotent, so a page that also calls the
  // explicit API on top of this still reports once.
  document.addEventListener("click", (e) => {
    const el = e.target.closest("button, a");
    if (!el) return;
    const label = (el.textContent || "").trim();
    if (el.hasAttribute("data-play") || /^\s*▶/.test(label) || /\bplay\b/i.test(label)) playClick();
  }, true);

  // An engine-owned canvas is one the engine has resized; 300x150 is the HTML
  // default and means no frame was ever delivered, which is the same test the
  // boot-audit harness uses.
  const canvasLooksLive = (c) => c.width > 300 && c.height > 150;
  // A canvas only counts as "this page is a canvas engine" if it is actually on
  // screen. Solitaire's frame carries a leftover 300x150 canvas at 0x0 CSS size
  // that nothing ever draws to; treating that as an engine meant the card games
  // waited forever for a frame that was never coming.
  const canvasIsVisible = (c) => c.clientWidth > 0 && c.clientHeight > 0;

  // Same-origin only, which every /apps/ frame is. Returns the frame's document
  // once it has finished loading, or null.
  function frameDoc(f) {
    if (!f.src) return null;              // a frame with no src has loaded nothing
    try {
      const d = f.contentDocument;
      return d && d.readyState === "complete" && d.body && d.body.children.length ? d : null;
    } catch {
      return null;                        // cross-origin; fall back to the load event
    }
  }

  // Two shapes of game live behind these pages and they become "playing" at
  // different moments, so detecting them the same way would be wrong:
  //
  //   canvas engines (Space Cadet, ScummVM, OpenTTD) load a frame in
  //   milliseconds and then pull megabytes of wasm behind it. Their frame
  //   loading means nothing; wait for a canvas the engine has actually sized.
  //
  //   DOM games (Solitaire, FreeCell, Spider, Hearts) have no canvas at all.
  //   They are playable the moment their document is complete.
  const engines = new WeakSet();        // frames known to run a wasm/canvas engine
  const completeAt = new WeakMap();     // when a frame's document first went complete
  const SETTLE_MS = 2500;

  function scan() {
    if (booted) return true;
    for (const c of document.querySelectorAll("canvas")) {
      if (canvasIsVisible(c) && canvasLooksLive(c)) { bootSuccess(); return true; }
    }
    for (const f of document.querySelectorAll("iframe")) {
      const d = frameDoc(f);
      if (!d) continue;
      // An Emscripten app announces itself with a Module global, and it creates
      // its canvas some time after the frame document is complete. Once a frame
      // has ever looked like an engine it stays one, so a slow wasm download
      // cannot be mistaken for a DOM game that is ready.
      try { if (f.contentWindow && f.contentWindow.Module) engines.add(f); } catch {}

      const inner = [...d.querySelectorAll("canvas")].filter(canvasIsVisible);
      if (inner.length) {
        engines.add(f);
        for (const c of inner) if (canvasLooksLive(c)) { bootSuccess(); return true; }
        continue;                         // canvas engine, no frame delivered yet
      }
      if (engines.has(f)) continue;       // engine whose canvas has not appeared yet

      // No canvas and no engine global. That is a DOM game, but only conclude it
      // after the frame has been complete for a moment: Space Cadet's frame is
      // complete in about a second and then spends several more pulling 4.9 MB
      // of wasm, and calling that "booted" would have reported a boot the player
      // could not yet see.
      const first = completeAt.get(f);
      if (first === undefined) { completeAt.set(f, performance.now()); continue; }
      if (performance.now() - first < SETTLE_MS) continue;
      bootSuccess(first);                 // credit the moment it was ready, not now
      return true;
    }
    return false;
  }

  for (const f of document.querySelectorAll("iframe")) {
    f.addEventListener("load", scan);
  }

  // Poll rather than using MutationObserver, for two reasons: an engine resizes
  // its canvas without mutating the DOM, and an eager iframe can finish loading
  // before this script runs at all, which is exactly how the card games were
  // missed. Stops on the first boot, or after 90s.
  if (!scan()) {
    const started = Date.now();
    const iv = setInterval(() => {
      if (scan() || Date.now() - started > 90000) clearInterval(iv);
    }, 1000);
  }
})();
