// Parkhaven - pointer, touch and keyboard input: pan, zoom, rotate, tool clicks and drags.
export class Input {
  constructor(app, el) {
    this.app = app; this.el = el;
    this.pointers = new Map();
    this.mode = null; // 'pan' | 'tool' | 'pinch'
    this.keys = new Set();
    this.mouse = null;
    el.addEventListener('pointerdown', (e) => this.down(e));
    el.addEventListener('pointermove', (e) => this.move(e));
    el.addEventListener('pointerup', (e) => this.up(e));
    el.addEventListener('pointercancel', (e) => this.up(e, true));
    el.addEventListener('pointerleave', () => { this.mouse = null; });
    el.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => this.key(e, true));
    window.addEventListener('keyup', (e) => this.key(e, false));
    window.addEventListener('blur', () => this.keys.clear());
  }
  get ui() { return this.app.ui; }
  get cam() { return this.app.renderer.cam; }

  pos(e) { const r = this.el.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }

  down(e) {
    this.app.audio.unlock();
    this.el.setPointerCapture(e.pointerId);
    const [x, y] = this.pos(e);
    this.pointers.set(e.pointerId, { x, y, sx: x, sy: y, type: e.pointerType, button: e.button });
    if (this.pointers.size === 2) {
      this.mode = 'pinch';
      this.ui.drag = null;
      const [a, b] = [...this.pointers.values()];
      this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), zoom: this.cam.zoom, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
      return;
    }
    if (this.pointers.size > 2) return;
    this.moved = false;
    this.mode = null;
    if (e.pointerType === 'mouse' && (e.button === 1 || e.button === 2)) this.mode = 'pan';
    else if (e.pointerType === 'mouse' && e.button === 0 && this.ui.tool !== 'inspect') {
      if (this.ui.dragBegin(x, y)) this.mode = 'tool';
    }
  }

  move(e) {
    const [x, y] = this.pos(e);
    if (e.pointerType === 'mouse') this.mouse = [x, y];
    const p = this.pointers.get(e.pointerId);
    if (!p) { if (e.pointerType === 'mouse') this.ui.hover(x, y); return; }
    const dx = x - p.x, dy = y - p.y;
    p.x = x; p.y = y;
    if (this.mode === 'pinch' && this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      this.panBy(mx - this.pinch.mx, my - this.pinch.my);
      this.pinch.mx = mx; this.pinch.my = my;
      this.setZoom(this.pinch.zoom * (d / Math.max(10, this.pinch.d)), mx, my);
      return;
    }
    if (!this.moved && Math.hypot(x - p.sx, y - p.sy) > (p.type === 'mouse' ? 4 : 10)) {
      this.moved = true;
      if (!this.mode) this.mode = 'pan';
    }
    if (this.mode === 'pan' && this.moved) this.panBy(dx, dy);
    else if (this.mode === 'tool') { this.ui.dragMove(x, y); this.ui.hover(x, y); }
    else if (e.pointerType === 'mouse') this.ui.hover(x, y);
  }

  up(e, cancel = false) {
    const p = this.pointers.get(e.pointerId);
    this.pointers.delete(e.pointerId);
    if (!p) return;
    if (this.mode === 'pinch') { if (this.pointers.size === 0) this.mode = null; return; }
    if (cancel) { this.ui.drag = null; this.mode = null; return; }
    const [x, y] = this.pos(e);
    if (this.mode === 'tool') {
      if (this.moved) this.ui.dragEnd();
      else { this.ui.drag = null; this.ui.click(x, y); }
    } else if (!this.moved && (p.type !== 'mouse' || p.button === 0)) {
      if (p.type !== 'mouse') this.ui.hover(x, y);
      this.ui.click(x, y);
    }
    this.mode = null;
  }

  wheel(e) {
    e.preventDefault();
    const [x, y] = this.pos(e);
    const f = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015));
    this.setZoom(this.cam.zoom * f, x, y);
  }

  /** zoom keeping the world point under (sx,sy) fixed */
  setZoom(z, sx, sy) {
    const R = this.app.renderer;
    z = Math.max(10, Math.min(140, z));
    const before = R.pick(sx, sy);
    this.cam.zoom = z;
    R.updateCamera();
    const after = R.pick(sx, sy);
    if (before && after) { this.cam.x += before.x - after.x; this.cam.y += before.y - after.y; }
    this.clampCam();
  }

  panBy(dx, dy) {
    const R = this.app.renderer;
    const z = this.cam.zoom;
    // screen right/up vectors projected to the ground plane
    const r = R.right, u = R.up;
    if (!r) return;
    const ux = u[0], uy = u[1];
    const ul = Math.hypot(ux, uy) || 1;
    const k = 1 / (ul * ul);
    this.cam.x -= (r[0] * dx) / z - (ux * k * dy) / z;
    this.cam.y -= (r[1] * dx) / z - (uy * k * dy) / z;
    this.clampCam();
    this.app.ui.follow = null;
  }
  clampCam() {
    const N = this.app.game.w.N;
    this.cam.x = Math.max(0, Math.min(N, this.cam.x));
    this.cam.y = Math.max(0, Math.min(N, this.cam.y));
  }

  key(e, down) {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA')) return;
    const k = e.key.toLowerCase();
    if (down) this.keys.add(k); else { this.keys.delete(k); return; }
    const ui = this.ui;
    if (k === ' ') { e.preventDefault(); this.app.setSpeed(this.app.speed ? 0 : this.app.lastSpeed || 1); }
    else if (k >= '1' && k <= '4') this.app.setSpeed([1, 2, 4, 8][+k - 1]);
    else if (k === 'q') ui.rotate(-1);
    else if (k === 'e') ui.rotate(1);
    else if (k === 'r') { ui.rot = (ui.rot + 1) & 3; ui.refreshGhost(); }
    else if (k === 'escape') ui.setTool('inspect');
    else if (k === '+' || k === '=') this.setZoom(this.cam.zoom * 1.2, this.app.renderer.W / 2, this.app.renderer.H / 2);
    else if (k === '-') this.setZoom(this.cam.zoom / 1.2, this.app.renderer.W / 2, this.app.renderer.H / 2);
    else if (k === 'backspace' && ui.builder) { e.preventDefault(); ui.removePiece(); }
    else if (k === 'enter' && ui.builder) ui.placeNextPiece();
  }

  /** continuous: keyboard and edge panning */
  frame(dt) {
    let dx = 0, dy = 0;
    const s = 600 * dt;
    if (this.keys.has('arrowleft') || this.keys.has('a')) dx += s;
    if (this.keys.has('arrowright') || this.keys.has('d')) dx -= s;
    if (this.keys.has('arrowup') || this.keys.has('w')) dy += s;
    if (this.keys.has('arrowdown') || this.keys.has('s')) dy -= s;
    if (this.app.edgePan && this.mouse && this.pointers.size === 0) {
      const [x, y] = this.mouse, W = this.app.renderer.W, H = this.app.renderer.H, m = 10;
      if (x < m) dx += s; if (x > W - m) dx -= s; if (y < m) dy += s; if (y > H - m) dy -= s;
    }
    if (dx || dy) this.panBy(dx, dy);
  }
}
