// Skyrise — scheduled crowds (cinema, banquets, trains, weddings) and random events (spec 9).
import { FAC, floorLabel, FILMS, FILM_DRAW, evalTier, PRICE_EVAL_OFFSET as PRICE_OFFSET } from './data.js';
import { clockToTick, dayTick, dayType, dateDay, addMinutes, DAY_TICKS, MIDNIGHT_TICK, clockMinutes } from './clock.js';
import * as P from './people.js';

const C = (h, m = 0) => clockToTick(h, m);
const T10 = C(10), T13 = C(13), T15 = C(15), T17 = C(17), T19 = C(19), T21 = C(21), T23 = C(23), T18 = C(18);

function evalFactor(f) { return Math.max(0.3, Math.min(1.2, (f.eval ?? 200) / 200)); }

// midnight planning for the coming day (base = absolute tick of 07:00)
export function planDay(g, base, dtype, isLoad) {
  const r = g.rng;
  const we = dtype === 2;
  if (!isLoad) g.weather = { rain: r.chance(0.2), flashAt: 0 };
  const rain = g.weather.rain ? 0.7 : 1;
  // outside visitors for each open commercial facility
  for (const f of g.commercial()) {
    if (!f.open || !f.reach) continue;
    const d = FAC[f.type];
    let n = r.int(d.visitors[0], d.visitors[1]) * evalFactor(f) * rain;
    if (we && f.type !== 'restaurant') n *= 1.5;
    n = Math.round(Math.min(n, d.cap));
    const [a, b] = f.type === 'restaurant' ? [C(17), C(22)] : [C(10), C(20)];
    for (let i = 0; i < n; i++) {
      const at = base + r.int(a, b);
      if (isLoad && at <= g.t) continue;
      g.arrival(at, { fid: f.id, kind: 'visitor', goal: 'visit', after: 'street' });
    }
  }
  // trains 07:00–23:00 every 30 game minutes
  g.trainTicks = [];
  for (let m = 0; m <= 16 * 60; m += 30) g.trainTicks.push(base + C(7 + Math.floor(m / 60), m % 60));
  if (!isLoad) {
    // fire and bomb rolls (from 3 stars)
    g.fireAt = 0; g.bombAt = 0;
    if (g.star >= 3 && g.facsOf('security').length && r.chance(1 / 300)) g.fireAt = base + r.int(C(9), C(20));
    if (g.star >= 3 && r.chance(1 / 400)) g.bombAt = base + r.int(C(8), C(16, 30));
    // VIP
    if (g.star >= 3 && !g.flags.vipOk && g.facsOf('suite').length && dateDay(base) >= (g.flags.nextVip || 0)) {
      g.flags.vipPending = true;
      g.flags.nextVip = dateDay(base) + 5;
      g.msg('Word is out: a VIP may visit tonight. Keep a clean suite free.', 'notice');
    }
  }
  for (const c of g.facsOf('cinema')) c.filmAge = (c.filmAge || 0) + (isLoad ? 0 : 1);
}

function spawnCrowd(g, f, n, t0, t1, goal) {
  for (let i = 0; i < n; i++) g.arrival(g.t + g.rng.int(Math.max(1, t0 - dayTick(g.t)), Math.max(1, t1 - dayTick(g.t))), { fid: f.id, kind: 'visitor', goal, after: 'street' });
}

function releaseCrowd(g, f, toVenues) {
  for (const pid of [...(f.here || [])]) {
    const p = g.people.get(pid);
    if (!p || !p.transient) continue;
    if (toVenues && g.rng.chance(0.5)) {
      const v = P.pickVenue(g, f, ['shop', 'fastfood', 'restaurant'], { maxFloors: 5 });
      let ok = false;
      for (const vf of v) { p.after = 'street'; if (P.travel(g, p, vf, 'visit')) { ok = true; break; } }
      if (ok) continue;
    }
    if (!P.travel(g, p, 'street', 'gone')) P.removePerson(g, p);
  }
}

