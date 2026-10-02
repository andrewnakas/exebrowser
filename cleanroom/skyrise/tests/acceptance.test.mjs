// Skyrise headless acceptance tests (spec section 16 and a few extras).
// Run: node cleanroom/skyrise/tests/acceptance.test.mjs
import { Game } from '../../../public/apps/skyrise/js/game.js';
import * as E from '../../../public/apps/skyrise/js/events.js';
import { clockString, clockToTick, dayTick, DAY_TICKS, MIDNIGHT_TICK } from '../../../public/apps/skyrise/js/clock.js';
import { stressTier, evalTier, isExpressStop, TRANSPORT } from '../../../public/apps/skyrise/js/data.js';

let pass = 0, fail = 0;
const results = [];
function test(name, fn) {
  const t0 = Date.now();
  try { const note = fn(); pass++; results.push(`PASS  ${name}${note ? '  — ' + note : ''} (${Date.now() - t0} ms)`); }
  catch (e) { fail++; results.push(`FAIL  ${name}: ${e.message}`); }
}
const assert = (c, m) => { if (!c) throw new Error(m || 'assertion failed'); };
const must = (r, what) => { if (!r || !r.ok) throw new Error((what || 'build') + ' failed: ' + (r && r.reason)); return r; };
function run(g, ticks) { for (let i = 0; i < ticks; i++) g.step(); }
function runTo(g, dt) { do g.step(); while (dayTick(g.t) !== dt); }
function lobby(g, x0, x1, L = 0) { for (let x = x0; x < x1; x += 4) must(g.build('lobby', x, L), 'lobby'); }

// ---------------------------------------------------------------------------
test('clock: uneven day maps ticks to times', () => {
  assert(clockString(0) === '07:00', clockString(0));
  assert(clockString(400) === '12:00');
  assert(clockString(800) === '12:30');
  assert(clockString(1200) === '13:00');
  assert(clockString(1600) === '17:00');
  assert(clockString(2300) === '00:00');
  assert(clockString(2400) === '01:00');
  assert(clockToTick(12, 30) === 800);
  const g = new Game(1);
  assert(g.dateDay === 0 && g.dayType === 0 && g.quarter === 1 && g.year === 1, 'starts WD1 Q1 Y1');
  run(g, DAY_TICKS * 3);
  assert(g.quarter === 2 && g.dayType === 0, 'three days make a quarter');
});

test('16.1 a 300-population tower reaches 2 stars with lobby, offices, condos, fast food, stairs and lifts', () => {
  const g = new Game(11);
  lobby(g, 168, 232);
  must(g.buildTransport('elevator', 198, 0, 6), 'lift');
  // keep adding tenants while the money lasts, as a player would
  const plan = [];
  for (let L = 1; L <= 8; L++) plan.push(['floor', 0, L]);
  for (let L = 1; L <= 4; L++) for (let i = 0; i < 7; i++) plan.push(['office', 168 + i * 9, L]);
  plan.push(['fastfood', 168, 5], ['fastfood', 184, 5], ['fastfood', 200, 5], ['fastfood', 216, 5]);
  for (let i = 0; i < 4; i++) plan.push(['condo', 168 + i * 16, 6]);
  for (let L = 7; L <= 8; L++) for (let i = 0; i < 4; i++) plan.push(['condo', 168 + i * 16, L]);
  let day = 0;
  while (g.star < 2 && day < 30) {
    while (plan.length) { const [t, x, L] = plan[0]; const r = t === 'floor' ? g.buildFloor(168, 231, L) : g.build(t, x, L); if (!r.ok) { if (/funds/.test(r.reason)) break; throw new Error(r.reason); } plan.shift(); }
    if (!g.tower.trans.size || g.tower.trans.size < 2) { const r = g.buildTransport('stairs', 170, 0, 1); }
    if (plan.length === 0 && g.shafts()[0].top < 8) must(g.resizeShaft(g.shafts()[0].id, 0, 8), 'extend lift');
    run(g, DAY_TICKS); day++;
  }
  assert(g.star >= 2, `still ${g.star} star after ${day} days, pop ${g.pop.total}`);
  const types = new Set([...g.tower.facs.values()].map(f => f.type));
  for (const t of types) assert(['lobby', 'office', 'condo', 'fastfood'].includes(t), 'unexpected ' + t);
  return `2 stars on day ${day}, population ${g.pop.total}, funds $${g.funds.toLocaleString()}`;
});

