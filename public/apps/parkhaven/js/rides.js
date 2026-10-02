// Parkhaven - rides and stalls: placement, entrances, queues, operation cycles, tracked-ride
// vehicles and test runs, ratings refresh, value, reliability, breakdowns and inspections.
import { DX, DY } from './world.js';
import { FIN, STALLS, FLAT_RIDES, TRACK_RIDES, BREAKDOWNS, ITEMS, SCENERY } from './data.js';
import { flatRideRatings, coasterRatings, kartRatings, flumeRatings, rideValue, rideUpkeep, sceneryScore } from './ratings.js';
import {
  PIECES, pieceFootprint, pieceExit, buildCircuit, stepVehicle, newMeasure, finishMeasure, layoutStats,
  sampleIndex, poseAt, rightOf, DIRS,
} from './track.js';
import { onBoard, onUnload, leaveQueue, pushSample, QSP, updatePos } from './guests.js';
import { addThought } from './guestlogic.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const RIDE_SECOND = 32; // ticks

export function rideDef(r) {
  if (r.kind === 'stall') return STALLS[r.type];
  if (r.kind === 'flat') return FLAT_RIDES[r.type];
  return TRACK_RIDES[r.type];
}
export function typeBonus(r) { const d = rideDef(r); return r.kind === 'stall' ? d.bonus : d.typeBonus; }
function nameFor(game, type, base) {
  let n = 1;
  while (game.rides.some((r) => r.name === `${base} ${n}`)) n++;
  return `${base} ${n}`;
}

function baseRide(game, kind, type, name) {
  return {
    id: game.nextRideId++, kind, type, name, status: 'closed', built: game.absMonth, everOpened: false,
    price: 0, cost: 0, ratings: null, value: null, upkeep: 0, entrance: null, exit: null,
    queue: [], riders: [], queueCap: 0, access: [], exitAccess: null, qpts: [],
    rel: 25600, downB: [0, 0, 0, 0, 0, 0, 0, 0], downtime: 0, broken: null, brokenAt: 0, mechanic: null,
    inspectEvery: 30, minsSince: 0, due: false, lastFix: null,
    custBuckets: new Array(10).fill(0), custCur: 0, totalCustomers: 0, income: 0, incomeMonth: 0,
    pop: [], sat: [], favCount: 0, scenery: 0, profit: 0, sold: 0, customers: 0,
  };
}

// ------------------------------------------------------------------ placement checks
function tileFree(game, x, y, needOwned = true) {
  const w = game.w;
  if (!w.usable(x, y)) return 'Outside the map';
  const i = w.idx(x, y);
  if (needOwned && w.own[i] !== 1) return 'You do not own this land';
  if (w.ptype[i]) return 'There is a path in the way';
  if (w.wet(x, y)) return 'Cannot build in water';
  if (w.occ[i] && w.occ[i].length) return 'Something is already built here';
  return null;
}

export function flatFootprint(type, x, y, rot) {
  const d = FLAT_RIDES[type];
  const W = rot & 1 ? d.l : d.w, L = rot & 1 ? d.w : d.l;
  const out = [];
  for (let j = 0; j < L; j++) for (let i = 0; i < W; i++) out.push([x + i, y + j]);
  return { tiles: out, W, L };
}

export function towerHu(r) { const d = FLAT_RIDES[r.type]; return d.sections ? d.sections * 4 : 0; }

export function checkFlat(game, type, x, y, rot) {
  const d = FLAT_RIDES[type];
  const { tiles } = flatFootprint(type, x, y, rot);
  let z = 0;
  for (const [tx, ty] of tiles) {
    const e = tileFree(game, tx, ty);
    if (e) return { ok: false, reason: e };
    z = Math.max(z, game.w.groundMax(tx, ty));
  }
  for (const [tx, ty] of tiles) if (z - game.w.groundMin(tx, ty) > 4) return { ok: false, reason: 'The ground is too uneven here' };
  const cost = d.cost + (d.perSection || 0) * (d.sections || 0);
  if (game.cash < cost) return { ok: false, reason: 'Not enough cash', cost, z };
  return { ok: true, cost, z };
}

export function placeFlat(game, type, x, y, rot = 0) {
  const c = checkFlat(game, type, x, y, rot);
  if (!c.ok) return c;
  const d = FLAT_RIDES[type];
  const r = baseRide(game, 'flat', type, nameFor(game, type, d.name));
  Object.assign(r, { x, y, rot, z: c.z, option: d.option ? d.option.def : 0, price: game.pricing === 'gate' ? 0 : d.price, cost: c.cost, phase: 'loading', phaseT: 0, anim: 0, music: !!d.music });
  const { tiles } = flatFootprint(type, x, y, rot);
  const h = d.sections ? d.sections * 4 + 6 : 12;
  for (const [tx, ty] of tiles) { game.w.scen[game.w.idx(tx, ty)] = 0; game.w.addOcc(tx, ty, { k: 'ride', id: r.id, z0: c.z, z1: c.z + h }); }
  game.spend(FIN.RIDE_BUILD, c.cost);
  game.rides.push(r);
  refreshRatings(game, r);
  game.markConnDirty();
  return { ok: true, ride: r };
}

export function checkStall(game, type, x, y) {
  const d = STALLS[type];
  const e = tileFree(game, x, y);
  if (e) return { ok: false, reason: e };
  const w = game.w;
  if (w.groundMax(x, y) - w.groundMin(x, y) > 2) return { ok: false, reason: 'The ground is too uneven here' };
  if (game.cash < d.cost) return { ok: false, reason: 'Not enough cash', cost: d.cost };
  return { ok: true, cost: d.cost, z: w.groundMax(x, y) };
}

