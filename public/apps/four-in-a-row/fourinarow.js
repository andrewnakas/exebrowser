// Four in a Row — a from-scratch implementation of the classic vertical
// connection game, written for ExeBrowser. No emulator, no download.
//
// Rules: a 7-column, 6-row upright grid; players take turns dropping a disc
// into a column, where it falls to the lowest free hole. Four in a line —
// across, up or diagonally — wins. A full board is a draw. Who starts
// alternates game to game.
//
// The computer is a negamax search with alpha-beta pruning, centre-first move
// ordering and a window-counting evaluation; "Level" sets the depth.
(() => {
  "use strict";

  const COLS = 7, ROWS = 6, EMPTY = 0, HUMAN = 1, CPU = 2;
  const el = (id) => document.getElementById(id);
  const ORDER = [3, 2, 4, 1, 5, 0, 6];

  const state = {
    grid: [], turn: HUMAN, starter: HUMAN, history: [],
    over: false, wins: [0, 0], winLine: null,
  };

  const at = (g, r, c) => g[r * COLS + c];

  function dropRow(g, c) {
    for (let r = ROWS - 1; r >= 0; r--) if (g[r * COLS + c] === EMPTY) return r;
    return -1;
  }

  // Every line of four on the board, computed once.
  const LINES = [];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
      const er = r + 3 * dr, ec = c + 3 * dc;
      if (er < 0 || er >= ROWS || ec < 0 || ec >= COLS) continue;
      LINES.push([0, 1, 2, 3].map((k) => (r + k * dr) * COLS + (c + k * dc)));
    }
  }

  function winner(g) {
    for (const L of LINES) {
      const v = g[L[0]];
      if (v && v === g[L[1]] && v === g[L[2]] && v === g[L[3]]) return { p: v, line: L };
    }
    return null;
  }

  function evaluate(g, p) {
    const o = p === HUMAN ? CPU : HUMAN;
    let s = 0;
    for (let r = 0; r < ROWS; r++) {
      if (g[r * COLS + 3] === p) s += 3; else if (g[r * COLS + 3] === o) s -= 3;
    }
    for (const L of LINES) {
      let mine = 0, theirs = 0;
      for (const i of L) { if (g[i] === p) mine++; else if (g[i] === o) theirs++; }
      if (mine && theirs) continue;
      if (mine === 3) s += 5; else if (mine === 2) s += 2;
      if (theirs === 3) s -= 4; else if (theirs === 2) s -= 2;
    }
    return s;
  }

  function negamax(g, depth, alpha, beta, p, moveCount) {
    const o = p === HUMAN ? CPU : HUMAN;
    if (moveCount === COLS * ROWS) return 0;
    if (depth === 0) return evaluate(g, p);
    let best = -Infinity;
    for (const c of ORDER) {
      const r = dropRow(g, c);
      if (r < 0) continue;
      g[r * COLS + c] = p;
      let sc;
      if (winner(g)?.p === p) sc = 1000 + depth;   // sooner wins score higher
      else sc = -negamax(g, depth - 1, -beta, -alpha, o, moveCount + 1);
      g[r * COLS + c] = EMPTY;
      if (sc > best) best = sc;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }
    return best;
  }

  function cpuChoose() {
    const g = state.grid.slice();
    const depth = Number(el("level").value) || 5;
    const filled = g.filter((v) => v).length;
    let best = -1, bestScore = -Infinity;
    for (const c of ORDER) {
      const r = dropRow(g, c);
      if (r < 0) continue;
      g[r * COLS + c] = CPU;
      let sc = winner(g)?.p === CPU ? 100000
        : -negamax(g, depth - 1, -Infinity, Infinity, HUMAN, filled + 1);
      if (depth <= 2) sc += Math.random() * 6;   // Easy should feel human
      g[r * COLS + c] = EMPTY;
      if (sc > bestScore) { bestScore = sc; best = c; }
    }
    return best;
  }

  // ---- UI ----------------------------------------------------------------

  const boardEl = el("board");
  const holes = [];
  for (let i = 0; i < COLS * ROWS; i++) {
    const h = document.createElement("div");
    h.className = "hole";
    h.dataset.col = i % COLS;
    boardEl.appendChild(h);
    holes.push(h);
  }
  const colOf = (e) => {
    const rect = boardEl.getBoundingClientRect();
    return Math.min(COLS - 1, Math.max(0, Math.floor(((e.clientX - rect.left) / rect.width) * COLS)));
  };
  boardEl.addEventListener("click", (e) => humanMove(colOf(e)));
  boardEl.addEventListener("pointermove", (e) => hint(e.pointerType === "mouse" ? colOf(e) : -1));
  boardEl.addEventListener("pointerleave", () => hint(-1));
  addEventListener("keydown", (e) => {
    const n = Number(e.key);
    if (n >= 1 && n <= 7) humanMove(n - 1);
  });

  function hint(c) {
    boardEl.classList.toggle("col-hover", c >= 0 && state.turn === HUMAN && !state.over);
    holes.forEach((h, i) => h.classList.toggle("hint", i % COLS === c && state.grid[i] === EMPTY));
  }

  let drawn = [];
  function render(msg) {
    const g = state.grid;
    const win = new Set(state.winLine || []);
    for (let i = 0; i < g.length; i++) {
      const want = "hole" + (g[i] === HUMAN ? " r" : g[i] === CPU ? " y" : "") + (win.has(i) ? " win" : "");
      // Only touch changed holes so the drop animation plays once per disc.
      if (drawn[i] !== want) { holes[i].className = want; drawn[i] = want; }
    }
    el("sh").textContent = state.wins[0];
    el("sc").textContent = state.wins[1];
    el("undo").disabled = !state.history.length || state.turn !== HUMAN || state.over;
    if (msg != null) el("status").textContent = msg;
  }

  function place(c, p) {
    const r = dropRow(state.grid, c);
    if (r < 0) return false;
    state.grid[r * COLS + c] = p;
    const w = winner(state.grid);
    if (w) {
      state.over = true;
      state.winLine = w.line;
      state.wins[p === HUMAN ? 0 : 1]++;
      render(p === HUMAN ? "Four in a row — you win!" : "The computer connected four.");
      save?.save();
      return true;
    }
    if (state.grid.every((v) => v)) {
      state.over = true;
      render("The board is full — a draw.");
      save?.save();
    }
    return true;
  }

  function humanMove(c) {
    if (state.over || state.turn !== HUMAN) return;
    const before = state.grid.slice();
    if (!place(c, HUMAN)) return;
    state.history.push(before);
    if (state.over) return;
    state.turn = CPU;
    render("Computer is thinking…");
    hint(-1);
    setTimeout(cpuTurn, 300);
  }

  function cpuTurn() {
    if (state.over) return;
    place(cpuChoose(), CPU);
    if (state.over) return;
    state.turn = HUMAN;
    save?.mark();
    render("Your turn — tap a column (or press 1–7).");
  }

  function newGame() {
    state.grid = new Array(COLS * ROWS).fill(EMPTY);
    state.history = [];
    state.over = false;
    state.winLine = null;
    state.turn = state.starter;
    drawn = [];
    render(state.turn === HUMAN ? "You go first — tap a column (or press 1–7)." : "Computer goes first…");
    save?.mark();
    if (state.turn === CPU) setTimeout(cpuTurn, 450);
  }

  el("new").addEventListener("click", () => {
    if (state.over) state.starter = state.starter === HUMAN ? CPU : HUMAN;
    newGame();
  });
  el("undo").addEventListener("click", () => {
    if (!state.history.length || state.turn !== HUMAN || state.over) return;
    state.grid = state.history.pop();
    drawn = [];
    save?.mark();
    render("Move taken back. Your turn.");
  });

  const save = window.GameSave?.attach({
    key: "four-in-a-row",
    slug: "four-in-a-row",
    name: "Four in a Row",
    version: 1,
    serialize: () => ({
      g: state.over ? null : state.grid, h: state.history.slice(-21),
      st: state.starter, w: state.wins, lv: el("level").value,
    }),
    restore: (s) => {
      if (!s || !Array.isArray(s.w)) return false;
      state.wins = s.w;
      state.starter = s.st === CPU ? CPU : HUMAN;
      if (s.lv) el("level").value = s.lv;
      if (!Array.isArray(s.g) || s.g.length !== COLS * ROWS) return false;
      state.grid = s.g;
      state.history = Array.isArray(s.h) ? s.h : [];
      state.turn = HUMAN;
      state.over = false;
      return true;
    },
  });

  if (save?.restored) render("Welcome back — your game is where you left it.");
  else newGame();
})();
