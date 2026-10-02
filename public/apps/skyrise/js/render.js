// Skyrise — scene renderer. Reads the game state; never mutates simulation state.
import { FAC, TRANSPORT, WORLD_W, MIN_LEVEL, TOP_LEVEL, floorLabel, isExpressStop, stressTier, evalTier, PRICE_EVAL_OFFSET } from './data.js';
import { clockMinutes, dayTick, dayType } from './clock.js';
import { U, FH, SLAB, paintFacility, paintBareFloor, paintStairs, paintPerson, skyColors, hash, rect, star, car as paintCar } from './art.js';

const SKY_LEVELS = 8;           // empty sky above floor 100
export const WORLD_PX_W = WORLD_W * U;
export const WORLD_PX_H = (TOP_LEVEL + SKY_LEVELS - MIN_LEVEL + 3) * FH;
export function yOf(L) { return (TOP_LEVEL + SKY_LEVELS - L) * FH; } // top edge of level L
export const GROUND_Y = yOf(0) + FH;
export function levelAt(wy) { return TOP_LEVEL + SKY_LEVELS - Math.floor(wy / FH); }

export class Renderer {
  constructor(canvas) {
    this.cv = canvas;
    this.c = canvas.getContext('2d');
    this.cam = { x: 200 * U - 600, y: GROUND_Y - 520, z: 1 };
    this.dpr = 1;
    this.overlay = 'none';
    this.ghost = null;
    this.highlight = null;
    this.carMemo = new Map();
    this.skyline = [];
    let s = 7;
    for (let x = -800; x < WORLD_PX_W + 800; ) { s = (s * 16807) % 2147483647; const w = 30 + (s % 70); const h = 40 + ((s >> 7) % 160); this.skyline.push([x, w, h, s]); x += w + ((s >> 3) % 12); }
    this.clouds = [];
    for (let i = 0; i < 14; i++) this.clouds.push([hash(i * 7) * (WORLD_PX_W + 1600) - 800, yOf(20 + hash(i * 3 + 1) * 70), 40 + hash(i * 5) * 90, 0.3 + hash(i * 11) * 0.7]);
    this.flags = { people: true, detail: true };
    this.sound = null;
  }
  resize(w, h, dpr) {
    this.dpr = dpr; this.vw = w; this.vh = h;
    this.cv.width = Math.round(w * dpr); this.cv.height = Math.round(h * dpr);
    this.cv.style.width = w + 'px'; this.cv.style.height = h + 'px';
    this.clampCam();
  }
  clampCam() {
    const z = this.cam.z;
    const vwW = this.vw / z, vhW = this.vh / z;
    this.cam.x = Math.max(-300, Math.min(WORLD_PX_W + 300 - vwW, this.cam.x));
    this.cam.y = Math.max(-100, Math.min(WORLD_PX_H - vhW + 60, this.cam.y));
  }
  toWorld(sx, sy) { return { x: sx / this.cam.z + this.cam.x, y: sy / this.cam.z + this.cam.y }; }
  toScreen(wx, wy) { return { x: (wx - this.cam.x) * this.cam.z, y: (wy - this.cam.y) * this.cam.z }; }
  zoomAt(sx, sy, nz) {
    nz = Math.max(0.25, Math.min(2, nz));
    const w = this.toWorld(sx, sy);
    this.cam.z = nz;
    this.cam.x = w.x - sx / nz; this.cam.y = w.y - sy / nz;
    this.clampCam();
  }
  centerOn(wx, wy) { this.cam.x = wx - this.vw / this.cam.z / 2; this.cam.y = wy - this.vh / this.cam.z / 2; this.clampCam(); }

