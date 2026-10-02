// Parkhaven - track pieces, track geometry, circuit sampling, vehicle physics and test-run
// measurement. Pure module (no DOM); the world is reached through an injected `env`.
//
// Coordinates: tiles on x (east) / y (south); heights in hu (1 hu = 1/4 tile = 0.75 m).
// Circuit samples are stored in "tile space" (x, y, z all in tiles; 1 tile = 3 m) so the
// geometry is isotropic and metres = tiles * 3.

export const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];
export const METRES_PER_TILE = 3;
const L_PER_METRE = 4.25 / 3; // spec 8.6: 1 tile of straight = 4.25 L

const SLOPE_RATE = { 0: 0, 1: 2, 2: 8, '-1': -2, '-2': -8 }; // hu per tile

// cubic Hermite: z(0)=0, z(1)=dz, z'(0)=m0, z'(1)=m1
function hermite(p, dz, m0, m1) {
  const p2 = p * p, p3 = p2 * p;
  return m0 * (p3 - 2 * p2 + p) + dz * (-2 * p3 + 3 * p2) + m1 * (p3 - p2);
}

// ---------------------------------------------------------------- piece table
// geom(p) -> {x, y, z} local: x forward (tiles), y right (tiles), z (hu). bank(p) radians.
export const PIECES = {};
function def(id, o) { PIECES[id] = Object.assign({ id, turn: 0, R: 0, fromSlope: 0, toSlope: 0, fromBank: 0, toBank: 0, dz: 0, gV: 0, gL: 0, len: 1 }, o); }

const straightGeom = (p) => ({ x: p, y: 0, z: 0 });
def('station', { name: 'Station', group: 'base', mult: 1.5, L: 4.25, geom: straightGeom, station: true, out: [1, 0] });
def('straight', { name: 'Straight', group: 'base', mult: 1.0, L: 4.25, geom: straightGeom, liftable: true, out: [1, 0] });
def('brakes', { name: 'Brakes', group: 'brakes', mult: 1.375, L: 4.25, geom: straightGeom, brakes: true, out: [1, 0] });

// slopes: [from, to, dz, mult, L, gV]
const SLOPES = [
  [0, 1, 1, 1.125, 4.25, 103], [1, 1, 2, 1.22, 4.4, 0], [1, 0, 1, 1.125, 4.25, -103],
  [1, 2, 4, 1.47, 4.5, 82], [2, 2, 8, 1.75, 5.3, 0], [2, 1, 4, 1.47, 4.5, -82],
  [0, -1, -1, 1.125, 4.25, -103], [-1, -1, -2, 1.22, 4.4, 0], [-1, 0, -1, 1.125, 4.25, 103],
  [-1, -2, -4, 1.47, 4.5, -82], [-2, -2, -8, 1.75, 5.3, 0], [-2, -1, -4, 1.47, 4.5, 82],
];
for (const [f, t, dz, mult, L, gV] of SLOPES) {
  const m0 = SLOPE_RATE[f], m1 = SLOPE_RATE[t];
  const steep = Math.abs(f) === 2 || Math.abs(t) === 2;
  def(`s_${f}_${t}`, {
    name: slopeName(f, t), group: steep ? 'steep' : 'gentle', mult, L, gV, fromSlope: f, toSlope: t, dz,
    geom: (p) => ({ x: p, y: 0, z: hermite(p, dz, m0, m1) }), liftable: dz > 0, out: [1, 0],
  });
}
function slopeName(f, t) {
  const n = { 0: 'flat', 1: 'gentle up', 2: 'steep up', '-1': 'gentle down', '-2': 'steep down' };
  return f === t ? n[f][0].toUpperCase() + n[f].slice(1) : `${n[f]} to ${n[t]}`.replace(/^./, (c) => c.toUpperCase());
}

