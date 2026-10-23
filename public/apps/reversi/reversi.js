// Reversi — a from-scratch implementation of the classic disc-flipping game.
//
// Written for ExeBrowser as a free, hostable board game: no emulator, no
// download, and it plays the same on a phone as on a desktop.
//
// Rules: 8x8 board, black moves first, a move must outflank at least one line
// of the opponent's discs, which then flip. A side with no legal move passes;
// the game ends when neither side can move. Most discs wins.
//
// The computer is an alpha-beta search over a positional weight table plus
// mobility, corner and disc-count terms; "Level" sets the search depth.
(() => {
  "use strict";

  const EMPTY = 0, HUMAN = 1, CPU = 2;
  const DIRS = [-9, -8, -7, -1, 1, 7, 8, 9];
  const other = (p) => (p === HUMAN ? CPU : HUMAN);
  const el = (id) => document.getElementById(id);

  // Classic square weights: corners are gold, the squares next to them are
  // poison until the corner is taken.
  const W = [
    100, -20, 10,  5,  5, 10, -20, 100,
    -20, -50, -2, -2, -2, -2, -50, -20,
     10,  -2,  1,  1,  1,  1,  -2,  10,
      5,  -2,  1,  0,  0,  1,  -2,   5,
      5,  -2,  1,  0,  0,  1,  -2,   5,
     10,  -2,  1,  1,  1,  1,  -2,  10,
    -20, -50, -2, -2, -2, -2, -50, -20,
    100, -20, 10,  5,  5, 10, -20, 100,
  ];

  const state = { board: [], turn: HUMAN, history: [], last: -1, over: false };

  function fresh() {
    const b = new Array(64).fill(EMPTY);
    b[27] = CPU; b[36] = CPU; b[28] = HUMAN; b[35] = HUMAN;
    return b;
  }

  // Walking off the left/right edge wraps rows in a flat array, so each step
  // checks the column didn't jump.
  function flipsFor(b, sq, p) {
    if (b[sq] !== EMPTY) return null;
    const o = other(p);
    let all = null;
    for (const d of DIRS) {
      const line = [];
      let s = sq, col = sq % 8;
      for (;;) {
        const n = s + d, nc = n % 8;
        if (n < 0 || n >= 64 || Math.abs(nc - col) > 1) { line.length = 0; break; }
        s = n; col = nc;
        if (b[s] === o) { line.push(s); continue; }
        if (b[s] !== p) line.length = 0;
        break;
      }
      if (line.length) (all ||= []).push(...line);
    }
    return all;
  }

  function moves(b, p) {
    const out = [];
    for (let s = 0; s < 64; s++) {
      if (b[s] !== EMPTY) continue;
      const f = flipsFor(b, s, p);
      if (f) out.push({ sq: s, flips: f });
    }
    return out;
  }

  function apply(b, m, p) {
    const n = b.slice();
    n[m.sq] = p;
    for (const s of m.flips) n[s] = p;
    return n;
  }

  const count = (b, p) => b.reduce((a, v) => a + (v === p), 0);

  function evaluate(b) {
    let pos = 0;
    for (let s = 0; s < 64; s++) {
      if (b[s] === CPU) pos += W[s];
      else if (b[s] === HUMAN) pos -= W[s];
    }
    const mc = moves(b, CPU).length, mh = moves(b, HUMAN).length;
    const mob = mc + mh ? (100 * (mc - mh)) / (mc + mh) : 0;
    const empties = b.reduce((a, v) => a + (v === EMPTY), 0);
    const discs = count(b, CPU) - count(b, HUMAN);
    // Disc count only matters near the end; early on, fewer discs is often better.
    return pos + mob * 2 + (empties < 14 ? discs * 6 : 0);
  }

  function search(b, depth, alpha, beta, p, passed) {
    const ms = moves(b, p);
    if (!ms.length) {
      if (passed) {
        const d = count(b, CPU) - count(b, HUMAN);
        return d > 0 ? 10000 + d : d < 0 ? -10000 + d : 0;
      }
      return search(b, depth, alpha, beta, other(p), true);
    }
    if (depth === 0) return evaluate(b);
    if (p === CPU) {
      let best = -Infinity;
      for (const m of ms) {
        best = Math.max(best, search(apply(b, m, p), depth - 1, alpha, beta, HUMAN, false));
        alpha = Math.max(alpha, best);
        if (alpha >= beta) break;
      }
      return best;
    }
    let best = Infinity;
    for (const m of ms) {
      best = Math.min(best, search(apply(b, m, p), depth - 1, alpha, beta, CPU, false));
      beta = Math.min(beta, best);
      if (alpha >= beta) break;
    }
    return best;
  }

  function cpuChoose(b) {
    const depth = Number(el("level").value) || 3;
    const ms = moves(b, CPU);
    // Try corners first so alpha-beta prunes harder.
    ms.sort((x, y) => W[y.sq] - W[x.sq]);
    let best = null, bestScore = -Infinity;
    for (const m of ms) {
      // A little noise on Easy so it doesn't play the identical game every time.
      const noise = depth === 1 ? Math.random() * 30 : 0;
      const sc = search(apply(b, m, CPU), depth - 1, -Infinity, Infinity, HUMAN, false) + noise;
      if (sc > bestScore) { bestScore = sc; best = m; }
    }
    return best;
  }

  // ---- UI ----------------------------------------------------------------

  const boardEl = el("board");
  const cells = [];
  for (let s = 0; s < 64; s++) {
    const c = document.createElement("button");
    c.className = "sq";
    c.setAttribute("aria-label", "abcdefgh"[s % 8] + (8 - Math.floor(s / 8)));
    c.addEventListener("click", () => humanMove(s));
    boardEl.appendChild(c);
    cells.push(c);
  }

  function render(msg) {
    const b = state.board;
    const legal = !state.over && state.turn === HUMAN ? new Set(moves(b, HUMAN).map((m) => m.sq)) : new Set();
    for (let s = 0; s < 64; s++) {
      const c = cells[s];
      c.className = "sq" + (legal.has(s) ? " legal" : "") + (s === state.last ? " last" : "");
      const want = b[s] === HUMAN ? "b" : b[s] === CPU ? "w" : "";
      const disc = c.firstChild;
      if (!want) { if (disc) c.removeChild(disc); continue; }
      if (disc) disc.className = "disc " + want;
      else { const d = document.createElement("span"); d.className = "disc " + want; c.appendChild(d); }
    }
    el("sb").textContent = count(b, HUMAN);
    el("sw").textContent = count(b, CPU);
    el("undo").disabled = !state.history.length || state.turn !== HUMAN;
    if (msg != null) el("status").textContent = msg;
  }

  function finish() {
    state.over = true;
    const h = count(state.board, HUMAN), c = count(state.board, CPU);
    save?.clear();
    render(h > c ? `You win, ${h}–${c}!` : h < c ? `Computer wins, ${c}–${h}.` : `A draw, ${h}–${c}.`);
  }

  function humanMove(sq) {
    if (state.over || state.turn !== HUMAN) return;
    const m = moves(state.board, HUMAN).find((x) => x.sq === sq);
    if (!m) return;
    state.history.push(state.board);
    state.board = apply(state.board, m, HUMAN);
    state.last = sq;
    state.turn = CPU;
    render("Computer is thinking…");
    setTimeout(cpuTurn, 350);
  }

  function cpuTurn() {
    const b = state.board;
    const ms = moves(b, CPU);
    if (!ms.length) {
      if (!moves(b, HUMAN).length) return finish();
      state.turn = HUMAN;
      save?.mark();
      return render("Computer has no move and passes. Your turn.");
    }
    const m = cpuChoose(b);
    state.board = apply(b, m, CPU);
    state.last = m.sq;
    afterCpu();
  }

  function afterCpu() {
    const b = state.board;
    if (moves(b, HUMAN).length) {
      state.turn = HUMAN;
      save?.mark();
      return render("Your turn — you play black.");
    }
    if (!moves(b, CPU).length) return finish();
    state.turn = CPU;
    render("You have no move and pass.");
    setTimeout(cpuTurn, 700);
  }

  function newGame() {
    state.board = fresh();
    state.turn = HUMAN;
    state.history = [];
    state.last = -1;
    state.over = false;
    save?.clear();
    render("Your turn — you play black. Tap a dotted square.");
  }

  el("new").addEventListener("click", newGame);
  el("undo").addEventListener("click", () => {
    if (!state.history.length || state.turn !== HUMAN) return;
    state.board = state.history.pop();
    state.last = -1;
    state.over = false;
    save?.mark();
    render("Move taken back. Your turn.");
  });

  const save = window.GameSave?.attach({
    key: "reversi",
    slug: "reversi",
    name: "Reversi",
    version: 1,
    serialize: () => (state.over || state.turn !== HUMAN ? null :
      { b: state.board, h: state.history.slice(-30), l: state.last, lv: el("level").value }),
    restore: (s) => {
      if (!s || !Array.isArray(s.b) || s.b.length !== 64) return false;
      state.board = s.b;
      state.history = Array.isArray(s.h) ? s.h : [];
      state.last = s.l ?? -1;
      state.turn = HUMAN;
      state.over = false;
      if (s.lv) el("level").value = s.lv;
      return true;
    },
  });

  if (save?.restored) render("Welcome back — your game is where you left it.");
  else newGame();
})();
