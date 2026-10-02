// Skyrise — procedural art. Everything is drawn in "world pixels": 1 unit = 8 px wide,
// 1 floor = 36 px tall. The caller sets a canvas transform for camera and zoom.
import { FAC, FILMS, stressTier } from './data.js';

export const U = 8;
export const FH = 36;
export const SLAB = 4;

const VARIANT = [
  { wall: '#e9eef3', accent: '#2a9d8f', trim: '#264653' },
  { wall: '#f3ebe2', accent: '#e76f51', trim: '#7a3b2e' },
  { wall: '#e8efe4', accent: '#6a994e', trim: '#386641' },
  { wall: '#ece8f3', accent: '#7b5ea7', trim: '#3f2d63' },
];
export const STRESS_COL = ['#26313f', '#f2a541', '#e5484d'];
const SKIN = ['#f1c9a5', '#d9a07a', '#a8714f', '#6e4a33', '#f5d6bd'];
const HAIR = ['#2b2118', '#6b4226', '#c99a4a', '#1d1d1d', '#8f8f8f'];

function rect(c, x, y, w, h, col) { c.fillStyle = col; c.fillRect(x, y, w, h); }
function hash(n) { n = (n ^ 61) ^ (n >>> 16); n = n + (n << 3); n = n ^ (n >>> 4); n = Math.imul(n, 0x27d4eb2d); return ((n ^ (n >>> 15)) >>> 0) / 4294967296; }

// ------------------------------------------------------------------ helpers
function interior(c, x, y, w, h, col) { rect(c, x, y, w, h - SLAB, col); }
function slab(c, x, y, w, h) { rect(c, x, y + h - SLAB, w, SLAB, '#596273'); rect(c, x, y + h - SLAB, w, 1, '#7a8494'); }
function darken(c, x, y, w, h, a) { c.fillStyle = 'rgba(12,16,32,' + a + ')'; c.fillRect(x, y, w, h - SLAB); }
function windowStrip(c, x, y, w, lit, night) {
  // exterior windows suggested along the back wall
  const col = lit ? '#ffe7a3' : night ? '#1c2440' : '#bcd9f0';
  for (let i = x + 4; i < x + w - 8; i += 14) rect(c, i, y + 6, 9, 11, col);
}
function tinyPerson(c, x, y, col, seed, sit) {
  const sk = SKIN[seed % SKIN.length];
  rect(c, x, y + 4, 4, sit ? 5 : 8, col);
  c.fillStyle = sk; c.beginPath(); c.arc(x + 2, y + 2, 2.2, 0, 6.283); c.fill();
}

// ------------------------------------------------------------------ facilities
export function paintFacility(c, g, f, ctx) {
  const x = f.x * U, w = f.w * U, h = f.h * FH;
  const y = ctx.yOf(f.L + f.h - 1);
  const painter = PAINT[f.type];
  if (!g.ready(f) && f.type !== 'ruin' && f.type !== 'lobby') { construction(c, x, y, w, h, ctx, f); return; }
  if (painter) painter(c, g, f, x, y, w, h, ctx);
  else { interior(c, x, y, w, h, '#ccc'); slab(c, x, y, w, h); }
  if (f.type !== 'lobby' && f.type !== 'ruin' && f.reach === false) noAccess(c, x + w - 9, y + 2);
  if (ctx.festive && f.type !== 'ruin' && f.type !== 'parkspace' && f.type !== 'parkramp') festoon(c, x, y, w, ctx.anim);
}

function construction(c, x, y, w, h, ctx, f) {
  const struct = f.type === 'lobby' || f.type === 'parkspace' || f.type === 'parkramp';
  interior(c, x, y, w, h, struct ? '#8d8f94' : '#c8b897');
  c.save(); c.beginPath(); c.rect(x, y, w, h - SLAB); c.clip();
  c.strokeStyle = struct ? '#5d5f63' : '#7b6a45'; c.lineWidth = 2;
  for (let i = -h; i < w; i += 12) { c.beginPath(); c.moveTo(x + i, y + h); c.lineTo(x + i + h, y); c.stroke(); }
  c.restore();
  // scaffold poles + hazard band
  for (let i = x + 2; i < x + w; i += 24) rect(c, i, y, 2, h - SLAB, '#4a4f57');
  for (let i = 0; i < w; i += 8) rect(c, x + i, y + h - SLAB - 5, 4, 3, (i / 8) % 2 ? '#222' : '#f6c445');
  if (!struct) { rect(c, x + w / 2 - 6, y + h - SLAB - 14, 12, 9, '#a0743f'); rect(c, x + w / 2 - 6, y + h - SLAB - 14, 12, 2, '#7b5328'); }
  slab(c, x, y, w, h);
}

function noAccess(c, cx, y) {
  c.fillStyle = '#e5484d'; c.beginPath(); c.arc(cx, y + 6, 6, 0, 6.283); c.fill();
  c.strokeStyle = '#fff'; c.lineWidth = 2; c.beginPath(); c.moveTo(cx - 3, y + 3); c.lineTo(cx + 3, y + 9); c.stroke();
  c.beginPath(); c.moveTo(cx + 3, y + 3); c.lineTo(cx - 3, y + 9); c.stroke();
}
function festoon(c, x, y, w, t) {
  const cols = ['#e5484d', '#f6c445', '#3fb27f', '#4aa3df'];
  c.strokeStyle = 'rgba(40,80,40,0.8)'; c.lineWidth = 1;
  c.beginPath(); c.moveTo(x + 2, y + 3);
  for (let i = 0; i <= w - 4; i += 6) c.lineTo(x + 2 + i, y + 3 + Math.sin(i * 0.5) * 1.5);
  c.stroke();
  for (let i = 6, k = 0; i < w - 4; i += 12, k++) {
    const on = ((Math.floor(t / 8) + k) % 3) !== 0;
    c.fillStyle = on ? cols[k % 4] : '#444'; c.fillRect(x + i, y + 4, 2, 2);
  }
}

