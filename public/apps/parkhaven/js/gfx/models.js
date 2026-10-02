// Parkhaven - procedural models. Every shape here is drawn in code; colours are Parkhaven's own.
import { MB, shade, mix } from './gl.js';
import { DX, DY } from '../world.js';
import { PIECES, pieceSamples, DIRS, rightOf } from '../track.js';
import { STALLS, FLAT_RIDES, TRACK_RIDES, SCENERY } from '../data.js';

export const COL = {
  grass: [0.46, 0.7, 0.36], grass2: [0.42, 0.66, 0.33], wild: [0.5, 0.6, 0.4], dirt: [0.56, 0.43, 0.31],
  sand: [0.82, 0.74, 0.52], bed: [0.45, 0.5, 0.42], water: [0.32, 0.6, 0.85], path: [0.86, 0.8, 0.69],
  kerb: [0.66, 0.6, 0.52], queue: [0.84, 0.6, 0.45], rail: [0.36, 0.28, 0.24], wood: [0.6, 0.42, 0.26],
  trunk: [0.45, 0.32, 0.22], leaf: [0.26, 0.55, 0.3], leaf2: [0.36, 0.62, 0.28], pine: [0.17, 0.42, 0.3],
  stone: [0.72, 0.72, 0.7], white: [0.95, 0.95, 0.93], metal: [0.62, 0.65, 0.7], dark: [0.25, 0.26, 0.3],
  roofA: [0.92, 0.36, 0.34], roofB: [0.98, 0.94, 0.86], gold: [0.95, 0.78, 0.3], fence: [0.55, 0.42, 0.3],
  entr: [0.35, 0.72, 0.45], exit: [0.92, 0.5, 0.36],
};

function hash(x, y) { let h = (x * 374761393 + y * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
const Z = (hu) => hu / 4;

// ------------------------------------------------------------------ terrain & water
export function buildTerrain(mb, w, opts = {}) {
  const N = w.N;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = w.idx(x, y);
    const c = w.corners(x, y);
    const p = [[x, y, Z(c[0])], [x + 1, y, Z(c[1])], [x + 1, y + 1, Z(c[2])], [x, y + 1, Z(c[3])]];
    const h = hash(x, y);
    let col = h < 0.5 ? COL.grass : COL.grass2;
    col = mix(col, [0.52, 0.72, 0.38], hash(x >> 2, y >> 2) * 0.35);
    if (w.wet(x, y)) col = COL.bed;
    else if (Math.max(...c) - Math.min(...c) >= 6) col = mix(col, COL.dirt, 0.45);
    if (w.own[i] !== 1) col = mix(col, COL.wild, w.own[i] === 2 ? 0.25 : 0.5);
    if (!w.usable(x, y)) col = shade(col, 0.85);
    // choose the diagonal that keeps the surface convex-ish
    if (Math.abs(c[0] - c[2]) <= Math.abs(c[1] - c[3])) { mb.tri(p[0], p[1], p[2], col, true); mb.tri(p[0], p[2], p[3], col, true); }
    else { mb.tri(p[0], p[1], p[3], col, true); mb.tri(p[1], p[2], p[3], col, true); }
  }
  // skirts round the map edge
  const base = -0.4;
  const edge = (a, b, n) => mb.quadN([a[0], a[1], base], [b[0], b[1], base], [b[0], b[1], b[2]], [a[0], a[1], a[2]], n, COL.dirt);
  for (let k = 0; k < N; k++) {
    edge([k, 0, Z(w.vh(k, 0))], [k + 1, 0, Z(w.vh(k + 1, 0))], [0, -1, 0]);
    edge([k, N, Z(w.vh(k, N))], [k + 1, N, Z(w.vh(k + 1, N))], [0, 1, 0]);
    edge([0, k, Z(w.vh(0, k))], [0, k + 1, Z(w.vh(0, k + 1))], [-1, 0, 0]);
    edge([N, k, Z(w.vh(N, k))], [N, k + 1, Z(w.vh(N, k + 1))], [1, 0, 0]);
  }
  // park boundary fence (between owned and not-owned tiles)
  for (let y = 1; y < N - 1; y++) for (let x = 1; x < N - 1; x++) {
    if (w.own[w.idx(x, y)] !== 1) continue;
    for (let d = 0; d < 4; d++) {
      const nx = x + DX[d], ny = y + DY[d];
      if (w.own[w.idx(nx, ny)] === 1) continue;
      if (w.ptype[w.idx(nx, ny)] && w.poutside[w.idx(nx, ny)]) continue;
      if (w.gate && Math.abs(x - w.gate.x) <= 1 && y === w.gate.y && d === 1) continue;
      // edge endpoints
      const ex = [[x + 1, y, x + 1, y + 1], [x, y + 1, x + 1, y + 1], [x, y, x, y + 1], [x, y, x + 1, y]][d];
      const za = Z(w.vh(ex[0], ex[1])), zb = Z(w.vh(ex[2], ex[3]));
      const inset = 0.04;
      const ox = -DX[d] * inset, oy = -DY[d] * inset;
      const a = [ex[0] + ox, ex[1] + oy], b = [ex[2] + ox, ex[3] + oy];
      for (const t of [0.1, 0.5, 0.9]) {
        const px = a[0] + (b[0] - a[0]) * t, py = a[1] + (b[1] - a[1]) * t, pz = za + (zb - za) * t;
        mb.box(px - 0.025, py - 0.025, pz, px + 0.025, py + 0.025, pz + 0.22, COL.fence);
      }
      mb.beam([a[0], a[1], za + 0.16], [b[0], b[1], zb + 0.16], 0.03, COL.fence);
      mb.beam([a[0], a[1], za + 0.08], [b[0], b[1], zb + 0.08], 0.025, COL.fence);
    }
  }
}

export function buildWater(mb, w) {
  const N = w.N;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = w.idx(x, y);
    if (!w.water[i] || !w.wet(x, y)) continue;
    const z = Z(w.water[i]) - 0.03;
    const col = mix(COL.water, [0.42, 0.7, 0.9], hash(x, y) * 0.3);
    mb.quadN([x, y, z], [x + 1, y, z], [x + 1, y + 1, z], [x, y + 1, z], [0, 0, 1], col);
  }
}

