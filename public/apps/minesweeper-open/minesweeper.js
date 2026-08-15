// Open Minesweeper — a from-scratch implementation of the classic.
//
// Written for ExeBrowser because Microsoft's winmine.exe is proprietary and
// can't be hosted. This runs natively in the browser: no emulator, no
// download, instant start, and it works the same on a phone as on a desktop.
//
// Faithful where it matters:
//   * The three standard boards — 9x9/10, 16x16/40, 30x16/99.
//   * The canonical number colours (1 blue, 2 green, 3 red, 4 navy, …).
//   * First click is always safe, and on modern Windows it also opens a
//     zero-region — mines are placed after that click, never under it.
//   * Chording: clicking a satisfied number opens its unflagged neighbours.
//   * The face: 🙂 idle, 😮 while the mouse is down, 😎 on a win, 😵 on a loss.
//   * The counters are three-digit, red-on-black, and the clock stops at 999.
(() => {
  "use strict";

  const LEVELS = {
    beginner:     { w: 9,  h: 9,  mines: 10 },
    intermediate: { w: 16, h: 16, mines: 40 },
    expert:       { w: 30, h: 16, mines: 99 },
  };

  const el = (id) => document.getElementById(id);
  const gridEl = el("grid"), faceEl = el("face"), minesEl = el("mines");
  const clockEl = el("clock"), msgEl = el("msg"), flagBtn = el("flagmode");

  let W, H, MINES;
  let cells = [];          // { mine, open, flag, n, node }
  let started = false;     // mines are laid on the first click, not before
  let over = false;
  let opened = 0;
  let flags = 0;
  let timer = null, secs = 0;
  let flagMode = false;
  let level = "beginner";

  const idx = (x, y) => y * W + x;
  const inBounds = (x, y) => x >= 0 && x < W && y >= 0 && y < H;
  function* neighbours(x, y) {
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++)
        if ((dx || dy) && inBounds(x + dx, y + dy)) yield [x + dx, y + dy];
  }

  const pad3 = (n) => String(Math.max(-99, Math.min(999, n))).padStart(3, "0");

  function setFace(f) { faceEl.textContent = f; }
  function say(m) { msgEl.textContent = m || ""; }

  // ── board ────────────────────────────────────────────────────────────────

  function newGame(which) {
    if (which) level = which;
    const cfg = LEVELS[level];
    W = cfg.w; H = cfg.h; MINES = cfg.mines;
    cells = [];
    started = over = false;
    opened = flags = secs = 0;
    if (timer) { clearInterval(timer); timer = null; }
    clockEl.textContent = pad3(0);
    minesEl.textContent = pad3(MINES);
    setFace("🙂");
    say("");
    fitCells();
    save?.clear();

    buildGrid();
    for (let i = 0; i < W * H; i++) {
      cells.push({ mine: false, open: false, flag: false, n: 0, node: gridEl.children[i] });
    }
  }

  // The buttons only, in reading order — the cell records are attached by
  // whoever calls this, because a resumed board brings its own.
  function buildGrid() {
    gridEl.innerHTML = "";
    gridEl.style.gridTemplateColumns = `repeat(${W}, var(--cell))`;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "cell";
        b.dataset.x = x; b.dataset.y = y;
        gridEl.appendChild(b);
      }
    }
  }

  // ── resume ───────────────────────────────────────────────────────────────
  //
  // Each cell carries the button that draws it, which is neither serialisable
  // nor worth storing — the grid is rebuilt from W/H on the way back in and the
  // nodes reattached. The clock is stored as the seconds already elapsed, so it
  // doesn't run on while the tab is closed.

  const save = window.GameSave?.attach({
    key: "minesweeper",
    slug: "minesweeper-open",
    name: "Minesweeper",
    version: 1,
    serialize: () => {
      // A board that's over, or that hasn't been clicked yet, has nothing worth
      // coming back to — the untouched one has no mines laid.
      if (over || !started) return null;
      return {
        lv: level,
        c: cells.map((c) => (c.mine ? 1 : 0) | (c.open ? 2 : 0) | (c.flag ? 4 : 0) | (c.n << 3)),
        o: opened, f: flags, s: secs,
      };
    },
    restore: (s) => {
      const cfg = s && LEVELS[s.lv];
      if (!cfg || !Array.isArray(s.c) || s.c.length !== cfg.w * cfg.h) return false;
      level = s.lv;
      W = cfg.w; H = cfg.h; MINES = cfg.mines;
      started = true;
      over = false;
      opened = s.o; flags = s.f; secs = s.s;
      fitCells();
      buildGrid();
      cells = s.c.map((v, i) => ({
        mine: !!(v & 1), open: !!(v & 2), flag: !!(v & 4), n: v >> 3,
        node: gridEl.children[i],
      }));
      return true;
    },
  });

  // Mines are placed after the first click so that click can never lose, and
  // its whole zero-region is guaranteed open — the modern Windows behaviour,
  // which is far less annoying than the original's "first click can be a 5".
  function layMines(safeX, safeY) {
    const banned = new Set([idx(safeX, safeY)]);
    for (const [nx, ny] of neighbours(safeX, safeY)) banned.add(idx(nx, ny));
    const spots = [];
    for (let i = 0; i < W * H; i++) if (!banned.has(i)) spots.push(i);
    // Fisher-Yates, then take the first MINES.
    for (let i = spots.length - 1; i > 0; i--) {
      const j = randBelow(i + 1);
      [spots[i], spots[j]] = [spots[j], spots[i]];
    }
    for (let i = 0; i < Math.min(MINES, spots.length); i++) cells[spots[i]].mine = true;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let n = 0;
        for (const [nx, ny] of neighbours(x, y)) if (cells[idx(nx, ny)].mine) n++;
        cells[idx(x, y)].n = n;
      }
    }
  }

  function randBelow(n) {
    if (window.crypto && window.crypto.getRandomValues) {
      const limit = Math.floor(0x100000000 / n) * n;
      const buf = new Uint32Array(1);
      let v;
      do { window.crypto.getRandomValues(buf); v = buf[0]; } while (v >= limit);
      return v % n;
    }
    return Math.floor(Math.random() * n);
  }

  function startClock() {
    if (timer) return;
    timer = setInterval(() => {
      if (over) return;
      secs = Math.min(999, secs + 1);
      clockEl.textContent = pad3(secs);
    }, 1000);
  }

  // ── revealing ────────────────────────────────────────────────────────────

  function open(x, y) {
    const c = cells[idx(x, y)];
    if (!c || c.open || c.flag || over) return;

    if (!started) { started = true; layMines(x, y); startClock(); }

    if (c.mine) { lose(c); return; }

    // Flood-fill zero regions iteratively — a recursive version blows the
    // stack on a 30x16 board with a large opening.
    const stack = [[x, y]];
    while (stack.length) {
      const [cx, cy] = stack.pop();
      const cc = cells[idx(cx, cy)];
      if (cc.open || cc.flag) continue;
      cc.open = true; opened++;
      paint(cx, cy);
      if (cc.n === 0) for (const [nx, ny] of neighbours(cx, cy)) {
        const nc = cells[idx(nx, ny)];
        if (!nc.open && !nc.flag && !nc.mine) stack.push([nx, ny]);
      }
    }
    save?.mark();
    checkWin();
  }

  function paint(x, y) {
    const c = cells[idx(x, y)];
    const b = c.node;
    if (c.open) {
      b.classList.add("open");
      b.textContent = c.n ? String(c.n) : "";
      if (c.n) b.classList.add("n" + c.n);
    } else {
      b.textContent = c.flag ? "🚩" : "";
    }
  }

  // Chording: click a satisfied number to open everything unflagged around it.
  // This is how the game is actually played at speed, and it's the feature
  // people miss most in clones that leave it out.
  function chord(x, y) {
    const c = cells[idx(x, y)];
    if (!c.open || !c.n || over) return;
    let f = 0;
    for (const [nx, ny] of neighbours(x, y)) if (cells[idx(nx, ny)].flag) f++;
    if (f !== c.n) return;
    for (const [nx, ny] of neighbours(x, y)) {
      const nc = cells[idx(nx, ny)];
      if (!nc.flag && !nc.open) open(nx, ny);
      if (over) return;
    }
  }

  function toggleFlag(x, y) {
    const c = cells[idx(x, y)];
    if (!c || c.open || over) return;
    c.flag = !c.flag;
    flags += c.flag ? 1 : -1;
    minesEl.textContent = pad3(MINES - flags);
    paint(x, y);
    save?.mark();
    checkWin();
  }

  function lose(hit) {
    over = true;
    if (timer) { clearInterval(timer); timer = null; }
    setFace("😵");
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      if (c.mine && !c.flag) { c.open = true; c.node.classList.add("open"); c.node.textContent = "💣"; }
      // A flag on a safe square is the mistake worth showing.
      if (!c.mine && c.flag) { c.node.classList.add("wrong"); c.node.textContent = "❌"; }
    }
    if (hit) hit.node.classList.add("mine");
    say("Boom. Click the face to try again.");
  }

  function checkWin() {
    if (over) return;
    // Won when every non-mine square is open. Flags don't have to be correct,
    // which matches the original — you can win with none placed at all.
    if (opened === W * H - MINES) {
      over = true;
      if (timer) { clearInterval(timer); timer = null; }
      setFace("😎");
      // Auto-flag whatever is left, the way Windows does on a win.
      for (const c of cells) if (c.mine && !c.flag) { c.flag = true; c.node.textContent = "🚩"; }
      minesEl.textContent = pad3(0);
      say(`Cleared in ${secs}s.`);
    }
  }

  // ── layout ───────────────────────────────────────────────────────────────

  // Expert is 30 cells wide, which won't fit a phone at the desktop cell size.
  // Shrink the cell rather than letting the board scroll off the screen.
  function fitCells() {
    const avail = Math.min(window.innerWidth - 28, 900);
    const cfg = LEVELS[level];
    const size = Math.max(16, Math.min(24, Math.floor(avail / cfg.w)));
    document.documentElement.style.setProperty("--cell", size + "px");
  }

  // ── input ────────────────────────────────────────────────────────────────

  const coordsOf = (node) =>
    node && node.classList.contains("cell")
      ? [ +node.dataset.x, +node.dataset.y ]
      : null;

  gridEl.addEventListener("mousedown", (e) => {
    if (over) return;
    if (e.button === 0 && !flagMode) setFace("😮");
  });
  document.addEventListener("mouseup", () => { if (!over) setFace("🙂"); });

  gridEl.addEventListener("click", (e) => {
    const p = coordsOf(e.target);
    if (!p) return;
    const [x, y] = p;
    const c = cells[idx(x, y)];
    if (flagMode && !c.open) { toggleFlag(x, y); return; }
    if (c.open) chord(x, y);
    else open(x, y);
    if (!over) setFace("🙂");
  });

  gridEl.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    const p = coordsOf(e.target);
    if (!p) return;
    const c = cells[idx(p[0], p[1])];
    if (c.open) chord(p[0], p[1]);
    else toggleFlag(p[0], p[1]);
  });

  // Long-press flags on touch, so the game is playable without the mode
  // button — but Flag mode stays for people who prefer an explicit toggle.
  let touchTimer = null, touchCell = null;
  gridEl.addEventListener("touchstart", (e) => {
    const p = coordsOf(e.target);
    if (!p) return;
    touchCell = p;
    touchTimer = setTimeout(() => {
      touchTimer = null;
      if (touchCell) { toggleFlag(touchCell[0], touchCell[1]); touchCell = null; }
    }, 350);
  }, { passive: true });
  const cancelTouch = () => { if (touchTimer) { clearTimeout(touchTimer); touchTimer = null; } touchCell = null; };
  gridEl.addEventListener("touchend", cancelTouch);
  gridEl.addEventListener("touchmove", cancelTouch);

  faceEl.addEventListener("click", () => newGame());
  flagBtn.addEventListener("click", () => {
    flagMode = !flagMode;
    flagBtn.classList.toggle("on", flagMode);
    flagBtn.setAttribute("aria-pressed", flagMode ? "true" : "false");
  });
  for (const b of document.querySelectorAll("[data-level]")) {
    b.addEventListener("click", () => {
      for (const o of document.querySelectorAll("[data-level]")) o.classList.remove("on");
      b.classList.add("on");
      newGame(b.dataset.level);
    });
  }
  window.addEventListener("resize", () => { fitCells(); });

  if (save?.restored) {
    // Mid-game from a previous visit: the grid is built but blank, so paint
    // every square from the state it came back with and restart the clock.
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) paint(x, y);
    minesEl.textContent = pad3(MINES - flags);
    clockEl.textContent = pad3(secs);
    setFace("🙂");
    startClock();
    say("Resumed your game");
  } else {
    newGame("beginner");
  }
  document.querySelector(`[data-level="${level}"]`).classList.add("on");
})();