const PAINT = {
  lobby(c, g, f, x, y, w, h, ctx) {
    const tier = g.star >= 3 ? 2 : g.star >= 2 ? 1 : 0;
    const sky = f.L > 0;
    const base = ['#efe6d6', '#e9e2f0', '#f4ead2'][tier];
    interior(c, x, y, w, h, base);
    // floor tiles
    const fy = y + h - SLAB - 5;
    for (let i = 0; i < w; i += 8) rect(c, x + i, fy, 8, 5, ((x + i) / 8) % 2 ? (tier === 2 ? '#c9a95c' : '#d8cdbb') : (tier === 2 ? '#eadbb0' : '#ece4d4'));
    // tall windows on the ground lobby
    if (!sky) {
      for (let i = x + 3; i < x + w - 4; i += 16) {
        rect(c, i, y + 6, 10, h - SLAB - 16, ctx.night ? '#2a3458' : '#bfe0f5');
        rect(c, i, y + 6, 10, 2, '#9aa6b6');
      }
    } else {
      // sky lobby: big floor number plaque
      if ((f.x / 4) % 4 === 0) {
        rect(c, x + 4, y + 7, 22, 13, '#30394a');
        c.fillStyle = '#f6c445'; c.font = 'bold 10px system-ui,sans-serif'; c.textAlign = 'center'; c.fillText(String(f.L + 1), x + 15, y + 17);
      } else windowStrip(c, x, y, w, false, ctx.night);
    }
    if (tier >= 1) { // pendant lights
      for (let i = x + 8; i < x + w; i += 16) { rect(c, i, y, 1, 7, '#666'); c.fillStyle = ctx.night ? '#ffe39a' : '#f3e1b0'; c.beginPath(); c.arc(i + 0.5, y + 8, 2.5, 0, 6.283); c.fill(); }
    }
    if (tier === 2) rect(c, x, y, w, 2, '#c9a95c');
    // entrance doors at both ends of the ground lobby
    if (!sky && f.L === 0) {
      const T = g.tower;
      const leftEnd = !T.facAt(0, f.x - 1), rightEnd = !T.facAt(0, f.x + f.w);
      for (const [end, dx] of [[leftEnd, 0], [rightEnd, w - 14]]) {
        if (!end) continue;
        const dh = Math.min(28, h - SLAB - 4);
        rect(c, x + dx, y + h - SLAB - dh - 3, 14, 3, '#30394a');
        rect(c, x + dx + 1, y + h - SLAB - dh, 12, dh, ctx.night ? '#ffe7a3' : '#9fd0ee');
        rect(c, x + dx + 6.5, y + h - SLAB - dh, 1, dh, '#30394a');
        rect(c, x + dx + 4, y + h - SLAB - dh / 2, 1, 4, '#c9a95c'); rect(c, x + dx + 9, y + h - SLAB - dh / 2, 1, 4, '#c9a95c');
        // canopy
        rect(c, x + dx - (dx ? 0 : 6), y + h - SLAB - dh - 7, 20, 3, '#c0392b');
      }
    }
    // plants
    if ((f.x / 4) % 3 === 1) { rect(c, x + 12, fy - 6, 6, 6, '#8a5a3b'); c.fillStyle = '#3f8f4f'; c.beginPath(); c.arc(x + 15, fy - 9, 5, 0, 6.283); c.fill(); }
    if (ctx.night) darken(c, x, y, w, h, 0.18);
    slab(c, x, y, w, h);
  },
  office(c, g, f, x, y, w, h, ctx) {
    const v = VARIANT[f.variant % 4];
    if (!f.occupied) { vacant(c, x, y, w, h, ctx); return; }
    const present = (f.here || []).length;
    const lit = present > 0 || (ctx.min > 420 && ctx.min < 1140 && ctx.weekday);
    interior(c, x, y, w, h, v.wall);
    windowStrip(c, x, y, w, false, ctx.night);
    rect(c, x, y + h - SLAB - 12, w, 1, v.trim);
    // desks
    for (let i = 0; i < 3; i++) {
      const dx = x + 6 + i * 22;
      rect(c, dx, y + h - SLAB - 12, 16, 3, '#8b6d4f');
      rect(c, dx + 2, y + h - SLAB - 9, 2, 5, '#6b5039'); rect(c, dx + 12, y + h - SLAB - 9, 2, 5, '#6b5039');
      rect(c, dx + 5, y + h - SLAB - 19, 7, 6, '#2d3340'); rect(c, dx + 6, y + h - SLAB - 18, 5, 4, lit ? v.accent : '#3a4252');
    }
    for (let i = 0; i < Math.min(present, 6); i++) tinyPerson(c, x + 4 + i * 11, y + h - SLAB - 13, '#4a5568', f.id + i, true);
    if (!lit) darken(c, x, y, w, h, 0.55);
    slab(c, x, y, w, h);
  },
  condo(c, g, f, x, y, w, h, ctx) {
    const v = VARIANT[f.variant % 4];
    if (!f.occupied) { vacant(c, x, y, w, h, ctx, true); return; }
    const home = (f.here || []).length;
    const m = ctx.min;
    const evening = m >= 1020 || m < 30;
    const late = m >= 30 && m < 390 || (m >= 1380);
    interior(c, x, y, w, h, v.wall);
    // wallpaper stripes
    for (let i = x + 3; i < x + w; i += 6) rect(c, i, y, 1, h - SLAB, 'rgba(0,0,0,0.04)');
    windowStrip(c, x + 60, y, 50, false, ctx.night);
    const fy = y + h - SLAB;
    // sofa
    rect(c, x + 8, fy - 9, 26, 6, v.accent); rect(c, x + 8, fy - 14, 26, 5, v.trim); rect(c, x + 6, fy - 11, 3, 8, v.trim); rect(c, x + 33, fy - 11, 3, 8, v.trim);
    // lamp
    rect(c, x + 40, fy - 16, 1, 16, '#555'); c.fillStyle = evening && home ? '#ffd56b' : '#d6cbb5'; c.beginPath(); c.moveTo(x + 36, fy - 16); c.lineTo(x + 45, fy - 16); c.lineTo(x + 42, fy - 22); c.lineTo(x + 39, fy - 22); c.fill();
    // kitchen
    rect(c, x + w - 34, fy - 12, 28, 12, '#c9ced6'); rect(c, x + w - 34, fy - 13, 28, 2, '#8a9099');
    rect(c, x + w - 30, fy - 26, 10, 8, '#b7bcc4');
    // table & plant
    rect(c, x + 74, fy - 9, 18, 2, '#8b6d4f'); rect(c, x + 82, fy - 7, 2, 7, '#6b5039');
    c.fillStyle = '#4f9d5d'; c.beginPath(); c.arc(x + 100, fy - 12, 5, 0, 6.283); c.fill(); rect(c, x + 98, fy - 7, 5, 7, '#a0643f');
    for (let i = 0; i < Math.min(home, 5); i++) tinyPerson(c, x + 12 + i * 8, fy - 15, '#5a6b7d', f.id + i, true);
    if (late && home) darken(c, x, y, w, h, 0.62);
    else if (evening && home) { c.fillStyle = 'rgba(255,190,90,0.10)'; c.fillRect(x, y, w, h - SLAB); }
    else if (ctx.night || (evening && !home)) darken(c, x, y, w, h, 0.45);
    slab(c, x, y, w, h);
  },
  single: hotelRoom, twin: hotelRoom, suite: hotelRoom,
  fastfood(c, g, f, x, y, w, h, ctx) {
    const v = VARIANT[f.variant % 4];
    const open = g.isOpenNow(f);
    const fy = y + h - SLAB;
    interior(c, x, y, w, h, open ? '#fff4dc' : '#d9d2c4');
    rect(c, x, y, w, 8, v.accent);
    // menu board
    for (let i = 0; i < 4; i++) rect(c, x + 6 + i * 8, y + 11, 6, 5, ['#e5484d', '#f6c445', '#3fb27f', '#4aa3df'][(i + f.variant) % 4]);
    rect(c, x + 4, fy - 12, 40, 12, '#c0392b'); rect(c, x + 4, fy - 13, 40, 2, '#7f2a1f');
    // tables
    for (let i = 54; i < w - 8; i += 20) { rect(c, x + i, fy - 9, 12, 2, '#7a7f8a'); rect(c, x + i + 5, fy - 7, 2, 7, '#7a7f8a'); }
    const n = Math.min((f.here || []).length, 10);
    for (let i = 0; i < n; i++) tinyPerson(c, x + 50 + (i * 9) % (w - 58), fy - 13, '#5a6b7d', f.id + i * 3, true);
    if (!open) { closedShutter(c, x, y, w, h); }
    slab(c, x, y, w, h);
  },
  restaurant(c, g, f, x, y, w, h, ctx) {
    const v = VARIANT[f.variant % 4];
    const open = g.isOpenNow(f);
    const fy = y + h - SLAB;
    interior(c, x, y, w, h, open ? '#5b2333' : '#3d2a30');
    rect(c, x, y, w, 3, '#c9a95c');
    for (let i = 10; i < w - 10; i += 30) {
      rect(c, x + i, fy - 10, 16, 3, '#f4efe6'); rect(c, x + i + 7, fy - 7, 2, 7, '#c9a95c');
      if (open) { c.fillStyle = '#ffd56b'; c.beginPath(); c.arc(x + i + 8, fy - 12, 1.5, 0, 6.283); c.fill(); }
      c.fillStyle = 'rgba(255,220,150,0.5)'; c.beginPath(); c.arc(x + i + 8, y + 6, 3, 0, 6.283); c.fill();
    }
    const n = Math.min((f.here || []).length, 14);
    for (let i = 0; i < n; i++) tinyPerson(c, x + 6 + (i * 13) % (w - 12), fy - 14, '#d8c9b0', f.id + i, true);
    rect(c, x + w - 18, y + 8, 12, 8, v.accent);
    if (!open) closedShutter(c, x, y, w, h);
    slab(c, x, y, w, h);
  },
  shop(c, g, f, x, y, w, h, ctx) {
    const v = VARIANT[f.variant % 4];
    const open = g.isOpenNow(f);
    const fy = y + h - SLAB;
    interior(c, x, y, w, h, open ? '#fbfaf7' : '#d6d3cc');
    rect(c, x, y, w, 6, v.accent);
    const kind = f.variant % 4;
    if (kind === 0) { // clothing rail
      rect(c, x + 6, y + 12, w - 30, 1, '#777');
      for (let i = x + 8; i < x + w - 26; i += 6) rect(c, i, y + 13, 4, 10, ['#e76f51', '#2a9d8f', '#f4a261', '#264653'][(i / 6 | 0) % 4]);
    } else if (kind === 1) { // books
      for (let r = 0; r < 2; r++) for (let i = x + 6; i < x + w - 26; i += 3) rect(c, i, y + 10 + r * 9, 2, 7, ['#7b5ea7', '#e9c46a', '#2a9d8f', '#e5484d', '#264653'][((i / 3 | 0) + r) % 5]);
    } else if (kind === 2) { // flowers
      for (let i = x + 8; i < x + w - 26; i += 8) { rect(c, i + 2, fy - 8, 4, 8, '#8a5a3b'); c.fillStyle = ['#e5484d', '#f6c445', '#e98bc4', '#ffffff'][(i / 8 | 0) % 4]; c.beginPath(); c.arc(i + 4, fy - 11, 3.5, 0, 6.283); c.fill(); }
    } else { // gadgets
      for (let i = x + 6; i < x + w - 26; i += 12) { rect(c, i, y + 12, 9, 7, '#2d3340'); rect(c, i + 1, y + 13, 7, 5, '#5fb3d9'); }
    }
    rect(c, x + w - 22, fy - 11, 16, 11, '#a0743f'); rect(c, x + w - 22, fy - 12, 16, 2, '#7b5328');
    const n = Math.min((f.here || []).length, 6);
    for (let i = 0; i < n; i++) tinyPerson(c, x + 8 + i * 10, fy - 13, '#5a6b7d', f.id + i, false);
    if (!open) closedShutter(c, x, y, w, h);
    slab(c, x, y, w, h);
  },
  party(c, g, f, x, y, w, h, ctx) {
    const on = f.partying && (f.here || []).length > 0;
    const fy = y + h - SLAB;
    interior(c, x, y, w, h, on ? '#3b2e5a' : '#4a4458');
    rect(c, x, y + FH - 2, w, 2, '#2c2640');
    // chandeliers
    for (let i = 24; i < w - 10; i += 48) {
      rect(c, x + i, y, 1, 8, '#c9a95c');
      c.fillStyle = on ? '#ffe39a' : '#9a8f6f'; c.beginPath(); c.arc(x + i, y + 11, 5, 0, Math.PI); c.fill();
    }
    // stage & banner
    rect(c, x + 6, fy - 8, 40, 8, '#6b4a2b');
    rect(c, x + w / 2 - 30, y + 18, 60, 9, on ? '#e9c46a' : '#7c7466');
    if (on) {
      for (let i = 0; i < 40; i++) { const hx = hash(i * 31 + (ctx.anim >> 2)); const hy = hash(i * 17 + f.id); rect(c, x + hx * w, y + hy * (h - 12), 2, 2, ['#e5484d', '#f6c445', '#3fb27f', '#4aa3df'][i % 4]); }
      const n = Math.min((f.here || []).length, 24);
      for (let i = 0; i < n; i++) tinyPerson(c, x + 50 + (i * 7) % (w - 60), fy - 13 - ((ctx.anim + i * 5) % 16 < 3 ? 2 : 0), ['#e76f51', '#2a9d8f', '#7b5ea7', '#264653'][i % 4], i, false);
    }
    slab(c, x, y, w, h);
  },
  cinema(c, g, f, x, y, w, h, ctx) {
    const fy = y + h - SLAB;
    interior(c, x, y, w, h, '#1f1b2e');
    // upper floor: screen & seats
    const showing = f.showing;
    const screenCol = showing ? `hsl(${(ctx.anim * 3 + f.id * 40) % 360},55%,${55 + 10 * Math.sin(ctx.anim / 5)}%)` : '#c9c6d6';
    rect(c, x + w - 100, y + 4, 90, 26, '#000'); rect(c, x + w - 98, y + 6, 86, 22, showing ? screenCol : (f.doors ? '#e8e4f2' : '#5a566a'));
    if (showing) { // moving silhouettes in the film
      const k = (ctx.anim % 60) / 60;
      c.fillStyle = 'rgba(0,0,0,0.5)'; c.beginPath(); c.arc(x + w - 90 + k * 70, y + 18, 5, 0, 6.283); c.fill();
    }
    for (let r = 0; r < 3; r++) for (let i = x + 8 + r * 4; i < x + w - 110; i += 7) rect(c, i, y + 22 + r * 4, 5, 3, '#7a2333');
    const n = Math.min((f.here || []).length, 40);
    for (let i = 0; i < n; i++) { const sx = x + 9 + (i * 7) % (w - 118); const r = Math.floor(i * 7 / (w - 118)) % 3; c.fillStyle = '#d8c9b0'; c.beginPath(); c.arc(sx + 2, y + 19 + r * 4, 1.8, 0, 6.283); c.fill(); }
    rect(c, x, y + FH - 3, w, 3, '#2c2640');
    // lower floor: foyer with posters and a ticket desk
    const lw = y + FH;
    rect(c, x, lw, w, FH - SLAB, '#2b2540');
    for (let i = 0; i < 4; i++) poster(c, x + 10 + i * 30, lw + 5, (f.film + i) % FILMS.length);
    rect(c, x + w - 50, fy - 12, 36, 12, '#7a2333'); rect(c, x + w - 50, fy - 13, 36, 2, '#c9a95c');
    if (!showing && !f.doors) darken(c, x, y, w, h, 0.35);
    slab(c, x, y, w, h);
  },
  housekeeping(c, g, f, x, y, w, h, ctx) {
    const fy = y + h - SLAB;
    interior(c, x, y, w, h, '#e3eef0');
    for (let r = 0; r < 3; r++) { rect(c, x + 6, y + 8 + r * 8, 50, 1, '#9aa'); for (let i = 0; i < 8; i++) rect(c, x + 7 + i * 6, y + 4 + r * 8, 5, 4, ['#fff', '#cde8f6', '#f6e3cd'][(i + r) % 3]); }
    const inside = (f.here || []).length;
    for (let i = 0; i < Math.min(inside, 6); i++) { rect(c, x + 66 + i * 8, fy - 9, 6, 6, '#6b8fa3'); rect(c, x + 66 + i * 8, fy - 3, 1, 3, '#333'); rect(c, x + 71 + i * 8, fy - 3, 1, 3, '#333'); }
    c.fillStyle = '#4a6a7a'; c.font = '7px system-ui,sans-serif'; c.textAlign = 'left'; c.fillText(inside ? 'staff in' : 'staff out', x + 66, y + 12);
    slab(c, x, y, w, h);
  },
  security(c, g, f, x, y, w, h, ctx) {
    const fy = y + h - SLAB;
    const out = g.fire || (g.bomb && g.bomb.state === 'search');
    interior(c, x, y, w, h, '#d8dde6');
    for (let r = 0; r < 2; r++) for (let i = 0; i < 4; i++) { rect(c, x + 8 + i * 12, y + 6 + r * 9, 10, 7, '#1d2433'); rect(c, x + 9 + i * 12, y + 7 + r * 9, 8, 5, out ? '#e5484d' : '#3d6e8f'); }
    // badge emblem
    c.fillStyle = '#2c4a7a'; c.beginPath(); c.moveTo(x + w - 20, y + 8); c.lineTo(x + w - 10, y + 8); c.lineTo(x + w - 10, y + 16); c.lineTo(x + w - 15, y + 21); c.lineTo(x + w - 20, y + 16); c.fill();
    c.fillStyle = '#f6c445'; c.fillRect(x + w - 16, y + 11, 2, 6);
    if (out && (ctx.anim >> 2) % 2) { c.fillStyle = '#ff3b3b'; c.beginPath(); c.arc(x + 62, y + 6, 3, 0, 6.283); c.fill(); }
    const n = out ? 0 : Math.min((f.here || []).length, 6);
    for (let i = 0; i < n; i++) tinyPerson(c, x + 64 + i * 9, fy - 13, '#2c4a7a', i, false);
    slab(c, x, y, w, h);
  },
  clinic(c, g, f, x, y, w, h, ctx) {
    const fy = y + h - SLAB;
    interior(c, x, y, w, h, '#f4f8fb');
    rect(c, x, y, w, 4, '#5fb3a3');
    c.fillStyle = '#e5484d'; rect(c, x + 10, y + 9, 12, 4, '#e5484d'); rect(c, x + 14, y + 5, 4, 12, '#e5484d');
    for (let i = 40; i < w - 20; i += 40) { rect(c, x + i, fy - 9, 24, 4, '#ffffff'); rect(c, x + i, fy - 10, 24, 1, '#b8c4cc'); rect(c, x + i, fy - 5, 2, 5, '#8aa'); rect(c, x + i + 22, fy - 5, 2, 5, '#8aa'); rect(c, x + i + 1, fy - 12, 6, 3, '#dce8f0'); }
    const n = Math.min((f.here || []).length, 6);
    for (let i = 0; i < n; i++) tinyPerson(c, x + 44 + i * 30, fy - 16, '#5a6b7d', i, true);
    slab(c, x, y, w, h);
  },
  recycling(c, g, f, x, y, w, h, ctx) {
    const fy = y + h - SLAB;
    interior(c, x, y, w, h, '#c9d3c4');
    rect(c, x, y + FH - 2, w, 2, '#7a8a72');
    const m = ctx.min;
    const load = Math.max(0, Math.min(5, Math.floor(((m - 420 + 1440) % 1440) / 160)));
    const emptying = m >= 1260 && m < 1380;
    // conveyor on top floor
    rect(c, x + 8, y + 22, w - 16, 3, '#4a4f57');
    for (let i = 0; i < w - 16; i += 8) rect(c, x + 8 + ((i + ctx.anim) % (w - 16)), y + 18, 4, 4, ['#3f8f4f', '#4aa3df', '#c99a4a'][(i / 8) % 3]);
    // bins
    for (let i = 0; i < 5; i++) {
      const bx = x + 12 + i * 36;
      rect(c, bx, fy - 22, 26, 22, '#2f6b45');
      const lv = Math.min(load, 5);
      rect(c, bx + 2, fy - 2 - lv * 4, 22, lv * 4, '#8fbf6f');
      rect(c, bx - 1, fy - 23, 28, 2, '#1e4a2f');
    }
    if (emptying && f.serviced) { // collection truck
      const tx = x + ((ctx.anim * 2) % (w + 60)) - 60;
      rect(c, tx, fy - 14, 40, 12, '#e9c46a'); rect(c, tx + 40, fy - 12, 12, 10, '#264653'); rect(c, tx + 6, fy - 3, 6, 3, '#222'); rect(c, tx + 40, fy - 3, 6, 3, '#222');
    }
    if (!f.serviced) { c.fillStyle = '#e5484d'; c.font = 'bold 8px system-ui,sans-serif'; c.textAlign = 'left'; c.fillText('needs a service lift', x + 8, y + 12); }
    slab(c, x, y, w, h);
  },
  parkspace(c, g, f, x, y, w, h, ctx) {
    const fy = y + h - SLAB;
    interior(c, x, y, w, h, '#4b4f58');
    rect(c, x, fy - 1, 1, 1, '#ddd'); rect(c, x + w - 1, fy - 10, 1, 10, '#e9e3b0');
    const occ = f.linked && f.carOn;
    if (occ) car(c, x + 3, fy - 12, f.variant % 2 ? '#c0392b' : '#3d6e8f');
    if (!f.linked) { c.fillStyle = '#f6c445'; c.font = 'bold 9px system-ui'; c.textAlign = 'center'; c.fillText('?', x + w / 2, y + 16); }
    slab(c, x, y, w, h);
  },
  parkramp(c, g, f, x, y, w, h, ctx) {
    interior(c, x, y, w, h, '#555a64');
    c.fillStyle = '#6f7580'; c.beginPath(); c.moveTo(x, y + h - SLAB); c.lineTo(x + w, y); c.lineTo(x + w, y + 6); c.lineTo(x + 8, y + h - SLAB); c.fill();
    for (let i = 0; i < 6; i++) rect(c, x + 10 + i * 18, y + h - SLAB - 8 - i * 4.5, 8, 1, '#f6c445');
    const cyc = (ctx.anim + f.id * 13) % 160;
    if (cyc < 40) { const k = cyc / 40; car(c, x + k * (w - 24), y + h - SLAB - 12 - k * (h - 16), '#7b5ea7'); }
    if (f.badRamp) { c.fillStyle = '#e5484d'; c.font = 'bold 8px system-ui'; c.textAlign = 'left'; c.fillText('not linked to lobby', x + 4, y + 10); }
    slab(c, x, y, w, h);
  },
  transit(c, g, f, x, y, w, h, ctx) {
    const fy = y + h - SLAB;
    interior(c, x, y, w, h, '#d9dee6');
    // upper concourse, middle stairs, platform at the bottom
    rect(c, x, y + FH - 2, w, 2, '#8a93a3'); rect(c, x, y + 2 * FH - 2, w, 2, '#8a93a3');
    rect(c, x + 6, y + 6, 92, 11, '#2c4a7a'); c.fillStyle = '#fff'; c.font = 'bold 7px system-ui,sans-serif'; c.textAlign = 'left'; c.fillText('METRO · CITY LOOP', x + 10, y + 14);
    for (let i = 0; i < 4; i++) rect(c, x + 108 + i * 24, y + 8, 14, 18, '#bfc7d4');
    // stairs between levels
    for (let k = 0; k < 2; k++) for (let i = 0; i < 8; i++) rect(c, x + w - 60 + i * 5, y + (k + 1) * FH - 4 - i * 4, 5, 4 + i * 4 - i * 4 + 2, '#9aa3b2');
    rect(c, x, fy - 6, w, 6, '#3d4250');
    for (let i = 0; i < w; i += 10) rect(c, x + i, fy - 3, 6, 1, '#888');
    const trainOn = ctx.t - (f.trainAt || -999) < 40;
    if (trainOn) {
      const k = Math.min(1, (ctx.t - f.trainAt) / 10);
      const tx = x - w + k * w;
      c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip();
      rect(c, tx + 10, fy - 26, w - 20, 20, '#e5484d'); rect(c, tx + 10, fy - 24, w - 20, 3, '#ffffff');
      for (let i = tx + 16; i < tx + w - 20; i += 18) rect(c, i, fy - 19, 12, 8, '#cde8f6');
      c.restore();
    }
    const open = ctx.min >= 420 && ctx.min < 1380;
    if (!open) darken(c, x, y, w, h, 0.5);
    slab(c, x, y, w, h);
  },
  landmark(c, g, f, x, y, w, h, ctx) {
    const fy = y + h - SLAB;
    // stepped crown with a spire and a round window
    c.fillStyle = '#e9e4d8'; c.beginPath();
    c.moveTo(x, fy); c.lineTo(x, y + FH * 2.5); c.lineTo(x + w * 0.2, y + FH * 1.5); c.lineTo(x + w * 0.5, y + 10); c.lineTo(x + w * 0.8, y + FH * 1.5); c.lineTo(x + w, y + FH * 2.5); c.lineTo(x + w, fy); c.fill();
    rect(c, x + w / 2 - 1, y - 18, 2, 30, '#c9a95c');
    c.fillStyle = f.wedding ? '#ffd1e0' : '#bcd9f0'; c.beginPath(); c.arc(x + w / 2, y + FH * 1.9, 16, 0, 6.283); c.fill();
    c.strokeStyle = '#c9a95c'; c.lineWidth = 2; c.stroke();
    for (let a = 0; a < 6; a++) { c.beginPath(); c.moveTo(x + w / 2, y + FH * 1.9); c.lineTo(x + w / 2 + Math.cos(a) * 16, y + FH * 1.9 + Math.sin(a) * 16); c.stroke(); }
    rect(c, x + w / 2 - 14, fy - 30, 28, 30, '#7a5a3a'); rect(c, x + w / 2 - 1, fy - 30, 2, 30, '#5a3a20');
    for (let i = x + 10; i < x + w - 10; i += 24) rect(c, i, fy - 60, 8, 24, f.wedding ? '#ffe39a' : '#9fb7cc');
    if (f.wedding) for (let i = 0; i < 30; i++) { const hx = hash(i * 13 + (ctx.anim >> 1)); const hy = hash(i * 7 + 3); heart(c, x + hx * w, y + hy * h * 0.8, '#e98bc4'); }
    slab(c, x, y, w, h);
  },
  ruin(c, g, f, x, y, w, h, ctx) {
    interior(c, x, y, w, h, '#2b2522');
    for (let i = 0; i < w; i += 5) { const hh = 4 + hash(f.id * 97 + i) * 10; rect(c, x + i, y + h - SLAB - hh, 5, hh, i % 2 ? '#3a302b' : '#1d1917'); }
    for (let i = 0; i < w; i += 9) rect(c, x + i, y + hash(i + f.id) * 10, 3, 2, '#4a3f38');
    slab(c, x, y, w, h);
  },
};

