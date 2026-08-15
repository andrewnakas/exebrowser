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
    const { key, serialize, restore, version = 1, slug, name } = cfg;
    if (!key || typeof serialize !== "function") {
      throw new Error("GameSave.attach needs a key and a serialize function");
    }
    const storeKey = PREFIX + key;
    let dirty = false;

    // These games run in a same-origin iframe, so the shared index in the
    // parent frame is directly reachable — no postMessage needed. `slug` is
    // the page ("solitaire-open"), which is not the storage `key`
    // ("solitaire"); changing the key would orphan every existing save.
    const core = () => window.SaveCore || parent.SaveCore;

    function shot() {
      try {
        const canvas = document.querySelector("canvas");
        return canvas ? core()?.thumbFromCanvas(canvas) : null;
      } catch {
        return null; // cross-origin parent, or no canvas — poster art it is
      }
    }

    function write() {
      if (!dirty) return;
      dirty = false;
      try {
        const state = serialize();
        if (state == null) {
          localStorage.removeItem(storeKey);
          if (slug) try { core()?.drop(slug); } catch { /* index is optional */ }
          return;
        }
        const body = JSON.stringify({ v: version, t: Date.now(), s: state });
        // A state this big means a bug (an unbounded history array, usually).
        // Dropping it is better than poisoning storage the player can't clear.
        if (body.length > MAX_BYTES) return;
        localStorage.setItem(storeKey, body);
        if (slug) {
          try {
            core()?.note({
              slug,
              name: name || slug,
              runtime: "native",
              kind: "state",
              payload: { local: storeKey },
              bytes: body.length,
              thumb: shot(),
            });
          } catch { /* the save landed; the index entry is a nicety */ }
        }
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
      if (slug) try { core()?.drop(slug); } catch { /* index is optional */ }
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

    let announced = false;
    const api = {
      mark() {
        dirty = true;
        // First real state change is the honest moment to call this "played".
        // The pages used to announce it on load, so a game you opened and
        // never touched still showed up as one to continue.
        if (slug && !announced) {
          announced = true;
          try { core()?.markPlayed(slug, name || slug, "native"); } catch { /* optional */ }
        }
      },
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
