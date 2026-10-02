// Headless scenario: lay paths, build rides, stalls and a coaster, open the park, run fast,
// and check that guests arrive, ride, spend and the rating moves; then save/load determinism.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../../../public/apps/parkhaven/js/sim.js';
import * as R from '../../../public/apps/parkhaven/js/rides.js';
import * as B from '../../../public/apps/parkhaven/js/build.js';
import * as S from '../../../public/apps/parkhaven/js/staff.js';
import { FIN } from '../../../public/apps/parkhaven/js/data.js';
import { LOOPER } from './helpers.mjs';

function must(r, what) { assert.ok(r && r.ok, `${what}: ${r && r.reason}`); return r; }

export function buildPark() {
  const g = Game.create('willowmere');
  g.cash += 2000000; // headroom for the coaster
  for (let x = 26; x <= 38; x++) must(B.placePath(g, x, 39, false), 'path');
  const car = must(R.placeFlat(g, 'carousel', 34, 35, 0), 'carousel').ride;
  must(R.placeEntrance(g, car, 35, 38, false), 'ent'); must(R.placeEntrance(g, car, 34, 38, true), 'exit');
  const cups = must(R.placeFlat(g, 'cups', 28, 35, 0), 'cups').ride;
  // queue line for the cups: entrance (29,38) faces south onto a queue that leads to the path
  must(R.placeEntrance(g, cups, 30, 38, false), 'ent2'); must(R.placeEntrance(g, cups, 28, 38, true), 'exit2');
  must(R.placeStall(g, 'pie', 31, 40, 3), 'pie'); must(R.placeStall(g, 'lemonade', 33, 40, 3), 'lemon');
  must(R.placeStall(g, 'toilets', 31, 42, 0), 'wc');
  for (const x of [27, 33, 37]) B.placeAddon(g, x, 39, 2);
  S.hireStaff(g, 'handyman'); S.hireStaff(g, 'mechanic');
  // coaster north of the main path
  g.available.add('track:steep'); g.available.add('track:loop');
  const x0 = 22, y0 = 29;
  let z = 0;
  for (let y = y0 - 1; y <= y0 + 6; y++) for (let x = x0 - 5; x <= x0 + 14; x++) z = Math.max(z, g.w.groundMax(x, y));
  const co = R.startTrackRide(g, 'coaster', x0, y0, 0);
  co.track.start.z = co.track.cursor.z = z;
  LOOPER.ids.forEach((pid, i) => must(R.placePiece(g, co, pid, LOOPER.lift.has(i)), `piece ${i} ${pid}`));
  assert.ok(co.track.closed, 'coaster circuit closed');
  must(R.placeEntrance(g, co, x0 + 1, y0 - 1, false), 'coaster ent');
  must(R.placeEntrance(g, co, x0 + 2, y0 - 1, true), 'coaster exit');
  for (let x = x0 + 1; x <= 39; x++) must(B.placePath(g, x, y0 - 2, false), 'cpath');
  for (let y = y0 - 1; y <= 39; y++) must(B.placePath(g, 39, y, false), "cpath2");
  must(B.placePath(g, 38, 39, false), 'join');
  g.refreshConnectivity();
  return { g, car, cups, co };
}