function hotelRoom(c, g, f, x, y, w, h, ctx) {
  const v = VARIANT[f.variant % 4];
  const fy = y + h - SLAB;
  const st = f.hstate;
  const guests = (f.here || []).length;
  const m = ctx.min;
  const sleeping = (st === 'occupied') && guests > 0 && (m >= 1380 || m < 390);
  const wall = st === 'infested' ? '#b9c49a' : st === 'dirty' ? '#d9cdb5' : v.wall;
  interior(c, x, y, w, h, wall);
  // bed(s)
  const beds = f.type === 'twin' ? 2 : 1;
  const bw = f.type === 'suite' ? 26 : 18;
  for (let b = 0; b < beds; b++) {
    const bx = x + 3 + b * 22;
    rect(c, bx, fy - 8, bw, 6, st === 'dirty' || st === 'infested' ? '#cbbf9f' : '#ffffff');
    rect(c, bx, fy - 10, 5, 3, '#e9eef3'); rect(c, bx - 1, fy - 13, 2, 11, v.trim);
    rect(c, bx + 6, fy - 9, bw - 6, 3, st === 'dirty' ? '#a99a78' : v.accent);
    if (st === 'dirty' || st === 'infested') { rect(c, bx + 8, fy - 10, 5, 2, '#8a7a5a'); rect(c, bx + 2, fy - 2, 3, 2, '#7a6a4a'); }
  }
  if (f.type === 'suite') { // lounge
    rect(c, x + 38, fy - 9, 20, 6, v.accent); rect(c, x + 38, fy - 13, 20, 4, v.trim);
    rect(c, x + 64, fy - 24, 10, 8, '#bcd9f0');
  }
  rect(c, x + w - 8, fy - 22, 6, 22, '#a07a55'); // wardrobe/door
  if (st === 'cleaning') { rect(c, x + w - 18, fy - 9, 8, 7, '#6b8fa3'); rect(c, x + w - 18, fy - 12, 8, 2, '#fff'); }
  if (st === 'infested') { for (let i = 0; i < 8; i++) { const bx = x + hash(i * 11 + f.id + (ctx.anim >> 3)) * w, by = y + 4 + hash(i * 5 + f.id) * (h - 12); rect(c, bx, by, 2, 1, '#222'); rect(c, bx + 0.5, by - 1, 1, 1, '#222'); } }
  if (f.vip && st !== 'vacant') { c.fillStyle = '#c9a95c'; star(c, x + w / 2, y + 8, 4); }
  if (st === 'occupied' && guests && !sleeping) { c.fillStyle = 'rgba(255,200,110,0.12)'; c.fillRect(x, y, w, h - SLAB); }
  if (sleeping) darken(c, x, y, w, h, 0.65);
  else if ((st === 'vacant') && ctx.night) darken(c, x, y, w, h, 0.35);
  slab(c, x, y, w, h);
}