  draw(g, alpha, animT) {
    const c = this.c, z = this.cam.z, d = this.dpr;
    const T = g.tower;
    const dt = dayTick(g.t);
    const min = clockMinutes(dt);
    const night = min < 360 || min >= 1170;
    const ctx = { yOf, min, night, weekday: dayType(g.t) !== 2, anim: animT, t: g.t + alpha, festive: g.isFestive() };
    c.setTransform(d, 0, 0, d, 0, 0);
    // ---------- sky (screen space)
    const [top, bot] = skyColors(min, g.weather.rain);
    const gy = (GROUND_Y - this.cam.y) * z;
    const grad = c.createLinearGradient(0, Math.min(0, gy - 900 * z), 0, gy);
    grad.addColorStop(0, top); grad.addColorStop(1, bot);
    c.fillStyle = grad; c.fillRect(0, 0, this.vw, this.vh);
    if (night) this.drawStars(c, animT);
    this.drawSunMoon(c, min, gy);
    // ---------- world space
    c.setTransform(d * z, 0, 0, d * z, -this.cam.x * z * d, -this.cam.y * z * d);
    const vx0 = this.cam.x, vx1 = this.cam.x + this.vw / z, vy0 = this.cam.y, vy1 = this.cam.y + this.vh / z;
    this.drawClouds(c, ctx, vx0, vx1, g.weather.rain);
    this.drawSkyline(c, ctx, vx0, vx1, night);
    // seasonal sky show
    if (g.quarter === 4 && dayType(g.t) === 2 && min >= 1080 && min < 1380) this.drawSeasonal(c, ctx, vx0, vx1);
    // ground & earth
    rect(c, vx0, GROUND_Y, vx1 - vx0, Math.max(0, vy1 - GROUND_Y), '#6b4f3a');
    for (let L = -1; L >= MIN_LEVEL; L--) { const y = yOf(L); if (y > vy1 || y + FH < vy0) continue; for (let x = Math.floor(vx0 / 64) * 64; x < vx1; x += 64) rect(c, x + ((L * 37) % 64 + 64) % 64, y + 12, 6, 3, '#5d4431'); }
    rect(c, vx0, GROUND_Y - 2, vx1 - vx0, 6, '#3d3d44'); // street
    rect(c, vx0, GROUND_Y + 4, vx1 - vx0, 4, '#7b8f4a');
    // ---------- tower
    const Lmin = Math.max(MIN_LEVEL, levelAt(vy1) - 1), Lmax = Math.min(TOP_LEVEL, levelAt(vy0) + 1);
    const ux0 = Math.max(0, Math.floor(vx0 / U) - 1), ux1 = Math.min(WORLD_W, Math.ceil(vx1 / U) + 1);
    // reveal basements: darker cavity behind built basement slabs
    for (let L = Lmin; L <= Math.min(-1, Lmax); L++) {
      const row = T.slab[L - MIN_LEVEL];
      let x = ux0;
      while (x < ux1) { if (row[x]) { const s = x; while (x < ux1 && row[x]) x++; rect(c, s * U, yOf(L), (x - s) * U, FH, '#3a3036'); } else x++; }
    }
    // emergency stairs at the tower edges
    this.drawEmergencyStairs(c, g, Lmin, Lmax, ctx);
    // bare floors (slab cells with no facility)
    for (let L = Lmin; L <= Lmax; L++) {
      const row = T.slab[L - MIN_LEVEL], occ = T.occ[L - MIN_LEVEL];
      let x = ux0;
      while (x < ux1) {
        if (row[x] && !occ[x]) { const s = x; while (x < ux1 && row[x] && !occ[x]) x++; paintBareFloor(c, s, x, yOf(L), night); }
        else x++;
      }
    }
    // facilities
    const seen = new Set();
    this.markParking(g);
    for (let L = Lmin; L <= Lmax; L++) {
      const occ = T.occ[L - MIN_LEVEL];
      for (let x = ux0; x < ux1; x++) {
        const id = occ[x];
        if (!id || seen.has(id)) continue;
        seen.add(id);
        const f = T.facs.get(id);
        if (f) paintFacility(c, g, f, ctx);
      }
    }
    if (this.overlay !== 'none') this.drawOverlay(c, g, seen);
    if (this.focus) { c.fillStyle = 'rgba(10,14,26,0.72)'; c.fillRect(vx0, vy0, vx1 - vx0, vy1 - vy0); }
    // crane on the highest floor while growing
    this.drawCrane(c, g, ctx);
    // transport
    const visTrans = [];
    for (const o of T.trans.values()) {
      const b = o.cars ? o.bottom - 1 : o.L, t = o.cars ? o.top + 1 : o.L + 1;
      if (t < Lmin || b > Lmax || (o.x + o.w) < ux0 || o.x > ux1) continue;
      if (this.focus && o.id !== this.focus) continue;
      visTrans.push(o);
    }
    for (const o of visTrans) if (!o.cars && !this.focus) paintStairs(c, o, yOf(o.L + 1), animT, this.stairBusy(g, o), o.kind === 'escalator');
    for (const o of visTrans) if (o.cars && !o.hidden) this.drawShaft(c, g, o, alpha, ctx, Lmin, Lmax);
    // people
    if (this.flags.people && z >= 0.45) this.drawPeople(c, g, alpha, animT, ux0, ux1, Lmin, Lmax);
    for (const o of visTrans) if (o.cars && !o.hidden) this.drawCars(c, g, o, alpha, ctx);
    // events
    if (g.fire) this.drawFire(c, g, ctx);
    if (g.heli) this.drawHeli(c, g, ctx);
    if (g.bomb && g.bomb.state === 'search') this.drawSearch(c, g, ctx);
    if (g.boomAt && g.t - g.boomAt < 30) { c.fillStyle = `rgba(255,170,60,${1 - (g.t - g.boomAt) / 30})`; c.beginPath(); c.arc(g.boomX * U, yOf(g.boomL) + FH / 2, 40 + (g.t - g.boomAt) * 6, 0, 6.283); c.fill(); }
    // ghost
    if (this.ghost) this.drawGhost(c, this.ghost);
    if (this.highlight) this.drawHighlight(c, this.highlight, animT);
    // ---------- screen space effects
    c.setTransform(d, 0, 0, d, 0, 0);
    if (g.weather.rain) this.drawRain(c, animT);
    if (g.weather.flashAt && g.t - g.weather.flashAt < 4) { c.fillStyle = `rgba(255,255,255,${0.5 - (g.t - g.weather.flashAt) * 0.12})`; c.fillRect(0, 0, this.vw, this.vh); }
  }