/** Pick a facing for a stall: toward an adjacent footpath if there is one. */
export function stallFacing(game, x, y, pref = 1) {
  const w = game.w;
  for (let k = 0; k < 4; k++) {
    const d = (pref + k) & 3;
    const nx = x + DX[d], ny = y + DY[d];
    if (w.inMap(nx, ny) && w.ptype[w.idx(nx, ny)] === 1) return d;
  }
  return pref;
}

export function placeStall(game, type, x, y, dir) {
  const c = checkStall(game, type, x, y);
  if (!c.ok) return c;
  const d = STALLS[type];
  const r = baseRide(game, 'stall', type, nameFor(game, type, d.name));
  const prices = {};
  for (const k of d.sells || []) prices[k] = ITEMS[k].price;
  Object.assign(r, { x, y, dir, z: c.z, cost: c.cost, prices, fee: 0, status: 'open', everOpened: true });
  game.w.scen[game.w.idx(x, y)] = 0;
  game.w.addOcc(x, y, { k: 'stall', id: r.id, z0: c.z, z1: c.z + 10 });
  game.spend(FIN.RIDE_BUILD, c.cost);
  r.upkeep = d.upkeep;
  game.rides.push(r);
  game.markConnDirty();
  return { ok: true, ride: r };
}

// ------------------------------------------------------------------ entrances / exits
/** Where may an entrance/exit go? Returns {ok, dir, z} or {ok:false, reason}. */
export function checkEntrance(game, r, x, y) {
  const w = game.w;
  const e = tileFree(game, x, y);
  if (e) return { ok: false, reason: e };
  if (r.kind === 'flat') {
    const { tiles } = flatFootprint(r.type, r.x, r.y, r.rot);
    for (let d = 0; d < 4; d++) {
      const bx = x - DX[d], by = y - DY[d];
      if (tiles.some(([tx, ty]) => tx === bx && ty === by)) return { ok: true, dir: d, z: r.z };
    }
    return { ok: false, reason: 'Entrances must be right next to the ride' };
  }
  if (r.kind === 'track') {
    for (const pc of r.track.pieces) {
      if (!PIECES[pc.pid].station) continue;
      for (const side of [rightOf(pc.dir), (rightOf(pc.dir) + 2) & 3]) {
        if (pc.x + DX[side] === x && pc.y + DY[side] === y) {
          if (Math.abs(w.groundMax(x, y) - pc.z) > 6) return { ok: false, reason: 'The station is too far above the ground here' };
          return { ok: true, dir: side, z: pc.z };
        }
      }
    }
    return { ok: false, reason: 'Entrances must be beside a station piece' };
  }
  return { ok: false, reason: 'Not a ride' };
}

export function placeEntrance(game, r, x, y, isExit) {
  const c = checkEntrance(game, r, x, y);
  if (!c.ok) return c;
  const key = isExit ? 'exit' : 'entrance';
  if (r[key]) game.w.removeOccWhere(r[key].x, r[key].y, (e) => e.id === r.id && e.k === key);
  r[key] = { x, y, dir: c.dir, z: c.z };
  game.w.scen[game.w.idx(x, y)] = 0;
  game.w.addOcc(x, y, { k: key, id: r.id, z0: c.z, z1: c.z + 8 });
  game.markConnDirty();
  return { ok: true };
}

/** Recompute the queue chain, access tiles and exit access for a ride or stall. */
export function computeAccess(game, r) {
  const w = game.w, N = w.N;
  r.access = []; r.exitAccess = null; r.qpts = []; r.chain = [];
  const near = (i, d, z) => { const h = w.edgeH(i, d); return h != null && Math.abs(h - z) <= 2; };
  if (r.kind === 'stall') {
    const fx = r.x + DX[r.dir], fy = r.y + DY[r.dir];
    if (w.inMap(fx, fy)) {
      const i = w.idx(fx, fy);
      if (w.ptype[i] === 1 && near(i, (r.dir + 2) & 3, r.z)) r.access = [i];
    }
    r.queueCap = 0;
    return;
  }
  if (r.entrance) {
    const e = r.entrance;
    r.qpts.push({ x: e.x + 0.5, y: e.y + 0.5, z: e.z });
    const fx = e.x + DX[e.dir], fy = e.y + DY[e.dir];
    if (w.inMap(fx, fy)) {
      let i = w.idx(fx, fy);
      if (w.ptype[i] === 2 && near(i, (e.dir + 2) & 3, e.z)) {
        const seen = new Set([i]);
        r.chain.push(i);
        let prev = -1;
        for (;;) {
          r.qpts.push({ x: (i % N) + 0.5, y: ((i / N) | 0) + 0.5, z: w.centreZ(i) });
          let next = -1;
          const a = w.qadj[i];
          for (let d = 0; d < 4; d++) {
            if (!(a & (1 << d))) continue;
            const j = i + DX[d] + DY[d] * N;
            if (j === prev || seen.has(j)) continue;
            next = j; break;
          }
          if (next < 0) break;
          prev = i; i = next; seen.add(i); r.chain.push(i);
        }
        const head = i, hx = head % N, hy = (head / N) | 0;
        for (let d = 0; d < 4; d++) {
          const nx = hx + DX[d], ny = hy + DY[d];
          if (!w.inMap(nx, ny)) continue;
          const j = w.idx(nx, ny);
          if (w.ptype[j] !== 1) continue;
          const h1 = w.edgeH(head, d), h2 = w.edgeH(j, (d + 2) & 3);
          if (h1 != null && h2 != null && h1 === h2) r.access.push(j);
        }
      } else if (w.ptype[i] === 1 && near(i, (e.dir + 2) & 3, e.z)) {
        r.access.push(i);
      }
    }
  }
  r.queueCap = Math.max(3, Math.floor((r.qpts.length - 1) / QSP) + 2);
  if (r.exit) {
    const e = r.exit;
    const fx = e.x + DX[e.dir], fy = e.y + DY[e.dir];
    if (w.inMap(fx, fy)) {
      const i = w.idx(fx, fy);
      if (w.ptype[i] === 1 && near(i, (e.dir + 2) & 3, e.z)) r.exitAccess = i;
    }
  }
  // queue left dangling by a path edit: send the queuers back to the paths
  if (r.queue.length && !r.access.length) closeQueue(game, r);
}