// ------------------------------------------------------------------ paths
function pathCornerZ(w, i, x, y) {
  const z = w.pz[i], s = w.pslope[i];
  // corners nw ne se sw
  const zz = [z, z, z, z];
  if (s === 0) { zz[1] += 2; zz[2] += 2; }
  if (s === 1) { zz[2] += 2; zz[3] += 2; }
  if (s === 2) { zz[0] += 2; zz[3] += 2; }
  if (s === 3) { zz[0] += 2; zz[1] += 2; }
  void x; void y;
  return zz.map(Z);
}

export function buildPaths(mb, w, game) {
  const N = w.N;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = w.idx(x, y);
    const t = w.ptype[i];
    if (!t) continue;
    const zc = pathCornerZ(w, i, x, y);
    const lift = 0.03;
    const top = zc.map((z) => z + lift);
    const queue = t === 2;
    const col = queue ? COL.queue : w.poutside[i] ? [0.62, 0.62, 0.64] : mix(COL.path, [0.9, 0.84, 0.74], hash(x, y) * 0.5);
    const P = [[x, y, top[0]], [x + 1, y, top[1]], [x + 1, y + 1, top[2]], [x, y + 1, top[3]]];
    mb.quad(P[0], P[1], P[2], P[3], col, true);
    // side faces down to the ground (or slab thickness)
    const gmin = Z(w.groundMin(x, y));
    const sideCol = shade(col, 0.75);
    const sides = [[1, 2, [1, 0, 0]], [2, 3, [0, 1, 0]], [3, 0, [-1, 0, 0]], [0, 1, [0, -1, 0]]];
    for (const [a, b, n] of sides) {
      const lo = Math.min(gmin, top[a] - 0.08);
      mb.quadN([P[a][0], P[a][1], lo], [P[b][0], P[b][1], lo], P[b], P[a], n, sideCol);
    }
    // supports for raised paths
    const hmin = Math.min(...zc);
    if (hmin - gmin > 0.3) {
      mb.box(x + 0.42, y + 0.42, gmin, x + 0.58, y + 0.58, hmin, COL.stone);
    }
    // kerbs / queue rails on unconnected edges
    const conn = queue ? w.qadj[i] : w.adj[i];
    const EDGE = [[1, 2], [3, 2], [0, 3], [0, 1]]; // corner indices per direction e s w n
    for (let d = 0; d < 4; d++) {
      if (conn & (1 << d)) continue;
      const nx = x + DX[d], ny = y + DY[d];
      const j = w.inMap(nx, ny) ? w.idx(nx, ny) : -1;
      // queue tiles also open onto the path at the head and onto the ride entrance
      if (queue && j >= 0 && (w.ptype[j] === 1 || isEntranceTile(game, nx, ny))) continue;
      if (!queue && j >= 0 && w.ptype[j] === 2) continue;
      if (j >= 0 && isGateOrEntrance(game, w, nx, ny)) continue;
      const [ca, cb] = EDGE[d];
      const inx = -DX[d] * 0.06, iny = -DY[d] * 0.06;
      const a = [P[ca][0] + inx, P[ca][1] + iny, P[ca][2]], b = [P[cb][0] + inx, P[cb][1] + iny, P[cb][2]];
      if (queue) {
        for (const tt of [0.12, 0.88]) {
          const px = a[0] + (b[0] - a[0]) * tt, py = a[1] + (b[1] - a[1]) * tt, pz = a[2] + (b[2] - a[2]) * tt;
          mb.box(px - 0.02, py - 0.02, pz, px + 0.02, py + 0.02, pz + 0.2, COL.rail);
        }
        mb.beam([a[0], a[1], a[2] + 0.18], [b[0], b[1], b[2] + 0.18], 0.03, COL.rail);
      } else {
        mb.beam([a[0], a[1], a[2] + 0.02], [b[0], b[1], b[2] + 0.02], 0.07, COL.kerb);
      }
    }
    // furniture
    const ad = w.paddon[i];
    if (ad) addonModel(mb, x, y, top, ad, w.pbroken[i], w.pbin[i], w.adj[i]);
  }
}