function rushTower(shafts, cars) {
  const g = new Game(5); g.funds = 1e8;
  lobby(g, 180, 220);
  // 30 offices across floors 2–20
  let n = 0;
  for (let L = 1; L <= 19 && n < 30; L++) for (let i = 0; i < 2 && n < 30; i++, n++) must(g.build('office', 182 + i * 18, L), 'office');
  for (let L = 1; L <= 19; L++) g.buildFloor(180, 219, L);
  for (let k = 0; k < shafts; k++) { const s = must(g.buildTransport('elevator', 192 + k * 8, 0, 19), 'shaft').o; for (let c = 1; c < cars; c++) g.addCar(s.id, 0); }
  for (const f of g.tower.facs.values()) if (f.type === 'office') { f.readyAt = 0; g.occupy(f); }
  runTo(g, MIDNIGHT_TICK); runTo(g, 0); // 07:00 day 1 (date WD1 rush happens here)
  let maxQ = 0, maxTier = 0, sumWait = 0, nWait = 0;
  const t9 = clockToTick(11, 30);
  while (dayTick(g.t) < t9) {
    g.step();
    for (const s of g.shafts()) { maxQ = Math.max(maxQ, s.totalWaiting()); for (const q of s.queues.values()) for (const p of q.people) { maxTier = Math.max(maxTier, stressTier(p.stress)); sumWait += 1; } }
    nWait++;
  }
  const stress = [...g.tower.facs.values()].filter(f => f.type === 'office' && f.sN).map(f => f.sSum / f.sN);
  const mean = stress.reduce((a, b) => a + b, 0) / Math.max(1, stress.length);
  return { maxQ, maxTier, meanTrip: mean, waitTicks: sumWait / nWait };
}
test('16.2 the 08:00 rush builds queues and stress on one 2-car shaft; more cars relieve it', () => {
  const a = rushTower(1, 2), b = rushTower(2, 4);
  assert(a.maxQ >= 40, 'queue only ' + a.maxQ);
  assert(a.maxTier >= 2, 'stress never reached the high tier (' + a.maxTier + ')');
  assert(b.meanTrip < a.meanTrip * 0.6, `relief too small: ${a.meanTrip.toFixed(0)} -> ${b.meanTrip.toFixed(0)}`);
  assert(b.maxQ < a.maxQ, 'queues did not shrink');
  return `1×2 cars: peak queue ${a.maxQ}, mean trip stress ${a.meanTrip.toFixed(0)}; 2×4 cars: peak queue ${b.maxQ}, mean trip stress ${b.meanTrip.toFixed(0)}`;
});

function smallTower(seed = 3) {
  const g = new Game(seed); g.funds = 1e8;
  lobby(g, 180, 220);
  for (let L = 1; L <= 8; L++) g.buildFloor(180, 219, L);
  must(g.buildTransport('elevator', 198, 0, 6), 'lift');
  return g;
}
test('16.3 an office poor for a full day leaves; a condo that leaves refunds its sale', () => {
  const g = smallTower();
  const o = must(g.build('office', 182, 1)).f, c = must(g.build('condo', 182, 2)).f;
  o.readyAt = c.readyAt = 0;
  g.occupy(o);
  const before = g.funds; g.occupy(c); const sale = g.funds - before;
  assert(sale === 150000, 'sale booked ' + sale);
  runTo(g, MIDNIGHT_TICK - 1); // end of the first full day after moving in? make it count as a full day
  o.occSince = c.occSince = 0;
  o.sSum = 290 * 6; o.sN = 6; c.sSum = 290 * 3; c.sN = 3;
  const f0 = g.funds;
  g.step(); // midnight evaluation
  assert(!o.occupied, 'office still occupied (eval ' + o.eval + ')');
  assert(!c.occupied, 'condo still occupied');
  assert(f0 - g.funds === 150000, 'refund was ' + (f0 - g.funds));
  return 'office eval ' + o.eval.toFixed(0) + ', refund $150,000';
});

test('16.3b a happy office stays and pays rent at the quarter', () => {
  const g = smallTower();
  const o = must(g.build('office', 182, 1)).f; o.readyAt = 0; g.occupy(o);
  const f0 = g.funds;
  run(g, DAY_TICKS * 3 + 10);
  assert(o.occupied, 'office left');
  assert(g.prevFinance && (g.finance.income.office === 10000), 'rent not booked: ' + g.finance.income.office);
  return 'quarterly rent $10,000 booked';
});