export function queuePoint(r, d) {
  const p = r.qpts;
  if (!p.length) return { x: 0, y: 0, z: 0 };
  if (p.length === 1 || d <= 0) return p[0];
  const k = Math.min(p.length - 2, Math.floor(d));
  const f = Math.min(1, d - k);
  const a = p[k], b = p[k + 1];
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, z: a.z + (b.z - a.z) * f, dx: b.x - a.x, dy: b.y - a.y };
}

function closeQueue(game, r) {
  for (const gid of r.queue.slice()) {
    const g = game.guests.find((x) => x.id === gid);
    if (g) leaveQueue(game, g, r);
  }
  r.queue = [];
}

// ------------------------------------------------------------------ status changes
/** Returns an error string or null. */
export function canOpen(game, r) {
  if (r.kind === 'stall') return r.access.length ? null : 'The stall must face a footpath.';
  if (r.kind === 'track') {
    if (!r.track.closed) return 'The track is not a complete circuit yet.';
    if (!r.circuit) return 'The track needs exactly one block of station pieces.';
    const def = TRACK_RIDES[r.type];
    if (r.circuit.stationEnd < def.carLen) return 'The station is too short for the vehicles.';
  }
  if (!r.entrance) return 'Place an entrance first.';
  if (!r.exit) return 'Place an exit first.';
  if (!r.access.length) return 'The entrance is not connected to a path or queue line.';
  if (r.exitAccess == null) return 'The exit is not connected to a footpath.';
  return null;
}

export function setStatus(game, r, status) {
  if (status === r.status) return null;
  if (status !== 'closed') {
    const err = canOpen(game, r);
    if (err && !(status === 'testing' && r.kind === 'track' && r.track.closed && r.circuit)) return err;
  }
  if (status === 'closed') {
    closeQueue(game, r);
    r.status = 'closed';
    if (r.kind === 'flat' && r.phase === 'loading') ejectRiders(game, r);
    if (r.kind === 'track') r.testing = false;
    game.markConnDirty();
    return null;
  }
  r.status = status;
  if (status === 'open') r.everOpened = true;
  if (r.kind === 'track' && !r.tested) startTest(game, r);
  game.recalcPark();
  return null;
}

function ejectRiders(game, r) {
  for (const gid of r.riders) {
    const g = game.guests.find((x) => x.id === gid);
    if (g) onUnload(game, g, r);
  }
  r.riders = [];
}

// ------------------------------------------------------------------ demolish / refund
export function refundOf(r) { return r.everOpened ? Math.floor(r.cost * 0.7) : r.cost; }

export function demolish(game, r) {
  closeQueue(game, r);
  if (r.kind === 'flat') ejectRiders(game, r);
  if (r.kind === 'track') for (const v of r.vehicles || []) for (const gid of v.riders) { const g = game.guests.find((x) => x.id === gid); if (g) onUnload(game, g, r); }
  for (const s of game.staff) if (s.task && s.task.ride === r.id) { s.task = null; s.workT = 0; }
  game.w.removeOccId(r.id);
  game.spend(FIN.RIDE_BUILD, -refundOf(r));
  game.rides = game.rides.filter((x) => x !== r);
  game.campaigns = game.campaigns.filter((c) => c.subject !== r.id);
  for (const g of game.guests) {
    if (g.goal && g.goal.id === r.id) g.goal = null;
    if (g.favourite === r.id) g.favourite = null;
  }
  game.markConnDirty();
}

// ------------------------------------------------------------------ tracked rides
export function startTrackRide(game, type, x, y, dir) {
  const def = TRACK_RIDES[type];
  const z = game.w.inMap(x, y) ? game.w.groundMax(x, y) : 0;
  const r = baseRide(game, 'track', type, nameFor(game, type, def.name));
  Object.assign(r, {
    track: { pieces: [], start: { x, y, dir, z, slope: 0, bank: 0 }, cursor: { x, y, dir, z, slope: 0, bank: 0 }, closed: false },
    price: game.pricing === 'gate' ? 0 : def.price, cars: def.carsDef || 1, vehCount: def.vehDef || 1,
    liftSpeed: 5, brakeSpeed: 6, laps: type === 'karts' ? 3 : 1, loadMode: 1, minWait: 3, maxWait: 20,
    vehicles: [], tested: false, testing: false, measure: null, circuit: null, building: true,
  });
  game.rides.push(r);
  game.rideById.set(r.id, r);
  return r;
}

const CLEAR = { coaster: 4, karts: 3, flume: 4 };

