// Backgammon — a from-scratch implementation of the classic race-and-hit dice
// game, written for ExeBrowser. No emulator, no download.
//
// Rules: standard backgammon without the doubling cube. Each side has 15
// checkers; you move from your 24-point down to your 1-point and bear off.
// A checker on the bar must enter before anything else moves. A point held by
// two or more enemy checkers is blocked; landing on a single enemy checker
// (a blot) hits it to the bar. Doubles play four times. You must use as many
// dice as possible, and if only one die can be used it must be the larger one
// when either would do. Bearing off needs all 15 in the home board; a higher
// die may bear off from the highest point when nothing sits above it.
// Winning before the loser bears any checker off is a gammon (2 points); a
// gammon with a loser's checker still on the bar or in the winner's home board
// is a backgammon (3).
//
// Positions are kept "absolute" (positive = you, negative = computer, index 0
// is your 1-point). Move generation works on a position seen from the mover's
// side, so the computer's turn is the same code on a mirrored board.
(() => {
  "use strict";

  const H = 0, C = 1;
  const el = (id) => document.getElementById(id);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---- Rules engine (mover-relative positions) ---------------------------

  const clone = (p) => ({ pts: p.pts.slice(), bar: p.bar.slice(), off: p.off.slice() });
  const flip = (p) => ({
    pts: p.pts.map((_, i) => -p.pts[23 - i]),
    bar: [p.bar[1], p.bar[0]],
    off: [p.off[1], p.off[0]],
  });
  const view = (abs, side) => (side === H ? clone(abs) : flip(abs));
  const key = (p) => p.pts.join(",") + "|" + p.bar.join(",") + "|" + p.off.join(",");

  function start() {
    const pts = new Array(24).fill(0);
    pts[23] = 2; pts[12] = 5; pts[7] = 3; pts[5] = 5;
    pts[0] = -2; pts[11] = -5; pts[16] = -3; pts[18] = -5;
    return { pts, bar: [0, 0], off: [0, 0] };
  }

  // Every single-checker move for one die. from 24 = the bar, to -1 = off.
  function singles(p, d) {
    const out = [];
    if (p.bar[0] > 0) {
      const t = 24 - d;
      if (p.pts[t] >= -1) out.push({ from: 24, to: t, d });
      return out;
    }
    let highest = -1;
    for (let i = 23; i >= 0; i--) if (p.pts[i] > 0) { highest = i; break; }
    const allHome = highest <= 5;
    for (let i = 0; i < 24; i++) {
      if (p.pts[i] <= 0) continue;
      const t = i - d;
      if (t >= 0) { if (p.pts[t] >= -1) out.push({ from: i, to: t, d }); }
      else if (allHome && (t === -1 || i === highest)) out.push({ from: i, to: -1, d });
    }
    return out;
  }

  function step(p, m) {
    const n = clone(p);
    if (m.from === 24) n.bar[0]--; else n.pts[m.from]--;
    if (m.to === -1) n.off[0]++;
    else if (n.pts[m.to] === -1) { n.pts[m.to] = 1; n.bar[1]++; }
    else n.pts[m.to]++;
    return n;
  }

  const without = (arr, k) => arr.slice(0, k).concat(arr.slice(k + 1));

  // The most dice that can be played from here, memoised per position.
  function maxPlayable(p, dice, memo = new Map()) {
    if (!dice.length) return 0;
    const k = key(p) + "#" + dice.join("");
    if (memo.has(k)) return memo.get(k);
    let best = 0;
    const seen = new Set();
    for (let i = 0; i < dice.length && best < dice.length; i++) {
      if (seen.has(dice[i])) continue;
      seen.add(dice[i]);
      for (const m of singles(p, dice[i])) {
        best = Math.max(best, 1 + maxPlayable(step(p, m), without(dice, i), memo));
        if (best === dice.length) break;
      }
    }
    memo.set(k, best);
    return best;
  }

  // Which single moves are legal right now, given how many dice the whole
  // turn must use (`target`) and how many have been used so far.
  function legalNow(p, dice, target, used, firstDice) {
    const need = target - used;
    if (need <= 0) return [];
    const out = [];
    const seen = new Set();
    for (let i = 0; i < dice.length; i++) {
      if (seen.has(dice[i])) continue;
      seen.add(dice[i]);
      for (const m of singles(p, dice[i])) {
        if (1 + maxPlayable(step(p, m), without(dice, i)) === need) out.push(m);
      }
    }
    // Only one die playable in the whole turn: the larger must be used if it can.
    if (target === 1 && firstDice[0] !== firstDice[1]) {
      const hi = Math.max(...firstDice);
      if (out.some((m) => m.d === hi)) return out.filter((m) => m.d === hi);
    }
    return out;
  }

  // Every distinct end position a full legal turn can reach, with one move
  // sequence that reaches it.
  function endings(p, dice) {
    const target = maxPlayable(p, dice);
    const res = new Map();
    const visited = new Set();
    const hi = Math.max(...dice);
    (function rec(q, rest, seq) {
      if (seq.length === target) {
        if (target === 1 && dice[0] !== dice[1] && seq[0].d !== hi &&
            singles(p, hi).length) return;
        const k = key(q);
        if (!res.has(k)) res.set(k, { pos: q, seq });
        return;
      }
      const vk = key(q) + "#" + rest.join("");
      if (visited.has(vk)) return;
      visited.add(vk);
      const seen = new Set();
      for (let i = 0; i < rest.length; i++) {
        if (seen.has(rest[i])) continue;
        seen.add(rest[i]);
        for (const m of singles(q, rest[i])) rec(step(q, m), without(rest, i), seq.concat(m));
      }
    })(p, dice, []);
    return [...res.values()];
  }

  const pips = (p) => {
    let mine = p.bar[0] * 25, theirs = p.bar[1] * 25;
    for (let i = 0; i < 24; i++) {
      if (p.pts[i] > 0) mine += p.pts[i] * (i + 1);
      else if (p.pts[i] < 0) theirs += -p.pts[i] * (24 - i);
    }
    return [mine, theirs];
  };

  // Chance (out of 36) that a blot is hit from a given distance.
  const DIRECT = [0, 11, 12, 14, 15, 15, 17];
  const INDIRECT = { 7: 6, 8: 6, 9: 5, 10: 3, 11: 2, 12: 3 };

  // Score a position from the side that has just moved.
  function evaluate(p) {
    const [mine, theirs] = pips(p);
    let myBack = p.bar[0] ? 24 : -1;
    if (!p.bar[0]) for (let i = 23; i >= 0; i--) if (p.pts[i] > 0) { myBack = i; break; }
    let opBack = p.bar[1] ? -1 : 24;
    if (!p.bar[1]) for (let i = 0; i < 24; i++) if (p.pts[i] < 0) { opBack = i; break; }
    if (myBack < opBack) {
      // Pure race: only pips and checkers already off matter.
      return (theirs - mine) * 4 + p.off[0] * 6;
    }
    let s = theirs - mine;
    let prime = 0, homeMade = 0;
    for (let i = 0; i < 24; i++) {
      const v = p.pts[i];
      if (v >= 2) {
        s += 3;
        if (i <= 5) { s += 4; homeMade++; }
        if (i === 4 || i === 6) s += 3;          // 5-point and bar point
        if (i >= 18) s += 2;                     // anchor in their home board
        prime++;
        if (prime >= 3) s += prime * 2;
      } else prime = 0;
      if (v === 1) {
        // Enemy checkers move toward higher indices (from our view), so the
        // shooters are below this blot — and the bar, which enters at -1.
        let risk = 0;
        for (let j = i - 1; j >= -1 && i - j <= 12; j--) {
          const shooters = j === -1 ? p.bar[1] : p.pts[j] < 0 ? 1 : 0;
          if (!shooters) continue;
          const dist = i - j;
          risk = Math.max(risk, dist <= 6 ? DIRECT[dist] : INDIRECT[dist] || 0);
        }
        s -= (risk / 36) * (24 - i + 12);
      }
    }
    s += p.bar[1] * homeMade * 3;
    s += p.off[0] * 2;
    return s;
  }

  // ---- Game state ---------------------------------------------------------

  const state = {
    abs: start(), score: [0, 0],
    phase: "roll",          // roll | move | cpu | over
    dice: [], left: [],     // the roll, and the dice still to use this turn
    target: 0, used: 0,
    turnStart: null, turnMoves: [],
    sel: null, lastCpu: [],
  };

  const roll = () => 1 + Math.floor(Math.random() * 6);
  const expand = (a, b) => (a === b ? [a, a, a, a] : [a, b]);

  // ---- Rendering ----------------------------------------------------------

  const boardEl = el("board");
  const TOP = [12, 13, 14, 15, 16, 17, "barC", 18, 19, 20, 21, 22, 23, "offC"];
  const BOTTOM = [11, 10, 9, 8, 7, 6, "barH", 5, 4, 3, 2, 1, 0, "offH"];
  const cellsBy = new Map();
  for (const [row, list] of [["top", TOP], ["bottom", BOTTOM]]) {
    for (const id of list) {
      const d = document.createElement("div");
      if (typeof id === "number") {
        d.className = `pt ${row} ${id % 2 ? "odd" : "even"}`;
        d.dataset.i = id;
      } else {
        d.className = (id.startsWith("bar") ? "mid " : "off ") + row;
      }
      d.addEventListener("click", () => tap(id));
      boardEl.appendChild(d);
      cellsBy.set(id, d);
    }
  }

  function stack(cell, n, cls) {
    const shown = Math.min(n, 5);
    for (let k = 0; k < shown; k++) {
      const c = document.createElement("span");
      c.className = "ck " + cls + (k === shown - 1 ? " tip" : "");
      if (k === shown - 1 && n > 5) c.textContent = n;
      cell.appendChild(c);
    }
  }

  function render(msg) {
    const p = state.abs;
    const legal = state.phase === "move" ? currentLegal() : [];
    const sources = new Set(legal.map((m) => (m.from === 24 ? "barH" : m.from)));
    const targets = new Set(legal.filter((m) => m.from === state.sel)
      .map((m) => (m.to === -1 ? "offH" : m.to)));
    const lastCpu = new Set(state.lastCpu);
    for (const [id, cell] of cellsBy) {
      cell.textContent = "";
      const base = cell.className.split(" ").filter((c) =>
        !["src", "sel", "target", "last-from"].includes(c)).join(" ");
      let cls = base;
      if (typeof id === "number") {
        const v = p.pts[id];
        if (v > 0) stack(cell, v, "h"); else if (v < 0) stack(cell, -v, "c");
        const num = document.createElement("span");
        num.className = "num";
        num.textContent = id + 1;
        cell.appendChild(num);
      } else if (id === "barH") stack(cell, p.bar[0], "h");
      else if (id === "barC") stack(cell, p.bar[1], "c");
      else if (id === "offH") stack(cell, p.off[0], "h");
      else if (id === "offC") stack(cell, p.off[1], "c");
      const asSel = id === "barH" ? 24 : id;
      if (state.sel == null && sources.has(id)) cls += " src";
      if (state.sel != null && asSel === state.sel) cls += " sel";
      if (targets.has(id)) cls += " target";
      if (lastCpu.has(id)) cls += " last-from";
      cell.className = cls;
    }
    const dice = el("dice");
    dice.textContent = "";
    const remaining = state.left.slice();
    for (const d of state.dice) {
      const s = document.createElement("span");
      const k = remaining.indexOf(d);
      const used = state.phase === "move" && k < 0;
      if (k >= 0) remaining.splice(k, 1);
      s.className = "die" + (state.phase === "cpu" || state.phase === "roll" ? " cpu" : "") + (used ? " used" : "");
      s.textContent = "⚀⚁⚂⚃⚄⚅"[d - 1];
      dice.appendChild(s);
    }
    const [ph, pc] = pips(p);
    el("ph").textContent = ph;
    el("pc").textContent = pc;
    el("sh").textContent = state.score[0];
    el("sc").textContent = state.score[1];
    el("roll").disabled = state.phase !== "roll";
    el("undo").disabled = !(state.phase === "move" && state.turnMoves.length);
    if (msg != null) el("status").textContent = msg;
  }

  // ---- Your turn ----------------------------------------------------------

  const currentLegal = () =>
    legalNow(state.abs, state.left, state.target, state.used, state.dice.length === 4 ? [state.dice[0], state.dice[0]] : state.dice);

  function beginHumanTurn(a, b) {
    state.dice = expand(a, b);
    state.left = state.dice.slice();
    state.target = maxPlayable(state.abs, state.left);
    state.used = 0;
    state.turnStart = clone(state.abs);
    state.turnMoves = [];
    state.sel = null;
    if (!state.target) {
      state.phase = "cpu";
      render("No legal move with that roll — your turn passes.");
      setTimeout(cpuTurn, 1400);
      return;
    }
    state.phase = "move";
    save?.mark();
    render(state.abs.bar[0] ? "Enter from the bar: tap a highlighted point." : "Tap a checker, then where it goes.");
  }

  function tap(id) {
    if (state.phase !== "move") return;
    const legal = currentLegal();
    const as = id === "barH" ? 24 : id === "offH" ? -1 : id;
    if (state.sel != null) {
      const opts = legal.filter((m) => m.from === state.sel && m.to === as);
      if (opts.length) {
        opts.sort((x, y) => x.d - y.d);
        return playHuman(opts[0]);
      }
    }
    if (legal.some((m) => m.from === as)) {
      // A single possible destination plays straight away.
      const own = legal.filter((m) => m.from === as);
      const dests = new Set(own.map((m) => m.to));
      if (dests.size === 1 && state.sel !== as && own.length) {
        state.sel = as;
        const auto = own.slice().sort((x, y) => x.d - y.d)[0];
        return playHuman(auto);
      }
      state.sel = as;
      return render("Tap a highlighted point" + (dests.has(-1) ? " (or the tray to bear off)." : "."));
    }
    state.sel = null;
    render(null);
  }

  function playHuman(m) {
    state.abs = step(state.abs, m);
    state.left.splice(state.left.indexOf(m.d), 1);
    state.used++;
    state.turnMoves.push(m);
    state.sel = null;
    if (state.abs.off[0] === 15) return gameOver(H);
    if (state.used >= state.target) {
      state.phase = "cpu";
      render("Computer's turn…");
      setTimeout(cpuTurn, 700);
      return;
    }
    render(`${state.target - state.used} more to play.`);
  }

  el("roll").addEventListener("click", () => {
    if (state.phase !== "roll") return;
    state.lastCpu = [];
    beginHumanTurn(roll(), roll());
  });

  el("undo").addEventListener("click", () => {
    if (state.phase !== "move" || !state.turnMoves.length) return;
    state.abs = clone(state.turnStart);
    state.left = state.dice.slice();
    state.used = 0;
    state.turnMoves = [];
    state.sel = null;
    render("Moves taken back — play your roll again.");
  });

  // ---- Computer's turn ----------------------------------------------------

  async function cpuTurn(firstRoll) {
    state.phase = "cpu";
    state.sel = null;
    const [a, b] = firstRoll || [roll(), roll()];
    state.dice = expand(a, b);
    state.left = state.dice.slice();
    render("Computer rolls…");
    await sleep(650);
    const rel = view(state.abs, C);
    const ends = endings(rel, state.dice);
    if (!ends.length || !ends[0].seq.length) {
      render("The computer can't move with that roll.");
      await sleep(1100);
      return toHuman();
    }
    const strong = el("level").value === "1";
    for (const e of ends) e.score = evaluate(e.pos) + (strong ? 0 : (Math.random() - 0.5) * 40);
    ends.sort((x, y) => y.score - x.score);
    const pick = ends[0];
    state.lastCpu = [];
    let cur = rel;
    for (const m of pick.seq) {
      cur = step(cur, m);
      state.abs = flip(cur);
      state.left.splice(state.left.indexOf(m.d), 1);
      state.lastCpu.push(m.from === 24 ? "barC" : 23 - m.from);
      render(null);
      await sleep(420);
    }
    if (state.abs.off[1] === 15) return gameOver(C);
    toHuman();
  }

  function toHuman() {
    state.phase = "roll";
    state.left = [];
    save?.mark();
    render(state.abs.bar[0] ? "You're on the bar. Roll to enter." : "Your turn — roll the dice.");
  }

  function gameOver(winner) {
    const w = winner === H ? state.abs : flip(state.abs);   // from the winner's side
    let pts = 1, kind = "a single game";
    if (w.off[1] === 0) {
      pts = 2; kind = "a gammon";
      let trapped = w.bar[1] > 0;
      for (let i = 0; i <= 5; i++) if (w.pts[i] < 0) trapped = true;
      if (trapped) { pts = 3; kind = "a backgammon"; }
    }
    state.score[winner] += pts;
    state.phase = "over";
    state.dice = [];
    state.left = [];
    save?.save();
    render(winner === H
      ? `You win ${kind} — ${pts} point${pts > 1 ? "s" : ""}! Press New game to play on.`
      : `The computer wins ${kind} (${pts} point${pts > 1 ? "s" : ""}). Press New game to play on.`);
  }

  // ---- New game: the opening roll decides who starts ------------------------

  async function newGame() {
    state.abs = start();
    state.lastCpu = [];
    state.turnMoves = [];
    state.sel = null;
    let a, b;
    do { a = roll(); b = roll(); } while (a === b);
    state.phase = "cpu";
    state.dice = [a, b];
    state.left = [];
    render(`Opening roll: you ${a}, computer ${b}.`);
    await sleep(1100);
    if (a > b) {
      beginHumanTurn(a, b);
      el("status").textContent = `You rolled the higher die and play ${a}–${b} first. Tap a checker, then where it goes.`;
    } else {
      cpuTurn([a, b]);
    }
  }

  el("new").addEventListener("click", () => {
    if (state.phase === "cpu") return;
    newGame();
  });

  // ---- Resume -------------------------------------------------------------

  const save = window.GameSave?.attach({
    key: "backgammon",
    slug: "backgammon",
    name: "Backgammon",
    version: 1,
    serialize: () => {
      if (state.phase === "roll") return { a: state.abs, s: state.score, ph: "roll", lv: el("level").value };
      if (state.phase === "move") return { a: state.turnStart, s: state.score, ph: "move", d: state.dice.slice(0, 2), lv: el("level").value };
      if (state.phase === "over") return { s: state.score, ph: "over", lv: el("level").value };
      return undefined;  // mid computer turn: keep the last good save
    },
    restore: (s) => {
      if (!s || !Array.isArray(s.s)) return false;
      state.score = s.s;
      if (s.lv) el("level").value = s.lv;
      if (s.ph === "over" || !s.a || !Array.isArray(s.a.pts) || s.a.pts.length !== 24) return false;
      state.abs = s.a;
      if (s.ph === "move" && Array.isArray(s.d) && s.d.length === 2) {
        beginHumanTurn(s.d[0], s.d[1]);
      } else {
        toHuman();
      }
      return true;
    },
  });

  if (save?.restored) {
    el("status").textContent = "Welcome back — your game is where you left it. " + el("status").textContent;
  } else {
    newGame();
  }
})();