function vacant(c, x, y, w, h, ctx, resid) {
  interior(c, x, y, w, h, '#d5d8dd');
  for (let i = x + 2; i < x + w; i += 18) rect(c, i, y, 2, h - SLAB, '#b9bec6');
  c.fillStyle = '#7a8494'; c.font = '8px system-ui,sans-serif'; c.textAlign = 'center';
  c.fillText(resid ? 'FOR SALE' : 'TO LET', x + w / 2, y + 16);
  if (ctx.night) darken(c, x, y, w, h, 0.5);
  slab(c, x, y, w, h);
}
function closedShutter(c, x, y, w, h) {
  rect(c, x, y, w, h - SLAB, 'rgba(70,74,84,0.82)');
  for (let i = y + 3; i < y + h - SLAB; i += 4) rect(c, x, i, w, 1, 'rgba(30,32,40,0.6)');
}
function poster(c, x, y, idx) {
  const pal = [['#e76f51', '#f4a261', '#264653'], ['#2a9d8f', '#e9c46a', '#1d3557'], ['#7b5ea7', '#f2a541', '#2b2540'], ['#e5484d', '#ffffff', '#1d1d1d'], ['#3fb27f', '#f6c445', '#1b4332']][idx % 5];
  rect(c, x, y, 18, 24, pal[2]); rect(c, x + 2, y + 2, 14, 14, pal[0]);
  c.fillStyle = pal[1];
  if (idx % 3 === 0) { c.beginPath(); c.arc(x + 9, y + 9, 5, 0, 6.283); c.fill(); }
  else if (idx % 3 === 1) { c.beginPath(); c.moveTo(x + 3, y + 15); c.lineTo(x + 9, y + 4); c.lineTo(x + 15, y + 15); c.fill(); }
  else rect(c, x + 5, y + 5, 8, 8, pal[1]);
  rect(c, x + 3, y + 18, 12, 1.5, pal[1]); rect(c, x + 3, y + 21, 8, 1, pal[1]);
}
export function car(c, x, y, col) {
  rect(c, x, y + 4, 24, 6, col); rect(c, x + 5, y, 13, 5, col); rect(c, x + 7, y + 1, 9, 3, '#cde8f6');
  rect(c, x + 3, y + 9, 4, 3, '#1d1d1d'); rect(c, x + 17, y + 9, 4, 3, '#1d1d1d');
}
export function star(c, cx, cy, r) {
  c.beginPath();
  for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5; const rr = i % 2 ? r * 0.45 : r; c.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); }
  c.closePath(); c.fill();
}
function heart(c, x, y, col) { c.fillStyle = col; c.beginPath(); c.arc(x - 1.2, y, 1.5, 0, 6.283); c.arc(x + 1.2, y, 1.5, 0, 6.283); c.fill(); c.beginPath(); c.moveTo(x - 2.6, y + 0.5); c.lineTo(x + 2.6, y + 0.5); c.lineTo(x, y + 3.2); c.fill(); }