function isEntranceTile(game, x, y) {
  if (!game) return false;
  for (const e of game.w.occAt(x, y)) if (e.k === 'entrance' || e.k === 'exit' || e.k === 'stall') return true;
  return false;
}
function isGateOrEntrance(game, w, x, y) {
  for (const e of w.occAt(x, y)) if (e.k === 'entrance' || e.k === 'exit' || e.k === 'stall' || e.k === 'gate') return true;
  return false;
}

function addonModel(mb, x, y, top, kind, broken, fill, adj) {
  const z = Math.max(...top) - 0.0;
  // place furniture on an unconnected edge if there is one, else a corner
  let d = 3;
  for (let k = 0; k < 4; k++) if (!(adj & (1 << k))) { d = k; break; }
  const cx = x + 0.5 + DX[d] * 0.36, cy = y + 0.5 + DY[d] * 0.36;
  const yaw = d & 1 ? 0 : Math.PI / 2;
  if (kind === 1) {
    const c = broken ? shade(COL.wood, 0.55) : COL.wood;
    mb.rbox(cx, cy, z + 0.08, 0.22, 0.06, z + 0.11, yaw, c);
    if (!broken) mb.rbox(cx + DX[d] * 0.05, cy + DY[d] * 0.05, z + 0.11, d & 1 ? 0.22 : 0.015, d & 1 ? 0.015 : 0.22, z + 0.2, 0, c);
    mb.rbox(cx, cy, z, 0.18, 0.04, z + 0.08, yaw, COL.dark);
  } else if (kind === 2) {
    const c = broken ? [0.4, 0.4, 0.4] : [0.25, 0.55, 0.35];
    if (broken) mb.rbox(cx, cy, z, 0.12, 0.06, z + 0.08, 0.6, c);
    else { mb.cyl(cx, cy, z, z + 0.2, 0.07, 8, c, fill >= 24 ? [0.8, 0.6, 0.3] : shade(c, 0.8)); }
  } else if (kind === 3) {
    mb.box(cx - 0.02, cy - 0.02, z, cx + 0.02, cy + 0.02, z + (broken ? 0.18 : 0.55), COL.dark);
    if (!broken) mb.blob(cx, cy, z + 0.58, 0.06, 0.06, 0.06, [1.0, 0.93, 0.6], 6);
  }
}

// ------------------------------------------------------------------ scenery
export function buildScenery(mb, w) {
  const N = w.N;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = w.idx(x, y);
    const s = w.scen[i];
    if (!s) continue;
    sceneryModel(mb, s, x, y, Z(w.groundMax(x, y)), w.scenRot[i], hash(x, y));
  }
}

export function sceneryModel(mb, s, x, y, z, rot, h) {
  const cx = x + 0.5 + (h - 0.5) * 0.25, cy = y + 0.5 + (hash(y, x) - 0.5) * 0.25;
  const key = SCENERY[s]?.key;
  const sc = 0.85 + h * 0.35;
  if (key === 'pine') {
    mb.cyl(cx, cy, z, z + 0.35 * sc, 0.06, 5, COL.trunk);
    mb.cone(cx, cy, z + 0.25 * sc, z + 1.2 * sc, 0.38 * sc, 7, COL.pine);
    mb.cone(cx, cy, z + 0.75 * sc, z + 1.75 * sc, 0.28 * sc, 7, shade(COL.pine, 1.12));
  } else if (key === 'oak') {
    mb.cyl(cx, cy, z, z + 0.6 * sc, 0.07, 5, COL.trunk);
    mb.blob(cx, cy, z + 0.95 * sc, 0.42 * sc, 0.42 * sc, 0.4 * sc, mix(COL.leaf, COL.leaf2, h), 7);
    mb.blob(cx + 0.15, cy - 0.1, z + 1.2 * sc, 0.25 * sc, 0.25 * sc, 0.24 * sc, shade(COL.leaf2, 1.08), 6);
  } else if (key === 'birch') {
    mb.cyl(cx, cy, z, z + 1.0 * sc, 0.045, 5, [0.9, 0.88, 0.82]);
    mb.blob(cx, cy, z + 1.1 * sc, 0.24 * sc, 0.24 * sc, 0.42 * sc, [0.55, 0.72, 0.3], 6);
  } else if (key === 'bush') {
    mb.blob(cx, cy, z + 0.16, 0.3, 0.26, 0.2, mix(COL.leaf, [0.3, 0.5, 0.25], h), 6);
  } else if (key === 'flowers') {
    mb.box(x + 0.15, y + 0.15, z, x + 0.85, y + 0.85, z + 0.08, [0.45, 0.33, 0.24]);
    const fc = [[0.95, 0.4, 0.5], [0.98, 0.85, 0.3], [0.7, 0.45, 0.9], [1, 1, 1]];
    for (let k = 0; k < 9; k++) {
      const fx = x + 0.25 + (k % 3) * 0.25, fy = y + 0.25 + Math.floor(k / 3) * 0.25;
      mb.blob(fx, fy, z + 0.12, 0.07, 0.07, 0.05, fc[(k + Math.floor(h * 4)) % 4], 5);
    }
  } else if (key === 'fountain') {
    mb.cyl(x + 0.5, y + 0.5, z, z + 0.15, 0.42, 10, COL.stone, [0.45, 0.7, 0.92]);
    mb.cyl(x + 0.5, y + 0.5, z, z + 0.45, 0.06, 6, COL.stone);
    mb.cone(x + 0.5, y + 0.5, z + 0.4, z + 0.85, 0.12, 6, [0.7, 0.88, 1.0]);
  } else if (key === 'statue') {
    mb.box(x + 0.32, y + 0.32, z, x + 0.68, y + 0.68, z + 0.25, COL.stone);
    const c = [0.55, 0.62, 0.7];
    mb.box(x + 0.46, y + 0.48, z + 0.25, x + 0.48, y + 0.5, z + 0.6, c);
    mb.box(x + 0.52, y + 0.48, z + 0.25, x + 0.54, y + 0.5, z + 0.6, c);
    mb.blob(x + 0.5, y + 0.5, z + 0.7, 0.16, 0.08, 0.1, c, 6);
    mb.beam([x + 0.6, y + 0.5, z + 0.72], [x + 0.66, y + 0.5, z + 1.0], 0.035, c);
    mb.beam([x + 0.66, y + 0.5, z + 1.0], [x + 0.8, y + 0.5, z + 0.97], 0.03, COL.gold);
  } else if (key === 'rock') {
    mb.blob(cx, cy, z + 0.12, 0.32, 0.26, 0.24, mix([0.6, 0.58, 0.55], [0.7, 0.66, 0.6], h), 5);
  }
  void rot;
}

