// Pipe Panic — an original pipe-laying puzzle written for ExeBrowser.
//
// The genre goes back to Pipe Mania / Pipe Dream (1989) and the Windows
// Entertainment Pack build most people remember. Those are proprietary; laying
// pipe ahead of a flow is not. Original code, own name, own art.
//
// Structure note: the rules live in a `game` object with no DOM access at all,
// and the rendering never touches them. That separation is what makes the rules
// testable by driving them directly from the console, which is how the
// difficulty bug below was measured rather than guessed at.
//
// ── What changed, and why (2026-08) ──────────────────────────────────────────
//
// The first version was unwinnable and read as broken. Level 1 asked for a run
// of 8 pipes but started the water after 7.3s, and the queue is random, so you
// must dump pieces you can't use — perfect play needed 11 placements to lay 5
// pipes of path. Then any dead end was instant game over back to level 1. It
// died in about two seconds every time.
//
// The fix is to follow the original's actual loop:
//
//   * The water stopping ends the LEVEL, not the game. You pass if the flooz
//     got through the required number of pipes; only falling short ends it.
//     This one change is the difference between a puzzle and a punishment.
//   * You keep playing after hitting the target — the level runs until the
//     water stops, and every pipe past the target is worth bonus points. That
//     is where the game actually lives.
//   * A generous countdown before the flow (and starting it early pays a
//     bonus, as it does in the original).
//   * The cross piece carries water on both axes, so it can be used twice and
//     scores twice.
//   * Replacing a pipe the water hasn't reached is free. The original lets you
//     overwrite; charging for it punished the randomness of the queue.
//   * Blocked cells appear from level 3 to keep later boards interesting.
(() => {
  "use strict";

  const N = 1, E = 2, S = 4, W = 8;
  const OPP = { [N]: S, [S]: N, [E]: W, [W]: E };
  const DELTA = { [N]: [0, -1], [S]: [0, 1], [E]: [1, 0], [W]: [-1, 0] };
  const CROSS = N | E | S | W;
  const BLOCK = -1;

  // Weighted, like the original's piece supply: mostly straights and elbows,
  // the cross rare enough that getting one feels lucky. A flat random over all
  // seven pieces hands out crosses 14% of the time and trivialises routing.
  const BAG = [
    N | S, N | S, N | S,
    E | W, E | W, E | W,
    N | E, N | W, S | E, S | W,
    N | E, N | W, S | E, S | W,
    CROSS,
  ];

  const COLS = 10, ROWS = 8;
  const el = (id) => document.getElementById(id);
  const cv = el("c"), ctx = cv.getContext("2d");
  const qcv = el("queue"), qctx = qcv.getContext("2d");

  let CELL = 48;
  let game = null, level = 1, totalScore = 0;
  let flowing = false, startAt = 0, lastFlow = 0, raf = null;
  let preroll = 0;

  const rnd = (n) => Math.floor(Math.random() * n);
  const pick = () => BAG[rnd(BAG.length)];

  const needFor = (lv) => 5 + lv;                       // L1 = 6 pipes
  const prerollFor = (lv) => Math.max(5000, 16000 - lv * 1100);
  const intervalFor = (lv) => Math.max(320, 1000 - lv * 55);

  // ── rules (no DOM in here) ───────────────────────────────────────────────
  function makeGame() {
    const idx = (x, y) => y * COLS + x;
    const inB = (x, y) => x >= 0 && x < COLS && y >= 0 && y < ROWS;

    const g = {
      grid: new Array(COLS * ROWS).fill(0),
      // cell index -> bitmask of openings the water has already filled. A cross
      // is entered twice, once per axis, so "is it flooded" is per-direction
      // rather than per-cell.
      wet: new Map(),
      flowed: 0, score: 0, over: false, cleared: false, reason: null,
      need: needFor(level),
      idx, inB,
    };

    const sx = 1 + rnd(COLS - 2), sy = 1 + rnd(ROWS - 2);
    const out = [N, E, S, W][rnd(4)];
    g.source = { x: sx, y: sy, out };
    // The source is a straight pipe: it opens on the outlet AND on the side the
    // notional inflow arrives from. Masking only the outlet makes the very first
    // step read as a dead end.
    g.grid[idx(sx, sy)] = out | OPP[out];
    g.head = { x: sx, y: sy, from: OPP[out] };
    g.queue = Array.from({ length: 5 }, pick);

    // Blocked cells from level 3. Never on the source, never on the square the
    // water goes to first — that would make the board unplayable before a
    // single click.
    if (level >= 3) {
      const [fdx, fdy] = DELTA[out];
      const firstX = sx + fdx, firstY = sy + fdy;
      let want = Math.min(7, level - 2), guard = 0;
      while (want > 0 && guard++ < 300) {
        const bx = rnd(COLS), by = rnd(ROWS);
        if ((bx === sx && by === sy) || (bx === firstX && by === firstY)) continue;
        if (g.grid[idx(bx, by)]) continue;
        g.grid[idx(bx, by)] = BLOCK;
        want--;
      }
    }

    g.blocked = (x, y) => g.grid[idx(x, y)] === BLOCK;

    g.place = (x, y) => {
      if (g.over || !inB(x, y)) return false;
      if (x === g.source.x && y === g.source.y) return false;
      if (g.blocked(x, y)) return false;
      if (g.wet.has(idx(x, y))) return false;       // can't rebuild what's wet
      g.grid[idx(x, y)] = g.queue.shift();
      g.queue.push(pick());
      return true;
    };

    // Advance the water one square. Returns false when the water stops, which
    // ends the level — whether that's a win or a loss is decided by `flowed`.
    g.step = () => {
      if (g.over) return false;
      const i = idx(g.head.x, g.head.y);
      const cell = g.grid[i];

      if (!cell || cell === BLOCK || !(cell & g.head.from)) {
        return stop(g, "The water hit a dead end.");
      }

      // Which way out? Every piece has exactly two openings except the cross,
      // which always carries the water straight through.
      const straight = OPP[g.head.from];
      let exit;
      if (cell === CROSS) {
        exit = straight;
      } else {
        exit = [N, E, S, W].find((d) => (cell & d) && d !== g.head.from);
      }
      if (!exit) return stop(g, "The pipe goes nowhere.");

      // Mark the pair of openings this pass consumes. A cross entered on the
      // other axis later is still available, and scores again.
      const used = (g.wet.get(i) || 0) | g.head.from | exit;
      if ((g.wet.get(i) || 0) & g.head.from) {
        return stop(g, "The water looped back on itself.");
      }
      g.wet.set(i, used);
      g.flowed++;
      g.score += 50;
      if (g.flowed > g.need) g.score += 100;        // every pipe past the target

      const [dx, dy] = DELTA[exit];
      const nx = g.head.x + dx, ny = g.head.y + dy;
      if (!inB(nx, ny)) return stop(g, "The water ran off the board.");
      g.head = { x: nx, y: ny, from: OPP[exit] };
      const next = g.grid[idx(nx, ny)];
      if (!next || next === BLOCK) return stop(g, "There was no pipe there.");
      return true;
    };

    return g;
  }

  // The level always ends the same way — the water stops. Reaching the target
  // is what decides whether that's a pass.
  function stop(g, reason) {
    g.over = true;
    g.cleared = g.flowed >= g.need;
    g.reason = reason;
    return false;
  }

  // ── level flow ───────────────────────────────────────────────────────────
  function startLevel() {
    fit();
    game = makeGame();
    flowing = false;
    preroll = prerollFor(level);
    startAt = performance.now() + preroll;
    lastFlow = 0;
    say(`Level ${level} — get the water through ${game.need} pipes, then keep going for bonus.`);
    save?.mark();
    hud(); drawQueue();
  }

  function newGame() { level = 1; totalScore = 0; save?.clear(); startLevel(); }

  // ── resume ───────────────────────────────────────────────────────────────
  //
  // Only the pre-flow board is worth storing. Once the water is running the
  // state is a timed animation halfway between two squares, and there is no
  // honest place to put you back — so a game in flow saves nothing and you get
  // the level fresh.
  const save = window.GameSave?.attach({
    key: "pipes",
    slug: "pipes-open",
    name: "Pipe Panic",
    version: 2,
    serialize: () =>
      !game || game.over || flowing
        ? null
        : { g: game.grid, q: game.queue, s: game.source, h: game.head, n: game.need, sc: game.score, lv: level, ts: totalScore },
    restore: (s) => {
      if (!s || !Array.isArray(s.g) || s.g.length !== COLS * ROWS || !s.s) return false;
      level = s.lv; totalScore = s.ts;
      game = makeGame();
      game.grid = s.g;
      game.queue = s.q;
      game.source = s.s;
      game.head = s.h;
      game.need = s.n;
      game.score = s.sc;
      flowing = false;
      return true;
    },
  });

  function tick(now) {
    if (game && !game.over) {
      if (!flowing && now >= startAt) {
        flowing = true;
        lastFlow = now;
        say("The water's flowing — keep laying ahead of it!");
      }
      if (flowing) {
        if (now - lastFlow >= intervalFor(level)) {
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
    const extra = Math.max(0, game.flowed - game.need);
    if (game.cleared) {
      totalScore += game.score + 250 * level;
      const bonus = extra ? ` ${extra} pipe${extra === 1 ? "" : "s"} past the target.` : "";
      level++;
      say(`${game.reason} Level cleared —${bonus} On to level ${level}.`);
      setTimeout(startLevel, 1600);
    } else {
      totalScore += game.score;
      say(`${game.reason} You needed ${game.need} pipes and got ${game.flowed}. Final score ${totalScore} — click New game.`);
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
        const i = game.idx(x, y);
        const m = game.grid[i];
        if (!m) continue;
        if (m === BLOCK) {
          ctx.fillStyle = "#4a4038";
          ctx.fillRect(x * CELL + 3, y * CELL + 3, CELL - 6, CELL - 6);
          ctx.strokeStyle = "#6b5c4e";
          ctx.strokeRect(x * CELL + 3.5, y * CELL + 3.5, CELL - 7, CELL - 7);
          continue;
        }
        const used = game.wet.get(i) || 0;
        // A cross half-filled shows both states, which is the only way to see
        // that its second axis is still available.
        if (used && used !== m) {
          drawPipe(ctx, x * CELL, y * CELL, m & ~used, CELL, "#b8b8b8");
          drawPipe(ctx, x * CELL, y * CELL, used, CELL, "#2f9fe0");
        } else {
          drawPipe(ctx, x * CELL, y * CELL, m, CELL, used ? "#2f9fe0" : "#b8b8b8");
        }
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
      ctx.fillStyle = "rgba(255,255,255,.15)";
      ctx.fillRect(0, cv.height - 6, cv.width * (left / preroll), 6);
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
  function cellFromEvent(e) {
    const r = cv.getBoundingClientRect();
    // Map through the canvas's own backing size rather than the border box, so
    // the 2px inset border can't skew the column near the edges.
    const x = Math.floor(((e.clientX - r.left) / r.width) * COLS);
    const y = Math.floor(((e.clientY - r.top) / r.height) * ROWS);
    return { x, y };
  }

  cv.addEventListener("click", (e) => {
    if (!game || game.over) return;
    const { x, y } = cellFromEvent(e);
    if (game.place(x, y)) { save?.mark(); drawQueue(); hud(); say(""); }
    else if (game.blocked?.(x, y)) say("That square is blocked.");
    else if (game.wet.has(game.idx(x, y))) say("The water's already through there.");
    else say("Can't build there.");
  });

  el("start").addEventListener("click", () => {
    if (!game || game.over || flowing) return;
    // Starting early is worth points, as it is in the original — the bonus is
    // proportional to the countdown you gave up.
    const left = Math.max(0, startAt - performance.now());
    game.score += Math.round((left / 1000) * 20);
    startAt = performance.now();
    hud();
  });
  el("newgame").addEventListener("click", newGame);

  function fit() {
    const avail = Math.min(window.innerWidth - 130, 480);
    CELL = Math.max(30, Math.min(48, Math.floor(avail / COLS)));
    cv.width = COLS * CELL;
    cv.height = ROWS * CELL;
  }
  window.addEventListener("resize", () => { fit(); });

  // Expose the rules for the boot test and for driving them headlessly; the
  // page itself never uses this.
  window.__pipes = () => game;

  if (save?.restored) {
    fit();
    // The countdown restarts in full rather than resuming where it stood — the
    // stored clock would have run out while the tab was closed.
    preroll = prerollFor(level);
    startAt = performance.now() + preroll;
    lastFlow = 0;
    say(`Resumed level ${level}.`);
    hud(); drawQueue();
  } else {
    newGame();
  }
  raf = requestAnimationFrame(tick);
})();