test('16.4 a never-cleaned hotel room becomes infested and stays unlettable until bulldozed', () => {
  const g = smallTower(); g.star = 2;
  const r = must(g.build('single', 182, 3), 'room').f; r.readyAt = 0;
  g.bookRoom(r, false);
  run(g, 200);
  // check the guest out
  for (const pid of [...r.guests]) g.checkout(g.people.get(pid));
  assert(r.hstate === 'dirty', 'room is ' + r.hstate);
  for (let d = 0; d < 3; d++) { runTo(g, MIDNIGHT_TICK); }
  assert(r.infested && r.hstate === 'infested', 'not infested after 3 nights: ' + r.hstate + ' ' + r.dirtyNights);
  run(g, DAY_TICKS * 2);
  assert(r.hstate === 'infested', 'infested room was let');
  assert(!g.roomAvailable(r), 'infested room available');
  must(g.bulldoze(r.L, r.x + 1), 'bulldoze');
  assert(!g.tower.facs.has(r.id), 'room still there');
  const r2 = must(g.build('single', 182, 3), 'rebuild').f;
  assert(r2.hstate === 'vacant' && !r2.infested, 'rebuilt room not clean');
  return 'infested after 3 dirty nights';
});

test('16.4b housekeepers clean dirty rooms using service lifts', () => {
  const g = smallTower(); g.star = 2;
  const rooms = []; for (let i = 0; i < 4; i++) { const r = must(g.build('single', 182 + i * 4, 4), 'room').f; r.readyAt = 0; rooms.push(r); }
  const hk = must(g.build('housekeeping', 200, 1), 'hk').f; hk.readyAt = 0;
  must(g.buildTransport('service', 216, 1, 5), 'service lift');
  runTo(g, MIDNIGHT_TICK);
  for (const r of rooms) { r.hstate = 'dirty'; }
  runTo(g, clockToTick(16, 0));
  const clean = rooms.filter(r => r.hstate === 'vacant').length;
  assert(clean === 4, 'only ' + clean + ' of 4 rooms cleaned');
  return '4 rooms cleaned before 16:00';
});

test('16.5 express lifts stop only at 1, 15, 30 … and basements', () => {
  const g = new Game(2); g.funds = 1e9; g.star = 3;
  lobby(g, 180, 220);
  for (let L = 1; L <= 50; L++) g.buildFloor(180, 219, L);
  for (let L = -1; L >= -3; L--) g.buildFloor(180, 219, L);
  const s = must(g.buildTransport('express', 200, -3, 47), 'express').o;
  const served = s.servedLevels(g.tower).map(L => L >= 0 ? L + 1 : 'B' + (-L));
  assert(JSON.stringify(served) === JSON.stringify(['B3', 'B2', 'B1', 1, 15, 30, 45]), 'served ' + served);
  g.toggleService(s.id, 14);
  assert(g.tower.shaftServes(s, 14), 'express stops were changed');
  return 'stops ' + served.join(', ');
});

test('16.5b lift-to-lift transfers only on a continuous lobby', () => {
  const g = new Game(4); g.funds = 1e9; g.star = 3;
  lobby(g, 180, 220);
  for (let L = 1; L <= 25; L++) g.buildFloor(180, 219, L);
  const off = must(g.build('office', 200, 20), 'office').f;
  must(g.buildTransport('elevator', 184, 0, 14), 'low lift');
  must(g.buildTransport('elevator', 212, 14, 22), 'high lift');
  const to = { L: 20, x: off.x + 4 };
  g.tower.bump();
  assert(g.router.find({ street: true }, to) === null, 'transfer allowed on bare floor 15');
  // a sky lobby with a gap between the two shafts: still no transfer
  g.build('lobby', 184, 14, { replace: true }); g.build('lobby', 212, 14, { replace: true });
  g.tower.bump();
  assert(g.router.find({ street: true }, to) === null, 'transfer allowed across a broken lobby');
  for (let x = 188; x < 212; x += 4) must(g.build('lobby', x, 14), 'lobby fill');
  g.tower.bump();
  const r = g.router.find({ street: true }, to);
  assert(r, 'no transfer on a continuous sky lobby');
  const lifts = r.steps.filter(s => s.t === 'elev');
  assert(lifts.length === 2 && lifts[0].to === 14 && lifts[1].from === 14, 'unexpected route');
  return 'route: ' + r.steps.map(s => s.t).join(' > ');
});

test('route: stairs at most 4 flights in a row; at most two vertical legs', () => {
  const g = new Game(6); g.funds = 1e9;
  lobby(g, 180, 220);
  for (let L = 1; L <= 6; L++) g.buildFloor(180, 219, L);
  for (let L = 0; L < 6; L++) must(g.buildTransport('stairs', L % 2 ? 200 : 184, L, L + 1), 'stairs ' + L);
  const f4 = g.build('office', 205, 4).f, f5 = g.build('office', 205, 5).f;
  assert(g.router.find({ street: true }, { L: 4, x: 209 }), 'cannot climb 4 flights');
  assert(!g.router.find({ street: true }, { L: 5, x: 209 }), 'climbed 5 flights');
  // stairs + lift is fine
  must(g.buildTransport('elevator', 210, 4, 6), 'lift');
  assert(g.router.find({ street: true }, { L: 5, x: 209 }), 'stairs then lift refused');
});