test('a small park attracts guests who ride, eat and pay', () => {
  const { g, car, cups, co } = buildPark();
  for (const r of [car, cups, co]) assert.equal(R.setStatus(g, r, 'open'), null, `${r.name} opens`);
  assert.ok(co.testing, 'opening an untested coaster runs its test first');
  g.parkOpen = true;
  const rating0 = g.rating;
  for (let t = 0; t < 16384 * 2; t++) g.step();
  assert.ok(co.tested && co.ratings, 'coaster tested in-game');
  assert.ok(co.ratings[0] > 300, `coaster excitement ${co.ratings[0]}`);
  assert.ok(g.guestsInPark > 40, `guests ${g.guestsInPark}`);
  assert.ok(g.totalAdmissions > 60);
  assert.ok(car.totalCustomers > 20 && cups.totalCustomers > 20, `flat customers ${car.totalCustomers} ${cups.totalCustomers}`);
  assert.ok(co.totalCustomers > 10, `coaster customers ${co.totalCustomers}`);
  const tickets = g.fin[0][FIN.RIDE_TICKETS] + g.fin[1][FIN.RIDE_TICKETS];
  const food = g.fin[0][FIN.FOOD_SALES] + g.fin[1][FIN.FOOD_SALES];
  assert.ok(tickets > 5000, `ride tickets ${tickets}`);
  assert.ok(food > 0, 'food or drink sold');
  assert.ok(g.rating > rating0 + 200, `rating ${rating0} -> ${g.rating}`);
  const spent = g.guests.reduce((a, q) => a + q.spent, 0);
  assert.ok(spent > 0);
  // every guest is in a valid state and on the map
  for (const q of g.guests) {
    assert.ok(['arriving', 'walking', 'queuing', 'riding', 'shop', 'sitting', 'exiting'].includes(q.state), q.state);
    assert.ok(q.x >= 0 && q.y >= 0 && q.x < 64 && q.y < 64);
    assert.ok(q.happy >= 0 && q.happy <= 255 && q.cash >= 0);
  }
});

test('save and load round-trips and carries on identically', () => {
  const { g, car, cups } = buildPark();
  R.setStatus(g, car, 'open'); R.setStatus(g, cups, 'open');
  g.parkOpen = true;
  for (let t = 0; t < 9000; t++) g.step();
  const json = JSON.stringify(g.save());
  const h = Game.load(JSON.parse(json));
  for (let t = 0; t < 3000; t++) { g.step(); h.step(); }
  assert.equal(h.tick, g.tick);
  assert.equal(h.cash, g.cash);
  assert.equal(h.guests.length, g.guests.length);
  assert.equal(h.rating, g.rating);
  assert.deepEqual(h.guests.map((q) => [q.id, q.tx, q.ty, q.state, q.happy]), g.guests.map((q) => [q.id, q.tx, q.ty, q.state, q.happy]));
});

test('closing a ride empties its queue; demolishing refunds', () => {
  const { g, car } = buildPark();
  R.setStatus(g, car, 'open');
  g.parkOpen = true;
  for (let t = 0; t < 8000; t++) g.step();
  R.setStatus(g, car, 'closed');
  assert.equal(car.queue.length, 0);
  assert.ok(!g.guests.some((q) => q.queueRide === car.id && q.state === 'queuing'));
  const cash = g.cash;
  R.demolish(g, car);
  assert.equal(g.cash - cash, Math.floor(car.cost * 0.7), 'opened rides refund 70%');
  for (let t = 0; t < 2000; t++) g.step();
  assert.ok(!g.guests.some((q) => q.rideId === car.id));
});

test('breakdowns get fixed by a mechanic', () => {
  const { g, car } = buildPark();
  R.setStatus(g, car, 'open');
  g.parkOpen = true;
  car.rel = 0; // force a breakdown on the next reliability check
  let broke = false, fixed = false;
  for (let t = 0; t < 16384 && !fixed; t++) { g.step(); if (car.broken) broke = true; if (broke && !car.broken) fixed = true; }
  assert.ok(broke, 'ride broke down');
  assert.ok(fixed, 'mechanic repaired it');
  assert.ok(g.staff.find((s) => s.type === 'mechanic').stats.fixed >= 1);
});

test('objectives: attendance win and low-rating failure', () => {
  const g = Game.create('willowmere');
  g.guestsInPark = 500; g.rating = 700;
  g.checkObjective(true);
  assert.equal(g.obj.status, 'won');
  const h = Game.create('copperhill');
  h.month = 1; // past the first month
  h.rating = 50;
  for (let w = 0; w < 4; w++) h.onWeek();
  assert.equal(h.obj.status, 'lost');
});

test('research unlocks items over time', () => {
  const g = Game.create('willowmere');
  g.research.funding = 3;
  const before = g.available.size;
  for (let t = 0; t < 16384 * 2; t++) g.step();
  assert.ok(g.available.size > before, 'something new was researched');
});