// ------------------------------------------------------------------ park gate
export function buildGate(mb, w, open) {
  const g = w.gate;
  if (!g) return;
  const z = Z(w.groundMax(g.x, g.y));
  const tower = (tx) => {
    const cx = tx + 0.5, cy = g.y + 0.5;
    mb.box(cx - 0.35, cy - 0.35, z, cx + 0.35, cy + 0.35, z + 1.4, [0.95, 0.9, 0.8]);
    mb.box(cx - 0.4, cy - 0.4, z + 1.4, cx + 0.4, cy + 0.4, z + 1.5, [0.5, 0.36, 0.55]);
    mb.cone(cx, cy, z + 1.5, z + 2.3, 0.45, 4, [0.55, 0.38, 0.62]);
    mb.box(cx - 0.012, cy - 0.012, z + 2.2, cx + 0.012, cy + 0.012, z + 2.75, COL.dark);
    mb.quadN([cx, cy, z + 2.75], [cx + 0.35, cy, z + 2.65], [cx + 0.35, cy, z + 2.5], [cx, cy, z + 2.6], [0, 1, 0], [0.98, 0.75, 0.25]);
    for (let k = 0; k < 3; k++) mb.box(cx - 0.36, cy - 0.15 + k * 0.1, z + 0.5 + k * 0.3, cx - 0.34, cy - 0.1 + k * 0.1, z + 0.7 + k * 0.3, [0.4, 0.55, 0.7]);
  };
  tower(g.x - 1); tower(g.x + 1);
  // arch and sign
  mb.box(g.x - 0.2, g.y + 0.38, z + 1.15, g.x + 1.2, g.y + 0.62, z + 1.4, [0.5, 0.36, 0.55]);
  mb.box(g.x + 0.05, g.y + 0.44, z + 1.4, g.x + 0.95, g.y + 0.56, z + 1.75, [0.98, 0.9, 0.6]);
  mb.box(g.x + 0.1, g.y + 0.43, z + 1.47, g.x + 0.9, g.y + 0.57, z + 1.68, [0.42, 0.62, 0.42]);
  if (!open) mb.box(g.x, g.y + 0.47, z + 0.3, g.x + 1, g.y + 0.53, z + 0.38, [0.9, 0.3, 0.3]);
}

// ------------------------------------------------------------------ ride entrances, stalls
export function entranceModel(mb, e, isExit, col) {
  const z = Z(e.z);
  const cx = e.x + 0.5, cy = e.y + 0.5;
  const d = e.dir;
  const sx = d & 1 ? 1 : 0, sy = d & 1 ? 0 : 1; // across the doorway
  const c = isExit ? COL.exit : COL.entr;
  mb.box(e.x + 0.05, e.y + 0.05, z, e.x + 0.95, e.y + 0.95, z + 0.05, COL.path);
  for (const k of [-1, 1]) {
    const px = cx + sx * 0.38 * k, py = cy + sy * 0.38 * k;
    mb.box(px - 0.06, py - 0.06, z, px + 0.06, py + 0.06, z + 0.75, c);
  }
  mb.box(cx - sx * 0.46 - sy * 0.12, cy - sy * 0.46 - sx * 0.12, z + 0.75, cx + sx * 0.46 + sy * 0.12, cy + sy * 0.46 + sx * 0.12, z + 0.92, col || c, shade(col || c, 1.1));
  // a small arrow tile on the floor showing which way guests go
  const ax = DX[d] * (isExit ? 1 : -1), ay = DY[d] * (isExit ? 1 : -1);
  mb.tri([cx + ax * 0.25, cy + ay * 0.25, z + 0.06], [cx - ay * 0.15, cy + ax * 0.15, z + 0.06], [cx + ay * 0.15, cy - ax * 0.15, z + 0.06], shade(c, 0.9), true);
}