function curveGeom(R, side, dzTotal = 0) {
  return (p) => {
    const th = (p * Math.PI) / 2;
    return { x: R * Math.sin(th), y: side * R * (1 - Math.cos(th)), z: dzTotal * p };
  };
}
// curve exit: local tile offset of the next tile
function curveOut(R, side) {
  // exit point (R, side*R); next tile column = floor(R), row = side*(R+0.5)
  return [Math.floor(R), side * Math.round(R + 0.5)];
}
const CURVES = { s: [1.5, 2.36, 10.0, 59], l: [2.5, 3.93, 16.5, 98] };
for (const size of ['s', 'l']) {
  const [R, mult, L, gL] = CURVES[size];
  for (const [sd, side] of [['L', -1], ['R', 1]]) {
    def(`c_${size}_${sd}`, { name: `${size === 's' ? 'Small' : 'Large'} ${sd === 'L' ? 'left' : 'right'} curve`, group: 'base', mult, L, gL, turn: side, R, geom: curveGeom(R, side), out: curveOut(R, side), dirChange: side });
    const bm = size === 's' ? [2.5, 100, 100] : [5.09, 200, 160];
    def(`cb_${size}_${sd}`, { name: `${size === 's' ? 'Small' : 'Large'} banked ${sd === 'L' ? 'left' : 'right'} curve`, group: 'banked', mult: bm[0], L, gV: bm[1], gL: bm[2], turn: side, R, fromBank: side, toBank: side, geom: curveGeom(R, side), bankFn: () => side * 0.7, out: curveOut(R, side), dirChange: side });
  }
}
// small sloped curves (gentle up/down)
for (const [sd, side] of [['L', -1], ['R', 1]]) {
  for (const [ud, sl] of [['up', 1], ['dn', -1]]) {
    def(`cs_${sd}_${ud}`, { name: `Sloped ${sd === 'L' ? 'left' : 'right'} curve ${ud === 'up' ? 'up' : 'down'}`, group: 'gentle', mult: 4.12, L: 10.3, gL: 59, turn: side, R: 1.5, fromSlope: sl, toSlope: sl, dz: 4 * sl, geom: curveGeom(1.5, side, 4 * sl), out: curveOut(1.5, side), dirChange: side, liftable: sl > 0 });
  }
}
// bank transitions
for (const [sd, side] of [['L', -1], ['R', 1]]) {
  def(`b_0_${sd}`, { name: `Bank ${sd === 'L' ? 'left' : 'right'}`, group: 'banked', mult: 1.06, L: 4.25, toBank: side, geom: straightGeom, bankFn: (p) => side * 0.7 * p, out: [1, 0] });
  def(`b_${sd}_0`, { name: 'Level out', group: 'banked', mult: 1.06, L: 4.25, fromBank: side, geom: straightGeom, bankFn: (p) => side * 0.7 * (1 - p), out: [1, 0] });
}
// vertical loop: 3 long x 2 wide, exits one tile to the side
for (const [sd, side] of [['L', -1], ['R', 1]]) {
  def(`loop_${sd}`, {
    name: `Vertical loop (${sd === 'L' ? 'left' : 'right'})`, group: 'loop', mult: 7.5, L: 16.0, inversion: true,
    geom: (p) => {
      const th = 2 * Math.PI * p;
      return { x: 3 * p + 1.5 * Math.sin(th), y: (side * (1 - Math.cos(Math.PI * p))) / 2, z: 6 * (1 - Math.cos(th)) };
    },
    gVfn: (p) => Math.abs(p - 0.5) * 155 + 28, out: [3, side], loop: true,
  });
}
// go-kart extra curves (tight 1-tile and medium)
for (const [sd, side] of [['L', -1], ['R', 1]]) {
  def(`c_t_${sd}`, { name: `Tight ${sd === 'L' ? 'left' : 'right'} curve`, group: 'base', mult: 1.2, L: 3.4, gL: 40, turn: side, R: 0.5, geom: curveGeom(0.5, side), out: curveOut(0.5, side), dirChange: side });
}