/** Validate placing piece pid at the ride's cursor. Returns {ok, cost, reason, fp, exit}. */
export function checkPiece(game, r, pid) {
  const w = game.w;
  const def = TRACK_RIDES[r.type];
  if (r.track.closed) return { ok: false, reason: 'The circuit is already complete' };
  const cur = r.track.cursor;
  const P = PIECES[pid];
  if (!P) return { ok: false, reason: 'Unknown piece' };
  if (r.track.pieces.length === 0 && !P.station) return { ok: false, reason: 'The first piece must be a station' };
  const fp = pieceFootprint(pid, cur);
  let supports = 0;
  for (const t of fp) {
    if (!w.usable(t.x, t.y)) return { ok: false, reason: 'Off the edge of the map', fp };
    const i = w.idx(t.x, t.y);
    const g = w.groundMax(t.x, t.y);
    const base = Math.max(g, w.water[i]);
    const z0 = Math.floor(t.z0), z1 = Math.ceil(t.z1);
    if (w.own[i] !== 1 && !(w.own[i] === 2 && z0 >= g + 4)) return { ok: false, reason: 'You do not own this land', fp };
    if (z0 < base) return { ok: false, reason: 'The track would go underground', fp };
    if (z1 - g > def.maxHeight) return { ok: false, reason: 'Too high', fp };
    const hit = w.collides(t.x, t.y, z0, z1 + CLEAR[r.type], null);
    if (hit) return { ok: false, reason: hit.k === 'track' ? 'Another track is in the way' : 'Something is in the way', fp };
    if (w.ptype[i]) {
      const pz = w.pz[i];
      if (z0 < pz + 5 && pz < z1 + CLEAR[r.type]) return { ok: false, reason: 'A path is in the way', fp };
    }
    supports += Math.max(0, Math.floor((z0 - g) / 2));
  }
  const cost = Math.round(def.piecePrice * P.mult) + supports * def.supportPrice;
  const exit = pieceExit(pid, cur);
  if (exit.z - w.groundMax(clamp(exit.x, 0, w.N - 1), clamp(exit.y, 0, w.N - 1)) > def.maxHeight + 8) return { ok: false, reason: 'Too high', fp };
  if (game.cash < cost) return { ok: false, reason: 'Not enough cash', cost, fp, exit };
  return { ok: true, cost, fp, exit };
}

export function placePiece(game, r, pid, lift = false) {
  const c = checkPiece(game, r, pid);
  if (!c.ok) return c;
  const cur = r.track.cursor;
  const P = PIECES[pid];
  const pc = { pid, x: cur.x, y: cur.y, dir: cur.dir, z: cur.z, lift: !!(lift && P.liftable && r.type === 'coaster'), cost: c.cost };
  r.track.pieces.push(pc);
  const pi = r.track.pieces.length - 1;
  for (const t of c.fp) {
    game.w.scen[game.w.idx(t.x, t.y)] = 0;
    game.w.addOcc(t.x, t.y, { k: 'track', id: r.id, pi, z0: Math.floor(t.z0), z1: Math.ceil(t.z1) + CLEAR[r.type] });
  }
  r.track.cursor = c.exit;
  r.cost += c.cost;
  game.spend(FIN.RIDE_BUILD, c.cost);
  const s = r.track.start;
  const e = c.exit;
  if (r.track.pieces.length > 1 && e.x === s.x && e.y === s.y && e.dir === s.dir && e.z === s.z && e.slope === 0 && e.bank === 0) {
    r.track.closed = true;
  }
  invalidateTrack(game, r);
  game.w.version++;
  return { ok: true, closed: r.track.closed };
}

export function removeLastPiece(game, r) {
  const pcs = r.track.pieces;
  if (!pcs.length) return false;
  const pc = pcs.pop();
  const pi = pcs.length;
  game.w.removeOccId(r.id, 'track');
  // re-add remaining pieces (cheap: track sizes are small)
  pcs.forEach((p, k) => { for (const t of pieceFootprint(p.pid, p)) game.w.addOcc(t.x, t.y, { k: 'track', id: r.id, pi: k, z0: Math.floor(t.z0), z1: Math.ceil(t.z1) + CLEAR[r.type] }); });
  const refund = r.everOpened ? Math.floor(pc.cost * 0.7) : pc.cost;
  game.spend(FIN.RIDE_BUILD, -refund);
  r.cost -= pc.cost;
  r.track.cursor = { x: pc.x, y: pc.y, dir: pc.dir, z: pc.z, slope: PIECES[pc.pid].fromSlope, bank: PIECES[pc.pid].fromBank };
  r.track.closed = false;
  void pi;
  // removing a station piece may orphan the entrance / exit
  for (const key of ['entrance', 'exit']) {
    if (r[key] && checkEntrance(game, r, r[key].x, r[key].y).ok === false) {
      const e = r[key];
      game.w.removeOccWhere(e.x, e.y, (o) => o.id === r.id && o.k === key);
      const again = checkEntrance(game, r, e.x, e.y);
      if (again.ok) game.w.addOcc(e.x, e.y, { k: key, id: r.id, z0: e.z, z1: e.z + 8 });
      else r[key] = null;
    }
  }
  invalidateTrack(game, r);
  game.w.version++;
  game.markConnDirty();
  return true;
}

function invalidateTrack(game, r) {
  r.tested = false; r.ratings = null; r.value = null; r.measure = null; r.testing = false;
  r.circuit = r.track.closed ? buildCircuit(r.track.pieces, { flume: r.type === 'flume' }) : null;
  resetVehicles(game, r);
  refreshUpkeep(r);
}

export function resetVehicles(game, r) {
  for (const v of r.vehicles || []) for (const gid of v.riders || []) { const g = game.guests.find((x) => x.id === gid); if (g) onUnload(game, g, r); }
  r.vehicles = [];
  const c = r.circuit;
  if (!c) return;
  const def = TRACK_RIDES[r.type];
  if (r.type === 'coaster') {
    const maxCars = Math.max(1, Math.floor((c.stationEnd - 0.3) / def.carLen));
    r.cars = clamp(r.cars, 1, Math.min(def.carsMax, maxCars));
  }
  const n = r.type === 'coaster' ? 1 : clamp(r.vehCount, 1, def.vehMax);
  const cars = r.type === 'coaster' ? r.cars : 1;
  const stopS = c.stationEnd - 0.3;
  for (let k = 0; k < n; k++) {
    let s = stopS - k * (def.carLen * cars + 0.8);
    s = ((s % c.total) + c.total) % c.total;
    r.vehicles.push({ s, v: 0, state: k === 0 ? 'loading' : 'arriving', cars, carLen: def.carLen, riders: [], lapsLeft: 1, waitT: 0, stall: 0 });
  }
}

