// Ride-rating maths, value, upkeep, park rating and guest generation (spec 3, 4, 5, 8).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  flatRideRatings, coasterRatings, kartRatings, flumeRatings, rideValue, rideUpkeep, parkRating,
  spawnProbability, guestCap, weeklyInterest, turnsSubRating, sceneryScore,
} from '../../../public/apps/parkhaven/js/ratings.js';
import { FLAT_RIDES, TRACK_RIDES } from '../../../public/apps/parkhaven/js/data.js';
import { buildCircuit, simulateTest, layoutStats } from '../../../public/apps/parkhaven/js/track.js';
import { buildTrack, OUT_AND_BACK, LOOPER } from './helpers.mjs';

test('flat ride ratings: base + option bonus + scenery', () => {
  // carousel 0.60/0.15/0.30 + 10 rotations x 0.05
  assert.deepEqual(flatRideRatings(FLAT_RIDES.carousel, { option: 10 }), [110, 65, 80]);
  // spinning cups at 4 rotations: 1.13+0.80 / 0.97+0.80 / 1.90+0.80
  assert.deepEqual(flatRideRatings(FLAT_RIDES.cups, { option: 4 }), [193, 177, 270]);
  // option is clamped to its range
  assert.deepEqual(flatRideRatings(FLAT_RIDES.cups, { option: 99 }), flatRideRatings(FLAT_RIDES.cups, { option: 6 }));
  // scenery score 100 adds 0.298 x 100 hundredths to carousel excitement
  assert.equal(flatRideRatings(FLAT_RIDES.carousel, { option: 10, scenery: 100 })[0], 110 + 30);
  // towers scale with height: drop tower 32 hu
  const dt = flatRideRatings(FLAT_RIDES.droptower, { towerHu: 32 });
  assert.deepEqual(dt, [Math.round(280 + 5.1 * 32), Math.round(350 + 10.2 * 32), Math.round(350 + 10.2 * 32)]);
});

test('scenery score caps at 47 objects', () => {
  assert.equal(sceneryScore(10), 50);
  assert.equal(sceneryScore(100), 235);
  assert.equal(sceneryScore(3, true), 40);
});

test('turn sub-rating table and inversions', () => {
  const [e, i, n] = turnsSubRating([{ len: 1, kind: 'flat' }], 0);
  assert.ok(Math.abs(e - 0.97) < 1e-9 && Math.abs(i - 0.32) < 1e-9 && Math.abs(n - 0.65) < 1e-9);
  const [e2, i2, n2] = turnsSubRating([], 2);
  assert.ok(Math.abs(e2 - 53.34) < 1e-6 && i2 === 100 && Math.abs(n2 - 43.34) < 1e-6);
});

const BASE = { L: 1500, cars: 6, Smax: 20, Savg: 9, T: 90, Gpos: 300, Gneg: -50, Glat: 150, airtime: 20, drops: 3, H: 24, inversions: 0, turns: [], proximity: 100, scenery: 50 };

test('coaster requirements halve the ratings', () => {
  const good = coasterRatings(BASE);
  const lowDrop = coasterRatings({ ...BASE, H: 10 });
  assert.ok(lowDrop[0] < good[0] * 0.6, 'a drop under 14 hu halves excitement');
  const slow = coasterRatings({ ...BASE, Smax: 8 });
  assert.ok(slow[0] < good[0] * 0.6, 'under 10 m/s halves');
  // an inversion waives the height / drops / negative-g requirements
  const withLoop = coasterRatings({ ...BASE, H: 10, drops: 1, Gneg: 50, inversions: 1 });
  const noLoop = coasterRatings({ ...BASE, H: 10, drops: 1, Gneg: 50, inversions: 0 });
  assert.ok(withLoop[0] > noLoop[0] * 4, 'three halvings avoided');
});

test('coaster intensity penalty and excessive lateral g', () => {
  const wild = coasterRatings({ ...BASE, Gpos: 600, Glat: 330, Smax: 30 });
  assert.ok(wild[1] > 1000, 'very intense');
  assert.ok(wild[0] < coasterRatings(BASE)[0] + 100, 'penalty keeps excitement from running away');
});

test('a modest looping coaster lands near the spec guidance (E 4-7, I 4-7)', () => {
  const t = buildTrack({ x: 10, y: 10, dir: 0, z: 4 }, LOOPER.ids, LOOPER.lift);
  const c = buildCircuit(t.pieces);
  const res = simulateTest(c, { kind: 'coaster', liftSpeed: 5, brakeSpeed: 6, stopS: c.stationEnd - 0.3, launch: 2, cars: 4, carLen: 1.8 });
  assert.ok(res.ok, res.reason);
  const lay = layoutStats(t.pieces);
  assert.equal(lay.inversions, 1);
  const [E, I, N] = coasterRatings({ ...res.stats, ...lay, L: res.stats.L, cars: 4, proximity: 120, scenery: 60 });
  assert.ok(E >= 400 && E <= 700, `E ${E}`);
  assert.ok(I >= 400 && I <= 700, `I ${I}`);
  assert.ok(N >= 120 && N <= 450, `N ${N}`);
});