// ------------------------------------------------------------------ bare floor
export function paintBareFloor(c, x0, x1, y, night) {
  const w = (x1 - x0) * U;
  const x = x0 * U;
  c.fillStyle = night ? 'rgba(20,24,40,0.35)' : 'rgba(120,130,150,0.18)';
  c.fillRect(x, y, w, FH - SLAB);
  for (let i = Math.ceil(x0 / 8) * 8; i < x1; i += 8) rect(c, i * U, y, 3, FH - SLAB, '#7d8696');
  rect(c, x, y + FH - SLAB, w, SLAB, '#596273'); rect(c, x, y + FH - SLAB, w, 1, '#7a8494');
}

// ------------------------------------------------------------------ transport
export function paintStairs(c, o, y, anim, busy, esc) {
  const x = o.x * U, w = o.w * U;
  // y = top of the upper level; the flight runs from bottom-left (lower floor) to top-right
  const yb = y + 2 * FH - SLAB, yt = y + FH - SLAB;
  if (esc) {
    c.fillStyle = '#9aa3b2'; c.beginPath(); c.moveTo(x, yb); c.lineTo(x + 8, yb); c.lineTo(x + w, yt); c.lineTo(x + w - 8, yt); c.closePath(); c.fill();
    c.strokeStyle = '#2d3340'; c.lineWidth = 2; c.beginPath(); c.moveTo(x + 2, yb - 12); c.lineTo(x + w - 2, yt - 12); c.stroke();
    c.strokeStyle = '#d9dee6'; c.lineWidth = 1;
    for (let i = 0; i < 6; i++) { const k = ((i / 6) + (busy ? anim / 60 : 0)) % 1; const px = x + 4 + k * (w - 12), py = yb - 1 - k * (yb - yt); c.beginPath(); c.moveTo(px, py); c.lineTo(px + 4, py - 2); c.stroke(); }
  } else {
    const n = 9;
    for (let i = 0; i < n; i++) {
      const sx = x + i * (w / n), sy = yb - (i + 1) * (FH / n);
      rect(c, sx, sy, w / n + 1, FH / n, '#8d6e4f');
      rect(c, sx, sy, w / n + 1, 1.5, '#b08c66');
    }
    c.strokeStyle = '#4a3a2a'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(x, yb - 12); c.lineTo(x + w, yt - 12); c.stroke();
  }
}