export function startTest(game, r) {
  if (!r.circuit) return;
  resetVehicles(game, r);
  // only one vehicle goes round during the test; the rest wait in the shed
  r.vehicles.length = 1;
  const v = r.vehicles[0];
  v.state = 'departing'; v.lapsLeft = 1; v.measure = newMeasure(); v.testRun = true;
  r.testing = true;
}

function trackCfg(r, v) {
  const def = TRACK_RIDES[r.type];
  return {
    kind: r.type, liftSpeed: r.liftSpeed, brakeSpeed: r.brakeSpeed, stopS: r.circuit.stationEnd - 0.3, launch: r.type === 'karts' ? 3 : 2,
    brakesFailed: r.broken === 'brakes', carLen: def.carLen,
  };
}

function finishTest(game, r, v) {
  const raw = finishMeasure(v.measure);
  v.measure = null; v.testRun = false;
  r.testing = false;
  const lay = layoutStats(r.track.pieces);
  const stats = Object.assign({}, raw, lay, { L: raw.L, cars: r.cars, karts: r.vehCount, laps: r.laps, race: r.type === 'karts' && r.vehCount >= 4 });
  stats.scenery = sceneryScore(countScenery(game, r));
  stats.proximity = proximityScore(game, r);
  const sh = shelterStats(game, r);
  stats.shelteredL = sh.L; stats.shelteredSections = sh.sections; stats.shelteredFrac = sh.frac;
  r.measure = stats;
  r.tested = true;
  computeTrackRatings(r);
  refreshUpkeep(r);
  updateValue(game, r);
  resetVehicles(game, r);
  const f = (x) => (x / 100).toFixed(2);
  game.notify(`${r.name} test results - excitement ${f(r.ratings[0])}, intensity ${f(r.ratings[1])}, nausea ${f(r.ratings[2])}.`, { kind: 'ride', id: r.id }, 'good');
}

function computeTrackRatings(r) {
  const s = r.measure;
  if (!s) { r.ratings = null; return; }
  if (r.type === 'coaster') r.ratings = coasterRatings(s);
  else if (r.type === 'karts') r.ratings = kartRatings(s);
  else r.ratings = flumeRatings(s);
}

function countScenery(game, r) {
  const w = game.w;
  let cx, cy;
  if (r.kind === 'track') { const p = r.track.pieces.find((q) => PIECES[q.pid].station) || r.track.start; cx = p.x; cy = p.y; }
  else { cx = r.x + 1; cy = r.y + 1; }
  let n = 0;
  for (let y = cy - 5; y <= cy + 5; y++) for (let x = cx - 5; x <= cx + 5; x++) if (w.inMap(x, y) && w.scen[w.idx(x, y)]) n++;
  return n;
}

function shelterStats(game, r) {
  const w = game.w;
  let L = 0, sections = 0, inS = false, total = 0;
  for (const pc of r.track.pieces) {
    const P = PIECES[pc.pid];
    total += P.L;
    let covered = false;
    for (const t of pieceFootprint(pc.pid, pc)) {
      const i = w.idx(t.x, t.y);
      if (w.ptype[i] && w.pz[i] > t.z1 + 1) covered = true;
      for (const e of w.occAt(t.x, t.y)) if (e.id !== r.id && e.z0 > t.z1 + 2) covered = true;
      const s = w.scen[i];
      if (s && SCENERY[s].tall * 4 + w.groundMax(t.x, t.y) > t.z1 + 3 && s <= 3) covered = true;
    }
    if (covered) { L += P.L; if (!inS) sections++; inS = true; } else inS = false;
  }
  return { L, sections, frac: total ? L / total : 0 };
}

/** Proximity score (subset of spec 8.7.5). */
function proximityScore(game, r) {
  const w = game.w;
  const c = { aboveWater: 0, surface: 0, water2: 0, highWater: 0, ground: 0, queueUnder: 0, queueTouch: 0, pathBelow: 0, pathAbove: 0, ownClose: 0, ownStack: 0, other: 0, otherClose: 0, scenLow: 0, scenHigh: 0, pathBeside: 0, cutting: 0 };
  for (const pc of r.track.pieces) {
    const fp = pieceFootprint(pc.pid, pc);
    const t = fp[Math.floor(fp.length / 2)];
    const i = w.idx(t.x, t.y);
    const pz = (t.z0 + t.z1) / 2;
    const g = w.groundMax(t.x, t.y);
    if (w.wet(t.x, t.y)) {
      const wl = w.water[i];
      c.aboveWater++;
      if (pz - wl <= 1) c.surface++;
      else if (pz - wl <= 3) c.water2++;
      if (pz - wl >= 16) c.highWater++;
    } else if (t.z0 - g <= 1) c.ground++;
    if (w.ptype[i]) {
      const p = w.pz[i];
      if (p < t.z0) { if (w.ptype[i] === 2) { c.queueUnder++; if (t.z0 - p <= 6) c.queueTouch++; } else c.pathBelow++; }
      else c.pathAbove++;
    }
    for (const e of w.occAt(t.x, t.y)) {
      if (e.k !== 'track') continue;
      if (e.id === r.id) { if (e.pi !== undefined && Math.abs(e.z0 - t.z0) > 2) { if (Math.abs(e.z0 - t.z0) <= 10) c.ownClose++; else c.ownStack++; } }
      else { if (Math.abs(e.z0 - t.z0) <= 10) c.otherClose++; else c.other++; }
    }
    for (let d = 0; d < 4; d++) {
      const nx = t.x + DX[d], ny = t.y + DY[d];
      if (!w.inMap(nx, ny)) continue;
      const j = w.idx(nx, ny);
      if (w.scen[j]) { if (t.z0 - w.groundMax(nx, ny) > 4) c.scenLow++; else c.scenHigh++; }
      if (w.ptype[j] && Math.abs(w.pz[j] - t.z0) <= 2) c.pathBeside++;
      if (w.groundMin(nx, ny) > t.z1 + 2) c.cutting++;
    }
  }
  const cap = (x, m) => Math.min(x, m);
  const capPlus = (x, a, m) => (x === 0 ? 0 : Math.min(x + a, m));
  let s = 0;
  s += cap(c.aboveWater, 60) * 0.667 + cap(c.surface, 22) * 2.27 + cap(c.water2, 10) * 2.0 + cap(c.highWater, 40) * 0.625;
  s += cap(c.ground, 70) * 1.714;
  s += cap(c.queueUnder + 8, 12) * 6.25 + (c.queueTouch ? 40 : 0);
  s += capPlus(c.pathBelow, 10, 20) * 3.75 + capPlus(c.pathAbove, 10, 20) * 4.25;
  s += capPlus(c.ownStack, 10, 15) * 3.33 + cap(c.ownClose, 5) * 6.0;
  s += capPlus(c.other, 10, 15) * 2.67 + cap(c.otherClose, 5) * 9.0;
  s += cap(c.scenLow, 35) * 1.43 + cap(c.scenHigh, 35) * 0.857;
  s += capPlus(c.pathBeside, 10, 20) * 1.75 + capPlus(c.cutting, 10, 20) * 2.5;
  return Math.round(s);
}