test('an out-and-back with a single drop and no inversion is penalised', () => {
  const t = buildTrack({ x: 10, y: 10, dir: 0, z: 4 }, OUT_AND_BACK, new Set([5, 6, 7, 8, 9]));
  const c = buildCircuit(t.pieces);
  const res = simulateTest(c, { kind: 'coaster', liftSpeed: 5, brakeSpeed: 6, stopS: c.stationEnd - 0.3, launch: 2, cars: 4, carLen: 1.8 });
  assert.ok(res.ok);
  assert.equal(res.stats.drops, 1);
  const [E] = coasterRatings({ ...res.stats, ...layoutStats(t.pieces), L: res.stats.L, cars: 4 });
  assert.ok(E < 300, `E ${E}`);
});

test('go-kart and flume pipelines', () => {
  const k = kartRatings({ L: 200, karts: 6, laps: 3, race: true, turns: [{ len: 1, kind: 'flat' }], drops: 0, H: 0 });
  assert.equal(k[0], Math.round(142 + 100 + 140 + 60 + 0.97 * 0.068));
  const f1 = flumeRatings({ L: 300, Smax: 12, T: 60, turns: [], drops: 2, H: 12, splash: true });
  const f2 = flumeRatings({ L: 300, Smax: 12, T: 60, turns: [], drops: 2, H: 4, splash: true });
  assert.ok(f2[0] < f1[0] * 0.6, 'flume needs a 6 hu drop');
  assert.ok(f1[0] > flumeRatings({ L: 300, Smax: 12, T: 60, turns: [], drops: 2, H: 12, splash: false })[0], 'splash-down bonus');
});

test('ride value: formula, new-ride bonus, ageing and duplicates', () => {
  // (500*50 + 500*30 + 300*10)/10240 cr = 4.1992 cr
  assert.equal(rideValue([500, 500, 300], [50, 30, 10], 20), 420);
  assert.equal(rideValue([500, 500, 300], [50, 30, 10], 0), 720);
  assert.equal(rideValue([500, 500, 300], [50, 30, 10], 8), 520);
  assert.equal(rideValue([500, 500, 300], [50, 30, 10], 50), 315);
  assert.equal(rideValue([500, 500, 300], [50, 30, 10], 20, true), 315);
});

test('upkeep matches the spec worked example (12.96 cr a fortnight)', () => {
  const u = rideUpkeep(TRACK_RIDES.coaster.upkeep, { lifts: 1, L: 1500, brakes: 1, trains: 1, cars: 6, stations: 1 });
  assert.equal(u, 1296);
  assert.equal(rideUpkeep(FLAT_RIDES.carousel.upkeep, {}), 313); // 5.00 x 5/8
});

test('loan interest: 10,000 cr at 10% is 30.51 cr a week', () => {
  assert.equal(weeklyInterest(1000000, 10), 3051);
});

test('park rating bounds and drivers', () => {
  const empty = parkRating({ guests: 0, happy: 0, lost: 0, rides: [], oldLitter: 0 });
  assert.ok(empty >= 0 && empty <= 999);
  const rides = [{ downtime: 0, rated: true, E: 370, I: 520 }, { downtime: 0, rated: true, E: 370, I: 520 }];
  const happy = parkRating({ guests: 500, happy: 450, lost: 0, rides, oldLitter: 0 });
  const sad = parkRating({ guests: 500, happy: 50, lost: 0, rides, oldLitter: 0 });
  const dirty = parkRating({ guests: 500, happy: 450, lost: 0, rides, oldLitter: 200 });
  const broken = parkRating({ guests: 500, happy: 450, lost: 0, rides: rides.map((r) => ({ ...r, downtime: 60 })), oldLitter: 0 });
  assert.ok(happy > sad + 300, 'happiness is worth up to 500 points');
  assert.equal(happy - dirty, 600, '150+ old litter costs 600');
  assert.equal(happy - broken, 120, 'downtime counts 2 points per %');
  assert.equal(parkRating({ guests: 500, happy: 450, lost: 0, rides, oldLitter: 0, casualty: 2000 }), 0);
});

test('guest generation probability and park capacity', () => {
  assert.equal(spawnProbability({ rating: 0, guests: 0, cap: 100 }), 50);
  assert.equal(spawnProbability({ rating: 999, guests: 0, cap: 100 }), 700);
  assert.equal(spawnProbability({ rating: 999, guests: 200, cap: 100 }), 175);
  assert.equal(spawnProbability({ rating: 999, guests: 0, cap: 100, entranceFee: 1000, rideValueForMoney: 600 }), 175);
  assert.equal(spawnProbability({ rating: 999, guests: 0, cap: 100, entranceFee: 1000, rideValueForMoney: 400 }), 43);
  assert.equal(guestCap([{ typeBonus: 45, open: true }, { typeBonus: 95, open: true, broken: true }, { typeBonus: 40, open: false }]), 45);
});
