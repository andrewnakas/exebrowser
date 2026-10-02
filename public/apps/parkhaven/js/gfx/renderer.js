// Parkhaven - the WebGL renderer: orthographic 3D camera at an isometric-style angle, a static
// world mesh rebuilt on change, and per-frame vehicles, ride motion, people and effects.
import { GL, MB, ident, mul, ortho, lookAt, basis, trs, shade } from './gl.js';
import * as M from './models.js';
import { FLAT_RIDES, TRACK_RIDES, SHIRT_COLORS, PANTS_COLORS, STAFF } from '../data.js';
import { vehiclePoses, towerHu } from '../rides.js';

const DEG = Math.PI / 180;

export class Renderer {
  constructor(canvas, overlay) {
    this.canvas = canvas;
    this.overlay = overlay;
    this.ctx = overlay.getContext('2d');
    this.g = new GL(canvas);
    const gl = this.g.gl;
    this.gl = gl;
    this.cam = { x: 32, y: 40, zoom: 34, rot: 0, azim: 45, tAzim: 45 };
    this.world = this.g.mesh();
    this.water = this.g.mesh();
    this.people = this.g.mesh(M.personMesh()).enableInstancing();
    this.litterM = this.g.mesh(M.litterMesh()).enableInstancing();
    this.inst = new Float32Array(14 * 4096);
    this.litterInst = new Float32Array(14 * 2048);
    this.carMeshes = {};
    this.headMeshes = {};
    this.flatMeshes = {};
    this.ghost = null; this.ghostValid = true;
    this.overlayMesh = null;
    this.sig = '';
    this.vp = ident(); this.view = ident(); this.proj = ident();
    this.tmp = ident();
    this.anim = new Map();
    this.floaters = [];
    this.rain = [];
    this.flash = 0;
    this.time = 0;
    this.dpr = 1;
    this.light = [1, 1, 1];
    this.sun = norm([0.45, 0.75, 0.85]);
  }