function refreshUpkeep(r) {
  const def = rideDef(r);
  if (r.kind === 'stall') { r.upkeep = def.upkeep; return; }
  if (r.kind === 'flat') {
    const L = def.sections ? towerHu(r) * 2 * 0.8 : 0;
    r.upkeep = rideUpkeep(def.upkeep, { L, cars: def.sections ? 1 : 0 });
    return;
  }
  const lay = layoutStats(r.track.pieces);
  r.upkeep = rideUpkeep(def.upkeep, {
    lifts: lay.lifts, L: r.measure ? r.measure.L : lay.L, brakes: lay.brakes,
    trains: r.type === 'coaster' ? 1 : (r.vehicles.length || r.vehCount), cars: r.type === 'coaster' ? r.cars : r.vehCount, stations: lay.stations ? 1 : 0,
  });
}

/** Recompute ratings (flat rides immediately; tracked rides from their last test). */
export function refreshRatings(game, r) {
  if (r.kind === 'stall') { refreshUpkeep(r); return; }
  if (r.kind === 'flat') {
    const def = FLAT_RIDES[r.type];
    r.scenery = sceneryScore(countScenery(game, r));
    r.ratings = flatRideRatings(def, { option: r.option, towerHu: towerHu(r), scenery: r.scenery, proximity: 0 });
    r.sheltered = !!def.sheltered;
  } else {
    if (!r.circuit && r.track.closed) r.circuit = buildCircuit(r.track.pieces, { flume: r.type === 'flume' });
    if (r.circuit && (!r.vehicles || !r.vehicles.length)) resetVehicles(game, r);
    if (r.measure) {
      r.measure.scenery = sceneryScore(countScenery(game, r));
      computeTrackRatings(r);
    }
    r.gforce = r.type === 'coaster';
    r.reride = true;
    r.highDrop = r.measure ? r.measure.H : 0;
  }
  refreshUpkeep(r);
  updateValue(game, r);
}

export function updateValue(game, r) {
  if (r.kind === 'stall' || !r.ratings) { r.value = null; return; }
  const def = rideDef(r);
  const dup = game.rides.some((x) => x !== r && x.type === r.type && x.status === 'open') && r.status === 'open';
  r.value = rideValue(r.ratings, def.mult, game.absMonth - r.built, dup);
}

export function backgroundRatings(game) {
  const rs = game.rides.filter((r) => r.kind !== 'stall' && (r.status !== 'closed'));
  if (!rs.length) return;
  const r = rs[(game.tick >> 10) % rs.length];
  refreshRatings(game, r);
}

// ------------------------------------------------------------------ per-tick operation
export function rideTick(game, r) {
  if ((game.tick % 960) === 0) { r.custBuckets.shift(); r.custBuckets.push(r.custCur || 0); r.custCur = 0; }
  if (r.kind === 'stall') return;
  queueTick(game, r);
  if (r.kind === 'flat') flatTick(game, r);
  else if (r.circuit) trackTick(game, r);
}

function guestById(game, id) {
  // guests are kept in id order (append-only, filtered) so binary search works
  const a = game.guests;
  let lo = 0, hi = a.length - 1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (a[m].id === id) return a[m];
    if (a[m].id < id) lo = m + 1; else hi = m - 1;
  }
  return null;
}
export { guestById };

function queueTick(game, r) {
  if (!r.queue.length) return;
  const rng = game.rng;
  for (let k = 0; k < r.queue.length; k++) {
    const g = guestById(game, r.queue[k]);
    if (!g || g.state !== 'queuing') { r.queue.splice(k, 1); k--; continue; }
    const target = k * QSP;
    if (g.qd > target) g.qd = Math.max(target, g.qd - (0.016 * Math.max(95, g.energy)) / 96);
    g.qTime++;
    const p = queuePoint(r, g.qd);
    g.x = p.x; g.y = p.y; g.z = p.z;
    if (p.dx !== undefined) g.dir = Math.abs(p.dx) > Math.abs(p.dy) ? (p.dx > 0 ? 2 : 0) : (p.dy > 0 ? 3 : 1);
    if (g.qTime >= 3500 && rng.rand(65536) < 93) addThought(g, 'waitedLong', r.id, game.tick);
    if (g.qTime >= 4300 && g.happy <= 65 && rng.rand(65536) < 2184) { leaveQueue(game, g, r); k--; }
  }
}

function boardFromQueue(game, r, seats, list) {
  let n = 0;
  while (seats > 0 && r.queue.length) {
    const g = guestById(game, r.queue[0]);
    if (!g) { r.queue.shift(); continue; }
    if (g.qd > 0.08) break;
    r.queue.shift();
    if (!onBoard(game, g, r)) { r.queue.unshift(g.id); leaveQueue(game, g, r); continue; }
    list.push(g.id);
    seats--; n++;
  }
  return n;
}