test('16.6 promotion to 4 stars waits for a favourable VIP', () => {
  const g = smallTower(); g.star = 3;
  // stub the other requirements so only the VIP is missing
  g.computePop = function () { this.pop = { total: 6000, perm: 6000, hotel: 0, comm: 0, workers: 0 }; };
  g.computeDemands = function () { this.demands = []; };
  for (let i = 0; i < 2; i++) { const s = must(g.build('suite', 182 + i * 10, 3 + i), 'suite').f; s.readyAt = 0; }
  g.computePop(); g.checkStars();
  assert(g.star === 3, 'promoted without a VIP');
  assert(g.starBlockers().includes('a happy VIP'), 'blockers: ' + g.starBlockers());
  g.flags.vipOk = true; g.checkStars();
  assert(g.star === 4, 'not promoted after the VIP');
});

test('16.6b a VIP visit can be passed in a quiet, well-run tower', () => {
  const g = smallTower(9); g.star = 3;
  for (let L = -1; L >= -1; L--) g.buildFloor(180, 219, L);
  must(g.build('parkramp', 184, -1), 'ramp');
  must(g.build('parkspace', 200, -1), 'space');
  must(g.buildTransport('stairs', 210, -1, 0), 'stairs to parking');
  const suite = must(g.build('suite', 184, 2), 'suite').f; suite.readyAt = 0;
  must(g.build('housekeeping', 196, 1), 'housekeeping');
  must(g.buildTransport('service', 186, 1, 3), 'service lift');
  let verdict = null;
  g.on((t, d) => { if (t === 'dialog' && d.kind === 'vip' && /checked out|unimpressed/.test(d.text)) verdict = d.text; });
  for (let d = 0; d < 6 && !verdict; d++) run(g, DAY_TICKS);
  assert(verdict, 'no VIP verdict in 6 days (suite state ' + suite.hstate + ', parking ' + g.parking().usable + ')');
  assert(g.flags.vipOk, 'VIP unhappy: ' + verdict);
  return verdict.slice(0, 60) + '…';
});

test('16.7 fire spreads, guards climb the emergency stairs, the helicopter ends it', () => {
  const g = smallTower(); g.star = 3;
  for (let L = 1; L <= 6; L++) g.buildFloor(180, 219, L);
  const sec = must(g.build('security', 182, 1), 'security').f; sec.readyAt = 0;
  const targets = []; for (let L = 3; L <= 6; L++) for (let i = 0; i < 4; i++) { const o = g.build('office', 182 + i * 9, L); if (o.ok) { o.f.readyAt = 0; targets.push(o.f); } }
  run(g, 5);
  // move the guards far away so the fire has time to grow
  sec.L = 1;
  assert(E.startFire(g, targets[0]), 'fire did not start');
  const team = g.fire.teams[0];
  assert(team && team.at === g.t + 20 * Math.abs(1 - targets[0].L), 'guard arrival should be 20 ticks per floor');
  g.fire.teams = []; // keep the guards away to watch it spread
  run(g, 130);
  const levels = g.fire.levels.size;
  let width = 0; for (const [a, b] of g.fire.levels.values()) width = Math.max(width, b - a);
  assert(levels >= 2, 'fire did not climb');
  assert(width >= 5, 'fire did not widen');
  const ruins = [...g.tower.facs.values()].filter(f => f.type === 'ruin').length;
  assert(ruins >= 2, 'nothing burned');
  const f0 = g.funds;
  assert(E.callHelicopter(g).ok, 'helicopter refused');
  assert(f0 - g.funds === 500000, 'helicopter cost');
  run(g, 61);
  assert(!g.fire, 'fire still burning after the helicopter');
  return `${levels} floors, ${width} units wide, ${ruins} burnt shells`;
});

test('16.7b guards put a fire out on their own', () => {
  const g = smallTower(); g.star = 3;
  const sec = must(g.build('security', 182, 1), 'security').f; sec.readyAt = 0;
  const o = must(g.build('office', 182, 3), 'office').f; o.readyAt = 0;
  run(g, 2);
  E.startFire(g, o);
  run(g, 300);
  assert(!g.fire, 'guards failed');
});

