// Skyrise — people: travel along routes, stress, and daily behaviour (spec 6).
import { FAC, isLobbyLevel, STRESS_MAX } from './data.js';
import { dayTick, dayType, addMinutes, clockToTick, nextAt, DAY_TICKS, tickToMin } from './clock.js';

export const WALK_SPEED = 0.6;   // units per tick
export const STAIR_TICKS = 6;    // per flight
export const ESC_TICKS = 4;      // per floor
export const GIVE_UP = 300;      // ticks in one queue

const FIRST = ['Ada', 'Bruno', 'Cleo', 'Dev', 'Esme', 'Farid', 'Gus', 'Hana', 'Ivo', 'June', 'Kofi', 'Lena', 'Milo', 'Nell', 'Otto', 'Pia', 'Quin', 'Rosa', 'Sami', 'Tess', 'Ugo', 'Vera', 'Wes', 'Xena', 'Yuri', 'Zola', 'Arlo', 'Bea', 'Cyrus', 'Dot', 'Eli', 'Fern', 'Gil', 'Hal', 'Iris', 'Jem', 'Kit', 'Lark', 'Mae', 'Nico'];
const LAST = ['Pell', 'Varga', 'Okafor', 'Lindqvist', 'Moreau', 'Tanaka', 'Quill', 'Abara', 'Kowal', 'Brandt', 'Ferro', 'Nakamura', 'Osei', 'Reyes', 'Sato', 'Hollis', 'Marsh', 'Ivers', 'Dunmore', 'Achebe', 'Castell', 'Wren', 'Juarez', 'Kemp', 'Lowe'];

export function personName(p) {
  if (p.name) return p.name;
  const a = FIRST[p.id % FIRST.length], b = LAST[(p.id * 7 + 3) % LAST.length];
  return a + ' ' + b;
}

export function newPerson(game, kind, home, opts = {}) {
  const p = {
    id: game.nextPid++, kind, home, state: 'off', at: 0, L: 0, x: 0, px: 0, pL: 0,
    steps: null, si: 0, stress: 0, wait: 0, goal: null, goalFac: 0, after: null,
    look: game.rng.int(0, 3), face: 1, ft: 0, fn: 0, origin: 0, name: '', _dest: 0,
  };
  Object.assign(p, opts);
  game.people.set(p.id, p);
  return p;
}

export function addStress(p, v) {
  p.stress = Math.max(0, Math.min(STRESS_MAX, p.stress + v));
}

export function accessPoint(f) {
  return { L: FAC[f.type] && FAC[f.type].accessTop ? f.L + f.h - 1 : f.L, x: f.x + Math.floor(f.w / 2) };
}

// Plan a trip. dest: facility object or 'street'. from: optional facility (defaults to where p is).
export function travel(game, p, dest, goal, opts = {}) {
  if (p.dead) return false;
  let from;
  if (opts.fromFac) from = accessPoint(opts.fromFac);
  else if (p.state === 'off') from = { street: true };
  else if (p.state === 'in') {
    const f = game.tower.facs.get(p.at);
    from = f ? accessPoint(f) : { L: p.L, x: p.x };
  } else from = { L: p.L, x: Math.round(p.x) };
  const to = dest === 'street' ? { street: true } : accessPoint(dest);
  const cls = p.kind === 'keeper' ? 'staff' : 'normal';
  const r = game.router.find(from, to, cls);
  if (!r) return false;
  detach(game, p);
  if (p.rest) { p.stress *= 0.5; p.rest = false; }
  p.origin = p.state === 'in' ? p.at : 0;
  if (opts.fromFac && p.state === 'off') { p.L = from.L; p.x = from.x; p.state = 'walk'; }
  p.steps = r.steps; p.si = 0; p.goal = goal; p.goalFac = dest === 'street' ? 0 : dest.id;
  p.wait = 0; p.walkFloor = null;
  if (p.state === 'in') {
    const f = game.tower.facs.get(p.at);
    if (f) { const a = accessPoint(f); p.L = a.L; p.x = a.x; }
    removeFrom(f, p);
  }
  p.px = p.x; p.pL = p.L;
  startStep(game, p);
  return true;
}