function flatRunTicks(r) {
  const d = FLAT_RIDES[r.type];
  if (r.type === 'droptower') { const h = towerHu(r); return h * 4 + 80 + Math.ceil(h * 1.2) + 60; }
  if (r.type === 'obstower') { const h = towerHu(r); return h * 8 + 320 + h * 8; }
  return r.option * d.unitTicks;
}

function flatTick(game, r) {
  const d = FLAT_RIDES[r.type];
  if (r.broken && r.phase !== 'loading') return; // frozen where it stopped
  r.phaseT++;
  if (r.phase === 'loading') {
    if (r.broken) return;
    if (r.status === 'open') boardFromQueue(game, r, d.cap - r.riders.length, r.riders);
    const go = r.riders.length >= d.cap || (r.riders.length > 0 && r.phaseT >= d.loadTicks) || (r.status === 'testing' && r.phaseT >= d.loadTicks);
    if (go) { r.phase = 'running'; r.phaseT = 0; r.runTicks = flatRunTicks(r); r.controlFailed = false; }
  } else if (r.phase === 'running') {
    if (r.phaseT >= r.runTicks) { r.phase = 'unloading'; r.phaseT = 0; }
  } else if (r.phase === 'unloading') {
    if (r.phaseT >= 40) {
      for (const gid of r.riders) { const g = guestById(game, gid); if (g) onUnload(game, g, r); }
      r.riders = [];
      r.phase = 'loading'; r.phaseT = 0;
    }
  }
}

function trackTick(game, r) {
  const c = r.circuit;
  const def = TRACK_RIDES[r.type];
  const vs = r.vehicles;
  if (!vs.length) return;
  // order by position to compute leader gaps
  const n = vs.length;
  for (let k = 0; k < n; k++) {
    const v = vs[k];
    const cfg = trackCfg(r, v);
    if (n > 1) {
      let best = Infinity;
      for (let j = 0; j < n; j++) {
        if (j === k) continue;
        let gap = vs[j].s - v.s;
        if (gap <= 0) gap += c.total;
        gap -= vs[j].cars * vs[j].carLen;
        if (gap < best) best = gap;
      }
      cfg.leaderGap = best;
    }
    if (v.state === 'loading') {
      v.waitT++;
      if (r.broken || r.status === 'closed') continue;
      if (r.testing && !v.testRun) continue;
      if (r.status === 'open' && r.tested && !r.broken) {
        const seats = v.cars * def.seats - v.riders.length;
        if (seats > 0) boardFromQueue(game, r, seats, v.riders);
      }
      const cap = v.cars * def.seats;
      const need = [1, Math.ceil(cap / 4), Math.ceil(cap / 2), Math.ceil(cap * 3 / 4), cap][r.loadMode] || 1;
      const minW = r.minWait * RIDE_SECOND, maxW = r.maxWait * RIDE_SECOND;
      let go = (v.riders.length >= need && v.waitT >= minW) || (v.waitT >= maxW && v.riders.length > 0);
      if (r.status === 'testing' && v.waitT >= minW && !r.testing) go = true;
      if (go) { v.state = 'departing'; v.lapsLeft = r.type === 'karts' ? r.laps : 1; v.waitT = 0; }
      continue;
    }
    if (v.state === 'held') continue;
    if (r.broken === 'cutout' && v.state !== 'arriving' && (v.state === 'departing' || c.samples[sampleIndex(c, v.s)].lift)) continue; // halted
    const ev = stepVehicle(v, c, cfg, v.measure || null);
    if (v.measure) v.measure.cars = v.cars;
    if (ev === 'arrived') {
      for (const gid of v.riders) { const g = guestById(game, gid); if (g) onUnload(game, g, r); }
      v.riders = [];
      v.state = 'loading'; v.waitT = 0;
      if (v.testRun) finishTest(game, r, v);
    } else if (ev === 'stalled') {
      const why = 'it ran out of speed before finishing the circuit. Try a taller lift hill or gentler climbs.';
      game.notify(`${r.name} failed its test run: ${why}`, { kind: 'ride', id: r.id }, 'bad');
      r.testing = false;
      setStatus(game, r, 'closed');
      resetVehicles(game, r);
      return;
    }
  }
  // the vehicle at the platform must be the one in 'loading'; others queue behind it
  for (const v of vs) {
    if (v.state === 'unloading') { v.state = 'loading'; v.waitT = 0; }
  }
}

// ------------------------------------------------------------------ reliability (spec 8.10)
export function reliabilityStep(game) {
  const rng = game.rng;
  for (const r of game.rides) {
    if (r.kind === 'stall' || r.status === 'closed') continue;
    if (r.broken) {
      r.downB[0]++;
      r.brokenChecks = (r.brokenChecks || 0) + 1;
      if (r.brokenChecks % 16 === 0) game.notify(`${r.name} is still broken down.`, { kind: 'ride', id: r.id }, 'warn');
      callMechanic(game, r, 'fix');
      continue;
    }
    const def = rideDef(r);
    const years = Math.floor((game.absMonth - r.built) / 8);
    let u = def.unrel + (r.kind === 'track' && r.type === 'coaster' ? Math.max(0, r.liftSpeed - 4) * 2 : 0);
    const age = years === 0 ? 0 : years === 1 ? u / 8 : years === 2 ? u / 4 : years <= 4 ? u / 2 : years <= 7 ? u : 2 * u;
    r.rel = Math.max(0, r.rel - Math.round(u + age));
    if (r.rel === 0 || rng.rand(3145728) <= 25856 - r.rel) breakDown(game, r);
    if (r.due) callMechanic(game, r, 'inspect');
  }
}

