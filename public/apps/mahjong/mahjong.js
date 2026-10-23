// Mahjong Solitaire — a from-scratch implementation of the tile-matching
// patience game, written for ExeBrowser. No emulator, no download.
//
// Rules: remove the tiles in matching pairs. A tile can be taken only when
// nothing lies on top of it and its left or right side is open. Clear the
// board to win.
//
// Every deal can be cleared: tiles are assigned by playing a random game
// backwards on the empty layout — repeatedly picking two positions that would
// both be free and giving them the same face. Shuffle re-deals the remaining
// tiles the same way, so it can't make a position unwinnable either.
//
// Tile art: FluffyStuff's riichi mahjong tiles, CC0 (tiles/LICENSE.md). That
// set has no flower or season tiles, so every layout here holds 136 tiles —
// 34 faces, four of each.
(() => {
  "use strict";

  const el = (id) => document.getElementById(id);
  const FACES = ["Man1", "Man2", "Man3", "Man4", "Man5", "Man6", "Man7", "Man8", "Man9",
    "Pin1", "Pin2", "Pin3", "Pin4", "Pin5", "Pin6", "Pin7", "Pin8", "Pin9",
    "Sou1", "Sou2", "Sou3", "Sou4", "Sou5", "Sou6", "Sou7", "Sou8", "Sou9",
    "Ton", "Nan", "Shaa", "Pei", "Haku", "Hatsu", "Chun"];
  const FACE_NAME = (f) => {
    const m = f.match(/^(Man|Pin|Sou)(\d)$/);
    if (m) return `${m[2]} of ${{ Man: "characters", Pin: "circles", Sou: "bamboo" }[m[1]]}`;
    return { Ton: "east wind", Nan: "south wind", Shaa: "west wind", Pei: "north wind",
      Haku: "white dragon", Hatsu: "green dragon", Chun: "red dragon" }[f];
  };

  // ---- Layouts: [x, y, z] in half-tile units, 136 positions each ----------

  function grid(out, z, x0, y0, cols, rows) {
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) out.push([x0 + 2 * c, y0 + 2 * r, z]);
  }
  const LAYOUTS = {
    turtle() {
      const out = [];
      [12, 8, 10, 12, 12, 10, 8, 12].forEach((n, r) => grid(out, 0, 12 - n, 2 * r, n, 1));
      grid(out, 1, 6, 2, 6, 6);
      grid(out, 2, 8, 4, 4, 4);
      return out;
    },
    pyramid() {
      const out = [];
      grid(out, 0, 0, 0, 12, 6);
      grid(out, 1, 2, 2, 10, 4);
      grid(out, 2, 6, 3, 6, 3);
      grid(out, 3, 9, 4, 3, 2);
      return out;
    },
    bridge() {
      const out = [];
      grid(out, 0, 0, 2, 14, 4);
      grid(out, 1, 2, 2, 12, 4);
      grid(out, 2, 6, 4, 8, 2);
      grid(out, 3, 6, 4, 8, 2);
      return out;
    },
    fortress() {
      const out = [];
      grid(out, 0, 0, 0, 10, 8);
      for (let x = 0; x <= 18; x += 2) for (let y = 0; y <= 14; y += 2) {
        const ring = x === 0 || x === 18 || y === 0 || y === 14;
        const inner = (x === 2 || x === 16) && (y === 2 || y === 12);
        if (ring || inner) out.push([x, y, 1]);
      }
      for (const [x, y] of [[0, 0], [16, 0], [0, 12], [16, 12]]) grid(out, 2, x, y, 2, 2);
      for (const [x, y] of [[1, 1], [17, 1], [1, 13], [17, 13]]) out.push([x, y, 3]);
      return out;
    },
  };

  // ---- Rules --------------------------------------------------------------

  let P = [];            // positions
  let above = [];        // above[i]: tiles resting on i
  let lefts = [], rights = [];
  function index(positions) {
    P = positions;
    above = P.map(() => []); lefts = P.map(() => []); rights = P.map(() => []);
    P.forEach(([x, y, z], i) => {
      P.forEach(([x2, y2, z2], j) => {
        if (i === j) return;
        if (z2 === z + 1 && Math.abs(x2 - x) < 2 && Math.abs(y2 - y) < 2) above[i].push(j);
        if (z2 === z && Math.abs(y2 - y) < 2) {
          if (x2 === x - 2) lefts[i].push(j);
          if (x2 === x + 2) rights[i].push(j);
        }
      });
    });
  }
  const isFree = (i, present) =>
    present[i] && !above[i].some((j) => present[j]) &&
    (!lefts[i].some((j) => present[j]) || !rights[i].some((j) => present[j]));

  // Assign faces to the given positions (all of `present`) so that the
  // removal order we invent is a valid solution. `pairs` is the list of faces,
  // one entry per pair to place.
  function dealOnto(present, pairs) {
    for (let attempt = 0; attempt < 200; attempt++) {
      const live = present.slice();
      const faces = P.map(() => -1);
      const order = pairs.slice().sort(() => Math.random() - 0.5);
      let ok = true;
      for (const f of order) {
        const free = [];
        for (let i = 0; i < P.length; i++) if (isFree(i, live)) free.push(i);
        if (free.length < 2) { ok = false; break; }
        const a = free.splice(Math.floor(Math.random() * free.length), 1)[0];
        const b = free[Math.floor(Math.random() * free.length)];
        faces[a] = faces[b] = f;
        live[a] = live[b] = false;
      }
      if (ok) return faces;
    }
    return null;
  }

  // ---- State --------------------------------------------------------------

  const state = { layout: "turtle", faces: [], present: [], history: [], sel: -1, time: 0, over: false };

  function freePairs() {
    const byFace = new Map();
    for (let i = 0; i < P.length; i++) {
      if (!isFree(i, state.present)) continue;
      const f = state.faces[i];
      (byFace.get(f) || byFace.set(f, []).get(f)).push(i);
    }
    const out = [];
    for (const list of byFace.values()) for (let a = 0; a < list.length; a++) for (let b = a + 1; b < list.length; b++) out.push([list[a], list[b]]);
    return out;
  }

  // ---- Rendering ----------------------------------------------------------

  const field = el("field");
  let tiles = [];
  let W = 40, H = 53, D = 5;

  function build() {
    field.textContent = "";
    tiles = P.map(([x, y, z], i) => {
      const t = document.createElement("button");
      t.className = "tile";
      t.style.zIndex = z * 1000 + y * 30 + x;
      const img = document.createElement("img");
      img.alt = "";
      t.appendChild(img);
      t.addEventListener("click", () => tap(i));
      field.appendChild(t);
      return t;
    });
    layout();
  }

  function layout() {
    const stage = el("stage").getBoundingClientRect();
    const maxX = Math.max(...P.map((p) => p[0])) + 2;
    const maxY = Math.max(...P.map((p) => p[1])) + 2;
    const maxZ = Math.max(...P.map((p) => p[2]));
    // Tile faces are 3:4. Fit the whole layout, depth offsets included.
    const byW = (stage.width - 8) / (maxX / 2 + maxZ * 0.16 + 0.2);
    const byH = (stage.height - 8) / ((maxY / 2) * (4 / 3) + maxZ * 0.16 + 0.2);
    W = Math.max(14, Math.min(byW, byH * 1, 78));
    H = W * 4 / 3;
    D = W * 0.16;
    const fw = (maxX / 2) * W + maxZ * D, fh = (maxY / 2) * H + maxZ * D;
    field.style.width = fw + "px";
    field.style.height = fh + "px";
    field.style.marginLeft = -fw / 2 + "px";
    field.style.marginTop = -fh / 2 + "px";
    P.forEach(([x, y, z], i) => {
      const s = tiles[i].style;
      s.width = W + "px";
      s.height = H + "px";
      s.left = (x / 2) * W - z * D + maxZ * D + "px";
      s.top = (y / 2) * H - z * D + maxZ * D + "px";
      s.setProperty("--dx", Math.max(2, D * 0.75) + "px");
    });
  }

  function render(msg) {
    tiles.forEach((t, i) => {
      const f = FACES[state.faces[i]];
      const img = t.firstChild;
      const src = `tiles/${f}.svg`;
      if (img.getAttribute("src") !== src) img.setAttribute("src", src);
      const free = isFree(i, state.present);
      t.className = "tile" + (!state.present[i] ? " gone" : free ? "" : " blocked") + (i === state.sel ? " sel" : "");
      t.setAttribute("aria-label", FACE_NAME(f) + (free ? "" : " (blocked)"));
      t.tabIndex = state.present[i] && free ? 0 : -1;
    });
    const left = state.present.filter(Boolean).length / 2;
    el("left").textContent = left;
    el("avail").textContent = left ? freePairs().length : "–";
    el("undo").disabled = !state.history.length;
    if (msg != null) el("status").textContent = msg;
  }

  function tap(i) {
    if (state.over || !state.present[i]) return;
    if (!isFree(i, state.present)) return render("That tile is blocked — it needs a free left or right side, and nothing on top.");
    if (state.sel === i) { state.sel = -1; return render(""); }
    if (state.sel >= 0 && state.faces[state.sel] === state.faces[i]) {
      const a = state.sel;
      state.present[a] = state.present[i] = false;
      state.history.push([a, i]);
      state.sel = -1;
      return afterMove();
    }
    state.sel = i;
    render("");
  }

  function afterMove() {
    const left = state.present.filter(Boolean).length;
    if (!left) {
      state.over = true;
      save?.clear();
      render(`Cleared! You finished in ${clock(state.time)}. Press New game for another.`);
      return;
    }
    save?.mark();
    render(freePairs().length ? "" : "No more matching pairs — press Shuffle (or Undo).");
  }

  const clock = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  setInterval(() => {
    if (state.over || document.visibilityState !== "visible" || !state.history.length) return;
    state.time++;
    el("time").textContent = clock(state.time);
  }, 1000);

  // ---- Controls -----------------------------------------------------------

  function newGame(name) {
    state.layout = LAYOUTS[name] ? name : "turtle";
    el("layout").value = state.layout;
    index(LAYOUTS[state.layout]());
    const pairs = [];
    for (let f = 0; f < FACES.length; f++) pairs.push(f, f);
    state.present = P.map(() => true);
    state.faces = dealOnto(state.present, pairs);
    state.history = [];
    state.sel = -1;
    state.time = 0;
    state.over = false;
    el("time").textContent = "0:00";
    build();
    save?.clear();
    render("Match pairs of free tiles — a tile is free when nothing covers it and its left or right side is open.");
  }

  el("new").addEventListener("click", () => newGame(el("layout").value));
  el("layout").addEventListener("change", () => newGame(el("layout").value));
  el("undo").addEventListener("click", () => {
    const last = state.history.pop();
    if (!last) return;
    for (const i of last) state.present[i] = true;
    state.sel = -1;
    state.over = false;
    save?.mark();
    render("Pair put back.");
  });
  el("hint").addEventListener("click", () => {
    const pairs = freePairs();
    if (!pairs.length) return render("No pairs available — try Shuffle.");
    const [a, b] = pairs[Math.floor(Math.random() * pairs.length)];
    for (const i of [a, b]) {
      tiles[i].classList.remove("hint");
      void tiles[i].offsetWidth;
      tiles[i].classList.add("hint");
    }
    render("");
  });
  el("shuffle").addEventListener("click", () => {
    if (state.over) return;
    const counts = new Map();
    state.present.forEach((p, i) => { if (p) counts.set(state.faces[i], (counts.get(state.faces[i]) || 0) + 1); });
    const pairs = [];
    for (const [f, n] of counts) for (let k = 0; k < n / 2; k++) pairs.push(f);
    const dealt = dealOnto(state.present, pairs);
    if (!dealt) return render("Couldn't find a winnable shuffle — try Undo.");
    state.present.forEach((p, i) => { if (p) state.faces[i] = dealt[i]; });
    state.sel = -1;
    // Undo past a shuffle would restore pairs onto the wrong faces.
    state.history = [];
    save?.mark();
    render("Shuffled — the remaining tiles can still all be cleared.");
  });

  let resizeTimer;
  addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(layout, 80); });

  const save = window.GameSave?.attach({
    key: "mahjong",
    slug: "mahjong",
    name: "Mahjong Solitaire",
    version: 1,
    serialize: () => (state.over ? null : {
      l: state.layout, f: state.faces, p: state.present.map(Number).join(""),
      h: state.history.slice(-136), t: state.time,
    }),
    restore: (s) => {
      if (!s || !LAYOUTS[s.l] || !Array.isArray(s.f)) return false;
      index(LAYOUTS[s.l]());
      if (s.f.length !== P.length || typeof s.p !== "string" || s.p.length !== P.length) return false;
      state.layout = s.l;
      el("layout").value = s.l;
      state.faces = s.f;
      state.present = [...s.p].map((c) => c === "1");
      state.history = Array.isArray(s.h) ? s.h : [];
      state.time = s.t || 0;
      el("time").textContent = clock(state.time);
      build();
      return true;
    },
  });

  if (save?.restored) render("Welcome back — your game is where you left it.");
  else newGame("turtle");
})();