function removeFrom(f, p) {
  if (f && f.here) { const i = f.here.indexOf(p.id); if (i >= 0) f.here.splice(i, 1); }
}

// take the person out of any queue/car/mover set
export function detach(game, p) {
  if (p.state === 'queue' && p.shaft) { const s = game.tower.trans.get(p.shaft); if (s && s.removeFromQueues) s.removeFromQueues(p); }
  if (p.state === 'ride' && p.shaft) {
    const s = game.tower.trans.get(p.shaft);
    if (s) for (const c of s.cars) { const i = c.pax.indexOf(p); if (i >= 0) c.pax.splice(i, 1); }
  }
  game.movers.delete(p);
}

function maybeSwapShaft(game, p, walkStep, elevStep) {
  // load balancing between parallel shafts: compare queue length plus walk
  const T = game.tower;
  const s0 = T.trans.get(elevStep.sid);
  if (!s0) return;
  const dir = elevStep.to > elevStep.from ? 1 : -1;
  const seg = T.segAt(elevStep.from, walkStep.x);
  const cost = (s) => Math.abs(s.cx - p.x) + (s.qlen(elevStep.from, dir) + 1) / (s.cars.length * s.cap) * 80 + (s.kind === 'express' ? 15 : 0);
  let best = s0, bc = cost(s0);
  for (const s of T.trans.values()) {
    if (!s.cars || s === s0) continue;
    if ((s.kind === 'service') !== (s0.kind === 'service')) continue;
    if (!T.shaftServes(s, elevStep.from) || !T.shaftServes(s, elevStep.to)) continue;
    if (T.segAt(elevStep.from, s.cx) !== seg) continue;
    if (Math.abs(s.cx - walkStep.x) > 30) continue;
    const c = cost(s);
    if (c + 5 < bc) { bc = c; best = s; }
  }
  if (best !== s0) { walkStep.x = best.cx; elevStep.sid = best.id; }
}

export function startStep(game, p) {
  for (let guard = 0; guard < 20; guard++) {
    const s = p.steps && p.steps[p.si];
    if (!s) { arrive(game, p); return; }
    switch (s.t) {
      case 'appear':
        p.L = s.L; p.x = s.x; p.px = s.x; p.pL = s.L; p.state = 'walk'; p.si++;
        continue;
      case 'exit':
        p.state = 'off'; p.si++;
        continue;
      case 'walk': {
        if (p.L !== s.L) { p.L = s.L; }
        const nx = p.steps[p.si + 1];
        if (nx && nx.t === 'elev') maybeSwapShaft(game, p, s, nx);
        p.state = 'walk'; p.tx = s.x; p.walkFloor = 0;
        game.movers.add(p);
        return;
      }
      case 'stairs': case 'esc':
        p.state = 'flight'; p.ft = 0; p.fn = s.t === 'stairs' ? STAIR_TICKS : ESC_TICKS;
        p.fs = s; addStress(p, s.t === 'stairs' ? 10 : 1);
        game.movers.add(p);
        return;
      case 'elev': {
        const sh = game.tower.trans.get(s.sid);
        if (!sh || !sh.cars || !game.tower.shaftServes(sh, s.from) || !game.tower.shaftServes(sh, s.to)) { reroute(game, p); return; }
        p.state = 'queue'; p.shaft = sh.id; p._dest = s.to; p.wait = 0;
        p.x = sh.cx; p.L = s.from;
        sh.call(p, s.from, s.to > s.from ? 1 : -1, game.t);
        game.movers.delete(p);
        return;
      }
    }
  }
}

// someone's route broke under them: find a new one from where they stand
export function reroute(game, p) {
  if (p.dead) return;
  const goal = p.goal, gf = p.goalFac;
  const dest = gf ? game.tower.facs.get(gf) : 'street';
  detach(game, p);
  if (p.state === 'ride' || p.state === 'queue') { p.L = Math.round(p.L); }
  p.state = 'walk';
  if (dest && travel(game, p, dest, goal)) return;
  // no way: put them back where they came from, or out of the building
  bail(game, p);
}

