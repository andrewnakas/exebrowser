// Parkhaven - staff: handymen, mechanics, security guards and entertainers (spec section 10).
import { DX, DY } from './world.js';
import { STAFF, FIRST_NAMES } from './data.js';
import { mechanicDone } from './rides.js';

const SPEED = 0.016; // staff walk at 96 on the 32..128 energy scale

export function hireStaff(game, type) {
  const w = game.w;
  const g = w.gate;
  const id = game.nextStaffId++;
  const s = {
    id, type, name: `${STAFF[type].name} ${FIRST_NAMES[game.rng.rand(FIRST_NAMES.length)]}`,
    tx: g.x, ty: g.y, nx: g.x, ny: g.y, px: g.x, py: g.y + 1, prog: 0, x: g.x + 0.5, y: g.y + 0.5, z: w.centreZ(w.idx(g.x, g.y)),
    dir: 3, task: null, workT: 0, anim: null, stats: {},
    duties: type === 'handyman' ? { sweep: true, bins: true } : type === 'mechanic' ? { fix: true, inspect: true } : {},
  };
  game.staff.push(s);
  return s;
}

export function fireStaff(game, s) {
  if (s.task) { const r = game.ride(s.task.ride); if (r) r.mechanic = null; }
  game.staff = game.staff.filter((x) => x !== s);
}

/** Drop a staff member onto a path tile (pick up & place). */
export function placeStaff(game, s, x, y) {
  const w = game.w;
  if (!w.inMap(x, y) || w.ptype[w.idx(x, y)] !== 1 || w.poutside[w.idx(x, y)]) return false;
  s.tx = s.nx = s.px = x; s.ty = s.ny = s.py = y; s.prog = 0; s.workT = 0; s.anim = null;
  if (s.task) { const r = game.ride(s.task.ride); if (r) r.mechanic = null; s.task = null; }
  pos(game, s);
  return true;
}

export function staffTick(game, s) {
  if (s.workT > 0) {
    s.workT--;
    if (s.workT === 0) finishWork(game, s);
    return;
  }
  s.prog += SPEED * (game.w.pslope[game.w.idx(s.tx, s.ty)] >= 0 ? 0.6 : 1);
  if (s.prog >= 1) {
    s.px = s.tx; s.py = s.ty; s.tx = s.nx; s.ty = s.ny; s.prog = 0;
    arrive(game, s);
  }
  pos(game, s);
}

function pos(game, s) {
  const w = game.w;
  const i0 = w.idx(s.tx, s.ty), i1 = w.idx(s.nx, s.ny);
  const z0 = w.ptype[i0] ? w.centreZ(i0) : w.groundMax(s.tx, s.ty);
  const z1 = w.ptype[i1] ? w.centreZ(i1) : z0;
  const dx = s.nx - s.tx, dy = s.ny - s.ty;
  if (dx || dy) s.dir = dx === 1 ? 0 : dy === 1 ? 1 : dx === -1 ? 2 : 3;
  s.x = s.tx + 0.5 + dx * s.prog; s.y = s.ty + 0.5 + dy * s.prog; s.z = z0 + (z1 - z0) * s.prog;
}

function arrive(game, s) {
  const w = game.w;
  const i = w.idx(s.tx, s.ty);
  if (w.ptype[i] !== 1) { placeStaff(game, s, w.gate.x, w.gate.y); return; }
  if (s.type === 'handyman') {
    if (s.duties.sweep && (game.litterN[i] || game.vomitN[i])) { s.workT = 50; s.anim = 'sweep'; s.nx = s.tx; s.ny = s.ty; return; }
    if (s.duties.bins && w.paddon[i] === 2 && w.pbin[i] > 0) { s.workT = 50; s.anim = 'bin'; s.nx = s.tx; s.ny = s.ty; return; }
    if (w.paddon[i] && w.pbroken[i]) { s.workT = 80; s.anim = 'mend'; s.nx = s.tx; s.ny = s.ty; return; }
    if (s.duties.sweep && game.rng.rand(10) < 9) {
      const d = nearestLitterDir(game, s);
      if (d >= 0) { s.nx = s.tx + DX[d]; s.ny = s.ty + DY[d]; return; }
    }
    wander(game, s);
    return;
  }
  if (s.type === 'mechanic') {
    if (s.task) {
      const r = game.ride(s.task.ride);
      if (!r || (s.task.kind === 'fix' && !r.broken)) { if (r) r.mechanic = null; s.task = null; wander(game, s); return; }
      const f = game.rideExitField(r);
      const fa = f[i] >= 0 ? f : game.rideField(r);
      if (fa[i] === 0) {
        s.workT = s.task.kind === 'fix' ? 240 : 320; s.anim = 'fix'; s.nx = s.tx; s.ny = s.ty;
        game.emit({ type: 'fixing', x: s.x, y: s.y });
        return;
      }
      if (fa[i] < 0) { s.lost = (s.lost || 0) + 1; if (s.lost > 300) { r.mechanic = null; s.task = null; s.lost = 0; } wander(game, s); return; }
      s.lost = 0;
      if (step(game, s, fa)) return;
    }
    wander(game, s);
    return;
  }
  if (s.type === 'entertainer' && game.rng.rand(4) === 0) {
    s.workT = 80; s.anim = 'perform'; s.nx = s.tx; s.ny = s.ty;
    let n = 0;
    for (const g of game.guests) {
      if (!g.inPark || Math.abs(g.tx - s.tx) > 3 || Math.abs(g.ty - s.ty) > 3) continue;
      if (Math.abs((g.z || 0) - s.z) > 4) continue;
      if (g.state === 'walking') { g.happyT = Math.min(255, g.happyT + 4); n++; }
      else if (g.state === 'queuing') { g.happyT = Math.min(255, g.happyT + 3); g.qTime = Math.max(0, g.qTime - 200); n++; }
    }
    s.stats.entertained = (s.stats.entertained || 0) + n;
    return;
  }
  wander(game, s);
}