export function dailyClock(g, dt) {
  const we = dayType(g.t) === 2;
  const rain = g.weather.rain ? 0.7 : 1;
  // cinema
  if (dt === T13 || dt === T19) {
    for (const f of g.facsOf('cinema')) {
      if (!g.ready(f) || !f.reach) continue;
      const film = FILMS[f.film || 0];
      const draw = FILM_DRAW[film.kind] * Math.pow(0.9, (f.filmAge || 0) / 3);
      const n = Math.round(110 * draw * evalFactor(f) * (we ? 1.3 : 1) * rain);
      f.doors = true;
      spawnCrowd(g, f, n, dt, dt + (T15 - T13) - 10, 'cinema');
    }
  }
  if (dt === T15 || dt === T21) for (const f of g.facsOf('cinema')) { f.showing = g.ready(f); f.doors = false; }
  if (dt === T17 || dt === T23) for (const f of g.facsOf('cinema')) {
    if (!f.showing && !(f.here && f.here.length)) continue;
    f.showing = false;
    const n = (f.here || []).length;
    if (n && !f.burnedToday) g.earn('cinema', n * 60);
    f.lastAudience = n;
    releaseCrowd(g, f, true);
  }
  // banquet hall: needs at least 10 hotel rooms in the tower
  if (dt === T13) {
    const rooms = g.hotelRooms().filter(r => g.ready(r)).length;
    for (const f of g.facsOf('party')) {
      if (!g.ready(f) || !f.reach || rooms < 10) continue;
      f.partying = true; f.arrived = 0;
      spawnCrowd(g, f, Math.round(50 * evalFactor(f) * rain), T13, T15, 'party');
    }
    // weekend wedding at the chapel
    const lm = g.facsOf('landmark')[0];
    if (lm && we && g.ready(lm) && lm.reach) { lm.wedding = true; spawnCrowd(g, lm, 40, T13, T15, 'wedding'); g.msg('Wedding bells today at the sky chapel!', 'notice'); }
  }
  if (dt === T17) {
    for (const f of g.facsOf('party')) {
      if (!f.partying) continue;
      f.partying = false;
      const n = (f.here || []).length;
      if (n && !f.burnedToday) g.earn('party', Math.round(20000 * Math.min(50, n) / 50));
      releaseCrowd(g, f, false);
    }
    const lm = g.facsOf('landmark')[0];
    if (lm && lm.wedding) {
      lm.wedding = false;
      if ((lm.here || []).length) { g.flags.wedding = true; g.emit('sound', { name: 'applause' }); g.msg('The wedding at the sky chapel was a triumph.', null); }
      releaseCrowd(g, lm, false);
    }
  }
  // clinic visits: stressed office workers
  if (dt === C(10, 30)) {
    const clinics = g.facsOf('clinic').filter(f => g.ready(f));
    for (const p of g.people.values()) {
      if ((p.kind !== 'worker') || p.state !== 'in' || p.at !== p.home || p.stress < 150) continue;
      if (!g.rng.chance(0.01)) continue; // 1% of highly stressed workers each day
      const h = g.tower.facs.get(p.home);
      const c = clinics.find(c => Math.abs(c.L - h.L) <= 10);
      if (c) P.travel(g, p, c, 'clinic');
    }
  }
  // trains
  if (g.trainTicks.includes(g.t)) train(g);
  // holiday evening
  if (g.quarter === 4 && we && dt === T19) { g.emit('holiday', {}); g.emit('sound', { name: 'jingle' }); g.msg('Happy holidays from everyone at the tower!', null); }
}

function train(g) {
  const st = g.transitStation();
  if (!st || !st.reach && !g.router.find({ street: true }, P.accessPoint(st))) return;
  st.trainAt = g.t;
  g.emit('sound', { name: 'train', L: st.L, x: st.x });
  const venues = g.commercial().filter(f => f.L < 0 && f.open);
  const rain = g.weather.rain ? 0.7 : 1;
  const n = Math.round(Math.min(40, venues.length * 3) * rain);
  for (let i = 0; i < n; i++) {
    const v = g.rng.pick(venues);
    g.arrival(g.t + g.rng.int(1, 12), { fid: v.id, kind: 'visitor', goal: 'visit', after: 'station', from: st.id });
  }
}

export function tick(g, dt) {
  if (g.fireAt && g.t === g.fireAt) { g.fireAt = 0; startFire(g); }
  if (g.bombAt && g.t === g.bombAt) { g.bombAt = 0; startBomb(g); }
  if (g.fire) fireTick(g);
  if (g.bomb && g.bomb.state === 'search') bombTick(g);
  if (g.weather.rain && g.rng.chance(1 / 500)) { g.weather.flashAt = g.t; g.emit('sound', { name: 'thunder' }); }
}

// ---------------------------------------------------------------- treasure
export function maybeTreasure(g) {
  if (g.flags.treasure || !g.rng.chance(1 / 50)) return;
  g.flags.treasure = true;
  const amt = Math.round(g.rng.int(50, 500)) * 1000;
  g.earn('other', amt);
  g.emit('dialog', { kind: 'treasure', text: 'The diggers struck an old iron strongbox while excavating! It holds $' + amt.toLocaleString() + ' in forgotten bonds, now yours.' });
  g.emit('sound', { name: 'treasure' });
}