// which pieces each track type may use
export const TRACK_SETS = {
  coaster: (id) => !id.startsWith('c_t_'),
  karts: (id) => ['station', 'straight', 's_0_1', 's_1_1', 's_1_0', 's_0_-1', 's_-1_-1', 's_-1_0', 'c_t_L', 'c_t_R', 'c_s_L', 'c_s_R', 'c_l_L', 'c_l_R'].includes(id),
  flume: (id) => ['station', 'straight', 's_0_1', 's_1_1', 's_1_0', 's_0_-1', 's_-1_-1', 's_-1_0', 's_-1_-2', 's_-2_-2', 's_-2_-1', 'c_s_L', 'c_s_R'].includes(id),
};

// ---------------------------------------------------------------- placing pieces
export function rightOf(d) { return (d + 1) & 3; }

/** Build world samples for a piece placed at entry state st {x,y,dir,z}. */
export function pieceSamples(pid, st, n = null) {
  const pc = PIECES[pid];
  const f = DIRS[st.dir], r = DIRS[rightOf(st.dir)];
  const ex = st.x + 0.5 - f[0] * 0.5, ey = st.y + 0.5 - f[1] * 0.5;
  const count = n || Math.max(6, Math.ceil(pc.L * 2.5));
  const out = [];
  for (let i = 0; i <= count; i++) {
    const p = i / count;
    const g = pc.geom(p);
    out.push({
      p, x: ex + f[0] * g.x + r[0] * g.y, y: ey + f[1] * g.x + r[1] * g.y, z: st.z + g.z,
      bank: pc.bankFn ? pc.bankFn(p) : 0,
    });
  }
  return out;
}

/** Exit state after placing piece pid at entry state st. */
export function pieceExit(pid, st) {
  const pc = PIECES[pid];
  const f = DIRS[st.dir], r = DIRS[rightOf(st.dir)];
  const [a, b] = pc.out;
  const dir = pc.dirChange ? (st.dir + pc.dirChange + 4) & 3 : st.dir;
  return {
    x: st.x + f[0] * a + r[0] * b, y: st.y + f[1] * a + r[1] * b, dir,
    z: st.z + pc.dz, slope: pc.toSlope, bank: pc.toBank,
  };
}

/** Per-tile footprint of a piece: [{x, y, z0, z1}] (z in hu). */
export function pieceFootprint(pid, st) {
  const pc = PIECES[pid];
  const s = pieceSamples(pid, st, Math.max(16, Math.ceil(pc.L * 6)));
  const map = new Map();
  for (let i = 0; i < s.length; i++) {
    const q = s[i];
    // nudge edge samples inward so a tile boundary point is not counted in the neighbour
    let px = q.x, py = q.y;
    if (i === 0 || i === s.length - 1) {
      const o = i === 0 ? s[1] : s[s.length - 2];
      px = q.x + (o.x - q.x) * 0.05; py = q.y + (o.y - q.y) * 0.05;
    }
    const tx = Math.floor(px), ty = Math.floor(py);
    const k = tx + ',' + ty;
    let e = map.get(k);
    if (!e) { e = { x: tx, y: ty, z0: q.z, z1: q.z }; map.set(k, e); }
    e.z0 = Math.min(e.z0, q.z); e.z1 = Math.max(e.z1, q.z);
  }
  if (pc.loop) for (const e of map.values()) e.z1 = Math.max(e.z1, st.z + 12);
  return [...map.values()];
}

/**
 * Choose the next piece to place given the builder selection, stepping through the
 * transitions needed to reach the requested slope/bank. Returns {pid} or {error}.
 * sel: { turn: -1|0|1, size: 't'|'s'|'l', slope: -2..2, bank: -1|0|1, special: null|'station'|'brakes'|'loop' }
 */