  drawStars(c, t) {
    c.fillStyle = 'rgba(255,255,255,0.7)';
    for (let i = 0; i < 80; i++) { const x = hash(i * 3) * this.vw, y = hash(i * 7 + 1) * this.vh * 0.7; const tw = (Math.sin(t / 10 + i) + 1) / 2; c.globalAlpha = 0.3 + tw * 0.6; c.fillRect(x, y, 1.5, 1.5); }
    c.globalAlpha = 1;
  }
  drawSunMoon(c, min, gy) {
    const day = min >= 360 && min < 1170;
    const k = day ? (min - 360) / (1170 - 360) : ((min >= 1170 ? min - 1170 : min + 270) / 630);
    const x = this.vw * (0.1 + 0.8 * k);
    const y = Math.max(40, Math.min(gy - 30, this.vh * 0.1 + Math.sin(k * Math.PI) * -this.vh * 0.0 + (1 - Math.sin(k * Math.PI)) * this.vh * 0.45));
    c.fillStyle = day ? '#fff2b8' : '#e8ecf5';
    c.beginPath(); c.arc(x, y, day ? 22 : 14, 0, 6.283); c.fill();
    if (!day) { c.fillStyle = 'rgba(10,16,40,0.9)'; c.beginPath(); c.arc(x + 6, y - 3, 12, 0, 6.283); c.fill(); }
  }
  drawClouds(c, ctx, vx0, vx1, rain) {
    for (const [cx0, cy, w, sp] of this.clouds) {
      const span = WORLD_PX_W + 1600;
      const cx = ((cx0 + ctx.t * sp * 0.15) % span + span) % span - 800;
      if (cx + w < vx0 - 100 || cx > vx1 + 100) continue;
      c.fillStyle = rain ? 'rgba(150,155,165,0.85)' : ctx.night ? 'rgba(90,100,130,0.35)' : 'rgba(255,255,255,0.85)';
      c.beginPath();
      c.ellipse(cx, cy, w * 0.5, w * 0.18, 0, 0, 6.283);
      c.ellipse(cx - w * 0.2, cy - w * 0.08, w * 0.25, w * 0.16, 0, 0, 6.283);
      c.ellipse(cx + w * 0.18, cy - w * 0.1, w * 0.22, w * 0.15, 0, 0, 6.283);
      c.fill();
    }
  }
  drawSkyline(c, ctx, vx0, vx1, night) {
    const base = GROUND_Y - 2;
    const par = 0.35;
    const off = this.cam.x * par;
    for (const [x0, w, h, s] of this.skyline) {
      const x = x0 + off;
      if (x + w < vx0 || x > vx1) continue;
      c.fillStyle = night ? '#1a2038' : '#9fb0c4';
      c.fillRect(x, base - h, w, h);
      if (night) { c.fillStyle = '#e9d27a'; for (let yy = base - h + 6; yy < base - 6; yy += 10) for (let xx = x + 4; xx < x + w - 4; xx += 9) if (hash(xx * 13 + yy + s) > 0.72) c.fillRect(xx, yy, 3, 4); }
    }
  }
  drawSeasonal(c, ctx, vx0, vx1) {
    // drifting lanterns and sparkles over the skyline
    for (let i = 0; i < 40; i++) {
      const x = vx0 + (hash(i * 19) * (vx1 - vx0) + ctx.t * (0.2 + hash(i) * 0.3)) % (vx1 - vx0);
      const y = GROUND_Y - 200 - ((ctx.t * (0.4 + hash(i * 3) * 0.6) + hash(i * 5) * 1200) % 1200);
      c.fillStyle = ['#ff8a5b', '#ffd56b', '#ff6f91', '#9be7ff'][i % 4];
      c.globalAlpha = 0.8; c.beginPath(); c.ellipse(x, y, 3, 4, 0, 0, 6.283); c.fill();
      c.globalAlpha = 0.3; c.beginPath(); c.arc(x, y, 8, 0, 6.283); c.fill();
    }
    c.globalAlpha = 1;
  }
  drawRain(c, t) {
    c.strokeStyle = 'rgba(200,215,235,0.35)'; c.lineWidth = 1;
    c.beginPath();
    for (let i = 0; i < 160; i++) { const x = (hash(i * 7) * this.vw + t * 2) % this.vw; const y = (hash(i * 13) * this.vh + t * 18) % this.vh; c.moveTo(x, y); c.lineTo(x - 3, y + 10); }
    c.stroke();
  }
  drawEmergencyStairs(c, g, Lmin, Lmax, ctx) {
    const T = g.tower;
    for (let L = Math.max(Lmin, T.span.minL); L <= Math.min(Lmax, T.span.maxL); L++) {
      if (L === 0) continue;
      const ext = T.levelExtent(L);
      if (!ext) continue;
      const y = yOf(L);
      for (const side of [-1, 1]) {
        const x = side < 0 ? ext[0] * U - 14 : (ext[1] + 1) * U + 2;
        c.strokeStyle = '#a33b2b'; c.lineWidth = 1.5;
        c.beginPath(); c.moveTo(x, y + FH); c.lineTo(x + 12, y); c.stroke();
        rect(c, x - 1, y + FH - 2, 14, 2, '#7a2b20');
      }
    }
  }
  drawCrane(c, g, ctx) {
    const T = g.tower;
    if (T.span.maxL < 2 || T.span.maxL >= 99) return;
    const ext = T.levelExtent(T.span.maxL);
    if (!ext) return;
    const x = (ext[0] + 4) * U, y = yOf(T.span.maxL);
    rect(c, x, y - 90, 6, 90, '#f2b134');
    for (let i = 0; i < 90; i += 10) { c.strokeStyle = '#c98a1a'; c.lineWidth = 1; c.beginPath(); c.moveTo(x, y - i); c.lineTo(x + 6, y - i - 10); c.stroke(); }
    rect(c, x - 30, y - 96, 120, 5, '#f2b134');
    rect(c, x - 30, y - 92, 14, 10, '#555');
    const hx = x + 40 + Math.sin(ctx.t / 40) * 30;
    c.strokeStyle = '#333'; c.beginPath(); c.moveTo(hx, y - 91); c.lineTo(hx, y - 40); c.stroke();
    rect(c, hx - 6, y - 40, 12, 6, '#8a5a3b');
  }
  markParking(g) {
    const spaces = g.facsOf('parkspace');
    if (!spaces.length) return;
    g.parking();
    let need = g.parkingInUse();
    if (g.star >= 4) { const m = clockMinutes(dayTick(g.t)); if (m > 480 && m < 1080) for (const f of g.facsOf('office')) if (f.occupied) need++; for (const f of g.facsOf('condo')) if (f.occupied) need += 0.5; }
    for (const s of spaces) { s.carOn = s.linked && need >= 1; if (s.carOn) need--; }
  }
  stairBusy(g, o) {
    return true;
  }

