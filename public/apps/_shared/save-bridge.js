// Save persistence for the ported Emscripten games (ScummVM, OpenTTD, and the
// two Space Cadet Pinball builds), which run in their own iframe and know
// nothing about the rest of the site.
//
// Two jobs, because the four ports are in two different states:
//
//   ScummVM and OpenTTD already mount IDBFS on their own config directory, so
//   their saves survive. What they don't do is flush on the way out — IDBFS
//   only writes when it feels like it — or tell the parent page that a save
//   exists, so the site could never offer to resume them.
//
//   Space Cadet and Dragon Keep mount MEMFS and nothing else. Every high
//   score, every option, every window position has been thrown away on reload
//   since the day they shipped. `data-persist-dir` mounts IDBFS for them.
//
// Configured entirely from its own script tag:
//   <script src="/apps/_shared/save-bridge.js"
//           data-slug="space-cadet-open"
//           data-name="Open Cadet"
//           data-persist-dir="/libsdl"></script>
//
// …except the slug, which a `?slug=`/`?name=` on the page's own URL overrides.
// ScummVM runs three different games out of one HTML file, so the tag can only
// carry a default.
//
// It must be a plain (non-async) tag placed after the inline `Module = {…}`
// block and before the engine's own <script async>: it needs Module to exist
// so it can push a preRun hook, and it needs to get there before the engine
// starts running.
(() => {
  "use strict";

  const tag = document.currentScript;
  // ScummVM serves three different games out of one HTML file, so the slug
  // can't come from the tag alone — every one of them would have reported its
  // saves as Beneath a Steel Sky. A `?slug=`/`?name=` on the iframe URL wins;
  // the hash is spoken for by the engine's own arguments.
  const query = new URLSearchParams(location.search);
  const slug = query.get("slug") || tag?.dataset.slug || "";
  const name = query.get("name") || tag?.dataset.name || slug;
  const persistDir = tag?.dataset.persistDir || "";
  // ScummVM's three games share one save directory, so summing the directory
  // credited every game with every other game's saves — play Sołtys and the
  // site offered to resume Beneath a Steel Sky. `savePrefix` is the engine's
  // target name; ScummVM writes `<target>.000`, `.001` and so on, so counting
  // only those files gives an honest per-game answer. Apps that own their
  // directory outright leave it unset and nothing changes for them.
  const savePrefix = query.get("savePrefix") || tag?.dataset.savePrefix || "";
  const owns = savePrefix
    ? (path) => new RegExp("(^|/)" + savePrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\.\\w+$", "i").test(path)
    : () => true;
  const SYNC_INTERVAL_MS = 15000;

  if (!slug) return;

  const Module = window.Module;
  if (!Module) return;

  // ─── mount ─────────────────────────────────────────────────────────────

  function mountPersistence() {
    try {
      const FS = Module.FS || window.FS;
      const IDBFS = Module.IDBFS || window.IDBFS;
      if (!FS || !IDBFS) return;

      // Already mounted by the app itself? Leave it alone.
      if (mountPoints().includes(persistDir)) return;

      FS.mkdirTree(persistDir);
      FS.mount(IDBFS, {}, persistDir);

      // Hold the game at the loading screen until what's on disk is in
      // memory. Without the dependency the app reads the directory before
      // the read-back lands and concludes there's nothing saved.
      const late = Module.calledRun;
      if (!late) Module.addRunDependency("save-bridge-syncfs");
      FS.syncfs(true, () => { if (!late) Module.removeRunDependency("save-bridge-syncfs"); });
    } catch {
      // A game that can't persist is still a game that runs.
    }
  }

  if (persistDir) {
    // preRun is the right moment — the mount has to exist before the game
    // looks for its settings. But the engine tag next to this one may already
    // have run: an `async` script that is warm in cache executes while the
    // parser is still blocked fetching *this* file, and it drains preRun on
    // the way past. (The engine tags are plain scripts now for exactly that
    // reason; this branch is the belt to that braces.) Mounting late still
    // beats not mounting: the game won't see the old save this session, but
    // everything it writes from here survives.
    if (Module.calledRun) mountPersistence();
    else {
      Module.preRun = Module.preRun || [];
      Module.preRun.push(mountPersistence);
    }
  }

  // ─── flush ─────────────────────────────────────────────────────────────

  // Every mount in the tree. `FS.mounts` looks like the obvious source and is
  // permanently empty in these builds — it's scratch space for syncfs, not a
  // registry. getMounts walking down from the root mount is the real answer.
  function allMounts() {
    const FS = Module.FS || window.FS;
    if (!FS || !FS.root || !FS.getMounts) return [];
    try { return FS.getMounts(FS.root.mount) || []; } catch { return []; }
  }

  function mountPoints() {
    return allMounts().map(m => m.mountpoint).filter(Boolean);
  }

  // IDBFS names its database after the mount point, which is what lets the
  // parent page delete a save later without knowing anything about the layout
  // inside it.
  function idbfsMounts() {
    const IDBFS = Module.IDBFS || window.IDBFS;
    if (!IDBFS) return [];
    return allMounts().filter(m => m.type === IDBFS && m.mountpoint).map(m => m.mountpoint);
  }

  function dirBytes(FS, dir) {
    let total = 0;
    let names;
    try { names = FS.readdir(dir); } catch { return 0; }
    for (const entry of names) {
      if (entry === "." || entry === "..") continue;
      const full = dir === "/" ? "/" + entry : dir + "/" + entry;
      let st;
      try { st = FS.stat(full); } catch { continue; }
      if (FS.isDir(st.mode)) total += dirBytes(FS, full);
      else if (FS.isFile(st.mode) && owns(full)) total += st.size || 0;
    }
    return total;
  }

  let inFlight = false;
  function flush() {
    const FS = Module.FS || window.FS;
    const mounts = idbfsMounts();
    if (!FS || !mounts.length || inFlight) return;
    inFlight = true;

    let bytes = 0;
    for (const mount of mounts) bytes += dirBytes(FS, mount);

    FS.syncfs(false, () => {
      inFlight = false;
      if (!bytes) return; // nothing written yet — don't claim a save
      report("exe-save", {
        bytes,
        db: persistDir || mounts[0],
        thumb: shot(),
      });
    });
  }

  // SDL2 draws through WebGL without preserveDrawingBuffer in these builds, so
  // this usually reads back blank and the parent falls back to poster art.
  // Cheap enough to try, and it's free the moment a build renders through 2D.
  function shot() {
    try {
      const canvas = document.getElementById("canvas") || document.querySelector("canvas");
      return canvas && parent.SaveCore ? parent.SaveCore.thumbFromCanvas(canvas) : null;
    } catch {
      return null;
    }
  }

  function report(type, extra) {
    try {
      parent.postMessage(Object.assign({ type, slug, name }, extra || {}), location.origin);
    } catch {
      /* no parent, or a parent that isn't listening */
    }
  }

  setInterval(flush, SYNC_INTERVAL_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
  addEventListener("pagehide", (e) => { if (!e.persisted) flush(); });

  // ─── played ────────────────────────────────────────────────────────────
  //
  // On first real input, not on load. The site used to announce a game as
  // played the moment its page opened, so anything you glanced at came back
  // as something to continue.
  const onFirstInput = () => {
    report("exe-played");
    for (const ev of ["keydown", "pointerdown", "touchstart"]) {
      removeEventListener(ev, onFirstInput, true);
    }
  };
  for (const ev of ["keydown", "pointerdown", "touchstart"]) {
    addEventListener(ev, onFirstInput, true);
  }
})();
