// Open JezzBall — a from-scratch implementation of the Microsoft Entertainment
// Pack classic.
//
// Written for ExeBrowser because the original is proprietary Microsoft software
// and can't be hosted. Runs natively: no emulator, no download.
//
// The game: bouncing balls roam an open field. You build walls to partition it,
// and any region left with no ball in it is captured. Fill 75% to advance. A
// ball touching a wall while it is still growing costs a life and the wall.
//
// Faithful where it matters:
//   * Level N has N+1 balls, and lives carry over between levels.
//   * Walls grow from the click point in both directions at once, and only
//     become solid when BOTH ends have anchored.
//   * Capture is a flood fill from every ball; whatever the fill can't reach
//     is sealed off and filled in.
//   * The 75% threshold, and scoring by the percentage actually captured.
(() => {
  "use strict";

  const cv = document.getElementById("c");
  const ctx = cv.getContext("2d");
  const el = (id) => document.getElementById(id);

  // The field is a grid of cells; walls run along cell boundaries and captured
  // regions are whole cells, which is what makes flood-fill capture cheap.
  const CELL = 8;
  let COLS = 0, ROWS = 0;
  let grid = null;              // 0 = open, 1 = filled/wall
  let balls = [];
  let level = 1, lives = 3, score = 0, pct = 0;
  let building = null;          // the wall being grown
  let vertical = true;
  let running = false, dead = false;
  let raf = null;

  const idx = (x, y) => y * COLS + x;

  function sizeBoard() {
    // Fit the canvas to the viewport but keep whole cells.
    const maxW = Math.min(window.innerWidth - 40, 640);
    COLS = Math.max(40, Math.floor(maxW / CELL));
    ROWS = Math.max(28, Math.floor((COLS * 0.625)));
    cv.width = COLS * CELL;
    cv.height = ROWS * CELL;
  }

  function newGame() {
    level = 1; lives = 3; score = 0;
    save?.clear();
    startLevel();
  }

  // ── resume ─────────────────────────────────────────────────────────────────
  //
  // The grid is a Uint8Array, which JSON turns into an object of index keys, so
  // it goes over as a plain array and comes back typed. `building` is dropped:
  // a half-grown wall resuming with the balls in new positions would either
  // finish itself or cost a life before you'd touched anything.
  const save = window.GameSave?.attach({
    key: "jezzball",
    slug: "jezzball-open",
    name: "JezzBall",
    version: 1,
    serialize: () =>
      dead ? null : { g: Array.from(grid), b: balls, lv: level, li: lives, sc: score, p: pct, v: vertical, c: COLS, r: ROWS },
    restore: (s) => {
      if (!s || !Array.isArray(s.g) || !Array.isArray(s.b) || s.g.length !== s.c * s.r) return false;
      COLS = s.c; ROWS = s.r;
      cv.width = COLS * CELL;
      cv.height = ROWS * CELL;
      grid = Uint8Array.from(s.g);
      balls = s.b;
      level = s.lv; lives = s.li; score = s.sc; pct = s.p;
      vertical = s.v;
      building = null;
      dead = false;
      return true;
    },
  });

  function startLevel() {
    sizeBoard();
    grid = new Uint8Array(COLS * ROWS);
    balls = [];
    const n = level + 1;
    for (let i = 0; i < n; i++) {
      const speed = 1.1 + Math.min(0.9, level * 0.06);
      const ang = (Math.PI / 4) + (Math.random() * Math.PI / 2) + (Math.random() < 0.5 ? Math.PI : 0);
      balls.push({
        x: (0.25 + Math.random() * 0.5) * cv.width,
        y: (0.25 + Math.random() * 0.5) * cv.height,
        vx: Math.cos(ang) * speed * 1.6,
        vy: Math.sin(ang) * speed * 1.6,
        r: 6,
      });
    }
    building = null;
    dead = false;
    pct = 0;
    say(`Level ${level} — trap ${n} ball${n > 1 ? "s" : ""}.`);
    updateHud();
    save?.mark();
    if (!running) { running = true; loop(); }
  }

  const say = (m) => { el("msg").textContent = m || ""; };
  function updateHud() {
    el("level").textContent = String(level);
    el("lives").textContent = String(lives);
    el("pct").textContent = pct + "%";
    el("score").textContent = String(score);
  }

  // ── walls ────────────────────────────────────────────────────────────────
  //
  // A wall grows from the clicked cell outward in both directions. Each end
  // stops when it reaches a filled cell or the edge. Only when both ends have
  // stopped does the wall become permanent — until then a ball can break it.
  function startWall(cx, cy) {
    if (building || dead) return;
    if (cx < 0 || cy < 0 || cx >= COLS || cy >= ROWS) return;
    if (grid[idx(cx, cy)]) return;
    building = {
      cx, cy, vertical,
      a: 0, b: 0,            // how far each end has grown
      aDone: false, bDone: false,
      speed: 0.55,
      t: 0,
    };
  }

  function growWall() {
    const w = building;
    if (!w) return;
    w.t += w.speed;
    const step = Math.floor(w.t);

    if (!w.aDone && step > w.a) {
      w.a = step;
      const [x, y] = w.vertical ? [w.cx, w.cy - w.a] : [w.cx - w.a, w.cy];
      if (x < 0 || y < 0 || grid[idx(x, y)]) w.aDone = true;
    }
    if (!w.bDone && step > w.b) {
      w.b = step;
      const [x, y] = w.vertical ? [w.cx, w.cy + w.b] : [w.cx + w.b, w.cy];
      if (x >= COLS || y >= ROWS || grid[idx(x, y)]) w.bDone = true;
    }

    if (w.aDone && w.bDone) commitWall();
  }

  // Cells the growing wall currently occupies — used for drawing and for the
  // ball collision that breaks it.
  function wallCells(w) {
    const out = [];
    for (let i = 0; i <= w.a; i++) {
      const [x, y] = w.vertical ? [w.cx, w.cy - i] : [w.cx - i, w.cy];
      if (x >= 0 && y >= 0 && x < COLS && y < ROWS) out.push([x, y]);
    }
    for (let i = 1; i <= w.b; i++) {
      const [x, y] = w.vertical ? [w.cx, w.cy + i] : [w.cx + i, w.cy];
      if (x >= 0 && y >= 0 && x < COLS && y < ROWS) out.push([x, y]);
    }
    return out;
  }

  function commitWall() {
    for (const [x, y] of wallCells(building)) grid[idx(x, y)] = 1;
    building = null;
    captureRegions();
  }

  function breakWall() {
    building = null;
    lives--;
    updateHud();
    save?.mark();
    if (lives <= 0) {
      dead = true;
      say(`Game over — level ${level}, score ${score}. Click New game.`);
    } else {
      say("A ball hit the wall — life lost.");
    }
  }

  // ── capture ──────────────────────────────────────────────────────────────
  //
  // Flood-fill from every ball. Anything the fill can't reach has been sealed
  // off and becomes filled area. This is the whole game in one function.
  function captureRegions() {
    const seen = new Uint8Array(COLS * ROWS);
    const stack = [];
    for (const b of balls) {
      const bx = Math.floor(b.x / CELL), by = Math.floor(b.y / CELL);
      if (bx < 0 || by < 0 || bx >= COLS || by >= ROWS) continue;
      if (!grid[idx(bx, by)] && !seen[idx(bx, by)]) { seen[idx(bx, by)] = 1; stack.push(bx, by); }
    }
    while (stack.length) {
      const y = stack.pop(), x = stack.pop();
      const tryCell = (nx, ny) => {
        if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) return;
        const i = idx(nx, ny);
        if (grid[i] || seen[i]) return;
        seen[i] = 1; stack.push(nx, ny);
      };
      tryCell(x + 1, y); tryCell(x - 1, y); tryCell(x, y + 1); tryCell(x, y - 1);
    }
    let filled = 0;
    for (let i = 0; i < grid.length; i++) {
      if (!grid[i] && !seen[i]) grid[i] = 1;      // unreachable → captured
      if (grid[i]) filled++;
    }
    const before = pct;
    pct = Math.round((filled / grid.length) * 100);
    if (pct > before) score += (pct - before) * level * 10;
    updateHud();
    // A committed wall is the only thing that changes the field; the balls just
    // move around inside it.
    save?.mark();
    if (pct >= 75) nextLevel();
  }

  function nextLevel() {
    score += 1000 + lives * 250;
    level++;
    lives++;                       // the original's reward for clearing
    say(`Level cleared! On to level ${level}.`);
    setTimeout(startLevel, 900);
  }

  // ── loop ─────────────────────────────────────────────────────────────────
  function step() {
    if (dead) return;

    for (const b of balls) {
      // Move on each axis separately so a bounce off one doesn't cancel the
      // other — the classic tunnelling bug if you do both at once.
      let nx = b.x + b.vx;
      if (hits(nx, b.y, b.r)) { b.vx = -b.vx; nx = b.x; }
      let ny = b.y + b.vy;
      if (hits(nx, ny, b.r)) { b.vy = -b.vy; ny = b.y; }
      b.x = nx; b.y = ny;

      if (b.x < b.r) { b.x = b.r; b.vx = Math.abs(b.vx); }
      if (b.y < b.r) { b.y = b.r; b.vy = Math.abs(b.vy); }
      if (b.x > cv.width - b.r) { b.x = cv.width - b.r; b.vx = -Math.abs(b.vx); }
      if (b.y > cv.height - b.r) { b.y = cv.height - b.r; b.vy = -Math.abs(b.vy); }
    }

    if (building) {
      growWall();
      // A ball touching the wall while it is still growing breaks it.
      if (building) {
        for (const [x, y] of wallCells(building)) {
          const px = x * CELL + CELL / 2, py = y * CELL + CELL / 2;
          for (const b of balls) {
            if (Math.abs(b.x - px) < b.r + CELL / 2 && Math.abs(b.y - py) < b.r + CELL / 2) {
              breakWall();
              break;
            }
          }
          if (!building) break;
        }
      }
    }
  }

  // Does a ball at (x,y) overlap a filled cell?
  function hits(x, y, r) {
    const x0 = Math.floor((x - r) / CELL), x1 = Math.floor((x + r) / CELL);
    const y0 = Math.floor((y - r) / CELL), y1 = Math.floor((y + r) / CELL);
    for (let gy = y0; gy <= y1; gy++)
      for (let gx = x0; gx <= x1; gx++) {
        if (gx < 0 || gy < 0 || gx >= COLS || gy >= ROWS) continue;
        if (grid[idx(gx, gy)]) return true;
      }
    return false;
  }

  function draw() {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, cv.width, cv.height);

    // Captured area — the blue field the original fills in.
    ctx.fillStyle = "#2b5c86";
    for (let y = 0; y < ROWS; y++)
      for (let x = 0; x < COLS; x++)
        if (grid[idx(x, y)]) ctx.fillRect(x * CELL, y * CELL, CELL, CELL);

    // The wall in progress, in a colour that reads as "not safe yet".
    if (building) {
      ctx.fillStyle = "#e8c33a";
      for (const [x, y] of wallCells(building)) ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
    }

    for (const b of balls) {
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fillStyle = "#e02020";
      ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  function loop() {
    step();
    draw();
    raf = requestAnimationFrame(loop);
  }

  // ── input ────────────────────────────────────────────────────────────────
  function cellAt(e) {
    const r = cv.getBoundingClientRect();
    return [
      Math.floor((e.clientX - r.left) / (r.width / COLS)),
      Math.floor((e.clientY - r.top) / (r.height / ROWS)),
    ];
  }

  cv.addEventListener("pointerdown", (e) => {
    if (dead) return;
    if (e.button === 2) { flip(); e.preventDefault(); return; }
    const [x, y] = cellAt(e);
    startWall(x, y);
    e.preventDefault();
  });
  cv.addEventListener("contextmenu", (e) => e.preventDefault());

  function flip() {
    vertical = !vertical;
    el("dir").textContent = vertical ? "Wall: vertical ↕" : "Wall: horizontal ↔";
  }
  el("dir").addEventListener("click", flip);
  el("newgame").addEventListener("click", newGame);
  window.addEventListener("keydown", (e) => {
    if (e.code === "Space") { flip(); e.preventDefault(); }
  });
  window.addEventListener("resize", () => {
    // Resizing mid-level would invalidate the grid, so only re-fit between
    // games rather than rebuilding a board someone is playing.
    if (!running) sizeBoard();
  });

  if (save?.restored) {
    el("dir").textContent = vertical ? "Wall: vertical ↕" : "Wall: horizontal ↔";
    updateHud();
    say(`Resumed level ${level}.`);
    running = true; loop();
  } else {
    newGame();
  }
})();