// ------------------------------------------------------------------ people
// p drawn with feet at (x, y). kind affects accessories, color shows stress.
export function paintPerson(c, p, x, y, anim, scale = 1) {
  const tier = stressTier(p.stress);
  let body = STRESS_COL[tier];
  const seed = p.id;
  const child = p.kind === 'child';
  const hgt = child ? 9 : 13;
  const walk = p.state === 'walk' || p.state === 'flight';
  const step = walk ? Math.floor(anim / 3 + seed) % 2 : 0;
  // legs
  rect(c, x - 2, y - 4, 1.6, 4 - (step ? 1 : 0), '#2b2b33');
  rect(c, x + 0.4, y - 4, 1.6, 4 - (step ? 0 : 1), '#2b2b33');
  // body
  if (p.kind === 'vip') body = tier === 0 ? '#7b3fa0' : body;
  rect(c, x - 2.5, y - hgt + 3, 5, hgt - 7, body);
  if (p.kind === 'keeper') { rect(c, x - 2.5, y - 7, 5, 3, '#ffffff'); }
  if (p.kind === 'guard') { rect(c, x - 2.5, y - hgt, 5, 1.5, '#1d2b4a'); }
  if (p.kind === 'sales') { rect(c, x + (p.face > 0 ? 2.5 : -5.5), y - 6, 3, 2.5, '#5a3a20'); }
  if (p.kind === 'resident' && (seed % 3 === 0)) { rect(c, x - 2.5, y - 6, 5, 2, '#d1495b'); } // skirt-ish band variant
  // head
  c.fillStyle = SKIN[seed % SKIN.length];
  c.beginPath(); c.arc(x, y - hgt + 1, child ? 1.8 : 2.3, 0, 6.283); c.fill();
  c.fillStyle = HAIR[(seed >> 2) % HAIR.length];
  c.fillRect(x - 2.3, y - hgt - 1.4, 4.6, 1.5);
  if (p.kind === 'vip') { c.fillStyle = '#f6c445'; star(c, x, y - hgt - 6, 3.2); }
  if (p.name) { c.fillStyle = '#f6c445'; c.fillRect(x - 0.7, y - hgt - 5, 1.4, 1.4); }
}