export function choosePiece(type, cur, sel, allowed) {
  const ok = (id) => TRACK_SETS[type](id) && (!allowed || allowed(PIECES[id].group));
  const res = (id) => (PIECES[id] && ok(id) ? { pid: id } : { error: PIECES[id] && TRACK_SETS[type](id) ? 'Not researched yet' : 'That piece is not available here' });
  const stepSlope = (from, to) => {
    if (from === to) return null;
    let next;
    if (Math.sign(from) !== Math.sign(to) && from !== 0) next = from > 0 ? from - 1 : from + 1;
    else next = from + Math.sign(to - from);
    return `s_${from}_${next}`;
  };
  const unbank = () => (cur.bank !== 0 ? `b_${cur.bank < 0 ? 'L' : 'R'}_0` : null);

  if (sel.special) {
    if (cur.slope !== 0) return res(stepSlope(cur.slope, 0));
    if (cur.bank !== 0) return res(unbank());
    if (sel.special === 'loop' || sel.special === 'loopL' || sel.special === 'loopR') return res(`loop_${sel.special === 'loopL' || (sel.special === 'loop' && sel.turn < 0) ? 'L' : 'R'}`);
    return res(sel.special);
  }
  if (sel.turn !== 0) {
    const sd = sel.turn < 0 ? 'L' : 'R';
    if (sel.bank !== 0) {
      if (sel.bank !== sel.turn) return { error: 'Bank the track into the turn' };
      if (cur.slope !== 0) return res(stepSlope(cur.slope, 0));
      if (cur.bank === 0) return res(`b_0_${sd}`);
      if (cur.bank !== sel.bank) return res(unbank());
      return res(`cb_${sel.size === 'l' ? 'l' : 's'}_${sd}`);
    }
    if (cur.bank !== 0) return res(unbank());
    if (cur.slope === 0 && sel.slope === 0) return res(`c_${sel.size}_${sd}`);
    if (Math.abs(cur.slope) === 1 && cur.slope === sel.slope) {
      if (type !== 'coaster') return { error: 'Curves must be level on this ride' };
      return res(`cs_${sd}_${cur.slope > 0 ? 'up' : 'dn'}`);
    }
    if (cur.slope === 0 && sel.slope !== 0) return res(stepSlope(0, Math.sign(sel.slope)));
    return res(stepSlope(cur.slope, Math.sign(cur.slope) === Math.sign(sel.slope) ? Math.sign(sel.slope) : 0));
  }
  // straight-ish
  if (cur.bank !== sel.bank) {
    if (cur.slope !== 0) return res(stepSlope(cur.slope, 0));
    if (cur.bank !== 0) return res(unbank());
    return res(`b_0_${sel.bank < 0 ? 'L' : 'R'}`);
  }
  if (cur.bank !== 0) return res('straight_banked_unsupported');
  if (cur.slope === sel.slope) {
    if (cur.slope === 0) return res('straight');
    return res(`s_${cur.slope}_${cur.slope}`);
  }
  return res(stepSlope(cur.slope, sel.slope));
}

// ---------------------------------------------------------------- circuit
/**
 * Build the sampled circuit for a closed track. pieces: [{pid, x,y,dir,z, lift}]
 * Returns null if there is no single contiguous station block.
 */
