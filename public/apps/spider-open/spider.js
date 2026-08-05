// Open Spider Solitaire — a from-scratch implementation of the classic.
//
// Written for ExeBrowser because Microsoft's spider.exe is proprietary and
// can't be hosted. Runs natively: no emulator, no download, instant start.
//
// Faithful where it matters:
//   * Two decks, ten columns, dealt 6/6/6/6/5/5/5/5/5/5 with the last card of
//     each turned up — 54 cards down, and the remaining 50 held as five deals
//     of ten in the stock.
//   * 1-, 2- and 4-suit games. The easy game is the one most people actually
//     play, so it is the default rather than an afterthought.
//   * A card stacks on any card one rank higher regardless of suit, but only a
//     same-suit run travels together — the rule that makes Spider Spider.
//   * A completed K-to-A run of one suit is removed and scored.
//   * Windows scoring: start at 500, -1 per move, +100 per completed run.
//   * The stock refuses to deal onto an empty column, as the original does.
(() => {
  "use strict";

  const C = window.Cards;
  const { RANKS, rankValue, cardEl, shuffle } = C;

  const el = (id) => document.getElementById(id);
  const statusEl = el("status"), movesEl = el("moves"), clockEl = el("clock");
  const scoreEl = el("score"), undoBtn = el("undo");
  const tableauEl = el("tableau"), stockEl = el("stock"), doneEl = el("done");

  const board = { cols: [], stock: [], done: [] };
  let suits = 1, moves = 0, score = 500, history = [];
  let startedAt = 0, timer = null, won = false;

  // ── deal ─────────────────────────────────────────────────────────────────
  function deal(n) {
    if (n) suits = n;
    // Two decks. A 1-suit game is 8 copies of spades; 2-suit alternates two;
    // 4-suit is two straight decks.
    const pool = suits === 1 ? ["S"] : suits === 2 ? ["S", "H"] : ["S", "H", "D", "C"];
    const deck = [];
    const copies = 8 / pool.length;
    for (let c = 0; c < copies; c++)
      for (const s of pool)
        for (const r of RANKS) deck.push({ s, r, up: false });
    shuffle(deck);

    board.cols = Array.from({ length: 10 }, () => []);
    board.done = [];
    for (let i = 0; i < 54; i++) board.cols[i % 10].push(deck.pop());
    for (const col of board.cols) if (col.length) col[col.length - 1].up = true;
    board.stock = deck;                     // 50 left = five deals of ten

    moves = 0; score = 500; history = []; won = false;
    el("win").classList.remove("on");
    startedAt = Date.now();
    startClock();
    say("");
    fit(); render();
  }

  // ── clock ────────────────────────────────────────────────────────────────
  function startClock() { if (timer) clearInterval(timer); timer = setInterval(tick, 1000); tick(); }
  const elapsed = () => Math.floor((Date.now() - startedAt) / 1000);
  const fmt = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  function tick() { if (!won) clockEl.textContent = fmt(elapsed()); }

  // ── undo ─────────────────────────────────────────────────────────────────
  function snapshot() {
    history.push(JSON.stringify({ b: board, m: moves, s: score }));
    if (history.length > 500) history.shift();
    undoBtn.disabled = false;
  }
  function undo() {
    const prev = history.pop();
    if (!prev) return;
    const st = JSON.parse(prev);
    board.cols = st.b.cols; board.stock = st.b.stock; board.done = st.b.done;
    moves = st.m; score = st.s; won = false;
    el("win").classList.remove("on");
    undoBtn.disabled = history.length === 0;
    say(""); render();
  }

  // ── rules ────────────────────────────────────────────────────────────────
  // Anything may go on an empty column; otherwise one rank below, any suit.
  const canStack = (card, col) => {
    const t = col[col.length - 1];
    if (!t) return true;
    return t.up && rankValue(card) === rankValue(t) - 1;
  };
  // Only a same-suit descending run moves as a unit — the defining rule.
  function isRun(col, i) {
    if (!col[i] || !col[i].up) return false;
    for (let k = i; k < col.length - 1; k++) {
      const a = col[k], b = col[k + 1];
      if (!b.up || b.s !== a.s || rankValue(b) !== rankValue(a) - 1) return false;
    }
    return true;
  }

  const parseRef = (s) => (s && s.startsWith("t:") ? { kind: "t", i: +s.slice(2) } : null);
  const parsePile = parseRef;
  const peek = (ref, count) => board.cols[ref.i].slice(board.cols[ref.i].length - count);
  const legalDrop = (cards, dst) => dst.kind === "t" && canStack(cards[0], board.cols[dst.i]);

  function applyMove(src, dst, count) {
    snapshot();
    const taken = board.cols[src.i].splice(board.cols[src.i].length - count, count);
    if (!taken.length) { history.pop(); undoBtn.disabled = history.length === 0; return false; }
    board.cols[dst.i].push(...taken);
    moves++; score = Math.max(0, score - 1);
    flipExposed();
    harvest();
    render();
    checkWin();
    return true;
  }

  // Turning over the newly exposed card is the whole tempo of the game.
  function flipExposed() {
    for (const col of board.cols) {
      const t = col[col.length - 1];
      if (t && !t.up) t.up = true;
    }
  }

  // A full K-to-A run of one suit leaves the table.
  function harvest() {
    for (let i = 0; i < 10; i++) {
      const col = board.cols[i];
      if (col.length < 13) continue;
      const start = col.length - 13;
      if (col[start].r !== "K") continue;
      if (!isRun(col, start)) continue;
      const run = col.splice(start, 13);
      board.done.push(run[0]);
      score += 100;
      flipExposed();
      say("Run complete — 100 points.");
    }
  }

  function dealRow() {
    if (won || !board.stock.length) return;
    // The original refuses when a column is empty, because dealing there can
    // strand the game. Say so rather than silently doing nothing.
    if (board.cols.some((c) => c.length === 0)) {
      say("Fill every empty column before dealing a new row.");
      return;
    }
    snapshot();
    for (let i = 0; i < 10 && board.stock.length; i++) {
      const c = board.stock.pop();
      c.up = true;
      board.cols[i].push(c);
    }
    moves++;
    harvest();
    render();
    checkWin();
  }

  function onTap(src, cards, count) {
    if (won) return;
    if (count !== 1) { say("Drag the run to move it."); return; }
    const card = cards[0];
    // Prefer a column that continues the same suit, then any legal column.
    let best = -1;
    for (let i = 0; i < 10; i++) {
      if (i === src.i) continue;
      const col = board.cols[i];
      if (!canStack(card, col) || !col.length) continue;
      if (col[col.length - 1].s === card.s) { best = i; break; }
      if (best < 0) best = i;
    }
    if (best < 0) for (let i = 0; i < 10; i++) {
      if (i !== src.i && !board.cols[i].length) { best = i; break; }
    }
    if (best < 0) { say("No move for that card."); return; }
    applyMove(src, { kind: "t", i: best }, 1);
  }

  function checkWin() {
    if (board.done.length !== 8) return;
    won = true;
    if (timer) clearInterval(timer);
    el("win-detail").textContent =
      `${suits}-suit — score ${score}, ${moves} moves in ${fmt(elapsed())}.`;
    el("win").classList.add("on");
  }

  const say = (m) => { statusEl.textContent = m || ""; };

  // ── rendering ────────────────────────────────────────────────────────────
  function fit() { C.fitBoard(10, 900, 62, 26); }
  const cwNow = () =>
    parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--cw")) || 62;

  function render() {
    movesEl.textContent = String(moves);
    scoreEl.textContent = String(score);
    undoBtn.disabled = history.length === 0;

    // Stock: one back per remaining deal of ten, slightly offset.
    stockEl.innerHTML = "";
    const deals = Math.ceil(board.stock.length / 10);
    for (let i = 0; i < deals; i++) {
      const d = cardEl({ s: "S", r: "A" }, false);
      // Offset by a visible fraction of the card, not a flat 3px — at that
      // size five backs stack into what looks like a single card.
      d.style.left = `${Math.round(i * cwNow() * 0.13)}px`;
      d.style.pointerEvents = "none";
      stockEl.appendChild(d);
    }
    stockEl.classList.toggle("slot", deals === 0);

    doneEl.innerHTML = "";
    for (const c of board.done) {
      const d = cardEl(c, true);
      d.style.pointerEvents = "none";
      doneEl.appendChild(d);
    }

    const cw = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--cw")) || 62;
    const ch = cw / 0.7;
    const fanUp = Math.round(ch * 0.26);
    const fanDown = Math.round(ch * 0.10);

    tableauEl.innerHTML = "";
    board.cols.forEach((col, i) => {
      const c = document.createElement("div");
      c.className = "col" + (col.length === 0 ? " slot pile" : "");
      c.dataset.pile = `t:${i}`;
      let off = 0;
      col.forEach((card, k) => {
        const d = cardEl(card);
        d.style.top = `${off}px`;
        off += card.up ? fanUp : fanDown;
        if (card.up && isRun(col, k)) {
          d.dataset.src = `t:${i}`;
          d.dataset.count = String(col.length - k);
        } else if (!card.up) {
          d.style.pointerEvents = "none";
        }
        c.appendChild(d);
      });
      c.style.minHeight = `calc(var(--ch) + ${Math.max(0, off)}px)`;
      tableauEl.appendChild(c);
    });
  }

  C.installDrag({ root: document, parseRef, parsePile, peek, legalDrop, applyMove, onTap, render });

  stockEl.addEventListener("click", dealRow);
  el("deal").addEventListener("click", () => deal());
  el("undo").addEventListener("click", undo);
  el("win-again").addEventListener("click", () => deal());
  for (const b of document.querySelectorAll("[data-suits]")) {
    b.addEventListener("click", () => {
      for (const o of document.querySelectorAll("[data-suits]")) o.classList.remove("on");
      b.classList.add("on");
      deal(+b.dataset.suits);
    });
  }
  window.addEventListener("resize", () => { fit(); render(); });

  deal(1);
})();