export function stallModel(mb, r, ghost = false) {
  const d = STALLS[r.type];
  const z = Z(r.z);
  const cx = r.x + 0.5, cy = r.y + 0.5;
  const c = d.color;
  const f = r.dir;
  const fx = DX[f], fy = DY[f];
  mb.box(r.x + 0.12, r.y + 0.12, z, r.x + 0.88, r.y + 0.88, z + 0.62, [0.96, 0.93, 0.86]);
  // counter on the facing side
  mb.box(cx + fx * 0.38 - (fy ? 0.36 : 0.05), cy + fy * 0.38 - (fx ? 0.36 : 0.05), z + 0.25, cx + fx * 0.38 + (fy ? 0.36 : 0.05), cy + fy * 0.38 + (fx ? 0.36 : 0.05), z + 0.34, c);
  // window opening (dark)
  mb.box(cx + fx * 0.385 - (fy ? 0.28 : 0.01), cy + fy * 0.385 - (fx ? 0.28 : 0.01), z + 0.36, cx + fx * 0.385 + (fy ? 0.28 : 0.01), cy + fy * 0.385 + (fx ? 0.28 : 0.01), z + 0.58, [0.3, 0.25, 0.25]);
  // striped awning roof
  const zr = z + 0.62, zt = z + 0.98;
  const corners = [[r.x + 0.04, r.y + 0.04], [r.x + 0.96, r.y + 0.04], [r.x + 0.96, r.y + 0.96], [r.x + 0.04, r.y + 0.96]];
  const top = [cx, cy, zt];
  for (let k = 0; k < 4; k++) {
    const a = corners[k], b = corners[(k + 1) & 3];
    for (let s = 0; s < 4; s++) {
      const t0 = s / 4, t1 = (s + 1) / 4;
      const p = [a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0, zr];
      const q = [a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1, zr];
      mb.tri(p, q, top, s & 1 ? COL.roofB : c, true);
    }
  }
  iconModel(mb, d.icon, cx, cy, zt, c);
  void ghost;
}

function iconModel(mb, icon, cx, cy, z, c) {
  if (icon === 'pie') { mb.cyl(cx, cy, z, z + 0.08, 0.13, 8, [0.85, 0.6, 0.3], [0.9, 0.7, 0.4]); mb.blob(cx, cy, z + 0.1, 0.11, 0.11, 0.05, [0.95, 0.75, 0.45], 6); }
  else if (icon === 'drink') { mb.cyl(cx, cy, z, z + 0.25, 0.07, 8, [0.98, 0.9, 0.4], [0.98, 0.95, 0.7], 0.09); mb.box(cx + 0.02, cy - 0.01, z + 0.2, cx + 0.04, cy + 0.01, z + 0.38, [0.9, 0.3, 0.3]); }
  else if (icon === 'wc') { mb.box(cx - 0.1, cy - 0.1, z, cx + 0.1, cy + 0.1, z + 0.22, [0.35, 0.6, 0.85]); }
  else if (icon === 'info') { mb.blob(cx, cy, z + 0.14, 0.12, 0.12, 0.12, [0.3, 0.7, 0.62], 6); mb.box(cx - 0.02, cy - 0.02, z + 0.27, cx + 0.02, cy + 0.02, z + 0.36, COL.white); }
  else if (icon === 'gift') { mb.box(cx - 0.11, cy - 0.11, z, cx + 0.11, cy + 0.11, z + 0.2, [0.8, 0.4, 0.7]); mb.box(cx - 0.02, cy - 0.12, z, cx + 0.02, cy + 0.12, z + 0.21, COL.gold); }
  else if (icon === 'aid') { mb.box(cx - 0.12, cy - 0.035, z + 0.06, cx + 0.12, cy + 0.035, z + 0.13, [0.9, 0.2, 0.2]); mb.box(cx - 0.035, cy - 0.12, z + 0.06, cx + 0.035, cy + 0.12, z + 0.13, [0.9, 0.2, 0.2]); }
  else if (icon === 'pretzel') { mb.cyl(cx, cy, z, z + 0.06, 0.14, 10, [0.7, 0.45, 0.2], [0.75, 0.5, 0.25]); }
  else if (icon === 'cash') { mb.box(cx - 0.12, cy - 0.06, z, cx + 0.12, cy + 0.06, z + 0.14, [0.35, 0.7, 0.4]); }
  else mb.blob(cx, cy, z + 0.1, 0.1, 0.1, 0.1, c, 6);
}

