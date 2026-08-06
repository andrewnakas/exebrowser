// Open Solitaire — a from-scratch implementation of Klondike, made to feel like
// the Solitaire that shipped with Windows.
//
// Written for ExeBrowser because Microsoft's sol.exe is proprietary and can't
// be hosted, and the .NET clones people point at need a runtime that
// browser-based Wine 1.7.55 cannot provide. This runs natively in the browser:
// no emulator, no download, instant start, and it works the same on a phone as
// on a desktop.
//
// Faithful to the original where it matters:
//   * Draw 3 by default, draw 1 optional; unlimited redeals through the stock.
//   * Standard and Vegas scoring, with the same point values Windows used.
//   * Corner rank/suit in both corners, blue crosshatch backs, #008000 felt.
//   * Double-click sends a card home; the win ends in the bouncing cascade.
//
// Rules: seven tableau columns dealt 1..7 with only the last card face up;
// foundations built up by suit from the ace; tableau builds down in alternating
// colours; only a king (or a run headed by one) may fill an empty column.
(() => {
  "use strict";

  const SUITS = ["S", "H", "D", "C"];
  const SUIT_CHAR = { S: "♠", H: "♥", D: "♦", C: "♣" };
  const RED = { H: true, D: true };
  const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
  const COURT = { J: true, Q: true, K: true };

  const el = (id) => document.getElementById(id);
  const isRed = (c) => !!RED[c.s];
  // 1-based so "value 1 = ace" reads naturally against the foundation rules.
  const rankValue = (c) => RANKS.indexOf(c.r) + 1;

  const board = {
    stock: [],
    waste: [],
    found: { S: [], H: [], D: [], C: [] },
    cols: [[], [], [], [], [], [], []],
  };

  // Windows defaulted to draw-3 + Standard scoring; keep those defaults.
  let draw3 = true;
  let vegas = false;
  let moves = 0;
  let score = 0;
  let history = [];
  let startedAt = 0;
  let timerId = null;
  let won = false;
  let passes = 0;

  const statusEl = el("status");
  const movesEl = el("moves");
  const scoreEl = el("score");
  const clockEl = el("clock");
  const undoBtn = el("undo");
  const drawBtn = el("draw-mode");
  const scoreBtn = el("score-mode");
  const tableauEl = el("tableau");
  const stockEl = el("stock");
  const wasteEl = el("waste");

  // ── deck / deal ──────────────────────────────────────────────────────────

  function randBelow(n) {
    if (window.crypto && window.crypto.getRandomValues) {
      // Rejection-sample so the modulo doesn't bias the low indices.
      const limit = Math.floor(0x100000000 / n) * n;
      const buf = new Uint32Array(1);
      let v;
      do { window.crypto.getRandomValues(buf); v = buf[0]; } while (v >= limit);
      return v % n;
    }
    return Math.floor(Math.random() * n);
  }

  function freshDeck() {
    const d = [];
    for (const s of SUITS) for (const r of RANKS) d.push({ s, r, up: false });
    for (let i = d.length - 1; i > 0; i--) {          // Fisher-Yates
      const j = randBelow(i + 1);
      [d[i], d[j]] = [d[j], d[i]];
    }
    return d;
  }

  function deal() {
    const d = freshDeck();
    board.waste = [];
    board.found = { S: [], H: [], D: [], C: [] };
    board.cols = [[], [], [], [], [], [], []];
    for (let i = 0; i < 7; i++) {
      for (let j = i; j < 7; j++) {
        const c = d.pop();
        c.up = j === i;   // only the top card of each column starts face up
        board.cols[j].push(c);
      }
    }
    board.stock = d;
    moves = 0;
    passes = 0;
    // Vegas buys the deck for $52 and carries the loss; Standard starts at nil.
    score = vegas ? -52 : 0;
    history = [];
    won = false;
    stopCascade();
    el("win").classList.remove("on");
    startedAt = Date.now();
    startClock();
    say("");
    render();
  }

  // ── clock ────────────────────────────────────────────────────────────────

  function startClock() {
    if (timerId) clearInterval(timerId);
    timerId = setInterval(tick, 1000);
    tick();
  }
  function tick() {
    if (won) return;
    const s = elapsed();
    clockEl.textContent = fmtTime(s);
    // Standard scoring bleeds 2 points every 10 seconds after the first 30 —
    // the original's nudge to keep moving.
    if (!vegas && s > 30 && s % 10 === 0) {
      score = Math.max(0, score - 2);
      scoreEl.textContent = String(score);
    }
  }
  const elapsed = () => Math.floor((Date.now() - startedAt) / 1000);
  const fmtTime = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  // ── scoring ──────────────────────────────────────────────────────────────
  //
  // Standard: +10 to foundation, +5 turning a tableau card, +5 waste→tableau,
  // -15 pulling back off a foundation, -100 per redeal after the first (draw-1
  // only, as in the original), -2 per 10s. Vegas: +5 per card to foundation,
  // -$52 for the deck, no other adjustments.
  function addScore(n) {
    score += n;
    if (!vegas && score < 0) score = 0;   // Standard never goes negative
    scoreEl.textContent = String(score);
  }

  // ── undo ─────────────────────────────────────────────────────────────────

  // Snapshot before every mutation. A 52-card board is tiny, so storing whole
  // states is simpler and less bug-prone than inverting each move type.
  function snapshot() {
    history.push(JSON.stringify({ b: board, m: moves, s: score, p: passes }));
    if (history.length > 400) history.shift();
    undoBtn.disabled = false;
  }

  function undo() {
    const prev = history.pop();
    if (!prev) return;
    const s = JSON.parse(prev);
    board.stock = s.b.stock;
    board.waste = s.b.waste;
    board.found = s.b.found;
    board.cols = s.b.cols;
    moves = s.m;
    score = s.s;
    passes = s.p;
    won = false;
    stopCascade();
    el("win").classList.remove("on");
    undoBtn.disabled = history.length === 0;
    say("");
    render();
  }

  // ── rules ────────────────────────────────────────────────────────────────

  function canStackTableau(card, col) {
    const top = col[col.length - 1];
    if (!top) return card.r === "K";           // empty column takes kings only
    if (!top.up) return false;
    return isRed(card) !== isRed(top) && rankValue(card) === rankValue(top) - 1;
  }

  function canStackFoundation(card, suit) {
    if (card.s !== suit) return false;
    return rankValue(card) === board.found[suit].length + 1;  // A, then 2, 3, …
  }

  // A run is movable if it's face-up and already correctly sequenced.
  function isMovableRun(col, i) {
    if (!col[i] || !col[i].up) return false;
    for (let k = i; k < col.length - 1; k++) {
      const a = col[k], b = col[k + 1];
      if (!b.up || isRed(a) === isRed(b) || rankValue(b) !== rankValue(a) - 1) return false;
    }
    return true;
  }

  // ── moves ────────────────────────────────────────────────────────────────

  function drawFromStock() {
    if (!board.stock.length && !board.waste.length) return;
    snapshot();
    if (!board.stock.length) {
      // Recycle: the waste goes back face-down, order preserved.
      board.stock = board.waste.reverse().map((c) => ({ ...c, up: false }));
      board.waste = [];
      passes++;
      // The original charges for redeals in draw-1 Standard play only.
      if (!vegas && !draw3) addScore(-100);
      say(`Deck recycled — pass ${passes + 1}.`);
    } else {
      const n = draw3 ? Math.min(3, board.stock.length) : 1;
      for (let i = 0; i < n; i++) {
        const c = board.stock.pop();
        c.up = true;
        board.waste.push(c);
      }
      say("");
    }
    moves++;
    render();
  }

  // Every legal move funnels through here so the bookkeeping (snapshot, score,
  // move count, flip, win check) happens exactly once.
  function applyMove(src, dst, count) {
    snapshot();
    const taken = removeFrom(src, count);
    if (!taken.length) { history.pop(); undoBtn.disabled = history.length === 0; return false; }
    placeOn(dst, taken);

    if (dst.kind === "found") addScore(vegas ? 5 : 10);
    else if (!vegas && src.kind === "waste") addScore(5);
    if (!vegas && src.kind === "found") addScore(-15);

    // A column whose new top card is face-down turns it over — the core
    // Klondike tempo, and worth 5 in Standard scoring.
    for (const col of board.cols) {
      const top = col[col.length - 1];
      if (top && !top.up) {
        top.up = true;
        if (!vegas) addScore(5);
      }
    }
    moves++;
    render();
    checkWin();
    return true;
  }

  function removeFrom(ref, count) {
    if (ref.kind === "waste") return board.waste.splice(board.waste.length - count, count);
    if (ref.kind === "col") return board.cols[ref.i].splice(board.cols[ref.i].length - count, count);
    if (ref.kind === "found") return board.found[ref.suit].splice(board.found[ref.suit].length - count, count);
    return [];
  }

  function placeOn(ref, cards) {
    for (const c of cards) c.up = true;
    if (ref.kind === "col") board.cols[ref.i].push(...cards);
    else if (ref.kind === "found") board.found[ref.suit].push(...cards);
    else if (ref.kind === "waste") board.waste.push(...cards);
  }

  function legalDrop(cards, dst) {
    const head = cards[0];
    if (dst.kind === "col") return canStackTableau(head, board.cols[dst.i]);
    if (dst.kind === "found") return cards.length === 1 && canStackFoundation(head, dst.suit);
    return false;
  }

  // Double-click / tap shortcut: send a card to its foundation if it will go,
  // else to a tableau column that accepts it.
  function autoPlace(src, card, srcNode) {
    let dst = null;
    for (const suit of SUITS) {
      if (canStackFoundation(card, suit)) { dst = { kind: "found", suit }; break; }
    }
    if (!dst) {
      for (let i = 0; i < 7; i++) {
        if (src.kind === "col" && src.i === i) continue;
        if (canStackTableau(card, board.cols[i])) { dst = { kind: "col", i }; break; }
      }
    }
    if (!dst) return false;
    // Fly the card there rather than teleporting it. The move is applied when
    // the flight lands, so the board state and what you can see never disagree.
    const to = nodeForRef(dst);
    if (srcNode && to) flyCard(srcNode, to, [card], () => applyMove(src, dst, 1));
    else applyMove(src, dst, 1);
    return true;
  }

  function checkWin() {
    if (SUITS.reduce((n, s) => n + board.found[s].length, 0) !== 52) return;
    won = true;
    if (timerId) clearInterval(timerId);
    const s = elapsed();
    // Standard awards a time bonus for finishing quickly.
    if (!vegas && s > 30) addScore(Math.floor(700000 / s));
    el("win-detail").textContent = vegas
      ? `$${score} in ${moves} moves, ${fmtTime(s)}.`
      : `Score ${score} — ${moves} moves in ${fmtTime(s)}.`;
    startCascade();
    // Let the cascade play before the dialog interrupts it.
    setTimeout(() => el("win").classList.add("on"), 5200);
  }

  function say(msg) { statusEl.textContent = msg; }

  // ── card faces ───────────────────────────────────────────────────────────

  function cardEl(card, faceUpOverride) {
    const up = faceUpOverride !== undefined ? faceUpOverride : card.up;
    const d = document.createElement("div");
    d.className = "card" + (up ? (isRed(card) ? " red" : "") : " down")
      + (up && COURT[card.r] ? " court" : "");
    // Rank+suit in both corners, the second rotated, as on a real card.
    for (const pos of ["tl", "br"]) {
      const cn = document.createElement("span");
      cn.className = `corner ${pos}`;
      const r = document.createElement("span");
      r.textContent = card.r;
      const s = document.createElement("span");
      s.className = "cs";
      s.textContent = SUIT_CHAR[card.s];
      cn.append(r, s);
      d.appendChild(cn);
    }
    const mid = document.createElement("span");
    mid.className = "center";
    mid.textContent = COURT[card.r] ? card.r : SUIT_CHAR[card.s];
    d.appendChild(mid);
    return d;
  }

  // ── rendering ────────────────────────────────────────────────────────────

  function render() {
    movesEl.textContent = String(moves);
    scoreEl.textContent = String(score);
    drawBtn.textContent = draw3 ? "Draw 3" : "Draw 1";
    scoreBtn.textContent = vegas ? "Vegas" : "Standard";
    undoBtn.disabled = history.length === 0;

    // Stock
    stockEl.innerHTML = "";
    stockEl.classList.toggle("empty", board.stock.length === 0);
    stockEl.classList.toggle("dead", board.stock.length === 0 && board.waste.length === 0);
    if (board.stock.length) stockEl.appendChild(cardEl(board.stock[board.stock.length - 1], false));

    // Waste — in draw-3 the last three fan out so you can see what's coming.
    wasteEl.innerHTML = "";
    const showN = draw3 ? Math.min(3, board.waste.length) : Math.min(1, board.waste.length);
    const from = board.waste.length - showN;
    for (let i = 0; i < showN; i++) {
      const d = cardEl(board.waste[from + i], true);
      d.style.left = `calc(var(--fan-down) * ${i})`;
      if (from + i === board.waste.length - 1) {     // only the top card plays
        d.dataset.src = "waste";
        d.dataset.count = "1";
      } else {
        d.style.pointerEvents = "none";
      }
      wasteEl.appendChild(d);
    }
    wasteEl.classList.toggle("slot", board.waste.length === 0);

    // Foundations
    for (const suit of SUITS) {
      const pile = el(`f-${suit}`);
      pile.innerHTML = "";
      const f = board.found[suit];
      pile.classList.toggle("slot", f.length === 0);
      if (f.length) {
        const d = cardEl(f[f.length - 1], true);
        d.dataset.src = `found:${suit}`;
        d.dataset.count = "1";
        pile.appendChild(d);
      }
    }

    // Tableau
    const fanUp = fanUpPx(), fanDown = fanDownPx();
    tableauEl.innerHTML = "";
    board.cols.forEach((col, i) => {
      const c = document.createElement("div");
      c.className = "col" + (col.length === 0 ? " slot pile" : "");
      c.dataset.pile = `c:${i}`;
      let offset = 0;
      col.forEach((card, k) => {
        const d = cardEl(card);
        d.style.top = `${offset}px`;
        offset += card.up ? fanUp : fanDown;
        if (card.up && isMovableRun(col, k)) {
          d.dataset.src = `col:${i}`;
          d.dataset.count = String(col.length - k);
        } else {
          d.style.pointerEvents = card.up ? "auto" : "none";
        }
        c.appendChild(d);
      });
      // Tall enough to drop below the last card.
      c.style.minHeight = `calc(var(--ch) + ${Math.max(0, offset)}px)`;
      tableauEl.appendChild(c);
    });
  }

  // Fan offsets in real pixels. These can't be read back out of the CSS custom
  // properties — getPropertyValue hands back the literal "calc(...)" string,
  // not a resolved length, so parseFloat gives NaN. Derive them from the card
  // width instead, which is the one value we set numerically.
  const cardW = () =>
    parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--cw")) || 71;
  // Face-up cards fan far enough to read the corner index; face-down ones just
  // peek, the way a real stack of dealt cards sits.
  const fanUpPx = () => Math.round(cardW() * 0.30);
  const fanDownPx = () => Math.round(cardW() * 0.11);

  // Fit the board to the viewport: seven columns plus six gaps must fit the
  // width, and the card width drives every other measurement.
  function fitBoard() {
    // Derive the budget from the viewport and the body padding rather than
    // measuring .board: the board is width:100% of a flex column, so before
    // the first layout it reports its *content* width (as wide as the cards
    // currently make it), which would feed itself and never shrink. The
    // viewport is stable from the first frame.
    const vw = document.documentElement.clientWidth || window.innerWidth;
    const bodyPad = parseFloat(getComputedStyle(document.body).paddingLeft) || 0;
    const avail = Math.min(vw - bodyPad * 2, 780);
    // Seven columns and six gaps of 0.14cw: 7*cw + 6*0.14*cw = 7.84*cw.
    // Floor it so rounding never pushes the row wider than the space we have.
    const cw = Math.max(30, Math.min(71, Math.floor(avail / 7.84)));
    document.documentElement.style.setProperty("--cw", `${cw}px`);
  }

  // ── the win cascade ──────────────────────────────────────────────────────
  //
  // The bouncing waterfall of cards is the most recognisable thing about
  // Windows Solitaire, so the win doesn't feel right without it. Cards launch
  // from the foundations, fall under gravity and bounce off the bottom edge,
  // each leaving a trail — drawn on a canvas so 52 cards cost nothing.
  const cv = el("cascade");
  let cascadeId = null;

  function startCascade() {
    const ctx = cv.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    cv.width = window.innerWidth * dpr;
    cv.height = window.innerHeight * dpr;
    cv.style.width = window.innerWidth + "px";
    cv.style.height = window.innerHeight + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cv.classList.add("on");

    const cw = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--cw")) || 71;
    const ch = cw / 0.7;

    // Launch from where each foundation actually sits on screen.
    const flyers = [];
    SUITS.forEach((suit) => {
      const r = el(`f-${suit}`).getBoundingClientRect();
      for (let n = 13; n >= 1; n--) {
        flyers.push({
          x: r.left, y: r.top,
          vx: (Math.random() * 6 + 2) * (Math.random() < 0.5 ? -1 : 1),
          vy: -(Math.random() * 4 + 1),
          card: { s: suit, r: RANKS[n - 1] },
          started: false,
        });
      }
    });

    let i = 0, frame = 0;
    const G = 0.42, BOUNCE = 0.78;

    function step() {
      frame++;
      // Release a new card every few frames so they cascade rather than dump.
      if (frame % 4 === 0 && i < flyers.length) flyers[i++].started = true;

      for (const f of flyers) {
        if (!f.started) continue;
        f.vy += G;
        f.x += f.vx;
        f.y += f.vy;
        const floor = window.innerHeight - ch;
        if (f.y > floor) { f.y = floor; f.vy = -Math.abs(f.vy) * BOUNCE; }
        drawFlyer(ctx, f, cw, ch);
      }
      // Stop once every card has been released and drifted off-screen.
      const done = i >= flyers.length &&
        flyers.every((f) => f.x < -cw * 2 || f.x > window.innerWidth + cw * 2);
      cascadeId = done ? null : requestAnimationFrame(step);
    }
    cascadeId = requestAnimationFrame(step);
  }

  function drawFlyer(ctx, f, cw, ch) {
    ctx.fillStyle = "#fff";
    ctx.strokeStyle = "#808080";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.rect(f.x, f.y, cw, ch);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = RED[f.card.s] ? "#d40000" : "#000";
    ctx.font = `700 ${Math.round(cw * 0.235)}px "Segoe UI", Tahoma, sans-serif`;
    ctx.textBaseline = "top";
    ctx.fillText(f.card.r + SUIT_CHAR[f.card.s], f.x + cw * 0.08, f.y + cw * 0.07);
    ctx.font = `${Math.round(cw * 0.42)}px "Segoe UI", Tahoma, sans-serif`;
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    ctx.fillText(SUIT_CHAR[f.card.s], f.x + cw / 2, f.y + ch / 2);
    ctx.textAlign = "left";
  }

  function stopCascade() {
    if (cascadeId) cancelAnimationFrame(cascadeId);
    cascadeId = null;
    cv.classList.remove("on");
    const ctx = cv.getContext("2d");
    ctx.clearRect(0, 0, cv.width, cv.height);
  }

  // ── input ────────────────────────────────────────────────────────────────

  function parseRef(s) {
    if (!s) return null;
    if (s === "waste") return { kind: "waste" };
    if (s.startsWith("col:")) return { kind: "col", i: +s.slice(4) };
    if (s.startsWith("found:")) return { kind: "found", suit: s.slice(6) };
    return null;
  }
  function parsePile(s) {
    if (!s) return null;
    if (s.startsWith("c:")) return { kind: "col", i: +s.slice(2) };
    if (s.startsWith("f:")) return { kind: "found", suit: s.slice(2) };
    return null;
  }

  function peek(ref, count) {
    if (ref.kind === "waste") return board.waste.slice(board.waste.length - count);
    if (ref.kind === "col") return board.cols[ref.i].slice(board.cols[ref.i].length - count);
    if (ref.kind === "found") return board.found[ref.suit].slice(board.found[ref.suit].length - count);
    return [];
  }

  // Pointer-based drag. One handler set covers mouse, touch and pen, so the
  // phone and desktop paths can't drift apart.
  let drag = null;
  let hinted = null;
  // True while a card is gliding back after an illegal drop. Input is ignored
  // until it lands, so a fresh grab can't collide with the tidy-up.
  let animating = false;

  function onPointerDown(e) {
    if (won || animating) return;
    const cardNode = e.target.closest(".card");
    if (cardNode && stockEl.contains(cardNode)) { drawFromStock(); return; }
    if (!cardNode || !cardNode.dataset.src) {
      if (e.target.closest("#stock")) drawFromStock();   // empty stock recycles
      return;
    }
    const src = parseRef(cardNode.dataset.src);
    const count = +cardNode.dataset.count || 1;
    if (!src) return;
    const cards = peek(src, count);
    if (!cards.length) return;

    const rect = cardNode.getBoundingClientRect();
    drag = {
      src, count, cards,
      startX: e.clientX, startY: e.clientY,
      // Grab offset, so the card stays under the exact point you grabbed it by
      // rather than snapping its corner to the cursor.
      dx: e.clientX - rect.left, dy: e.clientY - rect.top,
      originX: rect.left, originY: rect.top,
      moved: false, ghost: null,
      // The nodes we hide while the cards are "in hand". Windows lifts them off
      // the pile — leaving them drawn underneath reads as a duplicated card.
      lifted: liftedNodes(cardNode),
    };
    try { cardNode.setPointerCapture(e.pointerId); } catch { /* not critical */ }
    e.preventDefault();
  }

  // The grabbed card and everything stacked on top of it travel together.
  function liftedNodes(cardNode) {
    const parent = cardNode.parentNode;
    if (!parent) return [];
    const kids = [...parent.children];
    return kids.slice(kids.indexOf(cardNode));
  }

  function beginDrag() {
    drag.moved = true;
    drag.ghost = buildGhost(drag.cards);
    // Pin the ghost at the card's own position and move it with a transform
    // from there, so translate3d values stay small and there is no layout
    // work per frame.
    drag.baseX = drag.originX;
    drag.baseY = drag.originY;
    drag.ghost.style.left = `${drag.baseX}px`;
    drag.ghost.style.top = `${drag.baseY}px`;
    // A dragged card is its own compositor layer; without this the browser
    // may re-rasterise it on every move.
    drag.ghost.style.willChange = "transform";
    document.body.appendChild(drag.ghost);
    // Hide the originals only once the drag really starts, so a plain click
    // never makes the pile flicker.
    for (const n of drag.lifted) n.style.visibility = "hidden";
    moveGhost(drag.startX, drag.startY);
  }

  // Position the ghost with a transform, not left/top.
  //
  // left/top are layout properties: setting them on every pointermove forces
  // the browser to re-lay-out the page before it can paint, and the card ends
  // up trailing the cursor. A transform is composited — the card follows the
  // pointer exactly, the way it does in the Windows game.
  function moveGhost(x, y) {
    drag.ghost.style.transform =
      `translate3d(${Math.round(x - drag.dx - drag.baseX)}px, ${Math.round(y - drag.dy - drag.baseY)}px, 0)`;
  }

  // The expensive part of a drag isn't moving the card, it's working out what
  // it's over: bestTarget() measures every pile. Doing that per pointermove
  // (which can fire well above 60Hz) was the actual source of the lag, so the
  // pointer position is recorded immediately and the hit-testing is done at
  // most once per animation frame.
  let pendingMove = null, moveRaf = 0;
  function onPointerMove(e) {
    if (!drag) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < 3) return;
    if (!drag.moved) beginDrag();
    // Move the card now — this is cheap and must not wait for a frame.
    moveGhost(e.clientX, e.clientY);
    pendingMove = [e.clientX, e.clientY];
    if (!moveRaf) {
      moveRaf = requestAnimationFrame(() => {
        moveRaf = 0;
        if (drag && pendingMove) highlight(bestTarget());
      });
    }
  }

  function buildGhost(cards) {
    const wrap = document.createElement("div");
    wrap.className = "card dragging";
    wrap.style.cssText += ";position:fixed;background:transparent;border:0;box-shadow:none;height:auto;";
    cards.forEach((c, i) => {
      const d = cardEl(c, true);
      d.style.position = "absolute";
      d.style.top = `calc(var(--fan) * ${i})`;
      wrap.appendChild(d);
    });
    return wrap;
  }

  // Windows picks the pile the dragged CARD overlaps most, not the one under
  // the mouse pointer. That's why dropping there feels forgiving: you line the
  // card up with the target, and the cursor can be anywhere on the card.
  function bestTarget() {
    if (!drag || !drag.ghost) return null;
    const head = drag.ghost.firstChild;
    if (!head) return null;
    const r = head.getBoundingClientRect();

    let best = null, bestArea = 0;
    for (const node of document.querySelectorAll("[data-pile]")) {
      const ref = parsePile(node.dataset.pile);
      if (!ref) continue;
      // Measure against the top card of a stacked column, not the whole
      // column box — otherwise a long column wins on area every time.
      const box = targetBox(node, ref);
      const ov = Math.max(0, Math.min(r.right, box.right) - Math.max(r.left, box.left))
               * Math.max(0, Math.min(r.bottom, box.bottom) - Math.max(r.top, box.top));
      if (ov > bestArea) { bestArea = ov; best = { ref, node }; }
    }
    // Require a real overlap (a quarter of a card) so a card dropped in open
    // space snaps back instead of jumping to whatever it barely grazed.
    const min = (r.width * r.height) * 0.25;
    return bestArea >= min ? best : null;
  }

  function targetBox(node, ref) {
    if (ref.kind === "col") {
      const cards = node.querySelectorAll(".card");
      const last = cards[cards.length - 1];
      if (last) return last.getBoundingClientRect();
    }
    return node.getBoundingClientRect();
  }

  function highlight(target) {
    if (hinted) { hinted.classList.remove("hint"); hinted = null; }
    if (!target || !target.ref || !drag) return;
    if (!legalDrop(drag.cards, target.ref)) return;
    target.node.classList.add("hint");
    hinted = target.node;
  }

  function onPointerUp(e) {
    if (!drag) return;
    // Drop any queued hit-test so it can't run against a finished drag.
    if (moveRaf) { cancelAnimationFrame(moveRaf); moveRaf = 0; }
    pendingMove = null;
    const d = drag;
    if (hinted) { hinted.classList.remove("hint"); hinted = null; }

    if (!d.moved) {
      // A click, not a drag. Windows sends a card home on double-click; a
      // single tap doing the same is what makes this playable on a phone.
      drag = null;
      if (d.ghost) d.ghost.remove();
      restoreLifted(d);
      if (d.count === 1) {
        // d.lifted[0] is the card node itself — the flight starts from there.
        if (!autoPlace(d.src, d.cards[0], (d.lifted || [])[0])) say("No move for that card.");
      } else {
        say("Drag the run to move it.");
      }
      return;
    }

    const target = bestTarget();
    drag = null;
    if (target && target.ref && legalDrop(d.cards, target.ref)) {
      d.ghost.remove();
      restoreLifted(d);
      applyMove(d.src, target.ref, d.count);
    } else {
      // Illegal drop: glide back where it came from, the way Windows does,
      // instead of vanishing and reappearing.
      snapBack(d);
    }
  }

  function restoreLifted(d) {
    for (const n of d.lifted || []) n.style.visibility = "";
  }

  // Animate the ghost home, then drop it and repaint. `animating` blocks input
  // for the duration so a second grab can't race the tidy-up.
  function snapBack(d) {
    const g = d.ghost;
    if (!g) { restoreLifted(d); render(); return; }
    animating = true;
    // The ghost is positioned by transform during the drag, so glide the
    // transform back to zero — animating left/top here would fight it and the
    // card would jump before it slid.
    g.style.transition = "transform .18s ease-out";
    g.style.transform = "translate3d(0,0,0)";
    // transitionend and the timeout can both fire; only the first should run.
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      g.remove();
      restoreLifted(d);
      animating = false;
      render();
    };
    g.addEventListener("transitionend", finish, { once: true });
    setTimeout(finish, 260);   // in case the transition never fires
  }

  // Fly a card from where it is to where it's going, then apply the move.
  //
  // Dragging already animates itself — you're holding the card. Every other
  // way a card moves (tapping it home, double-click, the auto-finish) used to
  // teleport, which makes the board feel like it's jumping rather than
  // playing. This routes those through the same ghost the drag uses, so one
  // mechanism covers both and the motion matches.
  function flyCard(fromNode, toNode, cards, done) {
    if (!fromNode || !toNode || prefersReducedMotion()) { done(); return; }
    const a = fromNode.getBoundingClientRect();
    const b = toNode.getBoundingClientRect();
    // A foundation or column already holding cards should receive the flight
    // on top of its stack, not at the pile's origin.
    const last = toNode.querySelectorAll(".card");
    const target = last.length ? last[last.length - 1].getBoundingClientRect() : b;

    const ghost = document.createElement("div");
    ghost.className = "card dragging";
    ghost.style.cssText += ";position:fixed;background:transparent;border:0;box-shadow:none;height:auto;";
    cards.forEach((c, i) => {
      const d = cardEl(c, true);
      d.style.position = "absolute";
      d.style.top = `calc(var(--fan) * ${i})`;
      ghost.appendChild(d);
    });
    ghost.style.left = `${a.left}px`;
    ghost.style.top = `${a.top}px`;
    document.body.appendChild(ghost);
    fromNode.style.visibility = "hidden";

    animating = true;
    // Force a reflow so the browser treats the next change as a transition
    // rather than folding it into the initial paint.
    void ghost.offsetWidth;
    ghost.style.transition = "left .2s cubic-bezier(.25,.8,.4,1), top .2s cubic-bezier(.25,.8,.4,1)";
    ghost.style.left = `${target.left}px`;
    ghost.style.top = `${target.top}px`;

    let fired = false;
    const finish = () => {
      if (fired) return;
      fired = true;
      ghost.remove();
      fromNode.style.visibility = "";
      animating = false;
      done();
    };
    ghost.addEventListener("transitionend", finish, { once: true });
    setTimeout(finish, 300);
  }

  // Respect the OS setting — a card game that flings things around is exactly
  // what this preference exists for.
  const prefersReducedMotion = () =>
    window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Where a destination ref lives on screen, so flyCard knows where to aim.
  function nodeForRef(ref) {
    if (!ref) return null;
    if (ref.kind === "found") return el(`f-${ref.suit}`);
    if (ref.kind === "col") return tableauEl.children[ref.i] || null;
    if (ref.kind === "waste") return wasteEl;
    return null;
  }

  document.addEventListener("pointerdown", onPointerDown);
  document.addEventListener("pointermove", onPointerMove, { passive: true });
  document.addEventListener("pointerup", onPointerUp);
  document.addEventListener("pointercancel", () => {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (hinted) { hinted.classList.remove("hint"); hinted = null; }
    if (d.ghost) d.ghost.remove();
    restoreLifted(d);
    render();
  });

  // Double-click also auto-places, matching the desktop convention.
  document.addEventListener("dblclick", (e) => {
    if (won || animating) return;
    const cardNode = e.target.closest(".card");
    if (!cardNode || !cardNode.dataset.src) return;
    const src = parseRef(cardNode.dataset.src);
    const cards = peek(src, 1);
    if (src && cards.length) autoPlace(src, cards[0], cardNode);
  });

  el("deal").addEventListener("click", deal);
  el("undo").addEventListener("click", undo);
  el("win-again").addEventListener("click", deal);
  // Both mode switches redeal: changing them mid-game would let you re-run the
  // stock under new rules, so they read as mode switches, not cheats.
  drawBtn.addEventListener("click", () => { draw3 = !draw3; deal(); });
  scoreBtn.addEventListener("click", () => { vegas = !vegas; deal(); });

  window.addEventListener("resize", () => { fitBoard(); render(); });

  fitBoard();
  deal();
})();
