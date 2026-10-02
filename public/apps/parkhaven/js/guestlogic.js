// Parkhaven - guest decision rules (spec section 6 and 7.3). Pure functions over plain objects so
// they can be unit-tested in node. Money in cents, ratings in hundredths, needs 0..255.

import { ITEMS } from './data.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const TOL_MAX_NAUSEA = [300, 600, 800, 1000];
export const TOL_MIN_NAUSEA = [0, 0, 200, 400];

/** Create a new guest's attributes (spec 6.1). scen: scenario guest defaults. */
export function rollGuest(rng, scen = {}) {
  const happy = clamp((scen.happiness ?? 128) + rng.rand(32) - 15, 0, 255);
  const energy = clamp(65 + rng.rand(64), 32, 128);
  const cashOpts = [-1000, 0, 1000, 2000];
  let prefMax = 3 + rng.rand(8);
  if (prefMax >= 7) prefMax = 15;
  let prefMin = Math.max(0, Math.min(prefMax, 7) - 3);
  if (scen.lessIntense) { prefMin = 0; prefMax = 4; }
  if (scen.moreIntense) { prefMin = 9; prefMax = 15; }
  const tr = rng.rand(12);
  let tol = tr < 1 ? 0 : tr < 3 ? 1 : tr < 6 ? 2 : 3;
  if (scen.moreIntense && tol < 2) tol++;
  return {
    happy, happyT: happy, energy, energyT: energy,
    hunger: clamp((scen.hunger ?? 200) + rng.rand(31) - 15, 0, 255),
    thirst: clamp((scen.thirst ?? 200) + rng.rand(31) - 15, 0, 255),
    toilet: 0, nausea: 0, nauseaT: 0,
    cash: Math.max(0, (scen.cash ?? 5000) + cashOpts[rng.rand(4)]),
    prefMin, prefMax, tol, mass: 45 + rng.rand(32),
  };
}

/** Item value depending on temperature (spec 7.2). */
export function itemValue(key, temp) {
  const it = ITEMS[key];
  if (temp >= 21) return it.hot;
  if (temp <= 11) return it.cold;
  return it.value;
}

/** Add a thought (newest first, max 5, same type+subject replaces). */
export function addThought(g, type, subject, tick) {
  if (!g.thoughts) g.thoughts = [];
  const i = g.thoughts.findIndex((t) => t.t === type && t.s === subject);
  if (i >= 0) g.thoughts.splice(i, 1);
  g.thoughts.unshift({ t: type, s: subject ?? null, at: tick });
  if (g.thoughts.length > 5) g.thoughts.length = 5;
}

function penalise(g, amount) {
  if (g.happyT >= 64) g.happyT = Math.max(0, g.happyT - amount);
}

/**
 * Would the guest ride this ride? (spec 6.5 guest_accepts_ride)
 * ride: { id, status, broken, ratings:[E,I,N]|null, price, value, sheltered, gforce, queueFull,
 *         crashedRecently, transport, maxG:{pos,neg,lat} }
 * opts: { atRide, decided, paidEntry, voucher, ctx:{raining, payRides, tick} }
 * Returns { ok, thought?, pen? } - penalties/thoughts are applied by the caller only when atRide.
 */