// ------------------------------------------------------------------ flat rides: static parts
export function flatRideCentre(r) {
  const d = FLAT_RIDES[r.type];
  const W = r.rot & 1 ? d.l : d.w, L = r.rot & 1 ? d.w : d.l;
  return { cx: r.x + W / 2, cy: r.y + L / 2, W, L };
}

export function flatStatic(mb, r, w) {
  const { cx, cy, W, L } = flatRideCentre(r);
  const z = Z(r.z);
  const d = FLAT_RIDES[r.type];
  // plinth down to the ground
  const gmin = Math.min(...[[r.x, r.y], [r.x + W - 1, r.y + L - 1]].map(([x, y]) => Z(w.groundMin(x, y))));
  if (r.type === 'carousel' || r.type === 'cups') {
    mb.cyl(cx, cy, Math.min(gmin, z) - 0.05, z + 0.12, 1.42, 16, [0.88, 0.84, 0.78], [0.93, 0.9, 0.84]);
    mb.cyl(cx, cy, z + 0.12, z + 0.14, 1.3, 16, shade(d.color, 0.9), d.color);
  } else if (r.type === 'ship') {
    mb.box(r.x + 0.1, r.y + 0.1, Math.min(gmin, z) - 0.05, r.x + W - 0.1, r.y + L - 0.1, z + 0.06, [0.85, 0.82, 0.76]);
    const along = L > W; // long axis along y?
    const pivot = z + 2.3;
    const ends = along ? [[cx, r.y + 0.6], [cx, r.y + L - 0.6]] : [[r.x + 0.6, cy], [r.x + W - 0.6, cy]];
    for (const [ex, ey] of ends) {
      const sx = along ? 1 : 0, sy = along ? 0 : 1;
      mb.beam([ex - sx * 1.1, ey - sy * 1.1, z], [ex, ey, pivot], 0.12, [0.45, 0.4, 0.5]);
      mb.beam([ex + sx * 1.1, ey + sy * 1.1, z], [ex, ey, pivot], 0.12, [0.45, 0.4, 0.5]);
    }
    mb.beam([ends[0][0], ends[0][1], pivot], [ends[1][0], ends[1][1], pivot], 0.1, COL.metal);
  } else {
    mb.box(r.x + 0.15, r.y + 0.15, Math.min(gmin, z) - 0.05, r.x + W - 0.15, r.y + L - 0.15, z + 0.12, [0.86, 0.83, 0.78], [0.8, 0.82, 0.86]);
    const H = Z(d.sections * 4) + 0.6;
    const tw = r.type === 'droptower' ? 0.32 : 0.22;
    const col = r.type === 'droptower' ? [0.92, 0.92, 0.95] : [0.85, 0.9, 0.95];
    const segs = Math.ceil(H / 0.5);
    for (let k = 0; k < segs; k++) {
      const c2 = k & 1 ? col : shade(d.color, 1.0);
      mb.box(cx - tw, cy - tw, z + k * (H / segs), cx + tw, cy + tw, z + (k + 1) * (H / segs), c2);
    }
    mb.cone(cx, cy, z + H, z + H + 0.5, tw * 1.4, 6, d.color);
  }
}

// ------------------------------------------------------------------ tracks
const TRACK_STYLE = {
  coaster: { gauge: 0.17, rail: 0.05, tie: [0.35, 0.35, 0.38], spine: 0.09 },
  karts: { gauge: 0.38, rail: 0.06, tie: [0.3, 0.3, 0.32], spine: 0 },
  flume: { gauge: 0.32, rail: 0.07, tie: [0.6, 0.45, 0.3], spine: 0 },
};