  drawShaft(c, g, s, alpha, ctx, Lmin, Lmax) {
    const T = g.tower;
    const x = s.x * U, w = s.w * U;
    const kindCol = s.kind === 'express' ? '#c9a95c' : s.kind === 'service' ? '#6a8a6a' : '#5a7fb0';
    const b = Math.max(s.bottom, Lmin), t = Math.min(s.top, Lmax);
    // shaft body
    c.fillStyle = 'rgba(28,32,44,0.88)';
    c.fillRect(x, yOf(t), w, yOf(b) + FH - yOf(t));
    rect(c, x, yOf(t), 2, yOf(b) + FH - yOf(t), kindCol);
    rect(c, x + w - 2, yOf(t), 2, yOf(b) + FH - yOf(t), kindCol);
    c.font = 'bold 7px system-ui,sans-serif'; c.textAlign = 'center';
    for (let L = b; L <= t; L++) {
      const y = yOf(L);
      rect(c, x, y + FH - SLAB, w, 1, 'rgba(255,255,255,0.12)');
      const served = T.shaftServes(s, L);
      if (served) {
        c.fillStyle = 'rgba(255,255,255,0.75)'; c.fillText(floorLabel(L), x + w / 2, y + 9);
        // door frame
        rect(c, x + 4, y + FH - SLAB - 18, w - 8, 1, '#8a93a3');
      } else if (s.off.has(L)) {
        c.strokeStyle = '#e5484d'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(x + 4, y + 6); c.lineTo(x + w - 4, y + FH - 8); c.moveTo(x + w - 4, y + 6); c.lineTo(x + 4, y + FH - 8); c.stroke();
      }
    }
    // machinery top & bottom
    const anyMove = s.cars.some(cc => cc.v !== 0);
    for (const [L, top] of [[s.top + 1, true], [s.bottom - 1, false]]) {
      if (L < Lmin - 1 || L > Lmax + 1) continue;
      const y = top ? yOf(L) + FH - 14 : yOf(L) + 2;
      rect(c, x, y, w, 12, '#3a4150'); rect(c, x, y, w, 2, kindCol);
      const gx = x + w / 2, gy2 = y + 7, r = 4;
      c.strokeStyle = '#c9ced6'; c.lineWidth = 1.5;
      const a0 = anyMove && this.flags.detail ? ctx.t / 3 : 0;
      c.beginPath(); c.arc(gx, gy2, r, 0, 6.283); c.stroke();
      for (let k = 0; k < 4; k++) { const a = a0 + k * Math.PI / 2; c.beginPath(); c.moveTo(gx, gy2); c.lineTo(gx + Math.cos(a) * r, gy2 + Math.sin(a) * r); c.stroke(); }
    }
  }
  drawCars(c, g, s, alpha, ctx) {
    const x = s.x * U, w = s.w * U;
    const cap = s.cap;
    for (let i = 0; i < s.cars.length; i++) {
      const car = s.cars[i];
      const pos = car.prev + (car.pos - car.prev) * alpha;
      const y = yOf(pos) + FH - SLAB - 26 + (pos - Math.floor(pos)) * 0;
      const yy = (TOP_LEVEL + 8 - pos) * FH + FH - SLAB - 26;
      const n = car.pax.length;
      const open = car.state === 'unload' || car.state === 'load';
      const col = s.kind === 'express' ? '#e9d8a6' : s.kind === 'service' ? '#b9d1b0' : '#d6e2f2';
      rect(c, x + 2, yy, w - 4, 26, col);
      rect(c, x + 2, yy, w - 4, 2, '#3a4150');
      // load: 0 empty, 1, 2-3, 4+, full
      const lvl = n === 0 ? 0 : n === 1 ? 1 : n <= 3 ? 2 : n < cap ? 3 : 4;
      const heads = [0, 1, 2, 4, 6][lvl];
      for (let k = 0; k < heads; k++) { c.fillStyle = lvl === 4 ? '#e5484d' : '#3b4252'; c.beginPath(); c.arc(x + 6 + (k % 3) * ((w - 10) / 3) + 2, yy + 8 + Math.floor(k / 3) * 8, 2.2, 0, 6.283); c.fill(); }
      if (open) { rect(c, x + w / 2 - 3, yy + 3, 6, 23, '#fff6d6'); }
      else rect(c, x + w / 2 - 0.5, yy + 3, 1, 23, '#7a8494');
      // sound cue memo
      const key = s.id * 16 + i;
      const prev = this.carMemo.get(key);
      if (prev !== car.state) {
        this.carMemo.set(key, car.state);
        if (this.sound && car.state === 'opening' && prev) this.sound.carEvent('arrive');
        else if (this.sound && car.state === 'moving' && prev === 'closing') this.sound.carEvent('depart');
      }
    }
  }
  drawPeople(c, g, alpha, anim, ux0, ux1, Lmin, Lmax) {
    const T = g.tower;
    // movers
    const fid = this.focus;
    for (const p of g.movers) {
      if (fid && !(p.steps && p.steps.some((st, i) => i >= p.si && st.t === 'elev' && st.sid === fid))) continue;
      const x = (p.px + (p.x - p.px) * alpha), L = p.pL + (p.L - p.pL) * alpha;
      if (x < ux0 || x > ux1 || L < Lmin - 1 || L > Lmax + 1) continue;
      const y = (TOP_LEVEL + 8 - L) * FH + FH - SLAB;
      paintPerson(c, p, x * U, y, anim);
    }
    // queues beside shafts
    for (const s of g.shafts()) {
      if (s.x + s.w < ux0 - 20 || s.x > ux1 + 20) continue;
      if (fid && s.id !== fid) continue;
      for (const q of s.queues.values()) {
        if (q.L < Lmin || q.L > Lmax || !q.people.length) continue;
        const y = yOf(q.L) + FH - SLAB;
        const n = Math.min(q.people.length, 10);
        for (let i = 0; i < n; i++) {
          const p = q.people[i];
          const px = q.d > 0 ? s.x * U - 5 - i * 6 : (s.x + s.w) * U + 5 + i * 6;
          p.face = q.d > 0 ? 1 : -1;
          paintPerson(c, p, px, y, anim);
        }
        if (q.people.length > 10) {
          c.fillStyle = '#fff'; c.font = 'bold 8px system-ui'; c.textAlign = 'center';
          const px = q.d > 0 ? s.x * U - 70 : (s.x + s.w) * U + 70;
          c.fillText('+' + (q.people.length - 10), px, y - 16);
        }
        // call arrow
        c.fillStyle = q.d > 0 ? '#3fb27f' : '#f2a541';
        const ax = q.d > 0 ? s.x * U - 3 : (s.x + s.w) * U + 3, ay = y - 20;
        c.beginPath(); if (q.d > 0) { c.moveTo(ax - 3, ay + 3); c.lineTo(ax + 3, ay + 3); c.lineTo(ax, ay - 2); } else { c.moveTo(ax - 3, ay - 2); c.lineTo(ax + 3, ay - 2); c.lineTo(ax, ay + 3); } c.fill();
      }
    }
    // VIP in a room or anywhere: halo
    for (const p of g.people.values()) {
      if (p.kind !== 'vip') continue;
      const L = p.L, x = p.x;
      if (L < Lmin || L > Lmax) continue;
      c.strokeStyle = 'rgba(246,196,69,0.9)'; c.lineWidth = 2; c.beginPath(); c.arc(x * U, yOf(L) + FH / 2, 14 + Math.sin(anim / 4) * 2, 0, 6.283); c.stroke();
    }
  }
  drawOverlay(c, g, seen) {
    const T = g.tower;
    for (const id of seen) {
      const f = T.facs.get(id);
      if (!f) continue;
      const d = FAC[f.type];
      let col = null;
      if (this.overlay === 'eval') {
        if ((f.occupied || f.open || (d.hotel && f.hstate !== 'vacant')) && f.evalTier !== undefined) col = ['rgba(229,72,77,0.55)', 'rgba(242,165,65,0.45)', 'rgba(63,178,127,0.5)'][f.evalTier];
        else if (d.tenant || d.hotel || d.commercial) col = 'rgba(120,120,130,0.35)';
      } else if (this.overlay === 'price') {
        if (d.prices) { const v = f.price === 0 ? 0 : f.price === 1 ? 1 : 2; col = ['rgba(229,72,77,0.55)', 'rgba(74,163,223,0.45)', 'rgba(63,178,127,0.5)'][v]; }
      } else if (this.overlay === 'hotel') {
        if (d.hotel) col = f.infested ? 'rgba(120,160,40,0.7)' : f.hstate === 'dirty' ? 'rgba(229,72,77,0.6)' : f.hstate === 'cleaning' ? 'rgba(242,165,65,0.6)' : 'rgba(63,178,127,0.35)';
      }
      if (col) { c.fillStyle = col; c.fillRect(f.x * U, yOf(f.L + f.h - 1), f.w * U, f.h * FH - SLAB); }
    }
  }
  drawFire(c, g, ctx) {
    for (const [L, [a, b]] of g.fire.levels) {
      const y = yOf(L) + FH - SLAB;
      for (let x = a; x < b; x++) {
        const big = (b - a) > 6;
        const hgt = (big ? 22 : 14) + Math.sin(ctx.anim / 2 + x * 1.7) * 4;
        c.fillStyle = 'rgba(255,90,30,0.85)'; c.beginPath(); c.moveTo(x * U, y); c.quadraticCurveTo(x * U + 4, y - hgt * 1.2, x * U + 8, y); c.fill();
        c.fillStyle = 'rgba(255,210,80,0.9)'; c.beginPath(); c.moveTo(x * U + 2, y); c.quadraticCurveTo(x * U + 4, y - hgt * 0.6, x * U + 6, y); c.fill();
      }
      c.fillStyle = 'rgba(60,60,60,0.35)'; c.beginPath(); c.ellipse((a + b) / 2 * U, yOf(L) - 10 - (ctx.anim % 20), (b - a) * U * 0.6 + 10, 10, 0, 0, 6.283); c.fill();
    }
    // guards on the emergency stairs
    const T = g.tower;
    for (const tm of g.fire.teams) {
      const k = Math.max(0, Math.min(1, 1 - (tm.at - g.t) / Math.max(1, 20 * Math.abs(tm.from - g.fire.origin))));
      const L = tm.from + (g.fire.origin - tm.from) * k;
      const ext = T.levelExtent(Math.round(L)) || [0, 0];
      const x = ext[1] * U + 10;
      for (let i = 0; i < 3; i++) paintPerson(c, { id: i, kind: 'guard', stress: 0, state: 'walk', face: -1 }, x + i * 5, (TOP_LEVEL + 8 - L) * FH + FH - SLAB, ctx.anim);
    }
  }
  drawHeli(c, g, ctx) {
    const top = Math.max(...g.fire.levels.keys());
    const ext = g.tower.levelExtent(top) || [0, 0];
    const cx = ((ext[0] + ext[1]) / 2) * U, cy = yOf(top) - 60;
    rect(c, cx - 20, cy, 40, 14, '#e5484d'); rect(c, cx + 20, cy + 4, 26, 4, '#e5484d'); rect(c, cx - 14, cy + 2, 12, 8, '#cde8f6');
    const r = ((ctx.anim * 7) % 40) - 20;
    rect(c, cx - Math.abs(r) - 10, cy - 4, (Math.abs(r) + 10) * 2, 2, '#333');
    c.fillStyle = 'rgba(120,180,255,0.35)'; c.beginPath(); c.moveTo(cx - 10, cy + 14); c.lineTo(cx - 40, cy + 70); c.lineTo(cx + 40, cy + 70); c.lineTo(cx + 10, cy + 14); c.fill();
  }
  drawSearch(c, g, ctx) {
    for (const plan of g.bomb.plans) {
      let cur = null;
      for (const s of plan) { if (g.t >= s.t0 - 10 && g.t <= s.t1) { cur = s; break; } }
      if (!cur) continue;
      const ext = g.tower.levelExtent(cur.L) || [0, 0];
      const sweeping = g.t >= cur.t0;
      const k = sweeping ? (g.t - cur.t0) / (cur.t1 - cur.t0) : 0;
      const x = (ext[0] + (ext[1] - ext[0]) * k) * U;
      paintPerson(c, { id: 3, kind: 'guard', stress: 0, state: 'walk', face: 1 }, x, yOf(cur.L) + FH - SLAB, ctx.anim);
      c.fillStyle = 'rgba(255,255,140,0.25)'; c.beginPath(); c.moveTo(x + 3, yOf(cur.L) + FH - 14); c.lineTo(x + 30, yOf(cur.L) + 6); c.lineTo(x + 30, yOf(cur.L) + FH - 6); c.fill();
    }
  }
  drawGhost(c, gh) {
    c.fillStyle = gh.ok ? 'rgba(63,178,127,0.35)' : 'rgba(229,72,77,0.35)';
    c.strokeStyle = gh.ok ? '#3fb27f' : '#e5484d';
    c.lineWidth = 2;
    for (const r of gh.rects) {
      const y = yOf(r.L + r.h - 1);
      c.fillRect(r.x * U, y, r.w * U, r.h * FH);
      c.strokeRect(r.x * U, y, r.w * U, r.h * FH);
    }
    if (gh.anchor) { c.fillStyle = '#f6c445'; c.beginPath(); c.arc(gh.anchor.x * U, yOf(gh.anchor.L) + FH / 2, 5, 0, 6.283); c.fill(); }
  }
  drawHighlight(c, h, anim) {
    const r = 18 + Math.sin(anim / 3) * 4;
    c.strokeStyle = '#f6c445'; c.lineWidth = 3;
    c.beginPath(); c.arc(h.x * U, yOf(h.L) + FH / 2, r, 0, 6.283); c.stroke();
    c.beginPath(); c.moveTo(h.x * U, yOf(h.L) - 40 - (anim % 10)); c.lineTo(h.x * U, yOf(h.L) - 6); c.stroke();
    c.beginPath(); c.moveTo(h.x * U - 6, yOf(h.L) - 14); c.lineTo(h.x * U, yOf(h.L) - 6); c.lineTo(h.x * U + 6, yOf(h.L) - 14); c.stroke();
  }