export function buildCircuit(pieces, opts = {}) {
  const n = pieces.length;
  if (n < 2) return null;
  // find the station block start (a station whose predecessor is not a station)
  let start = -1, blocks = 0;
  for (let i = 0; i < n; i++) {
    const prev = pieces[(i - 1 + n) % n];
    if (PIECES[pieces[i].pid].station && !PIECES[prev.pid].station) { blocks++; if (start < 0) start = i; }
  }
  if (start < 0 || blocks !== 1) return null;
  const order = [];
  for (let k = 0; k < n; k++) order.push((start + k) % n);
  const samples = [];
  let cum = 0;
  let stationEnd = 0, stationPieces = 0;
  let recentSteep = false;
  const pieceStart = [];
  for (let oi = 0; oi < n; oi++) {
    const i = order[oi];
    const pc = pieces[i];
    const P = PIECES[pc.pid];
    pieceStart.push(cum);
    const st = pieceSamples(pc.pid, pc);
    const f = DIRS[pc.dir], r = DIRS[rightOf(pc.dir)];
    let splash = false;
    if (opts.flume) {
      if (P.fromSlope === -2 || P.toSlope === -2) recentSteep = true;
      else if (P.fromSlope > 0 || P.toSlope > 0) recentSteep = false;
      else if (P.fromSlope === 0 && recentSteep) { splash = true; recentSteep = false; }
    }
    for (let k = 0; k < st.length - 1; k++) {
      const a = st[k], b = st[k + 1];
      const dx = b.x - a.x, dy = b.y - a.y, dz = (b.z - a.z) / 4;
      const segT = Math.hypot(dx, dy, dz) || 1e-6;
      const tx = dx / segT, ty = dy / segT, tz = dz / segT;
      // right vector: from heading for loops, else from horizontal tangent
      let rx, ry, rz = 0;
      if (P.loop) { rx = r[0]; ry = r[1]; }
      else { const h = Math.hypot(tx, ty) || 1; rx = -ty / h; ry = tx / h; }
      // up = T x R
      let ux = ty * rz - tz * ry, uy = tz * rx - tx * rz, uz = tx * ry - ty * rx;
      let ul = Math.hypot(ux, uy, uz) || 1; ux /= ul; uy /= ul; uz /= ul;
      const bank = (a.bank + b.bank) / 2;
      if (bank) {
        const c = Math.cos(bank), s = Math.sin(bank);
        // right vector orthogonal to T and up
        const Rx = uy * tz - uz * ty, Ry = uz * tx - ux * tz, Rz = ux * ty - uy * tx;
        // R = up x T  -> points right
        ux = ux * c + Rx * s; uy = uy * c + Ry * s; uz = uz * c + Rz * s;
      }
      const pm = (a.p + b.p) / 2;
      samples.push({
        s: cum, x: a.x, y: a.y, z: a.z / 4, tx, ty, tz, ux, uy, uz, piece: oi, p: a.p,
        gV: P.gVfn ? P.gVfn(pm) : P.gV, gL: P.gL,
        lift: !!pc.lift || (opts.flume && (P.fromSlope > 0 || P.toSlope > 0)),
        station: !!P.station, brakes: !!P.brakes, splash,
      });
      cum += segT * METRES_PER_TILE;
    }
    if (P.station && oi === stationPieces) { stationPieces++; stationEnd = cum; }
  }
  return { samples, total: cum, stationEnd, stationPieces, order, pieceStart };
}

/** Find the sample index at distance s (metres) by binary search. */
export function sampleIndex(circ, s) {
  const a = circ.samples;
  s = ((s % circ.total) + circ.total) % circ.total;
  let lo = 0, hi = a.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (a[mid].s <= s) lo = mid; else hi = mid - 1;
  }
  return lo;
}

/** Interpolated pose at distance s: {x,y,z (tiles), tx,ty,tz, ux,uy,uz, sample} */
export function poseAt(circ, s) {
  s = ((s % circ.total) + circ.total) % circ.total;
  const i = sampleIndex(circ, s);
  const a = circ.samples[i], b = circ.samples[(i + 1) % circ.samples.length];
  const segLen = (i + 1 < circ.samples.length ? b.s : circ.total) - a.s;
  const t = segLen > 0 ? (s - a.s) / segLen : 0;
  return {
    x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t,
    tx: a.tx, ty: a.ty, tz: a.tz, ux: a.ux, uy: a.uy, uz: a.uz, sample: a,
  };
}

// ---------------------------------------------------------------- vehicle physics
const G = 9.81;
const DT = 1 / 40;
export const PHYS = {
  coaster: { k1: 0.02, k2: 0.0045 },
  karts: { k1: 0.05, k2: 0.002 },
  flume: { k1: 0.06, k2: 0.004 },
};

export function newMeasure() {
  return { Smax: 0, sumS: 0, nS: 0, Lm: 0, T: 0, Gpos: -999, Gneg: 999, Glat: 0, air: 0, drops: 0, H: 0, inDrop: false, dropZ: 0, prevZ: null, pgv: null, pgl: null, ticks: 0, moveTicks: 0, splash: false };
}