function breakDown(game, r) {
  if (globalThis.DEBUG_BD) console.log("BD", r.name, game.tick, r.rel);
  const def = rideDef(r);
  const opts = [];
  for (const b of def.breakdowns) {
    let wgt = BREAKDOWNS[b].w;
    if (b === 'brakes') {
      if (game.absMonth - r.built < 16 || r.rel > 12800) continue;
      if (game.raining) wgt = 20;
    }
    opts.push([b, wgt]);
  }
  if (!opts.length) return;
  let tot = opts.reduce((a, b) => a + b[1], 0);
  let x = game.rng.rand(tot), pick = opts[0][0];
  for (const [b, wgt] of opts) { if (x < wgt) { pick = b; break; } x -= wgt; }
  r.broken = pick; r.brokenAt = game.tick; r.brokenChecks = 0;
  r.lastBreak = BREAKDOWNS[pick].name;
  if (pick === 'control') r.controlFailed = true;
  game.notify(`${r.name} has broken down: ${BREAKDOWNS[pick].name.toLowerCase()}.`, { kind: 'ride', id: r.id }, 'bad');
  game.emit({ type: 'breakdown', ride: r.id });
  callMechanic(game, r, 'fix');
}

export function callMechanic(game, r, kind) {
  if (r.mechanic != null) {
    const s = game.staff.find((x) => x.id === r.mechanic);
    if (s && s.task && s.task.ride === r.id) { if (kind === 'fix') s.task.kind = 'fix'; return; }
    r.mechanic = null;
  }
  if (r.exitAccess == null && !r.access.length) return;
  const tx = r.exit ? r.exit.x : r.x, ty = r.exit ? r.exit.y : r.y;
  let best = null, bd = 1e9;
  for (const s of game.staff) {
    if (s.type !== 'mechanic' || s.task) continue;
    if (kind === 'fix' && !s.duties.fix) continue;
    if (kind === 'inspect' && !s.duties.inspect) continue;
    const d = Math.abs(s.tx - tx) + Math.abs(s.ty - ty);
    if (d < bd) { bd = d; best = s; }
  }
  if (!best && kind === 'fix') {
    // redirect a mechanic who is only on an inspection
    for (const s of game.staff) if (s.type === 'mechanic' && s.task && s.task.kind === 'inspect' && s.duties.fix) {
      const old = game.ride(s.task.ride); if (old) old.mechanic = null;
      best = s; break;
    }
  }
  if (!best) return;
  best.task = { kind, ride: r.id, stage: 'walk' };
  best.workT = 0;
  r.mechanic = best.id;
}

/** Mechanic finished work on a ride. */
export function mechanicDone(game, s, r, kind) {
  r.mechanic = null;
  if (kind === 'fix' && r.broken) {
    const relPct = r.rel / 256;
    // spec: reliability% += 96 x (100 - reliability%) / 2 / 256   (stored x256)
    r.rel = Math.min(25600, Math.round(r.rel + ((96 * (100 - relPct)) / 512) * 256));
    r.broken = null; r.controlFailed = false;
    s.stats.fixed = (s.stats.fixed || 0) + 1;
    r.lastFix = game.dateString();
    game.notify(`${r.name} has been repaired.`, { kind: 'ride', id: r.id }, 'good');
    game.recalcPark();
  } else if (kind === 'inspect') {
    const relPct = r.rel / 256;
    r.rel = Math.min(25600, Math.round(r.rel + ((100 - relPct) / 4) * (game.rng.rand(256) / 256) * 256));
    r.minsSince = 0; r.due = false;
    s.stats.inspected = (s.stats.inspected || 0) + 1;
  }
}

export function inspectionStep(game) {
  for (const r of game.rides) {
    if (r.kind === 'stall' || r.status === 'closed') continue;
    r.minsSince++;
    if (r.inspectEvery > 0 && r.minsSince >= r.inspectEvery && !r.broken) { r.due = true; callMechanic(game, r, 'inspect'); }
  }
}

export function downtimeStep(game) {
  for (const r of game.rides) {
    if (r.kind === 'stall') continue;
    r.downtime = Math.min(100, Math.floor(r.downB.reduce((a, b) => a + b, 0) / 2));
    r.downB.pop(); r.downB.unshift(0);
  }
}

export function dailyRide(game, r) { void game; void r; }

// ------------------------------------------------------------------ save / load
export function saveRide(r) {
  const o = Object.assign({}, r);
  delete o.circuit; delete o.qpts; delete o.access; delete o.exitAccess; delete o.chain;
  if (o.vehicles) o.vehicles = o.vehicles.map((v) => Object.assign({}, v, { measure: null, testRun: false }));
  return o;
}
export function loadRide(game, o) {
  const r = Object.assign({}, o);
  r.qpts = []; r.access = []; r.exitAccess = null;
  if (r.kind === 'track') {
    r.circuit = r.track.closed ? buildCircuit(r.track.pieces, { flume: r.type === 'flume' }) : null;
    if (r.testing) { r.testing = false; r.vehicles = []; }
    if (r.circuit && (!r.vehicles || !r.vehicles.length)) resetVehicles(game, r);
  }
  return r;
}

/** Vehicle car poses for rendering: [{x,y,z,tx,ty,tz,ux,uy,uz, riders}] */
export function vehiclePoses(r) {
  const out = [];
  if (!r.circuit) return out;
  for (const v of r.vehicles) {
    for (let c = 0; c < v.cars; c++) {
      const p = poseAt(r.circuit, v.s - c * v.carLen - v.carLen * 0.5);
      p.riders = Math.max(0, Math.min(TRACK_RIDES[r.type].seats, v.riders.length - c * TRACK_RIDES[r.type].seats));
      p.v = v.v;
      out.push(p);
    }
  }
  return out;
}

export { DIRS };
void updatePos;