function finishWork(game, s) {
  const w = game.w;
  const i = w.idx(s.tx, s.ty);
  if (s.anim === 'sweep') {
    const tx = s.tx, ty = s.ty;
    const k = game.litter.findIndex((l) => Math.floor(l.x) === tx && Math.floor(l.y) === ty);
    if (k >= 0) {
      const l = game.litter[k];
      game.litter.splice(k, 1);
      if (l.t >= 4) game.vomitN[i] = Math.max(0, game.vomitN[i] - 1); else game.litterN[i] = Math.max(0, game.litterN[i] - 1);
      s.stats.swept = (s.stats.swept || 0) + 1;
    } else { game.litterN[i] = 0; game.vomitN[i] = 0; }
    if (game.litterN[i] || game.vomitN[i]) { s.workT = 50; return; }
  } else if (s.anim === 'bin') {
    w.pbin[i] = 0; s.stats.emptied = (s.stats.emptied || 0) + 1;
    // [D] handymen also mend broken path furniture they work beside
  } else if (s.anim === 'fix' && s.task) {
    const r = game.ride(s.task.ride);
    if (r) mechanicDone(game, s, r, s.task.kind);
    s.task = null;
  }
  if (s.type === 'handyman' && w.pbroken[i]) { w.pbroken[i] = 0; w.version++; s.stats.repaired = (s.stats.repaired || 0) + 1; }
  s.anim = null;
  wander(game, s);
}

function step(game, s, f) {
  const w = game.w, N = w.N;
  const i = w.idx(s.tx, s.ty);
  const a = w.adj[i];
  let best = -1, bd = 1e9;
  for (let d = 0; d < 4; d++) {
    if (!(a & (1 << d))) continue;
    const j = i + DX[d] + DY[d] * N;
    if (w.poutside[j] || f[j] < 0) continue;
    if (f[j] < bd || (f[j] === bd && game.rng.rand(2))) { bd = f[j]; best = d; }
  }
  if (best < 0) return false;
  s.nx = s.tx + DX[best]; s.ny = s.ty + DY[best];
  return true;
}

function wander(game, s) {
  const w = game.w, N = w.N;
  const i = w.idx(s.tx, s.ty);
  const a = w.adj[i];
  const opts = [];
  let back = -1;
  for (let d = 0; d < 4; d++) {
    if (!(a & (1 << d))) continue;
    const j = i + DX[d] + DY[d] * N;
    if (w.poutside[j]) continue;
    if (s.tx + DX[d] === s.px && s.ty + DY[d] === s.py) { back = d; continue; }
    opts.push(d);
  }
  const d = opts.length ? opts[game.rng.rand(opts.length)] : back;
  if (d < 0) { s.nx = s.tx; s.ny = s.ty; return; }
  s.nx = s.tx + DX[d]; s.ny = s.ty + DY[d];
}

/** BFS up to 3 tiles along paths for litter or a bin needing emptying; returns the first step direction. */
function nearestLitterDir(game, s) {
  const w = game.w, N = w.N;
  const start = w.idx(s.tx, s.ty);
  const seen = new Map([[start, -1]]);
  let frontier = [start];
  for (let depth = 0; depth < 3; depth++) {
    const next = [];
    for (const i of frontier) {
      const a = w.adj[i];
      for (let d = 0; d < 4; d++) {
        if (!(a & (1 << d))) continue;
        const j = i + DX[d] + DY[d] * N;
        if (seen.has(j) || w.poutside[j]) continue;
        const first = i === start ? d : seen.get(i);
        seen.set(j, first);
        if (game.litterN[j] || game.vomitN[j] || (w.paddon[j] === 2 && w.pbin[j] > 12)) return first;
        next.push(j);
      }
    }
    frontier = next;
  }
  return -1;
}