export function acceptsRide(g, ride, opts) {
  const ctx = opts.ctx || {};
  if (ride.status !== 'open' || ride.broken) return { ok: false };
  if (g.leaving && !ride.transport) return { ok: false };
  if (opts.atRide && ride.queueFull) return { ok: false, thought: 'queueFull', pen: 0 };
  if (g.lastRide === ride.id && ctx.tick != null && ctx.tick - (g.lastRideT || 0) < 720) return { ok: false };
  const free = opts.voucher || !ctx.payRides;
  if (!free && ride.price > 0) {
    if (g.cash <= 0) return { ok: false, thought: 'outOfMoney', pen: 8 };
    if (ride.price > g.cash) return { ok: false, thought: 'cantAfford', pen: 8 };
  }
  if (ride.crashedRecently && g.happy < 225) return { ok: false, thought: 'notSafe', pen: 8 };
  if (ride.ratings) {
    const [, I, N] = ride.ratings;
    if (opts.decided) {
      if (I > 1000) return { ok: false, thought: 'tooIntense', pen: 8 };
    } else {
      if (ctx.raining && !ride.sheltered && !g.umbrella) return { ok: false, thought: 'rain', pen: 8 };
      const maxI = Math.min(g.prefMax * 100, 1000) + g.happy;
      const minI = g.prefMin * 100 - g.happy;
      if (I < minI) return { ok: false, thought: 'notIntense', pen: 8 };
      if (I > maxI) return { ok: false, thought: 'tooIntense', pen: 8 };
      if (N > TOL_MAX_NAUSEA[g.tol] + g.happy) return { ok: false, thought: 'tooSickening', pen: 8 };
      if (N >= 140 && g.nausea > 160) return { ok: false, thought: 'tooSickening', pen: 8 };
    }
  } else if (ride.gforce) {
    // untested coaster: most guests stay away
    if ((opts.rngRoll ?? 0) < 90) return { ok: false, thought: 'noRatings', pen: 0 };
  }
  if (ride.value != null && ride.value > 0 && !free && ride.price > 0) {
    let v = ride.value;
    if (opts.paidEntry) v = Math.floor(v / 4);
    if (ride.price > 2 * v) return { ok: false, thought: 'badValue', pen: 16 };
    if (opts.atRide && ride.price <= v / 2 && !opts.paidEntry) return { ok: true, thought: 'goodValue' };
  }
  return { ok: true };
}

/** Apply a rejection made at the ride: thought + happiness penalty. */
export function applyRejection(g, res, subject, tick) {
  if (res.thought) addThought(g, res.thought, subject, tick);
  if (res.pen) penalise(g, res.pen);
}

/** Count how many of three widening windows contain value x (spec 6.6). */
function windowsHit(x, lo, hi, h) {
  let n = 0;
  if (x >= lo && x <= hi) n++;
  if (x >= lo - 2 * h && x <= hi + h) n++;
  if (x >= lo - 4 * h && x <= hi + 2 * h) n++;
  return n;
}
const FIT_TABLE = { '0': 70, '1,0': 50, '1,1': 35, '2,0': 35, '2,1': 20, '2,2': 10, '3,0': -35, '3,1': -50, '3,2': -60, '3,3': -60 };

/** Satisfaction score on boarding (spec 6.6). */
export function rideSatisfaction(g, ride, { payRides, queueTime = 0, riddenType = false, riddenRide = false } = {}) {
  let sat = 0;
  // value
  if (!payRides) sat += -30;
  else if (ride.value == null) sat += -30;
  else if (ride.price <= ride.value) sat += -5;
  else if (ride.price <= ride.value * (1 + g.happy / 256)) sat += -30;
  // intensity / nausea fit
  if (!ride.ratings) sat += 70;
  else {
    const h = g.happy;
    const [, I, N] = ride.ratings;
    const sI = 3 - windowsHit(I, g.prefMin * 100, g.prefMax * 100, h);
    const sN = 3 - windowsHit(N, TOL_MIN_NAUSEA[g.tol], TOL_MAX_NAUSEA[g.tol], h);
    const hi = Math.max(sI, sN), lo = Math.min(sI, sN);
    sat += hi === 0 ? FIT_TABLE['0'] : FIT_TABLE[hi + ',' + lo];
  }
  if (queueTime >= 4500) sat -= 35;
  else if (queueTime >= 2250) sat -= 10;
  else if (queueTime <= 750) sat += 10;
  if (riddenType) sat += 10;
  if (riddenRide) sat += 10;
  return sat;
}

/** Nausea target increase from a ride (spec 6.6). */
export function rideNauseaGain(g, rideN) {
  const k = clamp(256 - g.happyT, 64, 200);
  let v = (rideN * k) / 512;
  v = (v * Math.max(128, g.hunger)) / 128;
  v = v * 2;
  return Math.floor(v) >> g.tol;
}

export function satisfactionSample(sat) {
  return sat >= 40 ? 3 : sat >= 20 ? 2 : sat >= 0 ? 1 : 0;
}

/**
 * Purchase decision for one item (spec 7.3).
 * ctx: { temp, raining, rand: (n)=>int }
 * Returns { ok, thought?, pen?, gain?, sample }
 */