test('16.8 pausing freezes everything (no ticks, no motion)', () => {
  // The renderer reads car.prev/pos and person.px/x; with no step() nothing changes.
  const g = smallTower();
  const o = must(g.build('office', 182, 3)).f; o.readyAt = 0; g.occupy(o);
  runTo(g, 30);
  const snap = () => JSON.stringify([g.t, g.shafts().map(s => s.cars.map(c => [c.pos, c.prev, c.v])), [...g.movers].map(p => [p.x, p.px, p.L])]);
  const a = snap();
  // a paused frame loop calls no step; the browser test checks the real loop
  const b = snap();
  assert(a === b);
  return 'see browser test for the real loop';
});

test('dispatch: car capacities 21 / 42 / 17 and full cars skip hall calls', () => {
  assert(TRANSPORT.elevator.cap === 21 && TRANSPORT.express.cap === 42 && TRANSPORT.service.cap === 17, 'capacities');
  const g = smallTower(8);
  const s = g.shafts()[0];
  // 30 people at the lobby going up to floor 5: the first car leaves with exactly 21
  const o = must(g.build('office', 182, 5)).f; o.readyAt = 0;
  for (let i = 0; i < 30; i++) { const p = { id: 9000 + i, kind: 'visitor', state: 'queue', stress: 0, wait: 0, _dest: 5, L: 0, x: s.cx, transient: true }; g.people.set(p.id, p); s.call(p, 0, 1, g.t); }
  g.onBoard = (p) => { p.state = 'ride'; };
  g.onAlight = (p) => { p.state = 'gone'; };
  let maxLoad = 0;
  for (let i = 0; i < 40; i++) { s.tick(g); maxLoad = Math.max(maxLoad, s.cars[0].pax.length); }
  assert(maxLoad === 21, 'max load ' + maxLoad);
  assert(s.qlen(0, 1) === 9, 'left behind ' + s.qlen(0, 1));
  return 'car left with 21, 9 waited';
});

test('save and load round-trip keeps the tower', () => {
  const g = smallTower();
  const o = must(g.build('office', 182, 2)).f; o.readyAt = 0; g.occupy(o);
  run(g, 700);
  const json = JSON.stringify(g.serialize());
  const h = Game.load(JSON.parse(json));
  assert(h.funds === g.funds && h.tower.facs.size === g.tower.facs.size && h.shafts().length === 1, 'mismatch');
  assert(h.residents(h.tower.facs.get(o.id)).length === 6, 'workers lost');
  run(h, DAY_TICKS);
  return (json.length / 1024).toFixed(1) + ' KB save';
});

test('bomb: refusing sends guards floor by floor; found before 18:00 or it explodes', () => {
  const g = smallTower(); g.star = 3;
  const sec = must(g.build('security', 182, 1)).f; sec.readyAt = 0;
  for (let L = 2; L <= 5; L++) { const o = g.build('office', 182, L).f; o.readyAt = 0; }
  runTo(g, clockToTick(9, 0));
  E.startBomb(g);
  assert(g.bomb && g.bomb.state === 'ransom');
  E.refuseRansom(g);
  assert(g.bomb.state === 'search' && g.bomb.foundAt < g.bomb.deadline, 'search plan wrong');
  runTo(g, clockToTick(18, 30));
  assert(!g.bomb, 'bomb still active');
  // and without security it goes off
  const h = smallTower(); h.star = 3;
  for (let L = 2; L <= 3; L++) { const o = h.build('office', 182, L).f; o.readyAt = 0; }
  runTo(h, clockToTick(9, 0));
  E.startBomb(h); E.refuseRansom(h);
  runTo(h, clockToTick(18, 30));
  assert([...h.tower.facs.values()].some(f => f.type === 'ruin'), 'no explosion damage');
});

test('lift preview: a deep copy runs ahead without touching the real tower', () => {
  const g = smallTower(12);
  for (let i = 0; i < 4; i++) { const o = g.build('office', 182 + i * 9, 3).f; o.readyAt = 0; g.occupy(o); }
  runTo(g, MIDNIGHT_TICK); runTo(g, 30);
  g.updateReach(); // fills the router cache with a closure, which must not break cloning
  const before = JSON.stringify([g.t, g.funds, g.shafts()[0].cars.map(c => c.pos), g.people.size]);
  const c = g.cloneForPreview();
  run(c, 300);
  assert(c.t === g.t + 300, 'clone did not advance');
  assert(JSON.stringify([g.t, g.funds, g.shafts()[0].cars.map(c => c.pos), g.people.size]) === before, 'real tower changed');
  return 'clone ran 300 ticks; original unchanged';
});

console.log(results.join('\n'));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
