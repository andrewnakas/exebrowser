// 2048 — a from-scratch implementation of the tile-merging puzzle.
//
// Written for ExeBrowser. The original 2048 by Gabriele Cirulli is MIT
// licensed, but this shares no code with it — the rules are simple enough to
// implement directly, and doing so keeps the provenance clean and the file
// small enough to inline.
//
// Rules as the original defined them:
//   * 4x4 grid; every move slides every tile as far as it will go.
//   * Two tiles of equal value merge into their sum, and a tile produced by a
//     merge can't merge again on the same move — the rule that stops a row of
//     four 2s collapsing straight to an 8.
//   * A new 2 (90%) or 4 (10%) appears in a random empty cell after any move
//     that actually changed something.
//   * Reaching 2048 wins, but play continues; the game ends when no move is
//     possible in any direction.
(() => {
  "use strict";

  const SIZE = 4;
  const el = (id) => document.getElementById(id);
  const boardEl = el("board"), scoreEl = el("score"), bestEl = el("best");
  const undoBtn = el("undo"), msgEl = el("msg");

  let grid, score = 0, best = 0, over = false, won = false;
  let prev = null;                 // one level of undo, like the original
  let tileNodes = new Map();       // id -> node, so tiles animate rather than flicker
  let nextId = 1;

  const BEST_KEY = "exe_2048_best";
  try { best = parseInt(localStorage.getItem(BEST_KEY), 10) || 0; } catch { best = 0; }

  function rnd(n) {
    if (window.crypto && window.crypto.getRandomValues) {
      const limit = Math.floor(0x100000000 / n) * n;
      const buf = new Uint32Array(1);
      let v;
      do { window.crypto.getRandomValues(buf); v = buf[0]; } while (v >= limit);
      return v % n;
    }
    return Math.floor(Math.random() * n);
  }

  function newGame() {
    grid = Array.from({ length: SIZE }, () => new Array(SIZE).fill(null));
    score = 0; over = false; won = false; prev = null;
    boardEl.innerHTML = "";
    tileNodes.clear();
    drawCellBackgrounds();
    addRandom(); addRandom();
    save?.clear();
    say(""); render(); hud();
  }

  // ── resume ─────────────────────────────────────────────────────────────────
  //
  // Only the grid, the undo snapshot and the counters are stored. `tileNodes`
  // is a map of live DOM nodes and must never go near the save — render()
  // rebuilds it from the grid on the way back. `best` keeps its own key.
  const save = window.GameSave?.attach({
    key: "2048",
    version: 1,
    serialize: () => (over ? null : { g: grid, sc: score, w: won, p: prev, id: nextId }),
    restore: (s) => {
      if (!s || !Array.isArray(s.g) || s.g.length !== SIZE) return false;
      grid = s.g;
      score = s.sc;
      won = !!s.w;
      prev = s.p || null;
      nextId = s.id || 1;
      over = false;
      // The stored tiles already appeared; replaying their spawn animation on
      // load makes a resumed board look like a fresh deal.
      for (const row of grid) for (const c of row) if (c) { c.isNew = false; c.merged = false; }
      return true;
    },
  });

  function drawCellBackgrounds() {
    const cs = getComputedStyle(document.documentElement);
    const t = parseFloat(cs.getPropertyValue("--tile"));
    const g = parseFloat(cs.getPropertyValue("--gap"));
    for (let y = 0; y < SIZE; y++)
      for (let x = 0; x < SIZE; x++) {
        const d = document.createElement("div");
        d.className = "cellbg";
        d.style.left = `${g + x * (t + g)}px`;
        d.style.top = `${g + y * (t + g)}px`;
        boardEl.appendChild(d);
      }
  }

  function addRandom() {
    const free = [];
    for (let y = 0; y < SIZE; y++)
      for (let x = 0; x < SIZE; x++) if (!grid[y][x]) free.push([x, y]);
    if (!free.length) return;
    const [x, y] = free[rnd(free.length)];
    grid[y][x] = { v: rnd(10) === 0 ? 4 : 2, id: nextId++, isNew: true };
  }

  // ── moving ───────────────────────────────────────────────────────────────
  //
  // Every direction is the same operation on a line, so extract each line in
  // move order, collapse it, and write it back. That keeps one implementation
  // rather than four subtly different ones.
  function collapse(line) {
    const cells = line.filter(Boolean);
    const out = [];
    let gained = 0;
    for (let i = 0; i < cells.length; i++) {
      // A tile formed by a merge is inert for the rest of this move.
      if (i + 1 < cells.length && cells[i].v === cells[i + 1].v) {
        const v = cells[i].v * 2;
        out.push({ v, id: cells[i].id, merged: true });
        gained += v;
        i++;
      } else {
        out.push(cells[i]);
      }
    }
    while (out.length < SIZE) out.push(null);
    return { out, gained };
  }

  function move(dir) {
    if (over) return false;
    const before = JSON.stringify(grid.map((r) => r.map((c) => (c ? c.v : 0))));
    const snapshot = { g: JSON.parse(JSON.stringify(grid)), s: score };

    let gained = 0;
    for (let i = 0; i < SIZE; i++) {
      let line = [];
      for (let j = 0; j < SIZE; j++) line.push(readCell(dir, i, j));
      const r = collapse(line);
      gained += r.gained;
      for (let j = 0; j < SIZE; j++) writeCell(dir, i, j, r.out[j]);
    }

    const after = JSON.stringify(grid.map((r) => r.map((c) => (c ? c.v : 0))));
    if (before === after) return false;      // nothing moved — not a turn

    score += gained;
    if (score > best) {
      best = score;
      try { localStorage.setItem(BEST_KEY, String(best)); } catch { /* private mode */ }
    }
    prev = snapshot;
    undoBtn.disabled = false;
    addRandom();
    save?.mark();
    render(); hud();
    checkState();
    return true;
  }

  // Map (line, position) to a grid cell for each direction, so `collapse`
  // always sees the line in the order the tiles are travelling.
  function readCell(dir, i, j) {
    if (dir === "left")  return grid[i][j];
    if (dir === "right") return grid[i][SIZE - 1 - j];
    if (dir === "up")    return grid[j][i];
    return grid[SIZE - 1 - j][i];
  }
  function writeCell(dir, i, j, v) {
    if (dir === "left")  grid[i][j] = v;
    else if (dir === "right") grid[i][SIZE - 1 - j] = v;
    else if (dir === "up") grid[j][i] = v;
    else grid[SIZE - 1 - j][i] = v;
  }

  function canMove() {
    for (let y = 0; y < SIZE; y++)
      for (let x = 0; x < SIZE; x++) {
        if (!grid[y][x]) return true;
        const v = grid[y][x].v;
        if (x + 1 < SIZE && grid[y][x + 1] && grid[y][x + 1].v === v) return true;
        if (y + 1 < SIZE && grid[y + 1][x] && grid[y + 1][x].v === v) return true;
      }
    return false;
  }

  function checkState() {
    if (!won) {
      for (const row of grid) for (const c of row) if (c && c.v >= 2048) {
        won = true;
        say("2048! Keep going for a higher score.");
      }
    }
    if (!canMove()) {
      over = true;
      say(`No moves left — final score ${score}. Click New game.`);
    }
  }

  function undo() {
    if (!prev) return;
    grid = prev.g; score = prev.s;
    prev = null; over = false;
    undoBtn.disabled = true;
    save?.mark();
    say(""); render(); hud();
  }

  // ── rendering ────────────────────────────────────────────────────────────
  function render() {
    const cs = getComputedStyle(document.documentElement);
    const t = parseFloat(cs.getPropertyValue("--tile"));
    const g = parseFloat(cs.getPropertyValue("--gap"));

    const live = new Set();
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const c = grid[y][x];
        if (!c) continue;
        live.add(c.id);
        let node = tileNodes.get(c.id);
        if (!node) {
          node = document.createElement("div");
          boardEl.appendChild(node);
          tileNodes.set(c.id, node);
        }
        const cls = c.v <= 2048 ? `t${c.v}` : "big";
        node.className = "tile " + cls
          + (c.isNew ? " new" : "") + (c.merged ? " merged" : "");
        node.textContent = String(c.v);
        node.style.left = `${g + x * (t + g)}px`;
        node.style.top = `${g + y * (t + g)}px`;
        c.isNew = false; c.merged = false;
      }
    }
    // Remove nodes for tiles that were consumed by a merge.
    for (const [id, node] of tileNodes) {
      if (!live.has(id)) { node.remove(); tileNodes.delete(id); }
    }
  }

  function hud() {
    scoreEl.textContent = String(score);
    bestEl.textContent = String(best);
  }
  const say = (m) => { msgEl.textContent = m || ""; };

  // ── input ────────────────────────────────────────────────────────────────
  const KEYS = {
    ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down",
    KeyA: "left", KeyD: "right", KeyW: "up", KeyS: "down",
  };
  window.addEventListener("keydown", (e) => {
    const d = KEYS[e.code];
    if (!d) return;
    move(d);
    e.preventDefault();
  });
  for (const b of document.querySelectorAll("[data-dir]")) {
    b.addEventListener("click", () => move(b.dataset.dir));
  }

  // Swipe. The board is the whole game on a phone, so a gesture beats buttons.
  let sx = 0, sy = 0, tracking = false;
  boardEl.addEventListener("touchstart", (e) => {
    const t0 = e.changedTouches[0];
    sx = t0.clientX; sy = t0.clientY; tracking = true;
  }, { passive: true });
  boardEl.addEventListener("touchend", (e) => {
    if (!tracking) return;
    tracking = false;
    const t0 = e.changedTouches[0];
    const dx = t0.clientX - sx, dy = t0.clientY - sy;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;   // a tap, not a swipe
    move(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : (dy > 0 ? "down" : "up"));
  }, { passive: true });

  el("newgame").addEventListener("click", newGame);
  undoBtn.addEventListener("click", undo);

  // Shrink the tiles to fit a phone without changing the 4x4 board.
  function fit() {
    const avail = Math.min(window.innerWidth - 34, 420);
    const gap = 10;
    const tile = Math.max(52, Math.floor((avail - gap * 5) / 4));
    document.documentElement.style.setProperty("--tile", tile + "px");
    if (grid) { boardEl.innerHTML = ""; tileNodes.clear(); drawCellBackgrounds(); render(); }
  }
  window.addEventListener("resize", fit);

  fit();
  if (save?.restored) {
    // fit() has already rebuilt the backgrounds and rendered the stored grid;
    // all that's left is the chrome that reads off state rather than the board.
    undoBtn.disabled = !prev;
    say("Resumed your game"); hud();
  } else {
    newGame();
  }
})();