// give up: back to the origin facility, or out of the building
export function bail(game, p) {
  detach(game, p);
  const o = p.origin && game.tower.facs.get(p.origin);
  if (o && !p.transient) { placeIn(game, p, o); }
  else if (p.transient) { removePerson(game, p); }
  else { p.state = 'off'; p.at = 0; }
}

export function placeIn(game, p, f) {
  detach(game, p);
  p.state = 'in'; p.at = f.id;
  const a = accessPoint(f); p.L = a.L; p.x = a.x;
  if (!f.here) f.here = [];
  if (!f.here.includes(p.id)) f.here.push(p.id);
}

export function removePerson(game, p) {
  detach(game, p);
  const f = p.at && game.tower.facs.get(p.at);
  removeFrom(f, p);
  p.dead = true; p.state = 'gone';
  game.people.delete(p.id);
  if (game.named.people.includes(p.id)) game.named.people = game.named.people.filter(i => i !== p.id);
}

export function updateMovers(game) {
  for (const p of game.movers) {
    p.px = p.x; p.pL = p.L;
    if (p.state === 'walk') {
      const d = p.tx - p.x;
      const m = Math.min(WALK_SPEED, Math.abs(d));
      p.face = d >= 0 ? 1 : -1;
      p.x += Math.sign(d) * m;
      addStress(p, 0.15 * m);
      p.walkFloor += m;
      if (p.walkFloor > 60 && p.walkFloor - m <= 60) addStress(p, 20);
      if (Math.abs(p.tx - p.x) < 1e-6) { p.x = p.tx; p.si++; game.movers.delete(p); startStep(game, p); }
    } else if (p.state === 'flight') {
      const s = p.fs;
      p.ft++;
      const k = p.ft / p.fn;
      p.x = s.x0 + (s.x1 - s.x0) * k;
      p.L = s.L0 + (s.L1 - s.L0) * k;
      p.face = s.x1 >= s.x0 ? 1 : -1;
      if (p.ft >= p.fn) { p.L = s.L1; p.x = s.x1; p.si++; game.movers.delete(p); startStep(game, p); }
    } else {
      game.movers.delete(p);
    }
  }
}

export function onBoard(game, p, car, shaft) {
  p.state = 'ride'; p.car = car;
}
export function onAlight(game, p, L, shaft) {
  p.state = 'walk'; p.L = L; p.x = shaft.cx; p.px = p.x; p.pL = L; p.car = null; p.si++;
  startStep(game, p);
}

// per tick stress for waiting and riding, plus giving up
export function transitStress(game) {
  const lf = [1, 1, 0.75, 0.5][game.tower.lobbyHeight || 1];
  for (const s of game.shafts()) {
    for (const q of s.queues.values()) {
      const f = q.L === 0 ? lf : 1;
      for (let i = 0; i < q.people.length; i++) {
        const p = q.people[i];
        p.wait++;
        addStress(p, f);
        if (p.wait >= GIVE_UP) {
          q.people.splice(i, 1); i--;
          game.gaveUp(p);
        }
      }
    }
    for (const c of s.cars) for (const p of c.pax) addStress(p, 0.2);
  }
}

// ---------------------------------------------------------------- behaviour
function rngTick(game, base, h0, m0, h1, m1) {
  const a = clockToTick(h0, m0), b = clockToTick(h1, m1);
  return base + game.rng.int(a, b);
}