  // mini-map
  drawMini(mc, g, w, h, mode) {
    const T = g.tower;
    const sx = w / WORLD_W, sy = h / (TOP_LEVEL - MIN_LEVEL + 1);
    const ly = (L) => (TOP_LEVEL - L) * sy;
    mc.fillStyle = '#20263a'; mc.fillRect(0, 0, w, h);
    mc.fillStyle = '#4a3a30'; mc.fillRect(0, ly(-1), w, h - ly(-1));
    for (let L = MIN_LEVEL; L <= TOP_LEVEL; L++) {
      const row = T.slab[L - MIN_LEVEL];
      let x = 0;
      while (x < WORLD_W) { if (row[x]) { const s = x; while (x < WORLD_W && row[x]) x++; mc.fillStyle = '#5c6577'; mc.fillRect(s * sx, ly(L), (x - s) * sx, Math.max(1, sy - 0.5)); } else x++; }
    }
    for (const f of T.facs.values()) {
      const d = FAC[f.type];
      let col = MINI_COL[f.type] || '#999';
      if (mode === 'eval') col = (f.occupied || f.open || (d.hotel && f.hstate !== 'vacant')) ? ['#e5484d', '#f2a541', '#3fb27f'][f.evalTier ?? 2] : '#666';
      else if (mode === 'price') col = d.prices ? ['#e5484d', '#4aa3df', '#3fb27f', '#3fb27f'][f.price] : '#555';
      else if (mode === 'hotel') col = d.hotel ? (f.infested ? '#7aa028' : f.hstate === 'dirty' ? '#e5484d' : f.hstate === 'cleaning' ? '#f2a541' : '#3fb27f') : '#555';
      mc.fillStyle = col;
      mc.fillRect(f.x * sx, ly(f.L + f.h - 1), Math.max(1, f.w * sx - 0.5), Math.max(1, f.h * sy - 0.5));
    }
    for (const o of T.trans.values()) {
      if (!o.cars) continue;
      mc.fillStyle = o.kind === 'express' ? '#f6c445' : o.kind === 'service' ? '#7fd17f' : '#7fb3ff';
      mc.fillRect(o.x * sx, ly(o.top), Math.max(1.5, o.w * sx), (o.top - o.bottom + 1) * sy);
    }
    // viewport
    const v0 = this.toWorld(0, 0), v1 = this.toWorld(this.vw, this.vh);
    const L0 = levelAt(v0.y), L1 = levelAt(v1.y);
    mc.strokeStyle = '#fff'; mc.lineWidth = 1;
    mc.strokeRect(v0.x / U * sx, ly(L0), (v1.x - v0.x) / U * sx, (L0 - L1) * sy);
  }
}

const MINI_COL = { lobby: '#d8c9a8', office: '#8fb3d9', condo: '#e3a97a', fastfood: '#e5484d', restaurant: '#a3324b', shop: '#e98bc4', single: '#b8a3e0', twin: '#9c86d1', suite: '#7b5ea7', housekeeping: '#9ad1d4', security: '#2c4a7a', party: '#c9a95c', cinema: '#5a3a7a', clinic: '#f4f8fb', recycling: '#3f8f4f', parkspace: '#777', parkramp: '#999', transit: '#4aa3df', landmark: '#fff4c2', ruin: '#222' };