  setGame(game) { this.game = game; this.sig = ''; this.anim.clear(); this.floaters = []; }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.dpr = dpr;
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    for (const c of [this.canvas, this.overlay]) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    this.W = w; this.H = h;
  }

  // ---------------------------------------------------------------- camera
  updateCamera() {
    const c = this.cam;
    const target = 45 + c.rot * 90;
    let diff = ((target - c.azim + 540) % 360) - 180;
    c.azim += diff * 0.25;
    if (Math.abs(diff) < 0.05) c.azim = target;
    const az = c.azim * DEG, el = 30 * DEG;
    const d = [Math.cos(el) * Math.cos(az), Math.cos(el) * Math.sin(az), Math.sin(el)];
    const w = this.game.w;
    const tz = w.heightAt(c.x, c.y) / 4;
    // The world is x-east / y-south / z-up, which is left-handed. Build the view in a mirrored
    // (y-north) space and fold the mirror into the matrix so the picture is not reflected.
    const eye = [c.x + d[0] * 80, -(c.y + d[1] * 80), tz + d[2] * 80];
    lookAt(eye, [c.x, -c.y, tz], [0, 0, 1], this.view);
    for (let k = 4; k < 8; k++) this.view[k] = -this.view[k];
    const hw = this.W / 2 / c.zoom, hh = this.H / 2 / c.zoom;
    ortho(-hw, hw, -hh, hh, 1, 200, this.proj);
    mul(this.proj, this.view, this.vp);
    this.eyeDir = d;
    this.camTarget = [c.x, c.y, tz];
    const v = this.view;
    this.right = [v[0], v[4], v[8]];
    this.up = [v[1], v[5], v[9]];
  }

  /** world (tiles, z in tiles) -> CSS pixels */
  project(x, y, z) {
    const m = this.vp;
    const X = m[0] * x + m[4] * y + m[8] * z + m[12];
    const Y = m[1] * x + m[5] * y + m[9] * z + m[13];
    return [(X * 0.5 + 0.5) * this.W, (0.5 - Y * 0.5) * this.H];
  }

  /** CSS pixel -> ground point {x, y, z(hu)} or null */
  pick(sx, sy) {
    if (!this.right) return null;
    const c = this.cam;
    const ox = (sx - this.W / 2) / c.zoom, oy = (this.H / 2 - sy) / c.zoom;
    const t0 = this.camTarget, r = this.right, u = this.up, d = this.eyeDir;
    const P = [t0[0] + r[0] * ox + u[0] * oy, t0[1] + r[1] * ox + u[1] * oy, t0[2] + r[2] * ox + u[2] * oy];
    const w = this.game.w;
    const N = w.N;
    const at = (t) => [P[0] + d[0] * t, P[1] + d[1] * t, P[2] + d[2] * t];
    const above = (t) => { const q = at(t); if (q[0] < 0 || q[1] < 0 || q[0] >= N || q[1] >= N) return true; return q[2] > w.heightAt(q[0], q[1]) / 4; };
    let prev = 40;
    if (!above(prev)) return null;
    for (let t = 40; t > -60; t -= 0.08) {
      if (!above(t)) {
        let a = t, b = prev;
        for (let k = 0; k < 14; k++) { const m = (a + b) / 2; if (above(m)) b = m; else a = m; }
        const q = at(a);
        if (q[0] < 0 || q[1] < 0 || q[0] >= N || q[1] >= N) return null;
        return { x: q[0], y: q[1], z: q[2] * 4, tx: Math.floor(q[0]), ty: Math.floor(q[1]) };
      }
      prev = t;
    }
    return null;
  }

  // ---------------------------------------------------------------- static world
  signature() {
    const g = this.game;
    let s = g.w.version + '|' + g.parkOpen + '|' + (this.overlayMode || '') + (this.overlayMode === 'litter' ? g.litter.length : '');
    for (const r of g.rides) s += `|${r.id}:${r.status}:${r.track ? r.track.pieces.length : 0}:${r.entrance ? 1 : 0}${r.exit ? 1 : 0}:${r.broken ? 1 : 0}`;
    return s;
  }

  rebuildStatic() {
    const g = this.game, w = g.w;
    const mb = new MB(1 << 18);
    M.buildTerrain(mb, w);
    M.buildPaths(mb, w, g);
    M.buildScenery(mb, w);
    M.buildGate(mb, w, g.parkOpen);
    for (const r of g.rides) {
      const col = r.kind === 'stall' ? null : (r.status === 'open' ? (r.broken ? [0.95, 0.6, 0.2] : null) : [0.6, 0.6, 0.62]);
      if (r.kind === 'stall') M.stallModel(mb, r);
      else if (r.kind === 'flat') M.flatStatic(mb, r, w);
      else for (const pc of r.track.pieces) M.trackPieceModel(mb, r.type, pc, r.color || TRACK_RIDES[r.type].color, w);
      if (r.entrance) M.entranceModel(mb, r.entrance, false, col);
      if (r.exit) M.entranceModel(mb, r.exit, true, col);
    }
    this.world.set(mb.data());
    const wb = new MB(4096);
    M.buildWater(wb, w);
    this.water.set(wb.data());
    this.buildOverlay();
  }

  setOverlay(mode) { if (this.overlayMode !== mode) { this.overlayMode = mode; this.sig = ''; } }

  buildOverlay() {
    const w = this.game.w;
    if (!this.overlayMode) { this.overlayMesh = null; return; }
    const mb = new MB(8192);
    for (let y = 1; y < w.N - 1; y++) for (let x = 1; x < w.N - 1; x++) {
      const i = w.idx(x, y);
      let col = null;
      if (this.overlayMode === 'land') {
        if (w.own[i] === 1) col = [0.3, 0.8, 0.4];
        else if (w.own[i] === 2) col = [0.4, 0.6, 0.95];
        else if (w.sale[i] & 1) col = [0.98, 0.85, 0.3];
        else if (w.sale[i] & 2) col = [0.5, 0.75, 1.0];
      } else if (this.overlayMode === 'litter') {
        const n = this.game.litterN[i] + this.game.vomitN[i];
        if (n) col = n >= 3 ? [0.9, 0.3, 0.2] : [0.95, 0.75, 0.3];
      }
      if (!col) continue;
      const c = w.corners(x, y).map((h) => h / 4 + 0.05);
      mb.quadN([x + 0.05, y + 0.05, c[0]], [x + 0.95, y + 0.05, c[1]], [x + 0.95, y + 0.95, c[2]], [x + 0.05, y + 0.95, c[3]], [0, 0, 1], col);
    }
    if (!this.overlayMesh) this.overlayMesh = this.g.mesh();
    this.overlayMesh.set(mb.data());
  }

  /** ghost: mesh data built by the UI; valid tints it green/red */
  setGhost(data, valid) {
    if (!data) { this.ghost = null; return; }
    if (!this.ghostMesh) this.ghostMesh = this.g.mesh();
    this.ghostMesh.set(data);
    this.ghost = this.ghostMesh; this.ghostValid = valid;
  }

  // ---------------------------------------------------------------- frame
  draw(dt, ui) {
    const g = this.game;
    if (!g) return;
    this.time += dt;
    this.updateCamera();
    const sig = this.signature();
    if (sig !== this.sig) { this.sig = sig; this.rebuildStatic(); }
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    const gloom = g.weather.cur.gloom;
    const L = 1 - gloom * 0.13;
    this.light = [L, L, L * (1 + gloom * 0.02)];
    const sky = [0.62 - gloom * 0.1, 0.8 - gloom * 0.12, 0.92 - gloom * 0.1];
    gl.clearColor(sky[0], sky[1], sky[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const P = this.g.main;
    gl.useProgram(P.p);
    gl.uniformMatrix4fv(P.u.uVP, false, this.vp);
    gl.uniform3fv(P.u.uSun, this.sun);
    gl.uniform3fv(P.u.uLight, this.light);
    gl.uniform4f(P.u.uTint, 0, 0, 0, 0);
    gl.uniform1f(P.u.uAlpha, 1);
    this.drawMesh(this.world, ident(this.tmp));
    this.drawRides(dt);
    this.drawPeople(dt, ui);
    // highlights
    if (ui && ui.highlight) this.drawHighlight(ui.highlight);
    // transparent: water, overlay, ghost
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(P.p);
    gl.depthMask(false);
    gl.uniform1f(P.u.uAlpha, 0.78);
    this.drawMesh(this.water, ident(this.tmp));
    if (this.overlayMesh) { gl.uniform1f(P.u.uAlpha, 0.45); this.drawMesh(this.overlayMesh, ident(this.tmp)); }
    gl.depthMask(true);
    if (this.ghost) {
      gl.uniform1f(P.u.uAlpha, 0.62);
      gl.uniform4f(P.u.uTint, this.ghostValid ? 0.45 : 0.95, this.ghostValid ? 0.9 : 0.3, this.ghostValid ? 0.55 : 0.3, 0.45);
      this.drawMesh(this.ghost, ident(this.tmp));
      gl.uniform4f(P.u.uTint, 0, 0, 0, 0);
    }
    gl.uniform1f(P.u.uAlpha, 1);
    gl.disable(gl.BLEND);
    this.drawOverlay2D(dt);
  }

  drawMesh(mesh, m) {
    if (!mesh || !mesh.count) return;
    const gl = this.gl;
    gl.uniformMatrix4fv(this.g.main.u.uM, false, m);
    gl.bindVertexArray(mesh.vao);
    gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
  }

  meshFor(cache, key, build) {
    let m = cache[key];
    if (!m) { m = this.g.mesh(build()); cache[key] = m; }
    return m;
  }

  // ---------------------------------------------------------------- rides
  rideAnim(r, dt) {
    let a = this.anim.get(r.id);
    if (!a) { a = { ang: 0, spin: 0, sw: 0, h: 0, cup: 0 }; this.anim.set(r.id, a); }
    const running = r.phase === 'running' && !r.broken;
    const g = this.game;
    const speedMul = Math.min(8, g.speed || 1);
    const k = dt * speedMul;
    if (r.type === 'carousel' || r.type === 'cups') {
      const target = running ? (r.type === 'carousel' ? 2.1 : 1.3) * (r.controlFailed ? 2 : 1) : 0;
      a.spin += (target - a.spin) * Math.min(1, k * 1.5);
      a.ang += a.spin * k;
      a.cup += a.spin * k * 2.4;
    } else if (r.type === 'ship') {
      if (running) {
        const T = r.runTicks || 1, t = r.phaseT / T;
        const env = Math.min(1, t * 4, (1 - t) * 4);
        a.sw = Math.sin((r.phaseT / 120) * Math.PI * 2) * env * 1.45;
      } else a.sw *= Math.max(0, 1 - k * 3);
    } else if (r.type === 'droptower' || r.type === 'obstower') {
      const H = towerHu(r) / 4;
      let h = 0;
      if (running) {
        const t = r.phaseT;
        if (r.type === 'droptower') {
          const up = towerHu(r) * 4;
          if (t < up) h = (t / up) * H;
          else if (t < up + 80) h = H;
          else { const f = (t - up - 80) / Math.max(1, Math.ceil(towerHu(r) * 1.2)); h = H * Math.max(0, 1 - f * f); }
        } else {
          const up = towerHu(r) * 8;
          if (t < up) h = (t / up) * H; else if (t < up + 320) h = H; else h = H * Math.max(0, 1 - (t - up - 320) / up);
          a.ang += k * (t >= up && t < up + 320 ? 0.8 : 0.1);
        }
      }
      a.h = h;
    }
    return a;
  }

  drawRides(dt) {
    const g = this.game;
    this.riderSeats = [];
    for (const r of g.rides) {
      if (r.kind === 'flat') this.drawFlat(r, dt);
      else if (r.kind === 'track') this.drawVehicles(r);
    }
  }

  drawFlat(r, dt) {
    const a = this.rideAnim(r, dt);
    const def = FLAT_RIDES[r.type];
    const { cx, cy, W, L } = M.flatRideCentre(r);
    const z = r.z / 4;
    const m = this.tmp;
    const seats = this.riderSeats;
    const nR = r.riders.length;
    if (r.type === 'carousel') {
      const top = this.meshFor(this.flatMeshes, 'carousel', () => carouselTop(def.color));
      trs(cx, cy, z + 0.14, a.ang, 1, m);
      this.drawMesh(top, m);
      const horses = this.meshFor(this.flatMeshes, 'horsesA', () => carouselHorses(0));
      const horses2 = this.meshFor(this.flatMeshes, 'horsesB', () => carouselHorses(1));
      const bob = Math.sin(a.ang * 3) * 0.08 * Math.min(1, a.spin);
      trs(cx, cy, z + 0.14 + bob, a.ang, 1, m); this.drawMesh(horses, m);
      trs(cx, cy, z + 0.14 - bob, a.ang, 1, m); this.drawMesh(horses2, m);
      for (let k = 0; k < nR; k++) {
        const ang = a.ang + (k / 16) * Math.PI * 2;
        const rr = k & 1 ? 0.75 : 1.05;
        seats.push([cx + Math.cos(ang) * rr, cy + Math.sin(ang) * rr, z + 0.45 + (k & 1 ? -bob : bob), ang + Math.PI / 2, 0.75]);
      }
    } else if (r.type === 'cups') {
      const plat = this.meshFor(this.flatMeshes, 'cupsPlat', () => cupsPlatform(def.color));
      trs(cx, cy, z + 0.14, a.ang, 1, m); this.drawMesh(plat, m);
      const cups = [[0.95, 0.45, 0.55], [0.45, 0.7, 0.95], [0.98, 0.82, 0.35], [0.55, 0.85, 0.55], [0.8, 0.55, 0.9], [0.98, 0.6, 0.35]];
      for (let k = 0; k < 6; k++) {
        const ang = a.ang + (k / 6) * Math.PI * 2;
        const px = cx + Math.cos(ang) * 0.85, py = cy + Math.sin(ang) * 0.85;
        const cup = this.meshFor(this.flatMeshes, 'cup' + k, () => cupMesh(cups[k]));
        trs(px, py, z + 0.16, a.cup * (k & 1 ? 1 : -1), 1, m); this.drawMesh(cup, m);
        for (let s = 0; s < 3; s++) if (k * 3 + s < nR) {
          const sa = a.cup * (k & 1 ? 1 : -1) + (s / 3) * Math.PI * 2;
          seats.push([px + Math.cos(sa) * 0.12, py + Math.sin(sa) * 0.12, z + 0.2, sa + Math.PI, 0.6]);
        }
      }
    } else if (r.type === 'ship') {
      const along = L > W;
      const boat = this.meshFor(this.flatMeshes, 'boat', () => shipBoat(def.color));
      const yaw = along ? Math.PI / 2 : 0;
      // swing about the long axis: roll the boat
      trs(cx, cy, z + 2.3, yaw, 1, m, 0, a.sw);
      this.drawMesh(boat, m);
      for (let k = 0; k < nR; k++) {
        const along2 = (k % 10) / 9 - 0.5;
        const side = k < 10 ? -0.18 : 0.18;
        const lx = along2 * 1.8, ly = side, lz = -1.75;
        const cr = Math.cos(a.sw), sr = Math.sin(a.sw);
        const y2 = ly * cr - lz * sr, z2 = ly * sr + lz * cr;
        const cyaw = Math.cos(yaw), syaw = Math.sin(yaw);
        seats.push([cx + lx * cyaw - y2 * syaw, cy + lx * syaw + y2 * cyaw, z + 2.3 + z2, yaw + (k < 10 ? Math.PI / 2 : -Math.PI / 2), 0.7]);
      }
    } else {
      const ring = this.meshFor(this.flatMeshes, r.type, () => (r.type === 'droptower' ? dropRing(def.color) : obsCabin(def.color)));
      trs(cx, cy, z + 0.15 + a.h, a.ang, 1, m);
      this.drawMesh(ring, m);
      const n = Math.min(nR, def.cap);
      for (let k = 0; k < n; k++) {
        const ang = a.ang + (k / def.cap) * Math.PI * 2;
        const rr = r.type === 'droptower' ? 0.5 : 0.62;
        seats.push([cx + Math.cos(ang) * rr, cy + Math.sin(ang) * rr, z + 0.2 + a.h, ang, 0.7]);
      }
    }
  }

  drawVehicles(r) {
    const poses = vehiclePoses(r);
    if (!poses.length) return;
    const col = r.color || TRACK_RIDES[r.type].color;
    const car = this.meshFor(this.carMeshes, r.type + col.join(), () => M.coasterCarMesh(r.type === 'coaster' ? shade(col, 1.05) : col, r.type));
    const heads = this.meshFor(this.headMeshes, r.type, () => M.riderHeadsMesh(r.type));
    const m = this.tmp;
    for (const p of poses) {
      const f = [p.tx, p.ty, p.tz], u = [p.ux, p.uy, p.uz];
      const s = [u[1] * f[2] - u[2] * f[1], u[2] * f[0] - u[0] * f[2], u[0] * f[1] - u[1] * f[0]];
      // s = u x f points left; models use +y as the side axis
      basis(p.x, p.y, p.z, f, s, u, 1, m);
      // lift the car slightly onto the rails
      m[12] += u[0] * 0.07; m[13] += u[1] * 0.07; m[14] += u[2] * 0.07;
      this.drawMesh(car, m);
      if (p.riders > 0) this.drawMesh(heads, m);
    }
  }

  // ---------------------------------------------------------------- people & litter
  drawPeople(dt, ui) {
    const g = this.game;
    const gl = this.gl;
    const I = this.g.inst;
    let n = 0;
    const buf = this.inst;
    const cap = buf.length / 14;
    const time = this.time;
    const push = (x, y, z, yaw, A, B, phase, scale, umb, zoff) => {
      if (n >= cap) return;
      const o = n * 14;
      buf[o] = x; buf[o + 1] = y; buf[o + 2] = z; buf[o + 3] = yaw;
      buf[o + 4] = A[0]; buf[o + 5] = A[1]; buf[o + 6] = A[2];
      buf[o + 7] = B[0]; buf[o + 8] = B[1]; buf[o + 9] = B[2];
      buf[o + 10] = phase; buf[o + 11] = scale; buf[o + 12] = umb; buf[o + 13] = zoff;
      n++;
    };
    const DIRYAW = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
    const sel = ui && ui.selectedGuest;
    for (const q of g.guests) {
      if (q.hidden || q.state === 'riding' || q.gone) continue;
      const moving = q.state === 'walking' || q.state === 'arriving' || q.state === 'exiting';
      const phase = moving ? time * 9 + q.id : 0;
      const A = SHIRT_COLORS[q.shirt], B = PANTS_COLORS[q.pants];
      const sitting = q.state === 'sitting';
      const hl = sel === q.id ? [1, 1, 0.3] : A;
      push(q.x, q.y, q.z / 4 + 0.03, DIRYAW[q.dir], hl, B, phase, 0.85, q.umbrella ? 1 : 0, sitting ? -0.08 : 0);
    }
    for (const s of g.staff) {
      const A = STAFF[s.type].color;
      const phase = s.workT > 0 ? (s.anim === 'perform' ? time * 14 : time * 4) : time * 9 + s.id;
      push(s.x, s.y, s.z / 4 + 0.03, DIRYAW[s.dir], ui && ui.selectedStaff === s.id ? [1, 1, 0.3] : A, [0.15, 0.15, 0.2], phase, s.type === 'entertainer' ? 1.05 : 0.9, 0, s.anim === 'perform' ? Math.abs(Math.sin(time * 8)) * 0.1 : 0);
    }
    for (let k = 0; k < this.riderSeats.length; k++) {
      const [x, y, z, yaw, sc] = this.riderSeats[k];
      push(x, y, z, yaw, SHIRT_COLORS[k % SHIRT_COLORS.length], PANTS_COLORS[k % PANTS_COLORS.length], 0, sc, 0, -0.1);
    }
    gl.useProgram(I.p);
    gl.uniformMatrix4fv(I.u.uVP, false, this.vp);
    gl.uniform3fv(I.u.uSun, this.sun);
    gl.uniform3fv(I.u.uLight, this.light);
    gl.uniform1f(I.u.uAlpha, 1);
    if (n) {
      this.people.setInstances(buf, n);
      gl.bindVertexArray(this.people.vao);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, this.people.count, n);
    }
    // litter
    let ln = 0;
    const lb = this.litterInst;
    const lcap = lb.length / 14;
    const w = g.w;
    const LC = [[0.85, 0.85, 0.9], [0.95, 0.75, 0.3], [0.9, 0.3, 0.3], [0.4, 0.6, 0.95], [0.62, 0.72, 0.25], [0.7, 0.62, 0.3]];
    for (const l of g.litter) {
      if (ln >= lcap) break;
      const tx = Math.floor(l.x), ty = Math.floor(l.y);
      const i = w.idx(tx, ty);
      const z = (w.ptype[i] ? w.centreZ(i) : w.groundMax(tx, ty)) / 4 + 0.035;
      const o = ln * 14;
      const vom = l.t >= 4;
      lb[o] = l.x; lb[o + 1] = l.y; lb[o + 2] = z; lb[o + 3] = (l.born % 7);
      const c = LC[l.t] || LC[0];
      // the litter mesh uses part 0 => iA colour
      lb[o + 4] = c[0]; lb[o + 5] = c[1]; lb[o + 6] = c[2];
      lb[o + 7] = 0; lb[o + 8] = 0; lb[o + 9] = 0;
      lb[o + 10] = 0; lb[o + 11] = vom ? 2.2 : 1; lb[o + 12] = 0; lb[o + 13] = vom ? -0.03 : -0.012;
      ln++;
    }
    if (ln) {
      this.litterM.setInstances(lb, ln);
      gl.bindVertexArray(this.litterM.vao);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, this.litterM.count, ln);
    }
    gl.useProgram(this.g.main.p);
  }

  drawHighlight(h) {
    // h: {x0,y0,x1,y1,color}
    const w = this.game.w;
    const mb = new MB(4096);
    const col = h.color || [1, 1, 1];
    for (let y = h.y0; y <= h.y1; y++) for (let x = h.x0; x <= h.x1; x++) {
      if (!w.inMap(x, y)) continue;
      const i = w.idx(x, y);
      const c = w.corners(x, y).map((v) => v / 4 + 0.06);
      if (w.ptype[i]) { const pz = w.pz[i] / 4 + 0.08; for (let k = 0; k < 4; k++) c[k] = Math.max(c[k], pz); }
      const P = [[x, y, c[0]], [x + 1, y, c[1]], [x + 1, y + 1, c[2]], [x, y + 1, c[3]]];
      for (let k = 0; k < 4; k++) mb.beam(P[k], P[(k + 1) & 3], 0.05, col);
    }
    if (!this.hlMesh) this.hlMesh = this.g.mesh();
    this.hlMesh.set(mb.data());
    const gl = this.gl;
    gl.uniform4f(this.g.main.u.uTint, col[0], col[1], col[2], 0.85);
    this.drawMesh(this.hlMesh, ident(this.tmp));
    gl.uniform4f(this.g.main.u.uTint, 0, 0, 0, 0);
  }

  // ---------------------------------------------------------------- 2D overlay
  addFloater(x, y, z, text, color = '#ffe27a') { this.floaters.push({ x, y, z, text, color, t: 0 }); if (this.floaters.length > 60) this.floaters.shift(); }

  drawOverlay2D(dt) {
    const ctx = this.ctx, dpr = this.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.W, this.H);
    const g = this.game;
    // rain
    const lvl = g.weather.cur.level;
    if (lvl > 0) {
      const want = lvl === 1 ? 140 : 320;
      while (this.rain.length < want) this.rain.push({ x: Math.random() * this.W, y: Math.random() * this.H, s: 500 + Math.random() * 400 });
      this.rain.length = want;
      ctx.strokeStyle = 'rgba(210,225,255,0.45)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const d of this.rain) {
        d.y += d.s * dt; d.x -= d.s * dt * 0.15;
        if (d.y > this.H) { d.y = -10; d.x = Math.random() * this.W * 1.1; }
        ctx.moveTo(d.x, d.y); ctx.lineTo(d.x + 3, d.y - 12);
      }
      ctx.stroke();
    } else this.rain.length = 0;
    if (this.flash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${Math.min(0.6, this.flash)})`;
      ctx.fillRect(0, 0, this.W, this.H);
      this.flash -= dt * 2.5;
    }
    // money floaters
    ctx.font = '600 12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    for (const f of this.floaters) {
      f.t += dt;
      const [sx, sy] = this.project(f.x, f.y, f.z / 4 + 0.7);
      const a = Math.max(0, 1 - f.t / 1.4);
      ctx.fillStyle = `rgba(30,30,30,${a * 0.5})`;
      ctx.fillText(f.text, sx + 1, sy - f.t * 26 + 1);
      ctx.fillStyle = f.color.replace(')', `,${a})`).replace('rgb', 'rgba');
      if (f.color.startsWith('#')) { ctx.globalAlpha = a; ctx.fillStyle = f.color; }
      ctx.fillText(f.text, sx, sy - f.t * 26);
      ctx.globalAlpha = 1;
    }
    this.floaters = this.floaters.filter((f) => f.t < 1.4);
    // broken ride markers
    for (const r of g.rides) {
      if (!r.broken) continue;
      let x, y, z;
      if (r.kind === 'flat') { const c = M.flatRideCentre(r); x = c.cx; y = c.cy; z = r.z / 4 + 1.6; }
      else if (r.kind === 'track' && r.track.pieces.length) { const p = r.track.pieces[0]; x = p.x + 0.5; y = p.y + 0.5; z = p.z / 4 + 1.4; }
      else continue;
      const [sx, sy] = this.project(x, y, z);
      const bob = Math.sin(this.time * 4) * 3;
      ctx.fillStyle = '#ff8a3d'; ctx.strokeStyle = '#3a2a20'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(sx, sy - 18 + bob); ctx.lineTo(sx + 11, sy + 2 + bob); ctx.lineTo(sx - 11, sy + 2 + bob); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#3a2a20'; ctx.font = '700 12px system-ui'; ctx.fillText('!', sx, sy - 1 + bob);
    }
  }
}

function norm(v) { const l = Math.hypot(...v); return v.map((x) => x / l); }

// ---------------------------------------------------------------- moving-part meshes
function carouselTop(col) {
  const mb = new MB(4096);
  mb.cyl(0, 0, 0, 1.25, 0.12, 8, [0.95, 0.85, 0.5]);
  mb.cyl(0, 0, 1.2, 1.3, 1.45, 16, shade(col, 0.9), col);
  for (let k = 0; k < 16; k++) {
    const a0 = (k / 16) * Math.PI * 2, a1 = ((k + 1) / 16) * Math.PI * 2;
    mb.tri([Math.cos(a0) * 1.45, Math.sin(a0) * 1.45, 1.3], [Math.cos(a1) * 1.45, Math.sin(a1) * 1.45, 1.3], [0, 0, 1.85], k & 1 ? [0.98, 0.95, 0.88] : col, true);
  }
  mb.blob(0, 0, 1.92, 0.1, 0.1, 0.1, [0.98, 0.8, 0.3], 6);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    mb.cyl(Math.cos(a) * 1.05, Math.sin(a) * 1.05, 0, 1.2, 0.025, 4, [0.95, 0.8, 0.35]);
    mb.cyl(Math.cos(a + Math.PI / 8) * 0.75, Math.sin(a + Math.PI / 8) * 0.75, 0, 1.2, 0.025, 4, [0.95, 0.8, 0.35]);
  }
  return mb.data().slice();
}
function carouselHorses(odd) {
  const mb = new MB(4096);
  const cols = [[0.98, 0.98, 0.95], [0.85, 0.65, 0.45], [0.6, 0.45, 0.35], [0.95, 0.85, 0.7]];
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + (odd ? Math.PI / 8 : 0);
    const rr = odd ? 0.75 : 1.05;
    const x = Math.cos(a) * rr, y = Math.sin(a) * rr;
    const yaw = a + Math.PI / 2;
    const c = cols[(k + odd) % 4];
    const fx = Math.cos(yaw), fy = Math.sin(yaw);
    mb.blob(x, y, 0.42, 0.06 + Math.abs(fx) * 0.1, 0.06 + Math.abs(fy) * 0.1, 0.07, c, 6);
    mb.blob(x + fx * 0.15, y + fy * 0.15, 0.55, 0.05, 0.05, 0.07, c, 5);
    mb.beam([x - fx * 0.08, y - fy * 0.08, 0.38], [x - fx * 0.1, y - fy * 0.1, 0.22], 0.025, c);
    mb.beam([x + fx * 0.08, y + fy * 0.08, 0.38], [x + fx * 0.1, y + fy * 0.1, 0.22], 0.025, c);
  }
  return mb.data().slice();
}
function cupsPlatform(col) {
  const mb = new MB(2048);
  mb.cyl(0, 0, 0, 0.05, 1.3, 16, shade(col, 0.8), [0.95, 0.92, 0.88]);
  mb.cyl(0, 0, 0.05, 0.5, 0.18, 8, col, [0.98, 0.9, 0.5]);
  mb.cone(0, 0, 0.5, 0.75, 0.3, 8, [0.95, 0.5, 0.55]);
  return mb.data().slice();
}
function cupMesh(col) {
  const mb = new MB(1024);
  mb.cyl(0, 0, 0, 0.28, 0.16, 10, col, shade(col, 0.6), 0.24);
  mb.box(0.22, -0.02, 0.1, 0.3, 0.02, 0.22, col);
  return mb.data().slice();
}
function shipBoat(col) {
  const mb = new MB(2048);
  // arms from the pivot (origin) down to the hull
  mb.beam([-0.6, 0, 0], [-0.6, 0, -1.7], 0.07, [0.6, 0.62, 0.66]);
  mb.beam([0.6, 0, 0], [0.6, 0, -1.7], 0.07, [0.6, 0.62, 0.66]);
  // hull: tapered box with raised bow and stern
  const z0 = -2.05, z1 = -1.7;
  mb.box(-1.0, -0.32, z0, 1.0, 0.32, z1, col, shade(col, 1.1));
  mb.box(-1.3, -0.26, z0 + 0.1, -1.0, 0.26, z1 + 0.25, shade(col, 0.9));
  mb.box(1.0, -0.26, z0 + 0.1, 1.3, 0.26, z1 + 0.25, shade(col, 0.9));
  for (let k = -4; k <= 4; k++) mb.box(k * 0.2 - 0.04, -0.3, z1, k * 0.2 + 0.04, 0.3, z1 + 0.06, [0.5, 0.35, 0.2]);
  mb.box(-1.3, -0.33, z1 + 0.18, 1.3, -0.3, z1 + 0.24, [0.98, 0.85, 0.35]);
  mb.box(-1.3, 0.3, z1 + 0.18, 1.3, 0.33, z1 + 0.24, [0.98, 0.85, 0.35]);
  return mb.data().slice();
}
function dropRing(col) {
  const mb = new MB(2048);
  mb.cyl(0, 0, 0, 0.18, 0.62, 12, col, shade(col, 1.15));
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    mb.box(Math.cos(a) * 0.55 - 0.05, Math.sin(a) * 0.55 - 0.05, 0.18, Math.cos(a) * 0.55 + 0.05, Math.sin(a) * 0.55 + 0.05, 0.42, [0.2, 0.2, 0.25]);
  }
  return mb.data().slice();
}
function obsCabin(col) {
  const mb = new MB(2048);
  mb.cyl(0, 0, 0, 0.08, 0.75, 14, [0.9, 0.9, 0.92]);
  mb.cyl(0, 0, 0.08, 0.5, 0.72, 14, [0.55, 0.78, 0.92]);
  mb.cyl(0, 0, 0.5, 0.6, 0.78, 14, col, shade(col, 1.15));
  return mb.data().slice();
}
