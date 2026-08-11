// Auto-resume for the games we wrote ourselves.
//
// The emulated titles persist their *files* — a DOOM savegame slot survives,
// but you still come back to the title screen and load it by hand, because
// neither js-dos nor Boxedwine exposes a CPU/memory snapshot we could take.
// These games are our own code, so their whole state is a plain object and we
// can do the thing people actually expect: close the tab mid-hand, come back,
// still mid-hand.
//
// A game opts in with one call:
//
//   const save = window.GameSave.attach({
//     key: "solitaire",
//     version: 1,
//     serialize: () => ({ board, score, moves }),
//     restore: (s) => { board = s.board; score = s.score; moves = s.moves; },
//   });
//   save.mark();   // after any state change worth keeping
//   save.clear();  // when a game ends and there's nothing to resume into
//
// Storage is localStorage: these states are kilobytes, and unlike IndexedDB it
// can be written synchronously from a pagehide handler, which is the one moment
// that matters most here.
(() => {
  "use strict";

  const PREFIX = "exe_save_";
  const MAX_BYTES = 512 * 1024;

  function attach(cfg) {
    const { key, serialize, restore, version = 1 } = cfg;
    if (!key || typeof serialize !== "function") {
      throw new Error("GameSave.attach needs a key and a serialize function");
    }
    const storeKey = PREFIX + key;
    let dirty = false;

    function write() {
      if (!dirty) return;
      dirty = false;
      try {
        const state = serialize();
        if (state == null) return void localStorage.removeItem(storeKey);
        const body = JSON.stringify({ v: version, t: Date.now(), s: state });
        // A state this big means a bug (an unbounded history array, usually).
        // Dropping it is better than poisoning storage the player can't clear.
        if (body.length > MAX_BYTES) return;
        localStorage.setItem(storeKey, body);
      } catch {
        /* private mode, quota, or an unserialisable state — resume is a nicety */
      }
    }

    function read() {
      try {
        const raw = localStorage.getItem(storeKey);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        // A save written by an older build may not match today's state shape.
        if (!parsed || parsed.v !== version) {
          localStorage.removeItem(storeKey);
          return null;
        }
        return parsed.s;
      } catch {
        return null;
      }
    }

    function clear() {
      dirty = false;
      try { localStorage.removeItem(storeKey); } catch { /* nothing to do */ }
    }

    // pagehide is the only close-the-tab signal that fires reliably across
    // browsers (Safari never guaranteed unload, and bfcache skips it); the
    // hidden visibilitychange covers switching apps on mobile, where a tab can
    // be killed later with no further events.
    addEventListener("pagehide", write);
    addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") write();
    });
    // A periodic flush is the backstop for a tab that dies without warning
    // (OOM kill, crash, force-quit) — none of the events above fire then.
    setInterval(write, 10000);

    const api = {
      mark() { dirty = true; },
      save() { dirty = true; write(); },
      clear,
      load: read,
      hasSave() { return read() != null; },
    };

    // Restoring is the game's call — it knows whether it's safe to resume into
    // a stored state — but doing it here keeps every game's opt-in to one call.
    if (typeof restore === "function") {
      const stored = read();
      if (stored != null) {
        try {
          api.restored = restore(stored) !== false;
        } catch {
          clear();
          api.restored = false;
        }
      }
    }
    return api;
  }

  window.GameSave = { attach };
})();
