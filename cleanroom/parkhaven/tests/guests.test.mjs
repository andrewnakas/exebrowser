// Guest decision rules (spec 6 and 7.3).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  acceptsRide, rideSatisfaction, purchaseDecision, acceptsToilet, rideNauseaGain, pickRide, wantsReride,
  decideToLeave, rollGuest, addThought, itemValue,
} from '../../../public/apps/parkhaven/js/guestlogic.js';
import { Rng } from '../../../public/apps/parkhaven/js/rng.js';

const guest = (o = {}) => ({ happy: 128, happyT: 128, energy: 100, hunger: 60, thirst: 60, toilet: 0, nausea: 0, nauseaT: 0, cash: 5000,
  prefMin: 2, prefMax: 6, tol: 2, items: {}, holding: null, numRides: 0, ridden: [], tx: 10, ty: 10, ...o });
const ride = (o = {}) => ({ id: 1, status: 'open', broken: null, ratings: [400, 400, 300], price: 200, value: 500, sheltered: false, queueFull: false, x: 12, y: 12, ...o });
const ctx = { raining: false, payRides: true, tick: 100000 };

test('rides must be open and working', () => {
  assert.equal(acceptsRide(guest(), ride({ status: 'closed' }), { ctx }).ok, false);
  assert.equal(acceptsRide(guest(), ride({ broken: 'cutout' }), { ctx }).ok, false);
  assert.equal(acceptsRide(guest(), ride(), { ctx }).ok, true);
});

test('intensity window widens with happiness', () => {
  // prefMax 6 => maxI = 600 + happiness
  const wild = ride({ ratings: [600, 760, 300] });
  assert.equal(acceptsRide(guest({ happy: 128 }), wild, { ctx }).thought, 'tooIntense');
  assert.equal(acceptsRide(guest({ happy: 200 }), wild, { ctx }).ok, true);
  // prefMin 4 => minI = 400 - happiness
  const tame = ride({ ratings: [200, 100, 50] });
  assert.equal(acceptsRide(guest({ prefMin: 4, happy: 100 }), tame, { ctx }).thought, 'notIntense');
});

test('nausea tolerance', () => {
  const sick = ride({ ratings: [500, 400, 650] });
  assert.equal(acceptsRide(guest({ tol: 1, happy: 0 }), sick, { ctx }).thought, 'tooSickening');
  assert.equal(acceptsRide(guest({ tol: 3, happy: 0 }), sick, { ctx }).ok, true);
});

test('value: more than twice the value is refused; paying at the gate quarters it', () => {
  assert.equal(acceptsRide(guest(), ride({ price: 1100, value: 500 }), { ctx }).thought, 'badValue');
  assert.equal(acceptsRide(guest(), ride({ price: 300, value: 500 }), { ctx, paidEntry: true }).thought, 'badValue');
  assert.equal(acceptsRide(guest(), ride({ price: 200, value: 500 }), { ctx, atRide: true }).thought, 'goodValue');
  assert.equal(acceptsRide(guest({ cash: 100 }), ride({ price: 200 }), { ctx }).thought, 'cantAfford');
});

test('rain keeps guests off unsheltered rides unless they have an umbrella', () => {
  const rain = { ...ctx, raining: true };
  assert.equal(acceptsRide(guest(), ride(), { ctx: rain }).thought, 'rain');
  assert.equal(acceptsRide(guest(), ride({ sheltered: true }), { ctx: rain }).ok, true);
  assert.equal(acceptsRide(guest({ umbrella: true }), ride(), { ctx: rain }).ok, true);
});

test('untested coasters put off 90% of guests', () => {
  const coaster = ride({ ratings: null, value: null, gforce: true });
  assert.equal(acceptsRide(guest(), coaster, { ctx, rngRoll: 50 }).ok, false);
  assert.equal(acceptsRide(guest(), coaster, { ctx, rngRoll: 95 }).ok, true);
});

test('boarding satisfaction follows the fit table', () => {
  const g = guest({ prefMin: 2, prefMax: 6, tol: 2, happy: 128 });
  // perfect fit on both intensity and nausea, fair price, short queue, first ride
  const s1 = rideSatisfaction(g, ride({ ratings: [400, 400, 300], price: 200, value: 500 }), { payRides: true, queueTime: 100 });
  assert.equal(s1, -5 + 70 + 10);
  // way out of range on both: (3,3) => -60, long queue -35
  const s2 = rideSatisfaction(g, ride({ ratings: [400, 2000, 2000], price: 200, value: 500 }), { payRides: true, queueTime: 5000 });
  assert.equal(s2, -5 - 60 - 35);
  // familiarity
  const s3 = rideSatisfaction(g, ride(), { payRides: true, queueTime: 1000, riddenType: true, riddenRide: true });
  assert.equal(s3, -5 + 70 + 20);
});

