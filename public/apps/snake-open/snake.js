// Snake — a from-scratch implementation of the arcade classic.
//
// Written for ExeBrowser. Snake predates any single owner — it goes back to
// 1976 arcade Blockade, and the version most people remember shipped on Nokia
// phones in 1997. The rules are common property; this is original code with
// its own presentation, styled after a monochrome LCD.
//
// Details that matter to how it plays:
//   * Direction changes queue rather than apply instantly. Pressing up-then-
//     right faster than one tick used to let you reverse into yourself; the
//     queue means each press takes effect on its own step.
//   * You cannot reverse into your own neck, which is the other classic
//     instant-death bug.
//   * Food never spawns under the snake.
//   * Speed rises every five pieces, and "walls off" wraps the edges — the two
//     options every version of this game has shipped with.
(() => {
  "use strict";

  const cv = document.getElementById("c");
  const ctx = cv.getContext("2d");
  const el = (id) => document.getElementById(id);

  const CELL = 12;
  let COLS = 40, ROWS = 30;

  let snake, food, dir, queue, alive, paused, score = 0, best = 0;
  let baseMs = 130, stepMs = 130, acc = 0, last = 0, raf = null, walls = true;

  const BEST_KEY = "exe_snake_best";
  try { best = parseInt(localStorage.getItem(BEST_KEY), 10) || 0; } catch { best = 0; }

  function sizeBoard() {
    const maxW = Math.min(window.innerWidth - 34, 480);
    COLS = Math.max(24, Math.floor(maxW / CELL));
    ROWS = Math.max(18, Math.round(COLS * 0.75));
    cv.width = COLS * CELL;
    cv.height = ROWS * CELL;
  }

  function newGame() {
    sizeBoard();
    const cx = COLS >> 1, cy = ROWS >> 1;
    snake = [[cx, cy], [cx - 1, cy], [cx - 2, cy]];
    dir = [1, 0];
    queue = [];
    alive = true; paused = false; score = 0;
    stepMs = baseMs; acc = 0; last = performance.now();
    save?.clear();
    placeFood();
    hud(); say("");
    if (!raf) loop(last);
  }

  // ── resume ─────────────────────────────────────────────────────────────────
  //
  // The board is sized from the viewport, so the stored dimensions come along
  // and are re-applied — a snake laid out for 40 columns makes no sense on a
  // board that came back 30 wide. `best` is not stored here; it already has its
  // own key and is not part of a single game. The queued turns are dropped:
  // they were pressed before you left.
  const save = window.GameSave?.attach({
    key: "snake",
    slug: "snake-open",
    name: "Snake",
    version: 1,
    serialize: () =>
      alive ? { s: snake, f: food, d: dir, sc: score, ms: stepMs, bm: baseMs, w: walls, c: COLS, r: ROWS } : null,
    restore: (s) => {
      if (!s || !Array.isArray(s.s) || !s.s.length || !Array.isArray(s.d)) return false;
      COLS = s.c; ROWS = s.r;
      cv.width = COLS * CELL;
      cv.height = ROWS * CELL;
      snake = s.s;
      food = s.f;
      dir = s.d;
      queue = [];
      score = s.sc; stepMs = s.ms; baseMs = s.bm; walls = s.w;
      alive = true;
      // Snake never stops moving, so hand it back paused rather than a step
      // away from a wall you didn't see coming.
      paused = true;
      return true;
    },
  });

  function placeFood() {
    const taken = new Set(snake.map(([x, y]) => y * COLS + x));
    const free = [];
    for (let y = 0; y < ROWS; y++)
      for (let x = 0; x < COLS; x++) if (!taken.has(y * COLS + x)) free.push([x, y]);
    if (!free.length) { win(); return; }
    food = free[Math.floor(Math.random() * free.length)];
  }

  function step() {
    if (!alive || paused) return;

    // One queued turn per tick, so a fast double-tap can't fold the snake back
    // on itself within a single step.
    if (queue.length) {
      const d = queue.shift();
      if (d[0] !== -dir[0] || d[1] !== -dir[1]) dir = d;
      // A turn is the other discrete thing you do here, and it's what makes a
      // run with no food eaten yet still worth storing.
      save?.mark();
    }

    let [hx, hy] = snake[0];
    hx += dir[0]; hy += dir[1];

    if (walls) {
      if (hx < 0 || hy < 0 || hx >= COLS || hy >= ROWS) return die();
    } else {
      hx = (hx + COLS) % COLS;
      hy = (hy + ROWS) % ROWS;
    }

    // The tail cell is about to be vacated, so running into it is legal —
    // except when we're growing this tick.
    const eating = food && hx === food[0] && hy === food[1];
    const body = eating ? snake : snake.slice(0, -1);
    if (body.some(([x, y]) => x === hx && y === hy)) return die();

    snake.unshift([hx, hy]);
    if (eating) {
      score += 10;
      if (score > best) {
        best = score;
        try { localStorage.setItem(BEST_KEY, String(best)); } catch { /* private mode */ }
      }
      if (score % 50 === 0) {
        stepMs = Math.max(55, stepMs - 10);
        say("Faster!");
      }
      placeFood();
      hud();
      // Eating is the only step that changes anything you'd miss; the rest is
      // the snake sliding along.
      save?.mark();
    } else {
      snake.pop();
    }
  }

  function die() {
    alive = false;
    say(`Game over — score ${score}. Click New game.`);
  }
  function win() {
    alive = false;
    say(`You filled the board! Score ${score}.`);
  }

  function hud() {
    el("score").textContent = String(score);
    el("best").textContent = String(best);
  }
  const say = (m) => { el("msg").textContent = m || ""; };

  // ── drawing ──────────────────────────────────────────────────────────────
  function draw() {
    ctx.fillStyle = "#9ead86";
    ctx.fillRect(0, 0, cv.width, cv.height);

    // Faint cell grid, like the pixel gaps on an LCD.
    ctx.strokeStyle = "rgba(0,0,0,.05)";
    ctx.lineWidth = 1;
    for (let x = 1; x < COLS; x++) {
      ctx.beginPath(); ctx.moveTo(x * CELL, 0); ctx.lineTo(x * CELL, cv.height); ctx.stroke();
    }
    for (let y = 1; y < ROWS; y++) {
      ctx.beginPath(); ctx.moveTo(0, y * CELL); ctx.lineTo(cv.width, y * CELL); ctx.stroke();
    }

    if (food) {
      ctx.fillStyle = "#2f3527";
      const [fx, fy] = food;
      ctx.fillRect(fx * CELL + 3, fy * CELL + 3, CELL - 6, CELL - 6);
      ctx.fillRect(fx * CELL + 5, fy * CELL + 1, CELL - 10, CELL - 2);
      ctx.fillRect(fx * CELL + 1, fy * CELL + 5, CELL - 2, CELL - 10);
    }

    snake.forEach(([x, y], i) => {
      ctx.fillStyle = i === 0 ? "#1d2117" : "#2f3527";
      const p = i === 0 ? 1 : 2;
      ctx.fillRect(x * CELL + p, y * CELL + p, CELL - p * 2, CELL - p * 2);
    });

    if (paused) {
      ctx.fillStyle = "rgba(0,0,0,.6)";
      ctx.fillRect(0, cv.height / 2 - 20, cv.width, 40);
      ctx.fillStyle = "#fff";
      ctx.font = '600 17px "Segoe UI", Tahoma, sans-serif';
      ctx.textAlign = "center";
      ctx.fillText("Paused", cv.width / 2, cv.height / 2 + 6);
      ctx.textAlign = "left";
    }
  }

  function loop(t) {
    const dt = t - last;
    last = t;
    if (alive && !paused) {
      acc += dt;
      while (acc >= stepMs) { acc -= stepMs; step(); }
    }
    draw();
    raf = requestAnimationFrame(loop);
  }

  // ── input ────────────────────────────────────────────────────────────────
  const KEYS = {
    ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
    KeyW: [0, -1], KeyS: [0, 1], KeyA: [-1, 0], KeyD: [1, 0],
  };
  window.addEventListener("keydown", (e) => {
    if (e.code === "KeyP") { togglePause(); e.preventDefault(); return; }
    const d = KEYS[e.code];
    if (!d) return;
    if (queue.length < 2) queue.push(d);
    e.preventDefault();
  });
  function togglePause() {
    if (!alive) return;
    paused = !paused;
    say(paused ? "Paused." : "");
  }
  for (const b of document.querySelectorAll("[data-dir]")) {
    const d = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[b.dataset.dir];
    b.addEventListener("click", () => { if (queue.length < 2) queue.push(d); });
  }

  let sx = 0, sy = 0, tracking = false;
  cv.addEventListener("touchstart", (e) => {
    const t0 = e.changedTouches[0]; sx = t0.clientX; sy = t0.clientY; tracking = true;
  }, { passive: true });
  cv.addEventListener("touchend", (e) => {
    if (!tracking) return;
    tracking = false;
    const t0 = e.changedTouches[0];
    const dx = t0.clientX - sx, dy = t0.clientY - sy;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 20) return;
    const d = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? [1, 0] : [-1, 0]) : (dy > 0 ? [0, 1] : [0, -1]);
    if (queue.length < 2) queue.push(d);
  }, { passive: true });

  el("newgame").addEventListener("click", newGame);
  el("walls").addEventListener("click", () => {
    walls = !walls;
    el("walls").textContent = "Walls: " + (walls ? "on" : "off");
    newGame();
  });
  for (const b of document.querySelectorAll("[data-speed]")) {
    b.addEventListener("click", () => {
      for (const o of document.querySelectorAll("[data-speed]")) o.classList.remove("on");
      b.classList.add("on");
      baseMs = b.dataset.speed === "fast" ? 80 : 130;
      newGame();
    });
  }
  window.addEventListener("resize", () => { if (!alive) sizeBoard(); });

  if (save?.restored) {
    el("walls").textContent = "Walls: " + (walls ? "on" : "off");
    for (const b of document.querySelectorAll("[data-speed]"))
      b.classList.toggle("on", (b.dataset.speed === "fast") === (baseMs === 80));
    last = performance.now(); acc = 0;
    hud();
    say("Resumed your game — press P to play.");
    loop(last);
  } else {
    newGame();
  }
})();