// called at midnight for each permanent person; base = absolute tick of the coming 07:00
export function planDay(game, p, base, dtype) {
  const weekday = dtype !== 2;
  const r = game.rng;
  switch (p.kind) {
    case 'worker': case 'sales':
      if (!weekday) return;
      game.timer(p, rngTick(game, base, 7, 0, 8, 0), 'commute');
      if (p.kind === 'sales') {
        game.timer(p, rngTick(game, base, 8, 30, 9, 30), 'errand');
        game.timer(p, rngTick(game, base, 13, 0, 15, 0), 'errandBack');
      } else {
        game.timer(p, rngTick(game, base, 12, 0, 12, 12), 'lunch');
      }
      game.timer(p, rngTick(game, base, 17, 0, 19, 0), 'gohome');
      return;
    case 'resident': case 'child': {
      if (weekday) {
        if (p.kind === 'child') {
          game.timer(p, base + clockToTick(7, 30) + r.int(0, 6), 'leave');
          game.timer(p, base + (r.chance(0.5) ? clockToTick(15, 30) : clockToTick(17, 30)) + r.int(0, 8), 'return');
        } else {
          // late jitter more likely than early
          const k = Math.sqrt(r.next());
          const lt = Math.round(clockToTick(7, 30) + k * (clockToTick(9, 30) - clockToTick(7, 30)));
          game.timer(p, base + lt, 'leave');
          game.timer(p, rngTick(game, base, 17, 30, 19, 30), 'return');
        }
      } else {
        if (r.chance(0.7)) game.timer(p, rngTick(game, base, 10, 0, 12, 0), 'outing');
      }
      return;
    }
    case 'keeper':
      game.timer(p, base + clockToTick(10, 0) + r.int(0, 4), 'shift');
      game.timer(p, base + clockToTick(17, 0), 'shiftEnd');
      return;
  }
}

function weekdayNow(game) { return dayType(game.t) !== 2; }

// find an open commercial facility for a customer near point a
export function pickVenue(game, from, types, opts = {}) {
  const c = [];
  const fa = accessPoint(from);
  for (const f of game.commercial()) {
    if (!types.includes(f.type)) continue;
    if (!game.isOpenNow(f)) continue;
    if (f.today >= FAC[f.type].cap) continue;
    if (opts.maxFloors !== undefined && Math.abs(f.L - fa.L) > opts.maxFloors) continue;
    if (opts.underOnly && f.L >= 0) continue;
    const d = Math.abs(f.L - fa.L) * 6 + Math.abs(f.x - fa.x) / 10;
    c.push([d, f]);
  }
  c.sort((a, b) => a[0] - b[0]);
  const top = c.slice(0, 4).map(e => e[1]);
  // shuffle lightly
  for (let i = top.length - 1; i > 0; i--) { const j = game.rng.int(0, i); [top[i], top[j]] = [top[j], top[i]]; }
  return top;
}

export function goEat(game, p, types, after, opts) {
  const here = game.tower.facs.get(p.at) || (p.home && game.tower.facs.get(p.home));
  if (!here) return false;
  for (const f of pickVenue(game, here, types, opts)) {
    p.after = after;
    if (travel(game, p, f, 'eat')) return true;
  }
  return false;
}

export function onTimer(game, p, action) {
  const T = game.tower;
  const home = p.home && T.facs.get(p.home);
  switch (action) {
    case 'commute': case 'errandBack':
      if (p.state !== 'off' || !home || !home.occupied) return;
      if (game.transitStation() && game.rng.chance(0.3) && action === 'commute') {
        const st = game.transitStation();
        if (travel(game, p, home, 'work', { fromFac: st })) return;
      }
      if (!travel(game, p, home, 'work')) home.pen = (home.pen || 0) + 5;
      return;
    case 'errand':
      if (p.state === 'in' && p.at === p.home) travel(game, p, 'street', 'off');
      return;
    case 'lunch':
      if (p.state === 'in' && p.at === p.home) goEat(game, p, ['fastfood'], 'home', { maxFloors: 20 });
      return;
    case 'gohome':
      if (p.state === 'in' && p.at === p.home) travel(game, p, 'street', 'off');
      else if (p.state !== 'off' && dayTick(game.t) < clockToTick(21, 0)) game.timer(p, game.t + 30, 'gohome');
      return;
    case 'leave':
      if (p.state === 'in' && p.at === p.home) travel(game, p, 'street', 'off');
      return;
    case 'return':
      if (p.state === 'off' && home && home.occupied) { if (!travel(game, p, home, 'home')) { placeIn(game, p, home); addStress(p, 40); } }
      return;
    case 'outing':
      if (p.state === 'in' && p.at === p.home) {
        if (!goEat(game, p, ['shop', 'fastfood', 'restaurant'], 'home', { maxFloors: 30 })) {
          if (travel(game, p, 'street', 'off')) game.timer(p, game.t + game.rng.int(250, 500), 'return');
        }
      }
      return;
    case 'eatDone':
      if (p.state !== 'in') return;
      leaveVenue(game, p);
      return;
    case 'dinner':
      if (p.state === 'in' && p.at === p.home) {
        if (!goEat(game, p, ['restaurant', 'fastfood'], 'home', { maxFloors: 30 })) {
          if (travel(game, p, 'street', 'off')) game.timer(p, addMinutes(game.t, game.rng.int(60, 120)), 'comeback');
        }
      }
      return;
    case 'comeback':
      if (p.state === 'off' && home && (home.hstate === 'occupied' || home.hstate === 'booked')) {
        if (!travel(game, p, home, 'room')) placeIn(game, p, home);
      }
      return;
    case 'checkout':
      game.checkout(p);
      return;
    case 'shift':
      p.onShift = true;
      game.keeperIdle(p);
      return;
    case 'shiftEnd':
      p.onShift = false;
      if (p.state === 'in' && p.at !== p.home && !p.cleaning) { if (!travel(game, p, home, 'hk')) placeIn(game, p, home); }
      return;
    case 'cleaned':
      game.roomCleaned(p);
      return;
    case 'visitLeave':
      if (p.state === 'in') leaveVenue(game, p);
      return;
    case 'clinicDone':
      if (p.state === 'in') { if (!(home && travel(game, p, home, 'work'))) bail(game, p); }
      return;
  }
}