/** Build the mesh for one track piece; colours from the ride. */
export function trackPieceModel(mb, type, pc, col, w, ghost = false) {
  const P = PIECES[pc.pid];
  const st = TRACK_STYLE[type];
  const s = pieceSamples(pc.pid, pc, Math.max(6, Math.ceil(P.L * 2.2)));
  const frames = [];
  for (let k = 0; k < s.length; k++) {
    const a = s[Math.max(0, k - 1)], b = s[Math.min(s.length - 1, k + 1)];
    let tx = b.x - a.x, ty = b.y - a.y, tz = (b.z - a.z) / 4;
    const l = Math.hypot(tx, ty, tz) || 1; tx /= l; ty /= l; tz /= l;
    let rx, ry;
    if (P.loop) { const r = DIRS[rightOf(pc.dir)]; rx = r[0]; ry = r[1]; }
    else { const h = Math.hypot(tx, ty) || 1; rx = -ty / h; ry = tx / h; }
    let ux = ty * 0 - tz * ry, uy = tz * rx - tx * 0, uz = tx * ry - ty * rx;
    const ul = Math.hypot(ux, uy, uz) || 1; ux /= ul; uy /= ul; uz /= ul;
    // recompute right = up x T so the frame is orthonormal
    let Rx = uy * tz - uz * ty, Ry = uz * tx - ux * tz, Rz = ux * ty - uy * tx;
    const bank = s[k].bank || 0;
    if (bank) {
      const c = Math.cos(bank), sn = Math.sin(bank);
      const nux = ux * c + Rx * sn, nuy = uy * c + Ry * sn, nuz = uz * c + Rz * sn;
      Rx = Rx * c - ux * sn; Ry = Ry * c - uy * sn; Rz = Rz * c - uz * sn;
      ux = nux; uy = nuy; uz = nuz;
    }
    frames.push({ p: [s[k].x, s[k].y, s[k].z / 4], T: [tx, ty, tz], R: [Rx, Ry, Rz], U: [ux, uy, uz] });
  }
  const off = (f, a, b) => [f.p[0] + f.R[0] * a + f.U[0] * b, f.p[1] + f.R[1] * a + f.U[1] * b, f.p[2] + f.R[2] * a + f.U[2] * b];
  const railCol = ghost ? col : col;
  if (type === 'coaster') {
    for (let k = 0; k < frames.length - 1; k++) {
      const f = frames[k], g = frames[k + 1];
      for (const sd of [-1, 1]) mb.beam(off(f, sd * st.gauge, 0.06), off(g, sd * st.gauge, 0.06), st.rail, railCol, f.U);
      mb.beam(off(f, 0, -0.03), off(g, 0, -0.03), st.spine, shade(railCol, 0.75), f.U);
      if (P.station) {
        for (const sd of [-1, 1]) {
          const a = off(f, sd * 0.42, 0.04), b = off(g, sd * 0.42, 0.04);
          mb.beam(a, b, 0.24, [0.82, 0.78, 0.72], [0, 0, 1]);
        }
      }
      if (pc.lift) mb.beam(off(f, 0, 0.035), off(g, 0, 0.035), 0.04, [0.15, 0.15, 0.15], f.U);
      if (P.brakes) mb.beam(off(f, 0, 0.07), off(g, 0, 0.07), 0.05, [0.95, 0.8, 0.2], f.U);
    }
    for (let k = 0; k < frames.length; k += 1) {
      const f = frames[k];
      mb.beam(off(f, -st.gauge, 0.02), off(f, st.gauge, 0.02), 0.03, st.tie, f.T);
    }
    if (P.station) {
      // canopy
      const f0 = frames[0], f1 = frames[frames.length - 1];
      const zr = Math.max(f0.p[2], f1.p[2]) + 0.95;
      for (const fr of [f0, f1]) for (const sd of [-1, 1]) { const b = off(fr, sd * 0.55, 0); mb.box(b[0] - 0.03, b[1] - 0.03, b[2], b[0] + 0.03, b[1] + 0.03, zr, COL.white); }
      const a0 = off(f0, -0.62, 0), a1 = off(f0, 0.62, 0), b0 = off(f1, -0.62, 0), b1 = off(f1, 0.62, 0);
      mb.quad([a0[0], a0[1], zr], [a1[0], a1[1], zr], [b1[0], b1[1], zr], [b0[0], b0[1], zr], shade(col, 1.1), true);
    }
  } else if (type === 'karts') {
    for (let k = 0; k < frames.length - 1; k++) {
      const f = frames[k], g = frames[k + 1];
      const A = off(f, -st.gauge, 0), B = off(f, st.gauge, 0), C = off(g, st.gauge, 0), D = off(g, -st.gauge, 0);
      mb.quad(A, B, C, D, P.station ? [0.5, 0.5, 0.55] : [0.32, 0.32, 0.35], true);
      for (const sd of [-1, 1]) mb.beam(off(f, sd * (st.gauge + 0.03), 0.02), off(g, sd * (st.gauge + 0.03), 0.02), 0.06, k & 1 ? [0.92, 0.25, 0.25] : COL.white, f.U);
      // white centre dashes
      if (!(k & 1)) mb.beam(off(f, 0, 0.005), off(g, 0, 0.005), 0.025, [0.95, 0.95, 0.9], f.U);
    }
  } else {
    for (let k = 0; k < frames.length - 1; k++) {
      const f = frames[k], g = frames[k + 1];
      const A = off(f, -st.gauge, 0), B = off(f, st.gauge, 0), C = off(g, st.gauge, 0), D = off(g, -st.gauge, 0);
      mb.quad(A, B, C, D, [0.55, 0.42, 0.3], true);
      const wA = off(f, -st.gauge + 0.04, 0.05), wB = off(f, st.gauge - 0.04, 0.05), wC = off(g, st.gauge - 0.04, 0.05), wD = off(g, -st.gauge + 0.04, 0.05);
      mb.quad(wA, wB, wC, wD, [0.4, 0.68, 0.92], true);
      for (const sd of [-1, 1]) {
        const a = off(f, sd * st.gauge, 0), b = off(g, sd * st.gauge, 0), a2 = off(f, sd * st.gauge, 0.18), b2 = off(g, sd * st.gauge, 0.18);
        mb.quad(a, b, b2, a2, [0.62, 0.48, 0.32], false);
      }
      if (P.fromSlope > 0 || P.toSlope > 0) mb.beam(off(f, 0, 0.06), off(g, 0, 0.06), 0.05, [0.3, 0.3, 0.3], f.U);
    }
  }
  // supports
  if (w) {
    const seen = new Set();
    for (let k = 0; k < frames.length; k += Math.max(1, Math.floor(frames.length / Math.max(1, Math.round(P.L / 4.25))))) {
      const f = frames[k];
      if (f.U[2] < 0.3) continue; // inverted / near-vertical sections hang from the loop itself
      const tx = Math.floor(f.p[0]), ty = Math.floor(f.p[1]);
      const key = tx + ',' + ty;
      if (seen.has(key)) continue;
      seen.add(key);
      if (!w.inMap(tx, ty)) continue;
      const g = Z(Math.max(w.groundMin(tx, ty), w.water[w.idx(tx, ty)]));
      const bottom = f.p[2] - 0.08;
      if (bottom - g < 0.15) continue;
      mb.box(f.p[0] - 0.05, f.p[1] - 0.05, g, f.p[0] + 0.05, f.p[1] + 0.05, bottom, type === 'flume' ? [0.5, 0.38, 0.26] : [0.9, 0.9, 0.92]);
    }
  }
}