// ---------------------------------------------------------------- VIP
export function judgeVip(g, room, stress) {
  // the VIP weighs their own stress (lifts), the suite's evaluation and what it cost them
  const felt = stress + PRICE_OFFSET[room.price];
  const pass = felt < 80 && room.evalTier !== 0 && !room.dirtyArrival;
  if (pass) {
    g.flags.vipOk = true;
    g.emit('dialog', { kind: 'vip', text: 'The VIP checked out smiling: "Quick lifts, a spotless suite. I will be telling everyone." The tower\'s reputation soars.' });
    g.emit('sound', { name: 'applause' });
  } else {
    g.emit('dialog', { kind: 'vip', text: 'The VIP left unimpressed' + (stress >= 80 ? ', grumbling about the wait for the lifts' : room.price === 0 ? ', muttering about the bill' : '') + '. Another visitor may come in a few days.' });
    g.emit('sound', { name: 'refuse' });
  }
}

// ---------------------------------------------------------------- fire
export function startFire(g, target) {
  const cands = [...g.tower.facs.values()].filter(f => f.L >= 1 && f.type !== 'lobby' && f.type !== 'ruin' && f.type !== 'landmark' && (f.occupied || f.open || f.hstate === 'occupied' || target));
  const f = target || g.rng.pick(cands);
  if (!f) return false;
  const x = f.x + (f.w >> 1);
  g.fire = { levels: new Map([[f.L, [x, x + 1]]]), born: g.t, lastUp: g.t, work: 0, origin: f.L, x };
  const secs = g.facsOf('security').filter(s => g.ready(s));
  g.fire.teams = secs.map(s => ({ from: s.L, at: g.t + 20 * Math.abs(s.L - f.L), L: s.L }));
  burnRange(g, f.L, x, x + 1);
  g.emit('dialog', { kind: 'fire', text: 'Fire on floor ' + floorLabel(f.L) + '! ' + (secs.length ? 'Security teams are racing up the emergency stairs.' : 'There is no security post to fight it.') + ' You can call the rescue helicopter for $500,000.' });
  g.emit('sound', { name: 'fireAlarm' });
  return true;
}
function burnRange(g, L, a, b) {
  const T = g.tower;
  let changed = false;
  for (let x = a; x < b; x++) {
    const f = T.facAt(L, x);
    if (!f || f.type === 'lobby' || f.type === 'transit' || f.type === 'landmark') continue;
    if (f.type === 'ruin') { if (!f.burning) { f.burning = true; changed = true; } continue; }
    // destroy the facility: it becomes a burnt-out shell
    for (const p of [...g.people.values()]) {
      if (p.home === f.id) { P.removePerson(g, p); continue; }
      if (p.at === f.id || p.goalFac === f.id) { if (p.transient) P.removePerson(g, p); else { P.detach(g, p); p.state = 'off'; p.at = 0; } }
    }
    const { x: fx, L: fL, w, h } = f;
    f.salePrice = 0;
    T.removeFacility(f.id);
    const r = T.addFacility('ruin', fx, fL, h, w, { burning: true, readyAt: 0, here: [] });
    changed = true;
  }
  if (changed) T.bump();
}
function fireUnits(g) { let n = 0; for (const [a, b] of g.fire.levels.values()) n += b - a; return n; }
function fireTick(g) {
  const F = g.fire, T = g.tower, age = g.t - F.born;
  // growth
  if (age % 30 === 0 && age > 0) {
    for (const [L, r] of F.levels) {
      const ext = T.levelExtent(L) || [r[0], r[1] - 1];
      r[0] = Math.max(ext[0], r[0] - 1); r[1] = Math.min(ext[1] + 1, r[1] + 1);
      burnRange(g, L, r[0], r[1]);
    }
  }
  if (g.t - F.lastUp >= 120) {
    F.lastUp = g.t;
    const top = Math.max(...F.levels.keys());
    if (top + 1 <= 99 && T.hasSlab(top + 1, F.x)) { F.levels.set(top + 1, [F.x, F.x + 1]); burnRange(g, top + 1, F.x, F.x + 1); }
  }
  // fighting
  let rate = 0;
  for (const tm of F.teams) if (g.t >= tm.at) rate += 0.6;
  if (g.heli) {
    const left = Math.max(1, g.heli.until - g.t);
    rate += fireUnits(g) / left;
  }
  F.work += rate;
  while (F.work >= 1 && F.levels.size) {
    F.work -= 1;
    // shrink the widest level
    let wl = null, ww = -1;
    for (const [L, [a, b]] of F.levels) if (b - a > ww) { ww = b - a; wl = L; }
    const r = F.levels.get(wl);
    if (r[1] - r[0] <= 1) F.levels.delete(wl); else if (g.rng.chance(0.5)) r[0]++; else r[1]--;
  }
  if (!F.levels.size) endFire(g);
}
function endFire(g) {
  for (const f of g.tower.facs.values()) if (f.burning) f.burning = false;
  g.tower.bump();
  g.fire = null; g.heli = null;
  g.msg('The fire is out. Clear the burnt-out shells with the bulldozer before rebuilding.', 'notice');
}
export function callHelicopter(g) {
  if (!g.fire || g.heli) return { ok: false };
  g.spend(500000, 'other');
  g.heli = { until: g.t + 60, born: g.t };
  g.emit('sound', { name: 'helicopter' });
  return { ok: true };
}