/**
 * Advance one vehicle by one tick.
 * veh: { s, v, state, cars, carLen, laps, lapsLeft, stall }
 * cfg: { kind, liftSpeed, brakeSpeed, stopS, launch }
 * returns an event string or null: 'arrived' | 'stalled' | 'lap'
 */
export function stepVehicle(veh, circ, cfg, m) {
  const ph = PHYS[cfg.kind] || PHYS.coaster;
  let ev = null;
  if (veh.state === 'loading' || veh.state === 'held') { veh.v = 0; return null; }
  const trainLen = veh.cars * veh.carLen;
  // average pitch across cars
  let sinp = 0, onLift = false, onBrake = false;
  for (let c = 0; c < veh.cars; c++) {
    const smp = circ.samples[sampleIndex(circ, veh.s - c * veh.carLen - veh.carLen * 0.5)];
    sinp += smp.tz;
    if (smp.lift) onLift = true;
    if (smp.brakes && c === 0) onBrake = true;
  }
  sinp /= veh.cars;
  let a = -G * sinp - ph.k1 * veh.v - ph.k2 * veh.v * Math.abs(veh.v);
  if (cfg.kind === 'karts') {
    const target = sinp > 0.15 ? 6 : 9;
    if (veh.v < target) a += Math.min(4, (target - veh.v) * 2) + G * Math.max(0, sinp);
    if (sinp < -0.15 && veh.v > 12) a = Math.min(a, -2);
  }
  if (cfg.kind === 'flume' && sinp > -0.05 && sinp < 0.05 && veh.v < 2) a += 1.5; // gentle current
  veh.v += a * DT;
  if (onLift && veh.v < cfg.liftSpeed) veh.v = cfg.liftSpeed;
  if (onBrake && !cfg.brakesFailed && veh.v > cfg.brakeSpeed) veh.v = Math.max(cfg.brakeSpeed, veh.v - 12 * DT);
  if (veh.state === 'departing') {
    if (veh.v < cfg.launch) veh.v = cfg.launch;
    if (veh.s >= circ.stationEnd + trainLen + 0.5 && veh.s < circ.total - 1) veh.state = 'running';
  }
  if (veh.state === 'arriving' && veh.s < circ.stationEnd + 1) {
    const rem = cfg.stopS - veh.s;
    const vmax = Math.sqrt(2 * 5 * Math.max(0, rem)) + 0.4;
    if (cfg.brakesFailed && cfg.kind === 'coaster') {
      // brake failure: the train sails through the station and goes round again
    } else if (veh.v > vmax) veh.v = vmax;
    if (rem <= 0.05 && !(cfg.brakesFailed && cfg.kind === 'coaster')) {
      veh.s = cfg.stopS; veh.v = 0; veh.state = 'unloading'; return 'arrived';
    }
  }
  if (cfg.leaderGap != null && cfg.leaderGap < 2.5) {
    veh.v = Math.min(veh.v, Math.max(0, (cfg.leaderGap - 0.6) * 2));
  }
  // stall / rollback detection (not on lifts, not in station states)
  if (veh.state === 'running' && !onLift) {
    if (veh.v <= 0.05) { veh.stall = (veh.stall || 0) + 1; if (veh.v < 0) veh.v = 0; }
    else veh.stall = 0;
    if (veh.stall > 120 && (cfg.leaderGap == null || cfg.leaderGap > 3)) ev = 'stalled';
  }
  const ds = veh.v * DT;
  const prevS = veh.s;
  veh.s += ds;
  if (veh.s >= circ.total) {
    veh.s -= circ.total;
    veh.lapsLeft = (veh.lapsLeft || 1) - 1;
    if (veh.lapsLeft <= 0) veh.state = 'arriving';
    else ev = ev || 'lap';
  }
  if (m) measureTick(m, veh, circ, ds, prevS);
  return ev;
}

