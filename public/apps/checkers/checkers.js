// Checkers — a from-scratch implementation of American checkers (English
// draughts), written for ExeBrowser. No emulator, no download.
//
// Rules: 8x8 board, play on the dark squares, red (you) moves first. Men move
// one square diagonally forward; kings move one square diagonally either way.
// Captures are compulsory, and a capturing piece must keep jumping while it
// can. A man reaching the far row is crowned, which ends the move. You lose
// when you have no legal move. Fifty moves each without a capture or a
// crowning is a draw.
//
// The computer is an alpha-beta search over material, kings, advancement and
// back-row defence; "Level" sets the depth.
(() => {
  "use strict";

  const HUMAN = "r", CPU = "w";
  const el = (id) => document.getElementById(id);
  const owner = (p) => (p ? p.toLowerCase() : null);
  const isKing = (p) => p === "R" || p === "W";
  const enemy = (s) => (s === HUMAN ? CPU : HUMAN);
  const idx = (r, c) => r * 8 + c;
  const inside = (r, c) => r >= 0 && r < 8 && c >= 0 && c < 8;

  const state = { board: [], turn: HUMAN, history: [], quiet: 0, over: false, last: [] };

  function fresh() {
    const b = new Array(64).fill(null);
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      if ((r + c) % 2 !== 1) continue;
      if (r < 3) b[idx(r, c)] = CPU;
      else if (r > 4) b[idx(r, c)] = HUMAN;
    }
    return b;
  }

  function dirsFor(p) {
    if (isKing(p)) return [[-1, -1], [-1, 1], [1, -1], [1, 1]];
    return owner(p) === HUMAN ? [[-1, -1], [-1, 1]] : [[1, -1], [1, 1]];
  }

  const crowns = (p, r) => !isKing(p) && ((p === HUMAN && r === 0) || (p === CPU && r === 7));

  // Depth-first search for every complete jump sequence from one square. The
  // jumped pieces stay on the board until the move ends (they can't be jumped
  // twice), which is the standard rule.
  function jumpsFrom(b, sq, p, path, caps, out) {
    const r = Math.floor(sq / 8), c = sq % 8;
    let extended = false;
    for (const [dr, dc] of dirsFor(p)) {
      const mr = r + dr, mc = c + dc, tr = r + 2 * dr, tc = c + 2 * dc;
      if (!inside(tr, tc)) continue;
      const mid = idx(mr, mc), to = idx(tr, tc);
      if (owner(b[mid]) !== enemy(owner(p)) || caps.includes(mid) || b[to]) continue;
      extended = true;
      const np = path.concat(to), nc = caps.concat(mid);
      if (crowns(p, tr)) { out.push({ path: np, caps: nc }); continue; }
      const saved = b[sq];
      b[sq] = null; b[to] = p;
      jumpsFrom(b, to, p, np, nc, out);
      b[to] = null; b[sq] = saved;
    }
    if (!extended && caps.length) out.push({ path, caps });
  }

  function moves(b, side) {
    const jumps = [], steps = [];
    for (let sq = 0; sq < 64; sq++) {
      const p = b[sq];
      if (owner(p) !== side) continue;
      const found = [];
      jumpsFrom(b, sq, p, [], [], found);
      for (const j of found) jumps.push({ from: sq, path: j.path, caps: j.caps });
      if (jumps.length) continue;
      const r = Math.floor(sq / 8), c = sq % 8;
      for (const [dr, dc] of dirsFor(p)) {
        const tr = r + dr, tc = c + dc;
        if (inside(tr, tc) && !b[idx(tr, tc)]) steps.push({ from: sq, path: [idx(tr, tc)], caps: [] });
      }
    }
    return jumps.length ? jumps : steps;
  }

  function apply(b, m) {
    const n = b.slice();
    let p = n[m.from];
    n[m.from] = null;
    for (const c of m.caps) n[c] = null;
    const to = m.path[m.path.length - 1];
    if (crowns(p, Math.floor(to / 8))) p = p.toUpperCase();
    n[to] = p;
    return n;
  }

  function evaluate(b) {
    let s = 0;
    for (let sq = 0; sq < 64; sq++) {
      const p = b[sq];
      if (!p) continue;
      const r = Math.floor(sq / 8), c = sq % 8;
      let v = isKing(p) ? 165 : 100;
      if (!isKing(p)) {
        v += (owner(p) === CPU ? r : 7 - r) * 3;                 // advancement
        if ((owner(p) === CPU && r === 0) || (owner(p) === HUMAN && r === 7)) v += 8; // back row
      }
      if (c >= 2 && c <= 5 && r >= 2 && r <= 5) v += 4;          // centre
      s += owner(p) === CPU ? v : -v;
    }
    return s;
  }

  function search(b, depth, alpha, beta, side) {
    const ms = moves(b, side);
    if (!ms.length) return side === CPU ? -100000 - depth : 100000 + depth;
    // Keep searching through forced captures so the horizon doesn't hide them.
    if (depth <= 0 && !ms[0].caps.length) return evaluate(b);
    if (depth < -6) return evaluate(b);
    if (side === CPU) {
      let best = -Infinity;
      for (const m of ms) {
        best = Math.max(best, search(apply(b, m), depth - 1, alpha, beta, HUMAN));
        alpha = Math.max(alpha, best);
        if (alpha >= beta) break;
      }
      return best;
    }
    let best = Infinity;
    for (const m of ms) {
      best = Math.min(best, search(apply(b, m), depth - 1, alpha, beta, CPU));
      beta = Math.min(beta, best);
      if (alpha >= beta) break;
    }
    return best;
  }

  function cpuChoose() {
    const depth = Number(el("level").value) || 4;
    const ms = moves(state.board, CPU);
    let best = ms[0], bestScore = -Infinity;
    for (const m of ms) {
      let sc = search(apply(state.board, m), depth - 1, -Infinity, Infinity, HUMAN);
      sc += Math.random() * (depth <= 2 ? 25 : 2);   // break ties; Easy wanders more
      if (sc > bestScore) { bestScore = sc; best = m; }
    }
    return best;
  }

  // ---- UI ----------------------------------------------------------------

  const boardEl = el("board");
  const cells = [];
  for (let sq = 0; sq < 64; sq++) {
    const b = document.createElement("button");
    const r = Math.floor(sq / 8), c = sq % 8;
    b.className = "sq" + ((r + c) % 2 ? " dark" : "");
    b.setAttribute("aria-label", "abcdefgh"[c] + (8 - r));
    b.addEventListener("click", () => tap(sq));
    boardEl.appendChild(b);
    cells.push(b);
  }

  // The move being entered: a chosen piece plus the landing squares so far.
  let sel = null;
  const candidates = () => {
    if (!sel) return [];
    return moves(state.board, HUMAN).filter((m) =>
      m.from === sel.from && sel.steps.every((s, i) => m.path[i] === s));
  };

  function render(msg) {
    const b = state.board;
    const myTurn = !state.over && state.turn === HUMAN;
    const legal = myTurn ? moves(b, HUMAN) : [];
    const movable = new Set(legal.map((m) => m.from));
    const cands = candidates();
    const targets = new Set(cands.map((m) => m.path[sel.steps.length]).filter((x) => x != null));
    const trail = new Set(sel ? sel.steps : []);
    const capped = new Set(cands.length ? cands[0].caps.slice(0, sel.steps.length) : []);
    const last = new Set(state.last);
    for (let sq = 0; sq < 64; sq++) {
      const r = Math.floor(sq / 8), c = sq % 8;
      const cell = cells[sq];
      let cls = "sq" + ((r + c) % 2 ? " dark" : "");
      if (sel && sq === sel.from) cls += " sel";
      else if (trail.has(sq)) cls += " trail";
      if (targets.has(sq)) cls += " target";
      if (!sel && movable.has(sq)) cls += " can";
      if (last.has(sq)) cls += " last";
      cell.className = cls;
      const p = b[sq];
      cell.textContent = "";
      if (p) {
        const d = document.createElement("span");
        d.className = "pc " + owner(p) + (capped.has(sq) ? " cap" : "");
        if (isKing(p)) d.textContent = "♛";
        cell.appendChild(d);
      }
    }
    el("cr").textContent = b.filter((p) => owner(p) === HUMAN).length;
    el("cw").textContent = b.filter((p) => owner(p) === CPU).length;
    el("undo").disabled = !state.history.length || !myTurn;
    if (msg != null) el("status").textContent = msg;
  }

  function tap(sq) {
    if (state.over || state.turn !== HUMAN) return;
    const legal = moves(state.board, HUMAN);
    if (sel) {
      const cands = candidates();
      const next = cands.filter((m) => m.path[sel.steps.length] === sq);
      if (next.length) {
        sel.steps.push(sq);
        const done = next.find((m) => m.path.length === sel.steps.length);
        if (done && next.length === 1) return commit(done);
        return render("Keep jumping — tap the next landing square.");
      }
      // Mid-jump the piece is committed; otherwise a tap elsewhere re-selects.
      if (sel.steps.length) return;
      sel = null;
    }
    if (legal.some((m) => m.from === sq)) {
      sel = { from: sq, steps: [] };
      return render(legal[0].caps.length ? "You must capture — tap where to jump." : "Tap a highlighted square to move.");
    }
    render(legal[0]?.caps.length ? "A capture is available — you have to take it." : null);
  }

  function play(m, who) {
    const capture = m.caps.length > 0;
    const crowned = !isKing(state.board[m.from]) && crowns(state.board[m.from], Math.floor(m.path[m.path.length - 1] / 8));
    state.board = apply(state.board, m);
    state.last = [m.from, ...m.path];
    state.quiet = capture || crowned ? 0 : state.quiet + 1;
    state.turn = enemy(who);
  }

  function commit(m) {
    state.history.push({ b: state.board, q: state.quiet });
    sel = null;
    play(m, HUMAN);
    if (checkEnd()) return;
    render("Computer is thinking…");
    setTimeout(cpuTurn, 350);
  }

  function cpuTurn() {
    play(cpuChoose(), CPU);
    if (checkEnd()) return;
    save?.mark();
    const forced = moves(state.board, HUMAN)[0].caps.length;
    render(forced ? "Your turn — you must capture." : "Your turn.");
  }

  function checkEnd() {
    const side = state.turn;
    let msg = null;
    if (!moves(state.board, side).length) {
      msg = side === HUMAN ? "No moves left — the computer wins." : "The computer is out of moves — you win!";
    } else if (state.quiet >= 100) {
      msg = "Fifty moves each without a capture — a draw.";
    }
    if (!msg) return false;
    state.over = true;
    save?.clear();
    render(msg);
    return true;
  }

  function newGame() {
    state.board = fresh();
    state.turn = HUMAN;
    state.history = [];
    state.quiet = 0;
    state.over = false;
    state.last = [];
    sel = null;
    save?.clear();
    render("You play red and move first. Tap a piece, then where it goes.");
  }

  el("new").addEventListener("click", newGame);
  el("undo").addEventListener("click", () => {
    if (!state.history.length || state.turn !== HUMAN || state.over) return;
    const h = state.history.pop();
    state.board = h.b;
    state.quiet = h.q;
    state.last = [];
    sel = null;
    save?.mark();
    render("Move taken back. Your turn.");
  });

  const save = window.GameSave?.attach({
    key: "checkers",
    slug: "checkers",
    name: "Checkers",
    version: 1,
    serialize: () => (state.over || state.turn !== HUMAN ? null :
      { b: state.board, h: state.history.slice(-30), q: state.quiet, lv: el("level").value }),
    restore: (s) => {
      if (!s || !Array.isArray(s.b) || s.b.length !== 64) return false;
      state.board = s.b;
      state.history = Array.isArray(s.h) ? s.h : [];
      state.quiet = s.q || 0;
      state.turn = HUMAN;
      state.over = false;
      if (s.lv) el("level").value = s.lv;
      return true;
    },
  });

  if (save?.restored) render("Welcome back — your game is where you left it.");
  else newGame();
})();
