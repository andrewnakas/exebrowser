// One index for every save on the site, whatever wrote it.
//
// The site grew five unrelated ways to persist a game — DOS files in the
// `dosSaves` IndexedDB, Wine's writable layers in `wineSaves`, the native
// games' JSON in localStorage, the 64-bit Wine build's own store, and stock
// IDBFS inside the Emscripten ports. Each one knows how to save itself and
// none of them can answer the only question the *interface* ever needs to ask:
// "does this game have something to come back to, and what did it look like?"
//
// So this file doesn't own anybody's payload. It owns an index — one small
// record per game, written by whoever did the saving — plus the three things
// that were being reimplemented alongside each payload: when to flush, how to
// stay inside a storage budget, and how to grab a thumbnail.
//
//   SaveCore.note({slug, name, runtime, payload, bytes, thumb})  // after a save
//   SaveCore.get(slug) / .hasSave(slug) / .all()                 // synchronous
//   SaveCore.markPlayed(slug, name)                              // history only
//   SaveCore.drop(slug)                                          // index + payload
//   SaveCore.schedule({intervalMs, flush})                       // flush policy
//
// The index lives in localStorage, not IndexedDB, for two reasons that both
// matter: a play button has to render its "resume" state during first paint,
// with no await; and a write from a `pagehide` handler only reliably lands if
// it's synchronous. The payloads stay where they already are — several are
// megabytes, and moving them would mean migrating everyone's saves to fix a
// UI problem.
(() => {
  "use strict";

  const IDX_KEY = "exe_saveidx";
  const IDX_VERSION = 1;

  // Thumbnails are the expensive part of the index. Keeping them on the dozen
  // most recent saves covers every surface that shows one (a resume bar, four
  // Continue cards, the saves page's top rows) and keeps the whole index
  // comfortably inside the ~5 MB localStorage budget.
  const THUMB_KEEP = 12;
  const THUMB_WIDTH = 160;

  // Ceiling on the total we'll let saves occupy before evicting the oldest.
  // A quarter of the origin quota is generous without being the reason a
  // browser starts evicting our storage wholesale.
  const BUDGET_MAX = 96 * 1024 * 1024;
  const BUDGET_MIN = 24 * 1024 * 1024;
  const BUDGET_SHARE = 0.25;

  let budget = BUDGET_MAX;

  // ─── the index ─────────────────────────────────────────────────────────

  function readIndex() {
    try {
      const raw = localStorage.getItem(IDX_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.v !== IDX_VERSION || !parsed.games) return {};
      return parsed.games;
    } catch {
      // Private mode, a corrupt record, or storage blocked outright. An empty
      // index is always a safe answer: the UI just offers a fresh start.
      return {};
    }
  }

  function writeIndex(games) {
    try {
      localStorage.setItem(IDX_KEY, JSON.stringify({ v: IDX_VERSION, games }));
      return true;
    } catch {
      // Almost always quota, and almost always the thumbnails. Drop every
      // thumbnail and try once more before giving up — an index without art
      // is still an index, and losing it would lose the resume affordance.
      try {
        for (const rec of Object.values(games)) delete rec.thumb;
        localStorage.setItem(IDX_KEY, JSON.stringify({ v: IDX_VERSION, games }));
        return true;
      } catch {
        return false;
      }
    }
  }

  // Newest save first. Entries with no save at all (played but never saved)
  // sort after those that have one, since every caller wants saves first.
  function sorted(games) {
    return Object.values(games).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }

  function get(slug) {
    return readIndex()[slug] || null;
  }

  function hasSave(slug) {
    const rec = readIndex()[slug];
    return !!(rec && rec.updatedAt);
  }

  function all() {
    return sorted(readIndex());
  }

  function saves() {
    return sorted(readIndex()).filter(r => r.updatedAt);
  }

  // ─── payload deletion ──────────────────────────────────────────────────
  //
  // The index describes where a payload lives so that "delete my save" can be
  // one button instead of five. Three shapes, matching the three ways the
  // runtimes actually store things:
  //   {db, store, key}  a record inside one of our IndexedDB stores
  //   {local}           a localStorage key (the native games)
  //   {db}              a whole IDBFS database, named after its mount point

  function idbOpen(name, store) {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(name, 1);
      req.onupgradeneeded = () => {
        if (store && !req.result.objectStoreNames.contains(store)) {
          req.result.createObjectStore(store);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function idbKeys(name, store) {
    return idbOpen(name, store).then(db => new Promise((resolve, reject) => {
      if (!db.objectStoreNames.contains(store)) return resolve([]);
      const req = db.transaction(store, "readonly").objectStore(store).getAllKeys();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    }));
  }

  function idbDelete(name, store, key) {
    return idbOpen(name, store).then(db => new Promise((resolve, reject) => {
      if (!db.objectStoreNames.contains(store)) return resolve();
      const req = db.transaction(store, "readwrite").objectStore(store).delete(key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    }));
  }

  // A game can end up with more than one payload behind a single index entry —
  // a DOS title keeps its save *files* and, if it supports it, a full mid-game
  // snapshot. Deleting has to take both, or "start fresh" drops the files and
  // then resumes straight back into the game from the snapshot.
  async function dropPayload(payload) {
    if (!payload) return;
    for (const one of (Array.isArray(payload) ? payload : [payload])) await dropOnePayload(one);
  }

  function mergePayload(prev, next) {
    if (!next) return prev || null;
    const list = prev ? (Array.isArray(prev) ? prev.slice() : [prev]) : [];
    const key = JSON.stringify(next);
    if (!list.some(p => JSON.stringify(p) === key)) list.push(next);
    return list.length === 1 ? list[0] : list;
  }

  async function dropOnePayload(payload) {
    if (!payload) return;
    try {
      if (payload.local) {
        localStorage.removeItem(payload.local);
      } else if (payload.db && payload.store) {
        await idbDelete(payload.db, payload.store, payload.key);
      } else if (payload.db) {
        // A whole IDBFS mount. There is no per-file API worth writing here —
        // the emulator owns the layout — so the mount goes as a unit.
        await new Promise(resolve => {
          const req = indexedDB.deleteDatabase(payload.db);
          req.onsuccess = req.onerror = req.onblocked = () => resolve();
        });
      }
    } catch {
      // A payload we can't reach is a payload the player can't reach either.
      // Removing the index entry (the caller's next step) is still the right
      // outcome: the game stops claiming a save it can't load.
    }
  }

  async function drop(slug) {
    const games = readIndex();
    const rec = games[slug];
    delete games[slug];
    writeIndex(games);
    if (rec) await dropPayload(rec.payload);
  }

  // ─── budget ────────────────────────────────────────────────────────────

  function usage() {
    const list = Object.values(readIndex());
    return {
      bytes: list.reduce((n, r) => n + (r.bytes || 0), 0),
      count: list.filter(r => r.updatedAt).length,
      budget,
    };
  }

  // Evict oldest-first until we're back under budget, never touching the game
  // currently being played — evicting the save you just made would be a
  // spectacular way to lose a session.
  async function enforceBudget(keepSlug) {
    let games = readIndex();
    let total = Object.values(games).reduce((n, r) => n + (r.bytes || 0), 0);
    if (total <= budget) return;

    const victims = Object.values(games)
      .filter(r => r.slug !== keepSlug && r.updatedAt)
      .sort((a, b) => (a.updatedAt || 0) - (b.updatedAt || 0));

    for (const victim of victims) {
      if (total <= budget) break;
      total -= victim.bytes || 0;
      await drop(victim.slug);
    }
  }

  // Keep art only on the most recent handful; see THUMB_KEEP.
  function pruneThumbs(games) {
    const withThumbs = sorted(games).filter(r => r.thumb);
    for (const rec of withThumbs.slice(THUMB_KEEP)) delete rec.thumb;
  }

  // ─── writing ───────────────────────────────────────────────────────────

  // Called by whoever just persisted something. `bytes` is what the payload
  // costs, `payload` says where it went, `thumb` is optional.
  function note(info) {
    if (!info || !info.slug) return Promise.resolve(null);
    const games = readIndex();
    const prev = games[info.slug] || {};
    const now = Date.now();

    const rec = {
      slug: info.slug,
      name: info.name || prev.name || info.slug,
      runtime: info.runtime || prev.runtime || "unknown",
      // "snapshot" outranks "files": once a game can resume mid-play, that is
      // what the interface should promise, and a later file-level save
      // shouldn't quietly downgrade the claim.
      kind: info.kind === "snapshot" || prev.kind === "snapshot"
        ? "snapshot"
        : (info.kind || prev.kind || "files"),
      payload: mergePayload(prev.payload, info.payload),
      bytes: typeof info.bytes === "number" ? info.bytes : (prev.bytes || 0),
      updatedAt: now,
      playedAt: prev.playedAt || now,
    };
    const thumb = info.thumb || prev.thumb;
    if (thumb) rec.thumb = thumb;

    games[info.slug] = rec;
    pruneThumbs(games);
    writeIndex(games);
    return enforceBudget(info.slug).then(() => rec, () => rec);
  }

  // Play history, which is a different fact from "has a save" and used to be
  // conflated with it. This one never claims a save exists.
  function markPlayed(slug, name, runtime) {
    if (!slug) return null;
    const games = readIndex();
    const prev = games[slug] || {};
    const now = Date.now();

    // A returning player is someone whose history predates today. GA can't see
    // this — it's cookie-scoped and the site has no login — so the local play
    // history stays the only honest signal we have.
    const priorDay = Object.values(games).some(r => r.playedAt && now - r.playedAt > 86400000);
    if (priorDay && !prev.playedAt && typeof window.gtag === "function") {
      window.gtag("event", "return_play", { app_slug: slug, prior_games: Object.keys(games).length });
    }

    games[slug] = Object.assign({}, prev, {
      slug,
      name: name || prev.name || slug,
      runtime: runtime || prev.runtime || "unknown",
      playedAt: now,
    });
    writeIndex(games);
    return games[slug];
  }

  // ─── reconcile ─────────────────────────────────────────────────────────
  //
  // The index and the payloads can drift: a browser can evict one IndexedDB
  // database and leave localStorage alone, and iOS drops IndexedDB after about
  // a week idle. A card promising a save that no longer exists is worse than
  // no card, so check the IDB-backed records once per page load, off the
  // critical path.
  async function reconcile() {
    const games = readIndex();
    const byStore = new Map();
    for (const rec of Object.values(games)) {
      const p = rec.payload;
      // Multi-payload records are left alone: proving *all* of them are gone
      // is more bookkeeping than this is worth, and the conservative mistake (a
      // stale claim that boots into the fallback) is far cheaper than the other
      // one (dropping a save that was really there).
      if (!rec.updatedAt || !p || Array.isArray(p) || !p.db || !p.store) continue;
      const id = p.db + " " + p.store;
      if (!byStore.has(id)) byStore.set(id, { db: p.db, store: p.store, recs: [] });
      byStore.get(id).recs.push(rec);
    }
    if (!byStore.size) return;

    // slug -> the updatedAt whose payload we proved was missing.
    const missing = new Map();
    for (const { db, store, recs } of byStore.values()) {
      let keys;
      try {
        keys = new Set(await idbKeys(db, store));
      } catch {
        continue; // can't check — leave the records alone rather than guess
      }
      for (const rec of recs) {
        if (!keys.has(rec.payload.key)) missing.set(rec.slug, rec.updatedAt);
      }
    }
    if (!missing.size) return;

    // Re-read before writing: a save may well have landed while we were
    // awaiting IndexedDB, and one newer than the record we checked must win.
    const fresh = readIndex();
    let changed = false;
    for (const [slug, checkedAt] of missing) {
      const live = fresh[slug];
      if (!live || !live.updatedAt || live.updatedAt > checkedAt) continue;
      // The payload is gone. Keep the play history, drop the save claim.
      delete live.updatedAt;
      delete live.bytes;
      delete live.thumb;
      delete live.payload;
      changed = true;
    }
    if (changed) writeIndex(fresh);
  }


  // ─── flush scheduling ──────────────────────────────────────────────────
  //
  // Every runtime had its own copy of this block, each subtly different: one
  // cleared its timer on `beforeunload` (which on Safari can cancel the
  // pagehide flush that was the whole point), one had no exit flush at all.
  // One implementation, four triggers:
  //   interval    the backstop for a tab that dies with no events at all
  //   hidden      switching apps on mobile, where the tab may never come back
  //   pagehide    the only close signal that fires across every browser
  //   freeze      Chrome's tab-discard warning, earlier than pagehide
  function schedule(opts) {
    const flush = opts.flush;
    const intervalMs = opts.intervalMs || 15000;
    let inFlight = false;
    let stopped = false;

    async function run(reason) {
      if (stopped || inFlight) return;
      inFlight = true;
      try {
        await flush(reason);
      } catch {
        // A failed save must never take the game down with it.
      } finally {
        inFlight = false;
      }
    }

    const timer = setInterval(() => run("interval"), intervalMs);
    const onHide = () => { if (document.visibilityState === "hidden") run("hidden"); };
    const onPageHide = (e) => {
      // A bfcache'd page is still alive and will resume with its state intact;
      // flushing there is pure cost, and during a snapshot it's actively unsafe.
      if (e && e.persisted) return;
      run("pagehide");
    };
    const onFreeze = () => run("freeze");

    document.addEventListener("visibilitychange", onHide);
    addEventListener("pagehide", onPageHide);
    addEventListener("freeze", onFreeze);

    return {
      flushNow: (reason) => run(reason || "manual"),
      stop() {
        stopped = true;
        clearInterval(timer);
        document.removeEventListener("visibilitychange", onHide);
        removeEventListener("pagehide", onPageHide);
        removeEventListener("freeze", onFreeze);
      },
    };
  }

  // ─── thumbnails ────────────────────────────────────────────────────────

  // A frame from the game, small enough to live in localStorage. Returns null
  // rather than a black rectangle: a WebGL canvas without preserveDrawingBuffer
  // reads back blank, and an emulator that hasn't drawn yet reads back one
  // colour. Either way the caller falls back to the game's poster art.
  function thumbFromCanvas(canvas, width) {
    try {
      if (!canvas || !canvas.width || !canvas.height) return null;
      const w = width || THUMB_WIDTH;
      const h = Math.max(1, Math.round((canvas.height / canvas.width) * w));
      const off = document.createElement("canvas");
      off.width = w;
      off.height = h;
      const ctx = off.getContext("2d");
      if (!ctx) return null;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(canvas, 0, 0, w, h);
      if (distinctColours(ctx, w, h) < 2) return null;
      return off.toDataURL("image/jpeg", 0.7);
    } catch {
      // Tainted canvas, zero-sized canvas, or a context we can't read.
      return null;
    }
  }

  // Same idea from raw pixels, for runtimes that hand us an ImageData rather
  // than letting us read their canvas (js-dos `ci.screenshot()`).
  function thumbFromImageData(image, width) {
    try {
      if (!image || !image.width) return null;
      const src = document.createElement("canvas");
      src.width = image.width;
      src.height = image.height;
      const sctx = src.getContext("2d");
      if (!sctx) return null;
      sctx.putImageData(image, 0, 0);
      return thumbFromCanvas(src, width);
    } catch {
      return null;
    }
  }

  // Cheap "is there a picture here" test. Sampled, because a full scan of a
  // 320x200 frame on every save is wasted work for a yes/no answer.
  function distinctColours(ctx, w, h) {
    const data = ctx.getImageData(0, 0, w, h).data;
    const seen = new Set();
    for (let i = 0; i < data.length; i += 16) {
      seen.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
      if (seen.size > 8) break;
    }
    return seen.size;
  }

  // ─── payload packing ───────────────────────────────────────────────────
  //
  // A path->bytes map, flattened and gzipped. Save files are text-heavy and
  // full of runs, so this typically costs a fifth of the raw bytes for a few
  // milliseconds of work.
  //   u32 count, then per file: u16 pathLen | path (utf8) | u32 len | bytes
  const HAS_CS = typeof CompressionStream === "function";

  async function pack(map) {
    const enc = new TextEncoder();
    const entries = Object.entries(map).map(([path, bytes]) => ({
      path: enc.encode(path),
      bytes: bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes),
    }));
    let size = 4;
    for (const e of entries) size += 2 + e.path.length + 4 + e.bytes.length;

    const out = new Uint8Array(size);
    const view = new DataView(out.buffer);
    let off = 0;
    view.setUint32(off, entries.length, true); off += 4;
    for (const e of entries) {
      view.setUint16(off, e.path.length, true); off += 2;
      out.set(e.path, off); off += e.path.length;
      view.setUint32(off, e.bytes.length, true); off += 4;
      out.set(e.bytes, off); off += e.bytes.length;
    }
    if (!HAS_CS) return { gz: false, blob: out };
    const stream = new Blob([out]).stream().pipeThrough(new CompressionStream("gzip"));
    return { gz: true, blob: new Uint8Array(await new Response(stream).arrayBuffer()) };
  }

  async function unpack(packed) {
    if (!packed || !packed.blob) return {};
    let raw = packed.blob instanceof Uint8Array ? packed.blob : new Uint8Array(packed.blob);
    if (packed.gz) {
      const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream("gzip"));
      raw = new Uint8Array(await new Response(stream).arrayBuffer());
    }
    const dec = new TextDecoder();
    const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    const map = {};
    let off = 0;
    const count = view.getUint32(off, true); off += 4;
    for (let i = 0; i < count; i++) {
      const pathLen = view.getUint16(off, true); off += 2;
      const path = dec.decode(raw.subarray(off, off + pathLen)); off += pathLen;
      const len = view.getUint32(off, true); off += 4;
      map[path] = raw.slice(off, off + len); off += len;
    }
    return map;
  }

  // ─── the iframed ports ─────────────────────────────────────────────────
  //
  // ScummVM, OpenTTD and the two Pinball builds run inside same-origin
  // iframes and can't see this module, so a bridge script inside each one
  // reports through postMessage. Origin-checked, and the shape is validated
  // rather than trusted — an index record is UI, but it's UI we generate from
  // whatever arrives here.
  addEventListener("message", (e) => {
    if (e.origin !== location.origin) return;
    const msg = e.data;
    if (!msg || typeof msg !== "object" || typeof msg.slug !== "string") return;
    if (msg.type === "exe-save") {
      note({
        slug: msg.slug,
        name: typeof msg.name === "string" ? msg.name : undefined,
        runtime: "emscripten",
        kind: "files",
        payload: msg.db ? { db: String(msg.db) } : null,
        bytes: Number(msg.bytes) || 0,
        thumb: typeof msg.thumb === "string" && msg.thumb.startsWith("data:image/") ? msg.thumb : undefined,
      });
    } else if (msg.type === "exe-played") {
      markPlayed(msg.slug, typeof msg.name === "string" ? msg.name : undefined, "emscripten");
    }
  });

  // ─── init ──────────────────────────────────────────────────────────────

  if (navigator.storage && navigator.storage.estimate) {
    navigator.storage.estimate().then(est => {
      if (est && est.quota) {
        budget = Math.max(BUDGET_MIN, Math.min(BUDGET_MAX, Math.floor(est.quota * BUDGET_SHARE)));
      }
    }).catch(() => { /* keep the default ceiling */ });
  }

  // Off the critical path — nothing on screen waits for this.
  const idle = window.requestIdleCallback || (fn => setTimeout(fn, 1200));
  idle(() => reconcile().catch(() => {}));

  window.SaveCore = {
    get, hasSave, all, saves, note, markPlayed, drop, usage,
    schedule, thumbFromCanvas, thumbFromImageData, pack, unpack,
    reconcile,
  };
})();