export function purchaseDecision(g, key, price, ctx, voucher = false) {
  const it = ITEMS[key];
  if (!it) return { ok: false };
  if (g.items && g.items[key]) return { ok: false, thought: 'alreadyHave' };
  if (it.cat === 'food' || it.cat === 'drink') {
    if (g.holding) return { ok: false, thought: 'notFinished', item: g.holding };
    if (g.nausea >= 145) return { ok: false };
    if (it.cat === 'food' && g.hunger > 75) return { ok: false, thought: 'notHungry' };
    if (it.cat === 'drink' && g.thirst > 75) return { ok: false, thought: 'notThirsty' };
  }
  const umbrellaInRain = key === 'S2' && ctx.raining;
  if (it.cat === 'souvenir' && key !== 'M' && !umbrellaInRain && !voucher) {
    if (!(g.happy >= 115 + ctx.rand(128) && (g.numRides || 0) >= 3)) return { ok: false };
  }
  if (voucher) return { ok: true, price: 0, gain: 32, sample: 3, thought: 'itemGoodValue' };
  if (price > g.cash || g.cash <= 0) return { ok: false, thought: 'outOfMoney' };
  const v = itemValue(key, ctx.temp ?? 15);
  let gain = 0, thought = null;
  if (v < price) {
    let over = Math.floor((price - v) / 10);
    if (g.happy >= 128) over = Math.floor(over / 2);
    if (g.happy >= 180) over = Math.floor(over / 2);
    if (!umbrellaInRain && over > ctx.rand(8)) return { ok: false, thought: 'itemExpensive', pen: 0 };
  } else {
    const margin = Math.max(8, Math.floor((v - price) / 10));
    if (margin >= ctx.rand(8)) thought = 'itemGoodValue';
    gain = margin * 4;
  }
  const d = v - price;
  const sample = d > 30 ? 3 : d > -30 ? 2 : d > -80 ? 1 : 0;
  return { ok: true, price, gain, thought, sample };
}

/** Toilet fee acceptance (spec 7.3). */
export function acceptsToilet(g, price) {
  if (g.toilet < 70) return { ok: false };
  if (price > g.cash) return { ok: false, thought: 'outOfMoney' };
  // reference rule "price x 40 > toilet" with price in 0.10 units == cents x 4
  if (price * 4 > g.toilet) return { ok: false, thought: 'wontPayToilet', pen: 16 };
  return { ok: true };
}

/**
 * Pick the most exciting suitable ride (spec 6.5 pick_ride). rides: ride summaries with
 * {id, x, y, ratings, highDrop, queueFull}; returns the chosen ride or null.
 */
export function pickRide(g, rides, opts) {
  let best = null, bestE = -1;
  for (const r of rides) {
    if (!r.ratings) continue;
    const near = g.items?.M || Math.abs(r.x - g.tx) <= 10 && Math.abs(r.y - g.ty) <= 10;
    const visible = (r.highDrop || 0) > 66 || r.ratings[0] >= 800;
    if (!near && !visible) continue;
    if ((g.ridden || []).includes(r.id)) continue;
    if (r.queueFull) continue;
    if (r.ratings[0] <= bestE) continue;
    const res = acceptsRide(g, r, { ...opts, atRide: false, decided: false });
    if (!res.ok) continue;
    best = r; bestE = r.ratings[0];
  }
  return best;
}

/** Re-ride check (spec 6.6, rides flagged re-rideable). */
export function wantsReride(g, ride, rand) {
  if (!ride.reride) return false;
  if (g.happy < 180 || g.energy < 100 || g.nausea > 160 || g.hunger < 30 || g.thirst < 20 || g.toilet > 170) return false;
  if (ride.ratings && ride.ratings[1] > 1000) return false;
  return rand(100) < ((g.numRides || 0) > 7 ? 25 : 75);
}

/** Leaving decision (spec 6.8). Returns true if the guest starts heading home. */
export function decideToLeave(g, payPark, rand) {
  if (g.leaving) return false;
  const stay = payPark
    ? g.energy >= 55 && g.happy >= 45 && g.cash >= 500
    : g.energy >= 70 && g.happy >= 60;
  if (stay) return false;
  return rand(65536) < 3276;
}

/** Mood bucket 0 (very unhappy) .. 6 (ecstatic) for UI. */
export function moodLevel(h) {
  return h < 37 ? 0 : h < 73 ? 1 : h < 110 ? 2 : h < 146 ? 3 : h < 183 ? 4 : h < 219 ? 5 : 6;
}