// ------------------------------------------------------------------ sky helpers
const SKY_KEYS = [
  [0, '#060a1c', '#141c3c'], [300, '#0d1430', '#2a2c55'], [360, '#3a3a6e', '#e59b7a'], [420, '#6aa6dd', '#f6d2a8'],
  [540, '#4f9be0', '#cbe6f8'], [900, '#4a95dc', '#d2e8f7'], [1020, '#5a8fd0', '#f1d9b0'], [1110, '#3c3f7a', '#f08a5d'],
  [1170, '#1c2350', '#6e4f7a'], [1260, '#0a1028', '#1d2448'], [1440, '#060a1c', '#141c3c'],
];
function lerpCol(a, b, k) {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const r = ((pa >> 16) & 255) + (((pb >> 16) & 255) - ((pa >> 16) & 255)) * k;
  const gg = ((pa >> 8) & 255) + (((pb >> 8) & 255) - ((pa >> 8) & 255)) * k;
  const bb = (pa & 255) + ((pb & 255) - (pa & 255)) * k;
  return `rgb(${r | 0},${gg | 0},${bb | 0})`;
}
export function skyColors(min, rain) {
  let i = 0;
  while (i < SKY_KEYS.length - 1 && SKY_KEYS[i + 1][0] <= min) i++;
  const a = SKY_KEYS[i], b = SKY_KEYS[Math.min(i + 1, SKY_KEYS.length - 1)];
  const k = b[0] === a[0] ? 0 : (min - a[0]) / (b[0] - a[0]);
  let top = lerpCol(a[1], b[1], k), bot = lerpCol(a[2], b[2], k);
  if (rain) { top = mixGrey(top, 0.55); bot = mixGrey(bot, 0.55); }
  return [top, bot];
}
function mixGrey(rgb, k) {
  const m = rgb.match(/\d+/g).map(Number);
  const gr = (m[0] + m[1] + m[2]) / 3 * 0.8;
  return `rgb(${(m[0] + (gr - m[0]) * k) | 0},${(m[1] + (gr - m[1]) * k) | 0},${(m[2] + (gr - m[2]) * k) | 0})`;
}
export { hash, rect };
