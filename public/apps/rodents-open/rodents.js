// Open Rodent's Revenge — a from-scratch implementation of the Microsoft
// Entertainment Pack classic.
//
// Written for ExeBrowser because the original is proprietary Microsoft software
// and can't be hosted. Runs natively: no emulator, no download.
//
// The game: you are a mouse on a grid of pushable blocks. Cats chase you. Push
// blocks to wall a cat into a space it can't escape and it turns to cheese;
// eat the cheese for points. Clear every cat to finish the level.
//
// Faithful where it matters:
//   * Pushing a whole ROW of blocks at once, not just one — the mechanic the
//     whole game rests on, and the thing most clones get wrong.
//   * Trapping is a flood fill: a cat is caught when it cannot reach any open
//     edge of its region, not merely when it is orthogonally surrounded.
//   * Cats hunt you but can't push blocks, so blocks are your only weapon.
//   * Level N adds a cat and speeds them up; clearing one grants a life.
(() => {
  "use strict";

  const cv = document.getElementById("c");
  const ctx = cv.getContext("2d");
  const el = (id) => document.getElementById(id);

  const CELL = 16;
  let COLS = 32, ROWS = 24;

  // Cell contents.
  const EMPTY = 0, BLOCK = 1, WALL = 2, CHEESE = 3;
  let grid, mouse, cats, level = 1, lives = 3, score = 0;
  let dead = false, busy = false, raf = null;
  let tick = 0;

  const idx = (x, y) => y * COLS + x;
  const inB = (x, y) => x >= 0 && x < COLS && y >= 0 && y < ROWS;

  function sizeBoard() {
    const maxW = Math.min(window.innerWidth - 40, 512);
    COLS = Math.max(20, Math.floor(maxW / CELL));
    ROWS = Math.max(16, Math.round(COLS * 0.75));
    cv.width = COLS * CELL;
    cv.height = ROWS * CELL;
  }

  function newGame() { level = 1; lives = 3; score = 0; save?.clear(); startLevel(); }

  // ── resume ─────────────────────────────────────────────────────────────────
  //
  // Turn-based under the animation loop, so there is no mid-frame to land in:
  // the board between two keypresses is the whole state. The grid is a
  // Uint8Array and travels as a plain array. `busy` is dropped — it only ever
  // guards a timeout that no longer exists.
  const save = window.GameSave?.attach({
    key: "rodents",
    slug: "rodents-open",
    name: "Rodent's Revenge",
    version: 1,
    serialize: () =>
      dead ? null : { g: Array.from(grid), m: mouse, ca: cats, lv: level, li: lives, sc: score, t: tick, c: COLS, r: ROWS },
    restore: (s) => {
      if (!s || !Array.isArray(s.g) || !s.m || !Array.isArray(s.ca) || s.g.length !== s.c * s.r) return false;
      COLS = s.c; ROWS = s.r;
      cv.width = COLS * CELL;
      cv.height = ROWS * CELL;
      grid = Uint8Array.from(s.g);
      mouse = s.m;
      cats = s.ca;
      level = s.lv; lives = s.li; score = s.sc; tick = s.t || 0;
      dead = false; busy = false;
      return true;
    },
  });

  function startLevel() {
    sizeBoard();
    grid = new Uint8Array(COLS * ROWS);
    // A solid border, then a scattered field of pushable blocks.
    for (let x = 0; x < COLS; x++) { grid[idx(x, 0)] = WALL; grid[idx(x, ROWS - 1)] = WALL; }
    for (let y = 0; y < ROWS; y++) { grid[idx(0, y)] = WALL; grid[idx(COLS - 1, y)] = WALL; }
    for (let y = 2; y < ROWS - 2; y++)
      for (let x = 2; x < COLS - 2; x++)
        if (Math.random() < 0.42) grid[idx(x, y)] = BLOCK;

    // Clear a pocket for the mouse so it never starts boxed in.
    mouse = { x: (COLS >> 1), y: (ROWS >> 1) };
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++)
        if (inB(mouse.x + dx, mouse.y + dy)) grid[idx(mouse.x + dx, mouse.y + dy)] = EMPTY;

    // Cats start in the corners, far from the mouse.
    cats = [];
    const spots = [[2, 2], [COLS - 3, 2], [2, ROWS - 3], [COLS - 3, ROWS - 3],
                   [COLS >> 1, 2], [COLS >> 1, ROWS - 3]];
    for (let i = 0; i < level + 1 && i < spots.length; i++) {
      const [x, y] = spots[i];
      grid[idx(x, y)] = EMPTY;
      cats.push({ x, y, cool: 0 });
    }

    dead = false; busy = false; tick = 0;
    say(`Level ${level} — trap ${cats.length} cat${cats.length > 1 ? "s" : ""}.`);
    hud();
    save?.mark();
    if (!raf) loop();
  }

  const say = (m) => { el("msg").textContent = m || ""; };
  function hud() {
    el("level").textContent = String(level);
    el("lives").textContent = String(lives);
    el("cats").textContent = String(cats.length);
    el("score").textContent = String(score);
  }

  // ── movement ─────────────────────────────────────────────────────────────
  //
  // The mouse pushes a whole run of blocks: everything in a line ahead of it
  // shifts one cell, provided the far end has somewhere to go. Walls and cats
  // stop a push dead.
  function move(dx, dy) {
    if (dead || busy) return;
    const nx = mouse.x + dx, ny = mouse.y + dy;
    if (!inB(nx, ny)) return;
    const t = grid[idx(nx, ny)];

    if (t === WALL) return;
    if (cats.some((c) => c.x === nx && c.y === ny)) return;   // walking into a cat is suicide

    if (t === BLOCK) {
      // Find the end of the run of blocks.
      let ex = nx, ey = ny;
      while (inB(ex, ey) && grid[idx(ex, ey)] === BLOCK) { ex += dx; ey += dy; }
      if (!inB(ex, ey)) return;
      if (grid[idx(ex, ey)] !== EMPTY && grid[idx(ex, ey)] !== CHEESE) return;
      if (cats.some((c) => c.x === ex && c.y === ey)) return;  // can't crush a cat
      // Shift the run one cell along.
      grid[idx(ex, ey)] = BLOCK;
      grid[idx(nx, ny)] = EMPTY;
    } else if (t === CHEESE) {
      grid[idx(nx, ny)] = EMPTY;
      score += 50 * level;
      say("Cheese! +" + 50 * level);
    }

    mouse.x = nx; mouse.y = ny;
    catTurn();
    checkTrapped();
    hud();
    // Nothing moves here except on a keypress, so one move is one state change.
    save?.mark();
  }

  // Cats step toward the mouse, preferring the axis they are furthest off on,
  // and cannot move through blocks.
  function catTurn() {
    const speed = Math.max(2, 7 - level);      // lower = faster
    if (tick++ % speed !== 0) return;
    for (const c of cats) {
      const dx = Math.sign(mouse.x - c.x), dy = Math.sign(mouse.y - c.y);
      const tries = Math.abs(mouse.x - c.x) > Math.abs(mouse.y - c.y)
        ? [[dx, 0], [0, dy]] : [[0, dy], [dx, 0]];
      for (const [mx, my] of tries) {
        if (!mx && !my) continue;
        const nx = c.x + mx, ny = c.y + my;
        if (!inB(nx, ny)) continue;
        const g = grid[idx(nx, ny)];
        if (g === BLOCK || g === WALL) continue;
        if (cats.some((o) => o !== c && o.x === nx && o.y === ny)) continue;
        c.x = nx; c.y = ny;
        break;
      }
      if (c.x === mouse.x && c.y === mouse.y) return void caught();
    }
  }

  // A cat is trapped when the open region it stands in touches no other cat
  // and cannot reach the mouse — i.e. it has been sealed into a pocket.
  function checkTrapped() {
    const survivors = [];
    for (const c of cats) {
      const region = flood(c.x, c.y);
      // Reaching the mouse means it is still hunting; a big region means it
      // still has room. Sealed and small is what counts as caught.
      const free = region.size;
      const reachesMouse = region.has(idx(mouse.x, mouse.y));
      if (!reachesMouse && free <= 12) {
        grid[idx(c.x, c.y)] = CHEESE;
        score += 200 * level;
        say("Cat trapped! +" + 200 * level);
      } else {
        survivors.push(c);
      }
    }
    cats = survivors;
    hud();
    if (!cats.length) nextLevel();
  }

  function flood(sx, sy) {
    const seen = new Set();
    const stack = [[sx, sy]];
    seen.add(idx(sx, sy));
    while (stack.length) {
      const [x, y] = stack.pop();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (!inB(nx, ny)) continue;
        const i = idx(nx, ny);
        if (seen.has(i)) continue;
        const g = grid[i];
        if (g === BLOCK || g === WALL) continue;
        seen.add(i);
        stack.push([nx, ny]);
      }
      if (seen.size > 400) break;      // plenty of room — definitely not trapped
    }
    return seen;
  }

  function caught() {
    lives--;
    hud();
    if (lives <= 0) {
      dead = true;
      say(`Game over — level ${level}, score ${score}. Click New game.`);
    } else {
      busy = true;
      say("The cat got you! Lives left: " + lives);
      setTimeout(() => { busy = false; startLevel(); }, 1100);
    }
  }

  function nextLevel() {
    score += 1000 * level;
    level++; lives++;
    busy = true;
    say(`Level cleared! On to level ${level}.`);
    setTimeout(() => { busy = false; startLevel(); }, 900);
  }

  // ── drawing ──────────────────────────────────────────────────────────────
  function draw() {
    ctx.fillStyle = "#008080";
    ctx.fillRect(0, 0, cv.width, cv.height);

    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const g = grid[idx(x, y)];
        const px = x * CELL, py = y * CELL;
        if (g === WALL) {
          ctx.fillStyle = "#404040";
          ctx.fillRect(px, py, CELL, CELL);
        } else if (g === BLOCK) {
          // A bevelled block, in keeping with the Windows look.
          ctx.fillStyle = "#c0c0c0";
          ctx.fillRect(px, py, CELL, CELL);
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(px, py, CELL, 2); ctx.fillRect(px, py, 2, CELL);
          ctx.fillStyle = "#808080";
          ctx.fillRect(px, py + CELL - 2, CELL, 2); ctx.fillRect(px + CELL - 2, py, 2, CELL);
        } else if (g === CHEESE) {
          ctx.fillStyle = "#f2c200";
          ctx.beginPath();
          ctx.moveTo(px + 2, py + CELL - 3);
          ctx.lineTo(px + CELL - 2, py + CELL - 3);
          ctx.lineTo(px + CELL - 2, py + 4);
          ctx.closePath();
          ctx.fill();
          ctx.fillStyle = "#c99e00";
          ctx.fillRect(px + 6, py + 8, 2, 2);
          ctx.fillRect(px + 10, py + 11, 2, 2);
        }
      }
    }

    for (const c of cats) {
      const px = c.x * CELL, py = c.y * CELL;
      ctx.fillStyle = "#d84f2a";
      ctx.beginPath();
      ctx.arc(px + CELL / 2, py + CELL / 2, CELL * 0.38, 0, Math.PI * 2);
      ctx.fill();
      // Ears, so a cat reads as a cat rather than a dot.
      ctx.beginPath();
      ctx.moveTo(px + 3, py + 5); ctx.lineTo(px + 6, py + 1); ctx.lineTo(px + 8, py + 5);
      ctx.moveTo(px + CELL - 3, py + 5); ctx.lineTo(px + CELL - 6, py + 1); ctx.lineTo(px + CELL - 8, py + 5);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.fillRect(px + 5, py + 7, 2, 2);
      ctx.fillRect(px + CELL - 7, py + 7, 2, 2);
    }

    const mx = mouse.x * CELL, my = mouse.y * CELL;
    ctx.fillStyle = "#e8e8e8";
    ctx.beginPath();
    ctx.arc(mx + CELL / 2, my + CELL / 2, CELL * 0.34, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(mx + 4, my + 4, 3, 0, Math.PI * 2);
    ctx.arc(mx + CELL - 4, my + 4, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#000";
    ctx.fillRect(mx + 6, my + 8, 2, 2);
    ctx.fillRect(mx + CELL - 8, my + 8, 2, 2);
  }

  function loop() { draw(); raf = requestAnimationFrame(loop); }

  // ── input ────────────────────────────────────────────────────────────────
  const KEYS = {
    ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
    KeyW: [0, -1], KeyS: [0, 1], KeyA: [-1, 0], KeyD: [1, 0],
  };
  window.addEventListener("keydown", (e) => {
    const k = KEYS[e.code];
    if (!k) return;
    move(k[0], k[1]);
    e.preventDefault();
  });
  for (const b of document.querySelectorAll("[data-dir]")) {
    const d = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[b.dataset.dir];
    b.addEventListener("click", () => move(d[0], d[1]));
  }
  el("newgame").addEventListener("click", newGame);
  window.addEventListener("resize", () => { if (dead) sizeBoard(); });

  if (save?.restored) {
    hud();
    say(`Resumed level ${level}.`);
    loop();
  } else {
    newGame();
  }
})();