export function leaveVenue(game, p) {
  const T = game.tower;
  const home = p.home && T.facs.get(p.home);
  const after = p.after;
  p.after = null;
  if (after === 'home' && home) {
    const goal = home.type === 'office' ? 'work' : FAC[home.type].hotel ? 'room' : 'home';
    if (travel(game, p, home, goal)) return;
    placeIn(game, p, home); return;
  }
  if (after === 'station') {
    const st = game.transitStation();
    if (st && travel(game, p, st, 'gone')) return;
  }
  if (!travel(game, p, 'street', 'gone')) removePerson(game, p);
}

export function arrive(game, p) {
  const T = game.tower;
  game.movers.delete(p);
  const goal = p.goal;
  const f = p.goalFac ? T.facs.get(p.goalFac) : null;
  p.steps = null;
  // sample this trip's stress for the home facility's evaluation, then rest
  const hf = p.home && T.facs.get(p.home);
  if (hf && p.steps !== undefined) { hf.sSum = (hf.sSum || 0) + p.stress; hf.sN = (hf.sN || 0) + 1; }
  p.lastTrip = p.stress;
  p.rest = true;
  if (!p.goalFac) { // reached the street
    p.state = 'off'; p.at = 0;
    if (goal === 'gone' || p.transient) { removePerson(game, p); return; }
    if (goal === 'checkoutDone') { removePerson(game, p); return; }
    return;
  }
  if (!f) { bail(game, p); return; }
  placeIn(game, p, f);
  switch (goal) {
    case 'work': case 'home': case 'hk':
      if (goal === 'home' && T.isNoisy(f) && FAC[f.type].sensitive) addStress(p, 40);
      if (goal === 'hk') game.keeperIdle(p);
      return;
    case 'eat': case 'visit': case 'shop': {
      if (!game.isOpenNow(f) || f.today >= FAC[f.type].cap) { leaveVenue(game, p); return; }
      game.addCustomer(f, p);
      const stay = f.type === 'restaurant' ? 40 : 20;
      game.timer(p, game.t + stay + game.rng.int(0, 6), 'eatDone');
      return;
    }
    case 'checkin': case 'room':
      game.guestArrived(p, f, goal === 'checkin');
      return;
    case 'clean':
      game.startCleaning(p, f);
      return;
    case 'cinema': case 'party': case 'wedding':
      game.audienceArrived(p, f);
      return;
    case 'clinic':
      game.timer(p, game.t + 30, 'clinicDone');
      return;
    case 'gone':
      // arrived at the metro station to leave by train
      removePerson(game, p);
      return;
  }
}

export { DAY_TICKS, nextAt, tickToMin, isLobbyLevel };
