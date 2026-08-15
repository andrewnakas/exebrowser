// EXPERIMENTAL: true mid-game savestate for the DOS runtime.
//
// Everything else on this site saves *files* — your DOOM savegame survives,
// but you come back to the title screen and load it by hand. This tries for
// the thing people actually mean by "where I left off": the same frame, the
// same level, the same health, mid-corridor.
//
// On for the titles listed in ALLOW below, which are the ones that have been
// round-tripped by hand; everything else needs ?snapshot=1, and ?snapshot=0
// always disables. Any failure at any step falls back to the file-level save
// that ships today. Read that as: this file is allowed to be wrong, and is
// built so that being wrong costs a slightly slower boot.
//
// ── How it can work at all ────────────────────────────────────────────────
//
// js-dos exposes no savestate API (its whole CommandInterface is fs*, persist,
// pause/resume, screenshot and input). But the DOSBox build underneath is a
// stock Emscripten **Asyncify** build, and that changes the problem:
//
//   * DOSBox's main loop yields to the browser through `syncSleep`, which
//     unwinds the entire C call stack into a buffer **inside linear memory**
//     and parks, ~60 times a second. At that instant `Asyncify.state` is
//     Normal, `exportCallStack` is empty, and the only thing tying the
//     emulator to the JS world is `Module.sync_wakeUp` — a closure that reads
//     `Asyncify.currData` *when it is called*, not when it was created.
//   * `ci.pause()` makes the wake-up poll instead of firing, which holds the
//     emulator in exactly that parked state for as long as we need.
//
// So a snapshot is: pause, park, copy the heap. And a restore is: boot the
// same bundle, park it the same way, overwrite the heap, point `currData` at
// the restored stack, and resume — the pending poll wakes and rewinds into
// our call stack instead of its own.
//
// ── The parts the heap alone doesn't cover ────────────────────────────────
//
//   * Emscripten's MEMFS keeps file **contents in JS objects**, not in linear
//     memory, so the filesystem has to ride along separately.
//   * Open file descriptors dangle: DOOM holds DOOM1.WAD open the whole time,
//     and the restored heap remembers a number, not a file. The stream table
//     is captured and reopened.
//   * Asyncify's rewind id is stored in the heap, but the id→function map is
//     in JS and ids are handed out in first-call order, which is only
//     *probably* stable across boots. We record export **names** instead.
//   * **The screen.** DOSBox does not send frames, it sends the lines that
//     changed since the last one, and the full picture is accumulated in a JS
//     buffer on the CommandInterface. So a restored emulator carries on
//     sending deltas against the snapshot's image while the JS side is still
//     holding the *previous* instance's — and if the video mode differs too,
//     the line offsets fall outside the buffer and the pipeline dies outright.
//     The accumulated frame is part of the state and has to be restored with
//     everything else.
(() => {
  "use strict";

  // 15 of the 20 DOS titles, each verified by an actual reload round-trip:
  // capture, reload the page, and confirm the restored heap matches the
  // snapshot while the emulator keeps executing. Spans VGA and EGA, a
  // mouse-driven game (Scorched Earth) and a static-screen one, which is where
  // the interesting failures lived.
  //
  // Deliberately NOT here: god-of-thunder (resumes and runs, but drifts from
  // its snapshot faster than the others and wants a control run before it's
  // trusted) and alien-carnage, hocus-pocus, crystal-caves, monster-bash
  // (simply untested). Add a slug here AND to SNAPSHOT_SLUGS in dos-embed.js.
  const ALLOW = new Set([
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

  const DB_NAME = "exeSaves";
  const STORE = "snapshots";
  const FORMAT = 1;
  const PAGE = 65536;                          // wasm page, and our chunk size
  const MAX_HEAP_BYTES = 256 * 1024 * 1024;    // refuse anything absurd
  const MAX_STORED_BYTES = 64 * 1024 * 1024;   // total across all snapshots
  const MAX_SLUGS = 2;
  const PARK_TIMEOUT_MS = 3000;
  const FS_HOME = "/home/web_user";
  const SKIP_DIRS = ["/.jsdos/"];

  const params = new URLSearchParams(location.search);

  // A restore that failed once will fail again on the same data, and the
  // player is now watching their second boot. Stand down for the rest of the
  // tab session and let the file-level saves do their job.
  const FAIL_KEY = (slug) => "exe_snapfail_" + slug;

  function standDown(slug) {
    try { sessionStorage.setItem(FAIL_KEY(slug), "1"); } catch { /* fine */ }
  }

  // On by default for titles that have round-tripped by hand, off for
  // everything else, and `?snapshot=0` always wins. `?snapshot=1` force-enables
  // a title that isn't on the list yet, which is how the next one gets tested.
  function enabled(slug) {
    if (params.get("snapshot") === "0") return false;
    if (!ALLOW.has(slug) && params.get("snapshot") !== "1") return false;
    try { if (sessionStorage.getItem(FAIL_KEY(slug))) return false; } catch { /* fine */ }
    return true;
  }

  // ─── idb ───────────────────────────────────────────────────────────────

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

  function tx(mode, fn) {
    return idb().then(db => new Promise((resolve, reject) => {
      const store = db.transaction(STORE, mode).objectStore(STORE);
      const req = fn(store);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }));
  }

  const load = (slug) => tx("readonly", s => s.get(slug));
  const save = (slug, value) => tx("readwrite", s => s.put(value, slug));
  const drop = (slug) => tx("readwrite", s => s.delete(slug));
  const allKeys = () => tx("readonly", s => s.getAllKeys());

  async function has(slug) {
    try {
      const rec = await load(slug);
      return !!(rec && rec.v === FORMAT);
    } catch {
      return false;
    }
  }

  // ─── the parked state ──────────────────────────────────────────────────
  //
  // The one moment it is safe to read or write the heap: the emulator is
  // between frames, its C stack is fully unwound into `currData`, and the
  // wake-up closure is sitting in `Module.sync_wakeUp` waiting for the pause
  // to lift. Anything else and we would be copying a half-executed frame.
  function isParked(M) {
    const A = M && M.Asyncify;
    return !!(
      A &&
      M.paused === true &&
      A.state === 0 &&
      A.currData !== null &&
      A.currData !== 0 &&
      A.exportCallStack.length === 0 &&
      typeof M.sync_wakeUp === "function"
    );
  }

  async function waitParked(M, timeoutMs) {
    const deadline = Date.now() + (timeoutMs || PARK_TIMEOUT_MS);
    while (Date.now() < deadline) {
      if (isParked(M)) return true;
      await new Promise(r => setTimeout(r, 16));
    }
    throw new Error("emulator never parked (state=" +
      (M && M.Asyncify ? M.Asyncify.state : "?") +
      " paused=" + (M && M.paused) + ")");
  }

  // Things this design assumes are absent. Cheaper to assert than to debug a
  // restore that half-works because a bundle used a feature we never tested.
  function assertSupported(M) {
    if (!M.Asyncify) throw new Error("unpatched runtime (no Module.Asyncify)");
    if (!M.wasmMemory || !M.wasmExports) throw new Error("unpatched runtime (no wasmMemory/wasmExports)");
    if (!M.FS) throw new Error("no FS on the module");
    if (M.glfx) throw new Error("GL renderer in use — snapshot only covers the software path");
    if (M.sockdrives && Object.keys(M.sockdrives).length) throw new Error("network drives attached");
    if (M.HEAPU8.length > MAX_HEAP_BYTES) throw new Error("heap too large: " + M.HEAPU8.length);
  }

  // ─── heap ──────────────────────────────────────────────────────────────
  //
  // A 64 MiB heap where DOS has touched a fraction of it is mostly zeros, so
  // store a bitmap of which 64 KiB pages are non-zero plus only those pages.
  // gzip afterwards does the rest. This is the difference between a snapshot
  // that fits in IndexedDB and one that doesn't.
  function packHeap(heap) {
    const pages = Math.ceil(heap.length / PAGE);
    const bitmap = new Uint8Array(Math.ceil(pages / 8));
    const words = new Uint32Array(heap.buffer, heap.byteOffset, heap.length >>> 2);
    const wordsPerPage = PAGE >>> 2;

    const used = [];
    for (let p = 0; p < pages; p++) {
      const start = p * wordsPerPage;
      const end = Math.min(start + wordsPerPage, words.length);
      for (let i = start; i < end; i++) {
        if (words[i] !== 0) {
          bitmap[p >> 3] |= 1 << (p & 7);
          used.push(p);
          break;
        }
      }
    }

    const packed = new Uint8Array(used.length * PAGE);
    for (let i = 0; i < used.length; i++) {
      const off = used[i] * PAGE;
      packed.set(heap.subarray(off, off + PAGE), i * PAGE);
    }
    return { bitmap, packed, pages };
  }

  // The counterpart. Zero first: pages the snapshot says are empty must *be*
  // empty, and the freshly booted heap we are writing into is anything but.
  function unpackHeap(heap, bitmap, packed, pages) {
    heap.fill(0);
    let i = 0;
    for (let p = 0; p < pages; p++) {
      if (!(bitmap[p >> 3] & (1 << (p & 7)))) continue;
      const src = i * PAGE;
      if (src + PAGE > packed.length) throw new Error("packed heap is short at page " + p);
      heap.set(packed.subarray(src, src + PAGE), p * PAGE);
      i++;
    }
    return i;
  }

  const HAS_CS = typeof CompressionStream === "function";

  async function gzip(bytes) {
    if (!HAS_CS) return { gz: false, bytes };
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"));
    return { gz: true, bytes: new Uint8Array(await new Response(stream).arrayBuffer()) };
  }

  async function gunzip(bytes, isGz) {
    if (!isGz) return bytes;
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  // ─── filesystem ────────────────────────────────────────────────────────
  //
  // Same baseline-and-diff shape the file-level saves use, for the same
  // reason: the base game came out of the bundle we are about to boot again,
  // so only what changed since is worth carrying.
  const baseline = new Map();

  function walk(FS, dir, out) {
    let names;
    try { names = FS.readdir(dir); } catch { return out; }
    for (const name of names) {
      if (name === "." || name === "..") continue;
      const full = dir + "/" + name;
      let st;
      try { st = FS.stat(full); } catch { continue; }
      const rel = full.slice(FS_HOME.length);
      if (FS.isDir(st.mode)) {
        if (!SKIP_DIRS.some(d => (rel + "/").includes(d))) walk(FS, full, out);
      } else if (FS.isFile(st.mode)) {
        if (SKIP_DIRS.some(d => rel.includes(d))) continue;
        const mtime = st.mtime instanceof Date ? st.mtime.getTime() : Number(st.mtime) || 0;
        out.push({ path: rel, sig: mtime + ":" + st.size });
      }
    }
    return out;
  }

  function recordBaseline(ci) {
    const M = moduleOf(ci);
    if (!M || !M.FS) return;
    baseline.clear();
    for (const f of walk(M.FS, FS_HOME, [])) baseline.set(f.path, f.sig);
  }

  function fsDiff(M) {
    const files = {};
    for (const f of walk(M.FS, FS_HOME, [])) {
      if (baseline.get(f.path) === f.sig) continue;
      try {
        files[f.path] = M.FS.readFile(FS_HOME + f.path, { encoding: "binary" }).slice();
      } catch { /* unreadable — better a missing file than a failed snapshot */ }
    }
    return files;
  }

  function fsRestore(M, files) {
    let n = 0;
    for (const [path, bytes] of Object.entries(files || {})) {
      const full = FS_HOME + path;
      try {
        const dir = full.slice(0, full.lastIndexOf("/"));
        try { M.FS.mkdirTree(dir); } catch { /* already there */ }
        M.FS.writeFile(full, bytes);
        n++;
      } catch (err) {
        throw new Error("could not restore " + path + ": " + err.message);
      }
    }
    return n;
  }

  // ─── open file descriptors ─────────────────────────────────────────────
  //
  // The restored heap holds fd *numbers*. If the fresh boot opened a different
  // set, those numbers point at the wrong files and the game reads garbage —
  // the failure mode here is a game that runs and is subtly, quietly wrong,
  // which is worse than one that crashes. So the table is rebuilt exactly.
  function captureStreams(M) {
    const FS = M.FS;
    const out = [];
    for (let fd = 3; fd < FS.streams.length; fd++) {
      const s = FS.streams[fd];
      if (!s || !s.node) continue;
      let path;
      try { path = FS.getPath(s.node); } catch { continue; }
      out.push({ fd, path, position: s.position, flags: s.flags });
    }
    return out;
  }

  function restoreStreams(M, streams) {
    const FS = M.FS;
    for (let fd = FS.streams.length - 1; fd >= 3; fd--) {
      const s = FS.streams[fd];
      if (s) { try { FS.close(s); } catch { /* already gone */ } }
    }
    for (const want of streams || []) {
      const stream = FS.open(want.path, want.flags);
      if (stream.fd !== want.fd) {
        // Put it where the emulator expects to find it.
        if (FS.streams[want.fd]) throw new Error("fd " + want.fd + " is occupied");
        FS.streams[stream.fd] = null;
        FS.streams[want.fd] = stream;
        stream.fd = want.fd;
      }
      stream.position = want.position;
    }
    return (streams || []).length;
  }

  // ─── asyncify identity ─────────────────────────────────────────────────
  //
  // `callStackIdToFunc` maps a rewind id (which lives in the heap, so it comes
  // back with the snapshot) to a raw wasm export. The ids are assigned in
  // first-call order, so a fresh boot could plausibly number them differently.
  // Recording export names sidesteps the question entirely.
  //
  // Note the double indirection: the map holds *originals*, `wasmExports`
  // holds Asyncify's *wrappers*, and `funcWrappers` is the bridge.
  function captureIds(M) {
    const A = M.Asyncify;
    const nameOfWrapper = new Map();
    for (const [name, fn] of Object.entries(M.wasmExports)) {
      if (typeof fn === "function") nameOfWrapper.set(fn, name);
    }
    const ids = [];
    for (const [id, original] of A.callStackIdToFunc) {
      const name = nameOfWrapper.get(A.funcWrappers.get(original));
      if (name === undefined) throw new Error("asyncify id " + id + " maps to no export");
      ids.push([id, name]);
    }
    return ids;
  }

  function restoreIds(M, ids) {
    const A = M.Asyncify;
    const originalOfWrapper = new Map();
    for (const [original, wrapper] of A.funcWrappers) originalOfWrapper.set(wrapper, original);

    A.callStackIdToFunc.clear();
    A.callstackFuncToId.clear();
    let max = -1;
    for (const [id, name] of ids) {
      const original = originalOfWrapper.get(M.wasmExports[name]);
      if (!original) throw new Error("cannot resolve export " + name + " in the fresh instance");
      A.callStackIdToFunc.set(id, original);
      A.callstackFuncToId.set(original, id);
      if (id > max) max = id;
    }
    A.callStackId = max + 1;
  }

  // ─── the accumulated screen ────────────────────────────────────────────
  //
  // The single most misleading part of this whole exercise. DOSBox sends only
  // the scanlines that changed, and js-dos keeps the assembled picture in a JS
  // buffer on the CommandInterface (`rgb`, sized by `frameWidth`/`frameHeight`
  // and written by onFrameLines at `start * frameWidth * 3`).
  //
  // So a restored emulator emits deltas against the image it remembers, while
  // that buffer still holds the image from the instance we booted to get here.
  // The picture never converges. Worse, if the restored video mode differs the
  // offsets land outside the buffer, the write throws inside the message
  // handler, and every frame after it is lost — which is exactly the "restore
  // succeeds, emulator runs, screen frozen" symptom.
  function captureScreen(ci) {
    if (!ci.rgb || !ci.frameWidth) return null;
    return {
      width: ci.frameWidth,
      height: ci.frameHeight,
      rgb: ci.rgb.slice(),
    };
  }

  function restoreScreen(ci, screen) {
    if (!screen || !screen.rgb) return false;
    const expected = screen.width * screen.height * 3;
    if (screen.rgb.length !== expected) throw new Error("snapshot screen buffer is the wrong size");

    ci.frameWidth = screen.width;
    ci.frameHeight = screen.height;
    ci.rgb = new Uint8Array(screen.rgb);
    return true;
  }

  // Push the restored picture out to whoever is drawing. This is deliberately
  // separate from restoreScreen: the buffer has to be in place before the
  // emulator resumes, but the *paint* is useless until the page has attached
  // its renderer. Firing it too early costs nothing on a game that redraws
  // constantly and everything on one that doesn't — Scorched Earth sits on a
  // static screen, so the frame we fired into a void was the only one it was
  // ever going to send.
  function present(ci) {
    if (!ci || !ci.rgb || !ci.frameWidth) return false;
    ci.eventsImpl?.fireFrameSize?.(ci.frameWidth, ci.frameHeight);
    ci.eventsImpl?.fireFrame?.(ci.rgb, ci.rgba);
    return true;
  }

  // ─── capture ───────────────────────────────────────────────────────────

  const moduleOf = (ci) => (ci && ci.transport && ci.transport.module) || null;

  let capturing = null;

  function capture(ci, slug, reason) {
    if (capturing) return capturing;
    capturing = (async () => {
      const M = moduleOf(ci);
      if (!M) throw new Error("no module behind the command interface");
      assertSupported(M);

      let snap;
      ci.pause();
      try {
        await waitParked(M);
        const A = M.Asyncify;

        // Everything in this block is synchronous on purpose: the emulator is
        // parked, and it stays consistent only as long as we don't yield.
        const heap = M.HEAPU8;
        const { bitmap, packed, pages } = packHeap(heap);
        snap = {
          v: FORMAT,
          createdAt: Date.now(),
          heapBytes: heap.length,
          pages,
          bitmap,
          packed,
          files: fsDiff(M),
          streams: captureStreams(M),
          // What the emulator believes the time is. DOSBox keeps its timing
          // base in the heap, so on restore this is what the patched clock
          // shims are wound back to — otherwise it wakes up convinced it owes
          // the world however many minutes passed and never renders again.
          clock: {
            perf: performance.now() - (M.__perfSkew || 0),
            date: Date.now() - (M.__dateSkew || 0),
          },
          screen: captureScreen(ci),
          asyncify: {
            currData: A.currData,
            handleSleepReturnValue: A.handleSleepReturnValue,
            ids: captureIds(M),
          },
        };
      } finally {
        ci.resume();
      }

      // Compression happens after the emulator is running again — it's the
      // slow part and it works on our own copy.
      const { gz, bytes } = await gzip(snap.packed);
      const record = {
        v: snap.v,
        createdAt: snap.createdAt,
        heapBytes: snap.heapBytes,
        pages: snap.pages,
        bitmap: snap.bitmap,
        gz,
        heap: bytes,
        files: snap.files,
        streams: snap.streams,
        clock: snap.clock,
        screen: snap.screen,
        asyncify: snap.asyncify,
      };

      await evictFor(slug, bytes.length);
      await save(slug, record);
      return { bytes: bytes.length, files: Object.keys(snap.files).length, reason };
    })().finally(() => { capturing = null; });
    return capturing;
  }

  // Snapshots are big enough that they get their own budget rather than
  // competing with every file-level save on the site.
  async function evictFor(keepSlug, incoming) {
    let keys;
    try { keys = await allKeys(); } catch { return; }
    const others = keys.filter(k => k !== keepSlug);
    while (others.length + 1 > MAX_SLUGS) await drop(others.shift());

    let total = incoming;
    const sized = [];
    for (const k of others) {
      const rec = await load(k).catch(() => null);
      if (rec) sized.push({ k, bytes: (rec.heap && rec.heap.length) || 0, at: rec.createdAt || 0 });
    }
    for (const s of sized) total += s.bytes;
    sized.sort((a, b) => a.at - b.at);
    while (total > MAX_STORED_BYTES && sized.length) {
      const victim = sized.shift();
      total -= victim.bytes;
      await drop(victim.k);
    }
  }

  // ─── restore ───────────────────────────────────────────────────────────
  //
  // Called immediately after dosDirect resolves, INSTEAD of the file-level
  // restore. Throws on anything unexpected; the caller's job is to catch that
  // and fall back to booting normally.
  async function restore(ci, slug) {
    const rec = await load(slug);
    if (!rec || rec.v !== FORMAT) throw new Error("no usable snapshot");

    const M = moduleOf(ci);
    if (!M) throw new Error("no module behind the command interface");
    assertSupported(M);

    const packed = await gunzip(rec.heap, rec.gz);

    ci.pause();
    try {
      await waitParked(M);

      // Grow to match before touching anything: growth detaches every view,
      // so HEAPU8 has to be re-read afterwards or we write into a dead buffer.
      if (rec.heapBytes > M.HEAPU8.length) {
        const delta = Math.ceil((rec.heapBytes - M.HEAPU8.length) / PAGE);
        M.wasmMemory.grow(delta);
        M.updateMemoryViews();
      }
      const heap = M.HEAPU8;
      if (heap.length < rec.heapBytes) throw new Error("could not grow the heap to " + rec.heapBytes);

      unpackHeap(heap, rec.bitmap, packed, rec.pages);
      fsRestore(M, rec.files);
      restoreStreams(M, rec.streams);
      restoreIds(M, rec.asyncify.ids);

      const A = M.Asyncify;
      A.exportCallStack.length = 0;
      A.state = 0;
      A.handleSleepReturnValue = rec.asyncify.handleSleepReturnValue;
      A.currData = rec.asyncify.currData;

      // Wind the emulator's clock back to the instant of the snapshot. Without
      // this it wakes owing the whole gap since, and spends it in a catch-up
      // loop that renders nothing at all — verified: a gapless restore resumes
      // perfectly, the same snapshot after a reload does not.
      if (rec.clock) {
        M.__perfSkew = performance.now() - rec.clock.perf;
        M.__dateSkew = Date.now() - rec.clock.date;
      }
      M.last_wakeup = Date.now();
      M.sleep_started_at = Date.now();
      delete M.wakeUpAt;

      // Put the screen back before anything is allowed to draw on it.
      restoreScreen(ci, rec.screen);
    } finally {
      // Resuming lets the pending 16 ms poll fire the wake-up, which reads the
      // currData we just installed and rewinds into the restored call stack.
      ci.resume();
    }
    return true;
  }

  // Kept for diagnostics, no longer the liveness gate. Counting colours turned
  // out to be the wrong question: Commander Keen 4 sits on a five-colour EGA
  // screen that is perfectly alive, so any threshold high enough to catch a
  // black frame also rejects a good restore. Frames arriving is the real
  // signal, and dos-embed checks that instead. Judge the canvas *buffer*
  // either way — a page screenshot of a canvas that never painted tells you
  // nothing.
  function looksAlive(canvas, minColours) {
    try {
      const ctx = canvas.getContext("2d");
      if (!ctx) return false;
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const seen = new Set();
      for (let i = 0; i < data.length; i += 4) {
        seen.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
        if (seen.size >= (minColours || 12)) return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  // How far the emulator has actually executed, independent of what it chose
  // to draw. This is the honest liveness signal: Scorched Earth sits on a
  // completely static screen and emits **zero** frames while running perfectly
  // normally, because DOSBox only ever sends the scanlines that changed. Any
  // check based on frames arriving calls that game dead.
  function progress(ci) {
    const M = moduleOf(ci);
    return M ? (M.sleep_count || 0) : 0;
  }

  window.DosSnapshot = {
    enabled,
    standDown,
    progress,
    present,
    pathPrefix: "/dosbox-snap/",
    recordBaseline,
    capture,
    restore,
    has,
    drop,
    looksAlive,
    isParked,
    FORMAT,
  };
})();