// ------------------------------------------------------------------ dynamic models (built once)
export function personMesh() {
  // parts in colour.r: 0 shirt, 1 legs (g = side), 2 skin, 3 hair, 4 umbrella
  const mb = new MB(2048);
  const P = (p, s = 0.5) => [p, s, 0];
  mb.box(-0.035, -0.06, 0.0, 0.035, -0.01, 0.2, P(1, 0));
  mb.box(-0.035, 0.01, 0.0, 0.035, 0.06, 0.2, P(1, 1));
  mb.box(-0.05, -0.075, 0.2, 0.05, 0.075, 0.4, P(0));
  mb.box(-0.025, -0.1, 0.24, 0.025, -0.075, 0.39, P(2));
  mb.box(-0.025, 0.075, 0.24, 0.025, 0.1, 0.39, P(2));
  mb.blob(0, 0, 0.47, 0.065, 0.065, 0.075, P(2), 6);
  mb.blob(-0.01, 0, 0.51, 0.068, 0.068, 0.045, P(3), 6);
  mb.box(-0.006, -0.006, 0.38, 0.006, 0.006, 0.66, P(4));
  mb.cone(0, 0, 0.6, 0.72, 0.2, 8, P(4));
  return mb.data().slice();
}

export function litterMesh() {
  const mb = new MB(256);
  mb.box(-0.04, -0.03, 0, 0.04, 0.03, 0.035, [0, 0, 0]);
  return mb.data().slice();
}

export function coasterCarMesh(col, type) {
  const mb = new MB(1024);
  if (type === 'karts') {
    mb.box(-0.22, -0.13, 0.04, 0.22, 0.13, 0.12, col);
    mb.box(-0.12, -0.09, 0.12, 0.04, 0.09, 0.2, shade(col, 0.7));
    for (const [x, y] of [[-0.15, -0.14], [0.15, -0.14], [-0.15, 0.14], [0.15, 0.14]]) mb.box(x - 0.05, y - 0.03, 0.0, x + 0.05, y + 0.03, 0.09, [0.1, 0.1, 0.1]);
  } else if (type === 'flume') {
    mb.box(-0.32, -0.17, 0.02, 0.32, 0.17, 0.2, [0.62, 0.42, 0.25]);
    mb.box(-0.26, -0.12, 0.12, 0.26, 0.12, 0.21, [0.45, 0.3, 0.18]);
    mb.box(0.28, -0.1, 0.1, 0.38, 0.1, 0.22, [0.55, 0.36, 0.22]);
  } else {
    mb.box(-0.26, -0.2, 0.06, 0.26, 0.2, 0.2, col);
    mb.box(-0.2, -0.17, 0.2, 0.2, 0.17, 0.24, shade(col, 0.6));
    mb.box(0.18, -0.2, 0.1, 0.3, 0.2, 0.28, shade(col, 1.15));
    mb.box(-0.26, -0.2, 0.0, 0.26, 0.2, 0.06, [0.3, 0.3, 0.32]);
  }
  return mb.data().slice();
}

export function riderHeadsMesh(type) {
  const mb = new MB(512);
  const seats = type === 'karts' ? [[-0.05, 0]] : type === 'flume' ? [[-0.12, 0], [0.12, 0]] : [[-0.1, -0.09], [-0.1, 0.09], [0.08, -0.09], [0.08, 0.09]];
  for (const [x, y] of seats) {
    mb.box(x - 0.04, y - 0.045, 0.2, x + 0.04, y + 0.045, 0.33, [0.4, 0.5, 0.75]);
    mb.blob(x, y, 0.38, 0.045, 0.045, 0.05, [0.96, 0.78, 0.62], 5);
  }
  return mb.data().slice();
}

export { TRACK_RIDES };
