// Block Drop — an original falling-block puzzle written for ExeBrowser.
//
// The falling-block genre is not anyone's property — the rules of a game
// aren't copyrightable — but the name "Tetris" very much is, and it's actively
// enforced. So this is deliberately its own game with its own name, its own
// code and its own art. It is not a clone of any particular product, and the
// page never claims to be one.
//
// Implemented the way the genre's players expect:
//   * Seven tetromino shapes from a shuffled bag, so you never get a long
//     drought of the piece you need.
//   * Wall kicks: a rotation that would clip a wall or a stack slides one or
//     two cells to make it fit, rather than silently refusing.
//   * Soft drop, hard drop, and a ghost showing where the piece will land.
//   * Speed rises every ten lines; scoring rewards multi-line clears heavily.
(() => {
  "use strict";

  const cv = document.getElementById("c");
  const ctx = cv.getContext("2d");
  const nextCv = document.getElementById("next");
  const nctx = nextCv.getContext("2d");
  const el = (id) => document.getElementById(id);

  const COLS = 10, ROWS = 20;
  let CELL = 24;

  // Shapes as rotation-agnostic cell lists; rotation is computed, so each
  // piece needs one definition rather than four.
  const SHAPES = {
    I: { cells: [[0,1],[1,1],[2,1],[3,1]], w: 4, color: "#31c7ef" },
    O: { cells: [[1,0],[2,0],[1,1],[2,1]], w: 4, color: "#f7d308" },
    T: { cells: [[1,0],[0,1],[1,1],[2,1]], w: 3, color: "#ad4d9c" },
    S: { cells: [[1,0],[2,0],[0,1],[1,1]], w: 3, color: "#42b642" },
    Z: { cells: [[0,0],[1,0],[1,1],[2,1]], w: 3, color: "#ef2029" },
    J: { cells: [[0,0],[0,1],[1,1],[2,1]], w: 3, color: "#5a65ad" },
    L: { cells: [[2,0],[0,1],[1,1],[2,1]], w: 3, color: "#ef7921" },
  };
  const KEYS = Object.keys(SHAPES);

  let grid, piece, nextPiece, bag = [];
  let score = 0, lines = 0, level = 1;
  let dropAcc = 0, lastT = 0, over = false, paused = false, raf = null;

  const idx = (x, y) => y * COLS + x;

  // A shuffled bag of all seven, refilled when empty — the standard fix for
  // the frustration of pure random piece selection.
  function nextFromBag() {
    if (!bag.length) {
      bag = KEYS.slice();
      for (let i = bag.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [bag[i], bag[j]] = [bag[j], bag[i]];
      }
    }
    return bag.pop();
  }

  function spawn() {
    piece = nextPiece || makePiece(nextFromBag());
    nextPiece = makePiece(nextFromBag());
    piece.x = Math.floor((COLS - piece.w) / 2);
    piece.y = 0;
    if (collides(piece, 0, 0)) {
      over = true;
      say(`Game over — ${lines} lines, score ${score}. Click New game.`);
    }
    drawNext();
  }

  function makePiece(k) {
    const s = SHAPES[k];
    return { k, cells: s.cells.map((c) => c.slice()), w: s.w, color: s.color, x: 0, y: 0 };
  }

  function newGame() {
    grid = new Array(COLS * ROWS).fill(null);
    score = 0; lines = 0; level = 1;
    bag = []; nextPiece = null; over = false; paused = false;
    dropAcc = 0; lastT = performance.now();
    save?.clear();
    spawn();
    hud(); say("");
    if (!raf) loop(lastT);
  }

  // ── resume ─────────────────────────────────────────────────────────────────
  //
  // The well, the piece in the air and the bag are the whole game. The drop
  // accumulator is not stored: resuming with a partly-elapsed drop tick would
  // yank the piece down the instant the page loads.
  const save = window.GameSave?.attach({
    key: "blockdrop",
    version: 1,
    serialize: () =>
      over ? null : { g: grid, p: piece, n: nextPiece, b: bag, sc: score, li: lines, lv: level },
    restore: (s) => {
      if (!s || !Array.isArray(s.g) || s.g.length !== COLS * ROWS || !s.p) return false;
      grid = s.g;
      piece = s.p;
      nextPiece = s.n;
      bag = Array.isArray(s.b) ? s.b : [];
      score = s.sc; lines = s.li; level = s.lv;
      over = false;
      // Come back paused: a falling piece resuming under a hand that isn't on
      // the keyboard yet is a free line of damage.
      paused = true;
      return true;
    },
  });

  const say = (m) => { el("msg").textContent = m || ""; };
  function hud() {
    el("score").textContent = String(score);
    el("lines").textContent = String(lines);
    el("level").textContent = String(level);
  }

  // ── collision & rotation ─────────────────────────────────────────────────
  function collides(p, dx, dy, cells) {
    const cs = cells || p.cells;
    for (const [cx, cy] of cs) {
      const x = p.x + cx + dx, y = p.y + cy + dy;
      if (x < 0 || x >= COLS || y >= ROWS) return true;
      if (y >= 0 && grid[idx(x, y)]) return true;
    }
    return false;
  }

  // Rotate within the piece's own bounding box, then try small nudges so a
  // rotation against a wall or stack still succeeds.
  function rotate() {
    if (over || paused || piece.k === "O") return;
    const n = piece.w - 1;
    const rotated = piece.cells.map(([x, y]) => [n - y, x]);
    for (const kick of [0, -1, 1, -2, 2]) {
      if (!collides(piece, kick, 0, rotated)) {
        piece.cells = rotated;
        piece.x += kick;
        return;
      }
    }
  }

  function step(dx, dy) {
    if (over || paused) return false;
    if (collides(piece, dx, dy)) return false;
    piece.x += dx; piece.y += dy;
    return true;
  }

  function hardDrop() {
    if (over || paused) return;
    let n = 0;
    while (step(0, 1)) n++;
    score += n * 2;                    // reward committing to a drop
    lock();
  }

  function lock() {
    for (const [cx, cy] of piece.cells) {
      const x = piece.x + cx, y = piece.y + cy;
      if (y >= 0) grid[idx(x, y)] = piece.color;
    }
    clearLines();
    spawn();
    hud();
    // A locked piece is the game's only irreversible event, which makes it the
    // one place worth flagging — the frames in between are all recoverable.
    save?.mark();
  }

  function clearLines() {
    let cleared = 0;
    for (let y = ROWS - 1; y >= 0; y--) {
      let full = true;
      for (let x = 0; x < COLS; x++) if (!grid[idx(x, y)]) { full = false; break; }
      if (!full) continue;
      // Pull everything above down one row.
      for (let yy = y; yy > 0; yy--)
        for (let x = 0; x < COLS; x++) grid[idx(x, yy)] = grid[idx(x, yy - 1)];
      for (let x = 0; x < COLS; x++) grid[idx(x, 0)] = null;
      cleared++;
      y++;                             // re-test the row that just moved down
    }
    if (!cleared) return;
    // Multi-line clears are worth disproportionately more, which is what makes
    // stacking for a four-line clear worth the risk.
    score += [0, 100, 300, 500, 800][cleared] * level;
    lines += cleared;
    const nl = Math.floor(lines / 10) + 1;
    if (nl > level) { level = nl; say(`Level ${level} — faster now.`); }
    if (cleared === 4) say("Four lines at once! +" + 800 * level);
  }

  // ── drawing ──────────────────────────────────────────────────────────────
  function cellRect(x, y, color) {
    const px = x * CELL, py = y * CELL;
    ctx.fillStyle = color;
    ctx.fillRect(px, py, CELL, CELL);
    ctx.fillStyle = "rgba(255,255,255,.45)";
    ctx.fillRect(px, py, CELL, 2); ctx.fillRect(px, py, 2, CELL);
    ctx.fillStyle = "rgba(0,0,0,.35)";
    ctx.fillRect(px, py + CELL - 2, CELL, 2); ctx.fillRect(px + CELL - 2, py, 2, CELL);
  }

  function draw() {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, cv.width, cv.height);
    // Faint grid so the playfield reads as a grid even when nearly empty.
    ctx.strokeStyle = "rgba(255,255,255,.06)";
    ctx.lineWidth = 1;
    for (let x = 1; x < COLS; x++) {
      ctx.beginPath(); ctx.moveTo(x * CELL, 0); ctx.lineTo(x * CELL, cv.height); ctx.stroke();
    }
    for (let y = 1; y < ROWS; y++) {
      ctx.beginPath(); ctx.moveTo(0, y * CELL); ctx.lineTo(cv.width, y * CELL); ctx.stroke();
    }

    for (let y = 0; y < ROWS; y++)
      for (let x = 0; x < COLS; x++)
        if (grid[idx(x, y)]) cellRect(x, y, grid[idx(x, y)]);

    if (piece && !over) {
      // Ghost: where the piece would land if dropped now.
      let gy = 0;
      while (!collides(piece, 0, gy + 1)) gy++;
      ctx.fillStyle = "rgba(255,255,255,.14)";
      for (const [cx, cy] of piece.cells) {
        const x = piece.x + cx, y = piece.y + cy + gy;
        if (y >= 0) ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
      }
      for (const [cx, cy] of piece.cells) {
        const x = piece.x + cx, y = piece.y + cy;
        if (y >= 0) cellRect(x, y, piece.color);
      }
    }

    if (paused) {
      ctx.fillStyle = "rgba(0,0,0,.7)";
      ctx.fillRect(0, cv.height / 2 - 22, cv.width, 44);
      ctx.fillStyle = "#fff";
      ctx.font = '600 18px "Segoe UI", Tahoma, sans-serif';
      ctx.textAlign = "center";
      ctx.fillText("Paused", cv.width / 2, cv.height / 2 + 6);
      ctx.textAlign = "left";
    }
  }

  function drawNext() {
    nctx.fillStyle = "#000";
    nctx.fillRect(0, 0, nextCv.width, nextCv.height);
    if (!nextPiece) return;
    const c = 13;
    const xs = nextPiece.cells.map((p) => p[0]), ys = nextPiece.cells.map((p) => p[1]);
    const ox = (nextCv.width - (Math.max(...xs) - Math.min(...xs) + 1) * c) / 2 - Math.min(...xs) * c;
    const oy = (nextCv.height - (Math.max(...ys) - Math.min(...ys) + 1) * c) / 2 - Math.min(...ys) * c;
    for (const [cx, cy] of nextPiece.cells) {
      const px = ox + cx * c, py = oy + cy * c;
      nctx.fillStyle = nextPiece.color;
      nctx.fillRect(px, py, c, c);
      nctx.fillStyle = "rgba(255,255,255,.45)";
      nctx.fillRect(px, py, c, 2); nctx.fillRect(px, py, 2, c);
      nctx.fillStyle = "rgba(0,0,0,.35)";
      nctx.fillRect(px, py + c - 2, c, 2); nctx.fillRect(px + c - 2, py, 2, c);
    }
  }

  function loop(t) {
    const dt = t - lastT;
    lastT = t;
    if (!over && !paused) {
      dropAcc += dt;
      const interval = Math.max(80, 800 - (level - 1) * 65);
      if (dropAcc >= interval) {
        dropAcc = 0;
        if (!step(0, 1)) lock();
      }
    }
    draw();
    raf = requestAnimationFrame(loop);
  }

  // ── input ────────────────────────────────────────────────────────────────
  window.addEventListener("keydown", (e) => {
    if (e.code === "KeyP") { togglePause(); e.preventDefault(); return; }
    if (over || paused) return;
    switch (e.code) {
      case "ArrowLeft":  step(-1, 0); break;
      case "ArrowRight": step(1, 0); break;
      case "ArrowDown":  if (step(0, 1)) score += 1; break;
      case "ArrowUp": case "KeyX": rotate(); break;
      case "Space": hardDrop(); break;
      default: return;
    }
    hud();
    e.preventDefault();
  });

  function togglePause() {
    if (over) return;
    paused = !paused;
    el("pause").textContent = paused ? "Resume" : "Pause";
    say(paused ? "Paused." : "");
  }

  for (const b of document.querySelectorAll("[data-act]")) {
    b.addEventListener("click", () => {
      if (over || paused) return;
      const a = b.dataset.act;
      if (a === "left") step(-1, 0);
      else if (a === "right") step(1, 0);
      else if (a === "rot") rotate();
      else if (a === "drop") hardDrop();
      hud();
    });
  }
  el("pause").addEventListener("click", togglePause);
  el("newgame").addEventListener("click", newGame);

  // Fit the well to short screens without changing the 10x20 playfield.
  function fit() {
    const maxH = Math.min(window.innerHeight - 190, 480);
    CELL = Math.max(14, Math.min(24, Math.floor(maxH / ROWS)));
    cv.width = COLS * CELL;
    cv.height = ROWS * CELL;
  }
  window.addEventListener("resize", fit);

  fit();
  if (save?.restored) {
    lastT = performance.now();
    el("pause").textContent = "Resume";
    hud(); drawNext();
    say("Resumed your game — press P to play.");
    loop(lastT);
  } else {
    newGame();
  }
})();
