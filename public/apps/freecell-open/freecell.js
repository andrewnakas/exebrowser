// Open FreeCell — a from-scratch implementation of the classic.
//
// Written for ExeBrowser because Microsoft's freecell.exe is proprietary and
// can't be hosted. Runs natively: no emulator, no download, instant start, and
// it plays the same on a phone as on a desktop.
//
// Faithful where it matters:
//   * Microsoft's deal numbering. Deal #1 is the same 52 cards here as in
//     Windows, so a deal number means something and can be shared. The RNG
//     below is the exact LCG Microsoft used — this is a documented, widely
//     reimplemented algorithm, not anything taken from their binary.
//   * Supermoves: dragging a run moves as many cards as the free cells and
//     empty columns allow, rather than making you shuffle them one at a time.
//   * Everything is face-up from the deal, as it should be — FreeCell is a
//     game of complete information, which is why nearly every deal is winnable.
(() => {
  "use strict";

  const C = window.Cards;
  const { SUITS, RANKS, isRed, rankValue, cardEl } = C;

  const el = (id) => document.getElementById(id);
  const statusEl = el("status"), movesEl = el("moves"), clockEl = el("clock");
  const undoBtn = el("undo"), tableauEl = el("tableau"), dealNoEl = el("dealno");

  const board = { cells: [null, null, null, null], found: { S: [], H: [], D: [], C: [] }, cols: [] };
  let moves = 0, history = [], startedAt = 0, timer = null, won = false, dealNo = 1;

  // ── Microsoft's deal numbering ───────────────────────────────────────────
  //
  // The Windows games seeded a 31-bit linear congruential generator with the
  // deal number and dealt by repeatedly swapping the last card of a shrinking
  // deck. Reproducing it means deal #11982 is the famously unwinnable one here
  // too. The card order within the source deck is clubs/diamonds/hearts/spades
  // interleaved by rank, which is what the original's index arithmetic implies.
  function msDeal(seed) {
    let state = seed >>> 0;
    const rnd = () => {
      state = (state * 214013 + 2531011) >>> 0;
      return (state >>> 16) & 0x7fff;
    };
    const order = ["C", "D", "H", "S"];
    const deck = [];
    for (const r of RANKS) for (const s of order) deck.push({ s, r, up: true });
    for (let i = deck.length - 1; i > 0; i--) {
      const j = rnd() % (i + 1);
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    // Deal round-robin across eight columns: 7,7,7,7,6,6,6,6.
    const cols = [[], [], [], [], [], [], [], []];
    // The original deals from the END of the shuffled deck.
    for (let i = 0; i < 52; i++) cols[i % 8].push(deck[51 - i]);
    return cols;
  }

  function deal(n) {
    dealNo = Math.max(1, Math.min(1000000, n | 0 || 1));
    if (dealNoEl) dealNoEl.value = String(dealNo);
    board.cells = [null, null, null, null];
    board.found = { S: [], H: [], D: [], C: [] };
    board.cols = msDeal(dealNo);
    moves = 0; history = []; won = false;
    el("win").classList.remove("on");
    startedAt = Date.now();
    startClock();
    say("");
    save?.clear();
    fit();
    render();
  }

  // ── resume ───────────────────────────────────────────────────────────────
  //
  // The game is `board` plus a few scalars, so that's the whole stored state.
  // `history` travels with it — an undo stack you can't use after reopening
  // isn't much of an undo stack. The clock is stored as a duration rather than
  // a start time, so time doesn't accrue while the tab is closed.

  const save = window.GameSave?.attach({
    key: "freecell",
    slug: "freecell-open",
    name: "FreeCell",
    version: 1,
    serialize: () =>
      won ? null : { b: board, m: moves, h: history, n: dealNo, el: elapsed() },
    restore: (s) => {
      if (!s || !s.b || !Array.isArray(s.b.cols) || s.b.cols.length !== 8) return false;
      board.cells = s.b.cells;
      board.found = s.b.found;
      board.cols = s.b.cols;
      moves = s.m;
      history = Array.isArray(s.h) ? s.h : [];
      dealNo = s.n || 1;
      won = false;
      startedAt = Date.now() - (s.el || 0) * 1000;
      return true;
    },
  });

  // ── clock ────────────────────────────────────────────────────────────────
  function startClock() {
    if (timer) clearInterval(timer);
    timer = setInterval(tick, 1000);
    tick();
  }
  const elapsed = () => Math.floor((Date.now() - startedAt) / 1000);
  const fmt = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  function tick() { if (!won) clockEl.textContent = fmt(elapsed()); }

  // ── undo ─────────────────────────────────────────────────────────────────
  function snapshot() {
    history.push(JSON.stringify({ b: board, m: moves }));
    if (history.length > 500) history.shift();
    undoBtn.disabled = false;
    // Every move snapshots first, which makes this the one place that reliably
    // means "the game changed".
    save?.mark();
  }
  function undo() {
    const prev = history.pop();
    if (!prev) return;
    const s = JSON.parse(prev);
    board.cells = s.b.cells; board.found = s.b.found; board.cols = s.b.cols;
    moves = s.m; won = false;
    el("win").classList.remove("on");
    undoBtn.disabled = history.length === 0;
    save?.mark();
    say(""); render();
  }

  // ── rules ────────────────────────────────────────────────────────────────
  const canStack = (card, col) => {
    const t = col[col.length - 1];
    if (!t) return true;                      // any card may fill an empty column
    return isRed(card) !== isRed(t) && rankValue(card) === rankValue(t) - 1;
  };
  const canFound = (card, suit) =>
    card.s === suit && rankValue(card) === board.found[suit].length + 1;

  // A run is movable if it descends in alternating colours.
  function isRun(col, i) {
    for (let k = i; k < col.length - 1; k++) {
      const a = col[k], b = col[k + 1];
      if (isRed(a) === isRed(b) || rankValue(b) !== rankValue(a) - 1) return false;
    }
    return true;
  }

  // How many cards a supermove can carry: (free cells + 1) doubled for each
  // empty column, which is the standard FreeCell formula. Moving INTO an empty
  // column doesn't get to count that column.
  function maxMove(toEmptyCol) {
    const freeCells = board.cells.filter((c) => !c).length;
    let emptyCols = board.cols.filter((c) => c.length === 0).length;
    if (toEmptyCol) emptyCols = Math.max(0, emptyCols - 1);
    return (freeCells + 1) * Math.pow(2, emptyCols);
  }

  // ── refs ─────────────────────────────────────────────────────────────────
  const parseRef = (s) => {
    if (!s) return null;
    if (s.startsWith("t:")) return { kind: "t", i: +s.slice(2) };
    if (s.startsWith("c:")) return { kind: "c", i: +s.slice(2) };
    if (s.startsWith("f:")) return { kind: "f", suit: s.slice(2) };
    return null;
  };
  const parsePile = parseRef;

  function peek(ref, count) {
    if (ref.kind === "t") return board.cols[ref.i].slice(board.cols[ref.i].length - count);
    if (ref.kind === "c") return board.cells[ref.i] ? [board.cells[ref.i]] : [];
    if (ref.kind === "f") { const f = board.found[ref.suit]; return f.length ? [f[f.length - 1]] : []; }
    return [];
  }

  function legalDrop(cards, dst) {
    const head = cards[0];
    if (dst.kind === "c") return cards.length === 1 && !board.cells[dst.i];
    if (dst.kind === "f") return cards.length === 1 && canFound(head, dst.suit);
    if (dst.kind === "t") {
      const col = board.cols[dst.i];
      if (!canStack(head, col)) return false;
      return cards.length <= maxMove(col.length === 0);
    }
    return false;
  }

  function take(ref, count) {
    if (ref.kind === "t") return board.cols[ref.i].splice(board.cols[ref.i].length - count, count);
    if (ref.kind === "c") { const c = board.cells[ref.i]; board.cells[ref.i] = null; return c ? [c] : []; }
    if (ref.kind === "f") { const f = board.found[ref.suit]; return f.length ? [f.pop()] : []; }
    return [];
  }
  function put(ref, cards) {
    if (ref.kind === "t") board.cols[ref.i].push(...cards);
    else if (ref.kind === "c") board.cells[ref.i] = cards[0];
    else if (ref.kind === "f") board.found[ref.suit].push(...cards);
  }

  function applyMove(src, dst, count) {
    snapshot();
    const cards = take(src, count);
    if (!cards.length) { history.pop(); undoBtn.disabled = history.length === 0; return false; }
    put(dst, cards);
    moves++;
    render();
    autoToFoundation();
    checkWin();
    return true;
  }

  // Send up cards that can never be needed again — the safe-autoplay rule every
  // FreeCell implementation uses. A card is safe when both opposite-colour
  // foundations are already at least one rank behind it, so nothing still in
  // play could want to land on it.
  function autoToFoundation() {
    let moved = true;
    while (moved) {
      moved = false;
      const tryCard = (card, from) => {
        if (!card || !canFound(card, card.s)) return false;
        const v = rankValue(card);
        if (v > 2) {
          const opp = isRed(card) ? ["S", "C"] : ["H", "D"];
          if (board.found[opp[0]].length < v - 1 || board.found[opp[1]].length < v - 1) return false;
        }
        take(from, 1); put({ kind: "f", suit: card.s }, [card]);
        return true;
      };
      for (let i = 0; i < 8; i++) {
        const col = board.cols[i];
        if (col.length && tryCard(col[col.length - 1], { kind: "t", i })) { moved = true; break; }
      }
      if (moved) continue;
      for (let i = 0; i < 4; i++) {
        if (board.cells[i] && tryCard(board.cells[i], { kind: "c", i })) { moved = true; break; }
      }
    }
    render();
  }

  // Tap: foundation first, then a free cell, then any column that takes it.
  function onTap(src, cards, count) {
    if (won) return;
    if (count !== 1) { say("Drag the run to move it."); return; }
    const card = cards[0];
    for (const s of SUITS) if (canFound(card, s)) return void applyMove(src, { kind: "f", suit: s }, 1);
    for (let i = 0; i < 8; i++) {
      if (src.kind === "t" && src.i === i) continue;
      if (canStack(card, board.cols[i]) && board.cols[i].length) return void applyMove(src, { kind: "t", i }, 1);
    }
    for (let i = 0; i < 4; i++) if (!board.cells[i]) return void applyMove(src, { kind: "c", i }, 1);
    for (let i = 0; i < 8; i++) {
      if (src.kind === "t" && src.i === i) continue;
      if (!board.cols[i].length) return void applyMove(src, { kind: "t", i }, 1);
    }
    say("No move for that card.");
  }

  function checkWin() {
    if (SUITS.reduce((n, s) => n + board.found[s].length, 0) !== 52) return;
    won = true;
    if (timer) clearInterval(timer);
    el("win-detail").textContent = `Deal #${dealNo} — ${moves} moves in ${fmt(elapsed())}.`;
    el("win").classList.add("on");
  }

  const say = (m) => { statusEl.textContent = m || ""; };

  // ── rendering ────────────────────────────────────────────────────────────
  function fit() { C.fitBoard(8, 860, 71, 30); }

  function render() {
    movesEl.textContent = String(moves);
    undoBtn.disabled = history.length === 0;

    for (let i = 0; i < 4; i++) {
      const p = el(`c-${i}`);
      p.innerHTML = "";
      const c = board.cells[i];
      p.classList.toggle("slot", !c);
      if (c) {
        const d = cardEl(c, true);
        d.dataset.src = `c:${i}`; d.dataset.count = "1";
        p.appendChild(d);
      }
    }
    for (const s of SUITS) {
      const p = el(`f-${s}`);
      p.innerHTML = "";
      const f = board.found[s];
      p.classList.toggle("slot", !f.length);
      if (f.length) {
        const d = cardEl(f[f.length - 1], true);
        d.dataset.src = `f:${s}`; d.dataset.count = "1";
        p.appendChild(d);
      }
    }

    // Fan by a fraction of the card HEIGHT, not its width: deriving it from
    // the width overlaps the cards so far that only the rank letter shows.
    // 0.26 of the height leaves the corner index fully readable while still
    // fitting a seven-card column without the board growing a scrollbar.
    const cw = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--cw")) || 71;
    const fan = Math.round((cw / 0.7) * 0.26);
    tableauEl.innerHTML = "";
    board.cols.forEach((col, i) => {
      const c = document.createElement("div");
      c.className = "col" + (col.length === 0 ? " slot pile" : "");
      c.dataset.pile = `t:${i}`;
      let off = 0;
      col.forEach((card, k) => {
        const d = cardEl(card, true);
        d.style.top = `${off}px`;
        off += fan;
        // Only a properly sequenced run that fits the current free capacity is
        // draggable, so the game never offers a move it would then refuse.
        if (isRun(col, k) && col.length - k <= maxMove(false)) {
          d.dataset.src = `t:${i}`;
          d.dataset.count = String(col.length - k);
        }
        c.appendChild(d);
      });
      c.style.minHeight = `calc(var(--ch) + ${Math.max(0, off)}px)`;
      tableauEl.appendChild(c);
    });
  }

  C.installDrag({
    root: document, parseRef, parsePile, peek, legalDrop, applyMove, onTap, render,
  });

  el("deal").addEventListener("click", () => deal(Math.floor(Math.random() * 1000000) + 1));
  el("undo").addEventListener("click", undo);
  el("win-again").addEventListener("click", () => deal(Math.floor(Math.random() * 1000000) + 1));
  el("godeal").addEventListener("click", () => deal(parseInt(dealNoEl.value, 10)));
  dealNoEl.addEventListener("keydown", (e) => { if (e.key === "Enter") deal(parseInt(dealNoEl.value, 10)); });
  window.addEventListener("resize", () => { fit(); render(); });

  if (save?.restored) {
    // Mid-game from a previous visit: pick it up rather than dealing over it.
    if (dealNoEl) dealNoEl.value = String(dealNo);
    startClock();
    say("Resumed your game");
    fit();
    render();
  } else {
    deal(1);
  }
})();
