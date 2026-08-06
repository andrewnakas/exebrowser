// Pipe Panic — an original pipe-laying puzzle written for ExeBrowser.
//
// The genre goes back to Pipe Mania (1989) and the Windows Entertainment Pack
// build most people remember. Those are proprietary; laying pipe ahead of a
// flow is not. Original code, own name, own art.
//
// Structure note: the rules live in a `game` object with no DOM access at all,
// and the rendering never touches them. The first version of this file mixed
// the two and the flow silently stopped advancing — with the rules isolated,
// the same logic was testable outside a browser and passed on the first run,
// which located the bug in the loop rather than the game.
//
// How it plays:
//   * Pipes come from a queue you can see but not reorder. You place the next
//     one; you don't choose it. That constraint is the whole game.
//   * Water starts at the green source after a countdown and follows connected
//     openings, one square at a time.
//   * You may overwrite a pipe the water hasn't reached, at a small score
//     penalty, so a bad placement isn't fatal.
//   * Each level needs a longer run and gives you less time before the flow.
(() => {
  "use strict";

  const N = 1, E = 2, S = 4, W = 8;
  const OPP = { [N]: S, [S]: N, [E]: W, [W]: E };
  const DELTA = { [N]: [0, -1], [S]: [0, 1], [E]: [1, 0], [W]: [-1, 0] };
  const PIECES = [N | S, E | W, N | E, N | W, S | E, S | W, N | E | S | W];

  const COLS = 10, ROWS = 8;
  const el = (id) => document.getElementById(id);
  const cv = el("c"), ctx = cv.getContext("2d");
  const qcv = el("queue"), qctx = qcv.getContext("2d");

  let CELL = 48;
  let game = null, level = 1, totalScore = 0;
  let flowing = false, startAt = 0, lastFlow = 0, raf = null;

  const rnd = (n) => Math.floor(Math.random() * n);

  // ── rules (no DOM in here) ───────────────────────────────────────────────
  function makeGame() {
    const g = {
      grid: new Array(COLS * ROWS).fill(0),
      flooded: new Set(),
      flowed: 0, score: 0, over: false, cleared: false, reason: null,
      need: 6 + level * 2,
    };
    const idx = (x, y) => y * COLS + x;
    const inB = (x, y) => x >= 0 && x < COLS && y >= 0 && y < ROWS;
    const sx = 1 + rnd(COLS - 2), sy = 1 + rnd(ROWS - 2);
    const out = [N, E, S, W][rnd(4)];
    g.source = { x: sx, y: sy, out };
    // The source is a straight pipe: it opens on the outlet AND on the side
    // the notional inflow arrives from. Masking only the outlet makes the very
    // first step read as a dead end, which is what broke the first attempt.
    g.grid[idx(sx, sy)] = out | OPP[out];
    g.head = { x: sx, y: sy, from: OPP[out] };
    g.queue = Array.from({ length: 5 }, () => PIECES[rnd(PIECES.length)]);
    g.idx = idx; g.inB = inB;

    g.place = (x, y) => {
      if (g.over || !inB(x, y)) return false;
      if (x === sx && y === sy) return false;
      if (g.flooded.has(idx(x, y))) return false;
      if (g.grid[idx(x, y)]) g.score = Math.max(0, g.score - 5);
      g.grid[idx(x, y)] = g.queue.shift();
      g.queue.push(PIECES[rnd(PIECES.length)]);
      return true;
    };

    g.step = () => {
      if (g.over) return false;
      const cell = g.grid[idx(g.head.x, g.head.y)];
      if (!cell || !(cell & g.head.from)) { g.over = true; g.reason = "The water hit a dead end."; return false; }
      g.flooded.add(idx(g.head.x, g.head.y));
      g.flowed++; g.score += 25;
      if (g.flowed >= g.need) { g.over = true; g.cleared = true; return false; }
      const opens = [N, E, S, W].filter((d) => (cell & d) && d !== g.head.from);
      if (!opens.length) { g.over = true; g.reason = "The pipe goes nowhere."; return false; }
      let exit = opens[0];
      const straight = OPP[g.head.from];
      if (opens.length > 1 && opens.includes(straight)) exit = straight;
      const [dx, dy] = DELTA[exit];
      const nx = g.head.x + dx, ny = g.head.y + dy;
      if (!inB(nx, ny)) { g.over = true; g.reason = "The water ran off the board."; return false; }
      g.head = { x: nx, y: ny, from: OPP[exit] };
      if (!g.grid[idx(nx, ny)]) { g.over = true; g.reason = "There was no pipe there."; return false; }
      return true;
    };
    return g;
  }

  // ── level flow ───────────────────────────────────────────────────────────
  function startLevel() {
    fit();
    game = makeGame();
    flowing = false;
    startAt = performance.now() + Math.max(3000, 8000 - level * 700);
    lastFlow = 0;
    say(`Level ${level} — get the water through ${game.need} pipes.`);
    hud(); drawQueue();
  }

  function newGame() { level = 1; totalScore = 0; startLevel(); }

  function tick(now) {
    if (game && !game.over) {
      if (!flowing && now >= startAt) {
        flowing = true;
        lastFlow = now;
        say("The water's flowing!");
      }
      if (flowing) {
        const interval = Math.max(300, 850 - level * 60);
        if (now - lastFlow >= interval) {
          lastFlow = now;
          game.step();
          hud();
          if (game.over) finish();
        }
      }
    }
    draw();
    raf = requestAnimationFrame(tick);
  }

  function finish() {
    if (game.cleared) {
      totalScore += game.score + 250 * level;
      level++;
      say(`Level cleared! On to level ${level}.`);
      setTimeout(startLevel, 1200);
    } else {
      totalScore += game.score;
      say(`${game.reason} Level ${level} — score ${totalScore}. Click New game.`);
    }
    hud();
  }

  const say = (m) => { el("msg").textContent = m || ""; };
  function hud() {
    el("score").textContent = String(totalScore + (game ? game.score : 0));
    el("level").textContent = String(level);
    el("flowed").textContent = game ? `${game.flowed}/${game.need}` : "0/0";
  }

  // ── drawing ──────────────────────────────────────────────────────────────
  function drawPipe(g2, px, py, mask, size, color) {
    const t = Math.max(6, Math.floor(size * 0.30));
    const c = size / 2;
    g2.fillStyle = color;
    g2.fillRect(px + c - t / 2, py + c - t / 2, t, t);   // hub, so corners join
    if (mask & N) g2.fillRect(px + c - t / 2, py, t, c);
    if (mask & S) g2.fillRect(px + c - t / 2, py + c, t, c);
    if (mask & W) g2.fillRect(px, py + c - t / 2, c, t);
    if (mask & E) g2.fillRect(px + c, py + c - t / 2, c, t);
  }

  function draw() {
    ctx.fillStyle = "#2b2b2b";
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.strokeStyle = "rgba(255,255,255,.07)";
    ctx.lineWidth = 1;
    for (let x = 1; x < COLS; x++) {
      ctx.beginPath(); ctx.moveTo(x * CELL, 0); ctx.lineTo(x * CELL, cv.height); ctx.stroke();
    }
    for (let y = 1; y < ROWS; y++) {
      ctx.beginPath(); ctx.moveTo(0, y * CELL); ctx.lineTo(cv.width, y * CELL); ctx.stroke();
    }
    if (!game) return;

    for (let y = 0; y < ROWS; y++)
      for (let x = 0; x < COLS; x++) {
        const m = game.grid[game.idx(x, y)];
        if (!m) continue;
        const wet = game.flooded.has(game.idx(x, y));
        drawPipe(ctx, x * CELL, y * CELL, m, CELL, wet ? "#2f9fe0" : "#b8b8b8");
      }

    ctx.fillStyle = "#33cc55";
    ctx.beginPath();
    ctx.arc(game.source.x * CELL + CELL / 2, game.source.y * CELL + CELL / 2, CELL * 0.2, 0, Math.PI * 2);
    ctx.fill();

    if (flowing && !game.over) {
      ctx.strokeStyle = "#7fe3ff";
      ctx.lineWidth = 2;
      ctx.strokeRect(game.head.x * CELL + 2, game.head.y * CELL + 2, CELL - 4, CELL - 4);
    }

    // A countdown bar, so the wait before the flow is legible rather than a
    // mystery — the original gives you the same information as a filling pipe.
    if (!flowing && !game.over) {
      const left = Math.max(0, startAt - performance.now());
      const total = Math.max(3000, 8000 - level * 700);
      ctx.fillStyle = "rgba(255,255,255,.15)";
      ctx.fillRect(0, cv.height - 6, cv.width * (left / total), 6);
    }
  }

  function drawQueue() {
    qctx.fillStyle = "#000";
    qctx.fillRect(0, 0, qcv.width, qcv.height);
    if (!game) return;
    const s = 34, pad = 5;
    game.queue.forEach((m, i) => {
      const py = pad + i * (s + 1);
      qctx.fillStyle = i === 0 ? "#404040" : "#222";
      qctx.fillRect(pad, py, s, s);
      drawPipe(qctx, pad, py, m, s, i === 0 ? "#ffffff" : "#9a9a9a");
    });
  }

  // ── input ────────────────────────────────────────────────────────────────
  cv.addEventListener("click", (e) => {
    if (!game) return;
    const r = cv.getBoundingClientRect();
    const x = Math.floor((e.clientX - r.left) / (r.width / COLS));
    const y = Math.floor((e.clientY - r.top) / (r.height / ROWS));
    if (game.place(x, y)) { drawQueue(); hud(); }
    else say("Can't build there.");
  });

  el("start").addEventListener("click", () => {
    if (!game || game.over || flowing) return;
    startAt = performance.now();          // begin on the next frame
  });
  el("newgame").addEventListener("click", newGame);

  function fit() {
    const avail = Math.min(window.innerWidth - 130, 480);
    CELL = Math.max(30, Math.min(48, Math.floor(avail / COLS)));
    cv.width = COLS * CELL;
    cv.height = ROWS * CELL;
  }
  window.addEventListener("resize", () => { fit(); });

  // Expose the rules for the boot test; the page itself never uses this.
  window.__pipes = () => game;

  newGame();
  raf = requestAnimationFrame(tick);
})();