test('nausea gain shrinks with tolerance', () => {
  const g = guest({ happyT: 128, hunger: 128 });
  const none = rideNauseaGain({ ...g, tol: 0 }, 400);
  const high = rideNauseaGain({ ...g, tol: 3 }, 400);
  assert.equal(none, 200);
  assert.equal(high, 25);
});

test('purchase rules: hunger, holding food, overpricing', () => {
  const r0 = { temp: 15, raining: false, rand: () => 0 };
  assert.equal(purchaseDecision(guest({ hunger: 200 }), 'F1', 150, r0).thought, 'notHungry');
  assert.equal(purchaseDecision(guest({ holding: 'F2' }), 'F1', 150, r0).thought, 'notFinished');
  assert.equal(purchaseDecision(guest({ nausea: 150 }), 'F1', 150, r0).ok, false);
  const fair = purchaseDecision(guest(), 'F1', 150, r0);
  assert.equal(fair.ok, true);
  assert.equal(fair.gain, 32, 'margin floor of 0.80 cr => +32 happiness');
  // 0.80 over value: everyone refuses
  const rMax = { ...r0, rand: () => 7 };
  assert.equal(purchaseDecision(guest({ happy: 100 }), 'F1', 270, rMax).thought, 'itemExpensive');
  // an ordinary happy guest halves the overcharge
  assert.equal(purchaseDecision(guest({ happy: 130 }), 'F1', 270, rMax).ok, true);
  // happy guests tolerate more (over halved twice)
  assert.equal(purchaseDecision(guest({ happy: 200 }), 'F1', 270, rMax).ok, true);
  // drinks are worth more in the heat
  assert.equal(itemValue('D1', 25), 200);
  assert.equal(itemValue('D1', 5), 100);
});

test('souvenirs need a happy guest who has ridden a few rides', () => {
  const r = { temp: 15, raining: false, rand: () => 0 };
  assert.equal(purchaseDecision(guest({ numRides: 1, happy: 250 }), 'S1', 250, r).ok, false);
  assert.equal(purchaseDecision(guest({ numRides: 3, happy: 250 }), 'S1', 250, r).ok, true);
  assert.equal(purchaseDecision(guest({ items: { M: 1 } }), 'M', 60, r).thought, 'alreadyHave');
});

test('toilet fee tolerance scales with need', () => {
  assert.equal(acceptsToilet(guest({ toilet: 50 }), 0).ok, false);
  assert.equal(acceptsToilet(guest({ toilet: 160 }), 40).ok, true);
  assert.equal(acceptsToilet(guest({ toilet: 160 }), 50).thought, 'wontPayToilet');
});

test('pick_ride chooses the most exciting acceptable unridden ride nearby', () => {
  const g = guest();
  const rides = [
    ride({ id: 1, ratings: [300, 400, 200] }),
    ride({ id: 2, ratings: [650, 500, 300] }),
    ride({ id: 3, ratings: [900, 1400, 900] }), // too intense
    ride({ id: 4, ratings: [700, 450, 300], x: 40, y: 40 }), // too far, not visible
  ];
  assert.equal(pickRide(g, rides, { ctx }).id, 2);
  assert.equal(pickRide({ ...g, ridden: [2] }, rides, { ctx }).id, 1);
  assert.equal(pickRide({ ...g, items: { M: 1 } }, rides, { ctx }).id, 4, 'a map shows every ride');
});

test('re-ride and leaving rules', () => {
  const happy = guest({ happy: 220, energy: 120, hunger: 100, thirst: 100 });
  assert.equal(wantsReride(happy, { reride: true, ratings: [500, 500, 300] }, () => 0), true);
  assert.equal(wantsReride(happy, { reride: false }, () => 0), false);
  assert.equal(wantsReride({ ...happy, happy: 150 }, { reride: true }, () => 0), false);
  assert.equal(decideToLeave(guest({ energy: 100, happy: 100, cash: 2000 }), true, () => 0), false);
  assert.equal(decideToLeave(guest({ energy: 40, happy: 100 }), true, () => 0), true);
  assert.equal(decideToLeave(guest({ energy: 40, happy: 100 }), true, () => 5000), false);
});

test('new guests have sane attributes and thoughts are capped at five', () => {
  const rng = new Rng(3);
  for (let k = 0; k < 200; k++) {
    const g = rollGuest(rng);
    assert.ok(g.energy >= 32 && g.energy <= 128);
    assert.ok(g.prefMax === 15 || (g.prefMax >= 3 && g.prefMax <= 6));
    assert.ok(g.prefMin <= g.prefMax && g.prefMin >= 0);
    assert.ok([3000, 4000, 5000, 6000, 7000].includes(g.cash));
  }
  const g = { thoughts: [] };
  for (let k = 0; k < 8; k++) addThought(g, 't' + k, null, k);
  assert.equal(g.thoughts.length, 5);
  addThought(g, 't5', null, 99);
  assert.equal(g.thoughts[0].t, 't5');
  assert.equal(g.thoughts.length, 5);
});