function measureTick(m, veh, circ, ds, prevS) {
  m.ticks++;
  const moving = Math.abs(veh.v) > 0.1;
  if (!moving) return;
  m.moveTicks++;
  if (veh.v > m.Smax) m.Smax = veh.v;
  m.Lm += Math.abs(ds);
  if (m.moveTicks % 32 === 0) { m.sumS += veh.v; m.nS++; m.T++; }
  const pose = poseAt(circ, veh.s);
  const smp = pose.sample;
  let gv = smp.uz + (smp.gV ? (veh.v * 9.8) / smp.gV : 0);
  let gl = smp.gL ? (veh.v * 9.8) / smp.gL : 0;
  if (m.pgv == null) { m.pgv = gv; m.pgl = gl; }
  const sgv = (gv + m.pgv) / 2, sgl = (gl + m.pgl) / 2;
  m.pgv = gv; m.pgl = gl;
  const gvh = Math.round(sgv * 100), glh = Math.round(Math.abs(sgl) * 100);
  if (gvh > m.Gpos) m.Gpos = gvh;
  if (gvh < m.Gneg) m.Gneg = gvh;
  if (glh > m.Glat) m.Glat = glh;
  if (sgv <= 0) m.air++;
  if (smp.splash) m.splash = true;
  // drops (z in hu)
  const zhu = pose.z * 4;
  if (m.prevZ != null) {
    const dz = zhu - m.prevZ;
    if (dz < -0.0005) { if (!m.inDrop) { m.inDrop = true; m.dropZ = m.prevZ; } }
    else if (dz >= 0 && m.inDrop) {
      m.inDrop = false;
      const h = m.dropZ - m.prevZ;
      if (h >= 1) { m.drops++; if (h > m.H) m.H = h; }
    }
  }
  m.prevZ = zhu;
}

/** Turn the raw measurement into the stats object the rating formulas want. */
export function finishMeasure(m) {
  if (m.inDrop && m.prevZ != null) {
    const h = m.dropZ - m.prevZ; if (h >= 1) { m.drops++; if (h > m.H) m.H = h; }
    m.inDrop = false;
  }
  return {
    Smax: m.Smax, Savg: m.nS ? m.sumS / m.nS : 0, L: m.Lm * L_PER_METRE, T: m.T,
    Gpos: m.Gpos === -999 ? 100 : m.Gpos, Gneg: m.Gneg === 999 ? 100 : m.Gneg, Glat: m.Glat,
    airtime: m.air, drops: m.drops, H: Math.round(m.H), splash: m.splash,
  };
}

/** Static layout statistics: turns, inversions, lifts, brakes, stations, length in L. */
export function layoutStats(pieces) {
  const turns = [];
  let cur = null;
  let inversions = 0, lifts = 0, brakes = 0, stations = 0, L = 0, inLift = false;
  for (const pc of pieces) {
    const P = PIECES[pc.pid];
    L += P.L;
    if (P.inversion) inversions++;
    if (P.brakes) brakes++;
    if (P.station) stations++;
    if (pc.lift) { if (!inLift) lifts++; inLift = true; } else inLift = false;
    if (P.turn) {
      const kind = P.fromBank ? 'banked' : P.fromSlope ? 'sloped' : 'flat';
      if (cur && cur.dir === P.turn) cur.len++;
      else { cur = { dir: P.turn, len: 1, kind }; turns.push(cur); }
    } else cur = null;
  }
  return { turns, inversions, lifts, brakes, stations, L };
}

/**
 * Run a headless test circuit (used by tests and by the game for instant estimates).
 * Returns {ok, stats, reason}
 */
export function simulateTest(circ, cfg) {
  const veh = { s: cfg.stopS, v: 0, state: 'departing', cars: cfg.cars, carLen: cfg.carLen, lapsLeft: 1 };
  const m = newMeasure();
  for (let t = 0; t < 40 * 60 * 6; t++) {
    const ev = stepVehicle(veh, circ, cfg, m);
    if (ev === 'arrived') return { ok: true, stats: finishMeasure(m) };
    if (ev === 'stalled') return { ok: false, reason: 'The vehicle ran out of speed and could not finish the circuit.' };
  }
  return { ok: false, reason: 'The test run took too long.' };
}
