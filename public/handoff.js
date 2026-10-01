// Carries the files a visitor already picked from one loader to the other —
// the Windows loader (/load-exe/) and the DOS player (/dos-emulator/) — so a
// "wrong runtime" notice can be a single click instead of "pick it again".
//
// One pending record in IndexedDB, taken (and deleted) by the page it was sent
// to. Files and Uint8Arrays survive structured clone, so nothing is encoded.
// It never leaves the browser, and a record nobody collects is dropped after
// ten minutes rather than lingering.
(() => {
  "use strict";
  const DB = "exebrowserHandoff", STORE = "pending", KEY = "files", TTL_MS = 10 * 60 * 1000;

  function open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  function tx(mode, fn) {
    return open().then((db) => new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      t.oncomplete = () => { db.close(); resolve(req && req.result); };
      t.onerror = () => { db.close(); reject(t.error); };
    }));
  }

  window.ExeHandoff = {
    // files: [{ path, bytes: Uint8Array }]; entry: the path to start with.
    put(files, entry) {
      return tx("readwrite", (s) => s.put({ files, entry, at: Date.now() }, KEY)).catch(() => {});
    },
    async take() {
      const rec = await tx("readonly", (s) => s.get(KEY));
      if (rec) await tx("readwrite", (s) => s.delete(KEY));
      return rec && Date.now() - rec.at < TTL_MS ? rec : null;
    },
  };
})();