// ---------------------------------------------------------------- bomb
export function startBomb(g) {
  const amt = 300000 * g.star;
  g.bomb = { state: 'ransom', amount: amt };
  g.emit('dialog', { kind: 'bomb', amount: amt, text: 'An anonymous caller says a device is hidden somewhere in the tower and demands $' + amt.toLocaleString() + '. Pay, or send security to search before 18:00?' });
  g.emit('sound', { name: 'phone' });
}
export function payRansom(g) {
  if (!g.bomb) return;
  g.spend(g.bomb.amount, 'other');
  g.bomb = null;
  g.msg('The ransom was paid. The caller has gone quiet.', 'notice');
}
export function refuseRansom(g) {
  if (!g.bomb) return;
  const T = g.tower;
  const cands = [...T.facs.values()].filter(f => f.type !== 'lobby' && f.type !== 'ruin' && f.L !== 0);
  if (!cands.length) { g.bomb = null; g.msg('Security found nothing. It was a hoax.', null); return; }
  const f = g.rng.pick(cands);
  const deadline = g.t - dayTick(g.t) + T18;
  const levels = [];
  for (let L = T.span.minL; L <= T.span.maxL; L++) if (L !== 0 && T.levelExtent(L)) levels.push(L);
  const secs = g.facsOf('security').filter(s => g.ready(s));
  const teams = secs.map(s => ({ L: s.L, list: [] }));
  for (const L of levels) {
    if (!teams.length) break;
    let bt = teams[0];
    for (const tm of teams) if (Math.abs(tm.L - L) < Math.abs(bt.L - L)) bt = tm;
    bt.list.push(L);
  }
  let foundAt = Infinity;
  const plans = [];
  for (const tm of teams) {
    tm.list.sort((a, b) => Math.abs(a - tm.L) - Math.abs(b - tm.L));
    let t = g.t, cur = tm.L;
    const plan = [];
    for (const L of tm.list) {
      t += 10 * Math.abs(L - cur); const t0 = t; t += 30; cur = L;
      plan.push({ L, t0, t1: t });
      if (L === f.L && t < foundAt) foundAt = t;
    }
    plans.push(plan);
  }
  g.bomb = { state: 'search', L: f.L, x: f.x + (f.w >> 1), deadline, foundAt, plans };
  g.msg('Security teams are sweeping the tower floor by floor. Deadline 18:00.', 'notice');
}
function bombTick(g) {
  const B = g.bomb;
  if (g.t >= B.foundAt && B.foundAt <= B.deadline) {
    g.bomb = null;
    for (const f of g.tower.facs.values()) if (f.occupied || f.open) f.pen = (f.pen || 0) - 20;
    g.emit('dialog', { kind: 'bomb-ok', text: 'Security found the device on floor ' + floorLabel(B.L) + ' and made it safe. The tenants are grateful.' });
    g.emit('sound', { name: 'applause' });
  } else if (g.t >= B.deadline) {
    g.bomb = null;
    explode(g, B.L, B.x);
  }
}
function explode(g, L, x) {
  const T = g.tower;
  const hit = new Set();
  const zone = [[L, 10], [L + 1, 5], [L - 1, 5]];
  for (const [l, r] of zone) for (let i = x - r; i <= x + r; i++) { const f = T.facAt(l, i); if (f && f.type !== 'lobby' && f.type !== 'transit' && f.type !== 'landmark' && f.type !== 'ruin') hit.add(f); }
  for (const f of hit) {
    if (f.type === 'condo') f.salePrice = 0;
    for (const p of [...g.people.values()]) {
      if (p.home === f.id) { P.removePerson(g, p); continue; }
      if (p.at === f.id || p.goalFac === f.id) { if (p.transient) P.removePerson(g, p); else { P.detach(g, p); p.state = 'off'; p.at = 0; } }
    }
    const { x: fx, L: fL, w, h } = f;
    T.removeFacility(f.id);
    T.addFacility('ruin', fx, fL, h, w, { readyAt: 0, here: [] });
  }
  g.boomAt = g.t; g.boomL = L; g.boomX = x;
  g.emit('sound', { name: 'explosion' });
  g.emit('dialog', { kind: 'boom', text: 'The device went off on floor ' + floorLabel(L) + '. ' + hit.size + ' units were wrecked. Clear the rubble with the bulldozer.' });
}
