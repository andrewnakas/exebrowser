// Parkhaven - ride rating maths, ride value, upkeep, park rating and guest-generation probability.
// Pure functions (no DOM, no game state) so they can be unit-tested in node.
// All ratings are integers in hundredths (6.50 => 650). Money in cents.

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// ---------------------------------------------------------------- flat rides
/**
 * def: FLAT_RIDES entry. opts: { option, towerHu, scenery, proximity }
 * returns [E, I, N]
 */
export function flatRideRatings(def, opts = {}) {
  let [E, I, N] = def.base;
  if (def.option) {
    const o = clamp(opts.option ?? def.option.def, def.option.min, def.option.max);
    E += def.bonus[0] * o; I += def.bonus[1] * o; N += def.bonus[2] * o;
  }
  if (def.perHu) {
    const hu = opts.towerHu || 0;
    E += def.perHu[0] * hu; I += def.perHu[1] * hu; N += def.perHu[2] * hu;
  }
  E += (def.scen || 0) * (opts.scenery || 0);
  E += (def.prox || 0) * (opts.proximity || 0);
  return [Math.max(0, Math.round(E)), Math.max(0, Math.round(I)), Math.max(0, Math.round(N))];
}

/** Scenery score from a count of scenery objects in the 11x11 square (spec 8.3). */
export function sceneryScore(count, underground = false) {
  if (underground) return 40;
  return Math.min(count, 47) * 5;
}

// ---------------------------------------------------------------- tracked rides
// turn table: [E, I, N] per group, hundredths
const TURN_FLAT = [[97, 32, 65], [300, 75, 313], [250, 125, 500]];
const TURN_BANKED = [[113, 32, 74], [375, 75, 313], [375, 125, 500]];
const SLOPED_E = [[286, 7], [367, 6], [417, 6], [750, 4]]; // per length class 1,2,3,4+ : value, max counted

/**
 * turns: array of { len: number of consecutive pieces, kind: 'flat'|'banked'|'sloped' }
 * returns [tE, tI, tN] (before weighting)
 */
export function turnsSubRating(turns, inversions = 0) {
  let tE = 0, tI = 0, tN = 0;
  const slopedCount = [0, 0, 0, 0];
  for (const t of turns) {
    if (t.kind === 'sloped') {
      const c = Math.min(t.len, 4) - 1;
      slopedCount[c]++;
      continue;
    }
    const tbl = t.kind === 'banked' ? TURN_BANKED : TURN_FLAT;
    const row = tbl[Math.min(t.len, 3) - 1];
    // table values are quoted as e.g. "+0.97" hundredths
    tE += row[0] / 100; tI += row[1] / 100; tN += row[2] / 100;
  }
  for (let c = 0; c < 4; c++) {
    const [v, max] = SLOPED_E[c];
    tE += (Math.min(slopedCount[c], max) * v) / 100;
  }
  tN += (Math.min(slopedCount[3], 8) * 750) / 100;
  tE += Math.min(inversions, 6) * 26.67;
  tI += inversions * 50.0;
  tN += inversions * 21.67;
  return [tE, tI, tN];
}

export function dropsSubRating(drops, H) {
  return [Math.min(drops, 9) * 11.11 + H * 0.488, drops * 14.17 + H * 0.977, drops * 10.0 + H * 0.3125];
}

export function shelteredSubRating(s) {
  const Ls = s.shelteredL || 0, sec = s.shelteredSections || 0;
  let sE = Math.min(Ls, 1000) * 0.14 + Math.min(sec, 11) * 11.82;
  let sN = Math.min(Ls, 1000) * 0.25;
  if (s.shelteredBanked) { sE += 20; sN += 15; }
  if (s.shelteredPitched) { sE += 20; sN += 15; }
  const sI = Math.min(Ls, 2000) * 0.15;
  return [sE, sI, sN];
}

function intensityPenalty(E, I) {
  for (const th of [1000, 1100, 1200, 1320, 1450]) if (I >= th) E -= E / 4;
  return E;
}

/**
 * Coaster rating pipeline (spec 8.7.4).
 * s: { L, cars, Smax, Savg, T, Gpos, Gneg, Glat, airtime, drops, H, inversions, turns[],
 *      shelteredL, shelteredSections, proximity, scenery }
 */
export function coasterRatings(s) {
  let E = 300, I = 50, N = 20;
  E += Math.min(s.L, 6000) * 0.01166;
  E += ((s.cars || 1) - 1) * 2.857;
  E += s.Smax * 0.676; I += s.Smax * 1.351; N += s.Smax * 0.540;
  E += s.Savg * 4.444; I += s.Savg * 6.667;
  E += Math.min(s.T, 150) * 0.4;

  const Gpos = s.Gpos, Gneg = s.Gneg, Glat = s.Glat;
  const gE = Gpos * 0.08 + Math.min(Math.abs(Math.min(Gneg, 0)), 250) * 0.24 + Math.min(Glat, 150) * 0.4;
  const gI = Gpos * 0.8 + (100 - Gneg) * 0.8 + Glat * 1.0;
  const gN = Gpos * 0.26 + (100 - Gneg) * 0.222 + Glat * 0.333;
  E += gE * 0.375; I += gI * 0.545; N += gN * 0.758;

  const [tE, tI, tN] = turnsSubRating(s.turns || [], s.inversions || 0);
  E += tE * 0.408; I += tI * 0.531; N += tN * 0.698;

  const [dE, dI, dN] = dropsSubRating(s.drops, s.H);
  E += dE * 0.444; I += dI * 0.714; N += dN * 0.75;

  const [sE, sI, sN] = shelteredSubRating(s);
  E += sE * 0.235; I += sI * 0.5; N += sN * 0.536;

  E += (s.proximity || 0) * 0.307;
  E += (s.scenery || 0) * 0.102;

  const waived = (s.inversions || 0) >= 1;
  const halve = () => { E /= 2; I /= 2; N /= 2; };
  if (!waived) {
    if (s.H < 14) halve();
    if (s.drops < 2) halve();
    if (Gneg >= 10) halve();
  }
  if (s.Smax < 10) halve();

  if (Glat > 310) { E -= gE * 0.1875; I += 1225 * 0.545; N += 600 * 0.758; }
  else if (Glat > 280) { I += 375 * 0.545; N += 200 * 0.758; }

  E += Math.min(s.airtime || 0, 200) / 8;
  N += (s.airtime || 0) / 16;

  E = intensityPenalty(E, I);
  return [Math.max(0, Math.round(E)), Math.max(0, Math.round(I)), Math.max(0, Math.round(N))];
}

/** Go-kart ratings (spec 8.4). s also has: karts, laps, race, shelteredFrac */
export function kartRatings(s) {
  let E = 142, I = 173, N = 40;
  E += Math.min(s.L, 700) * 0.5;
  if (s.race && s.karts >= 4) {
    E += 140; I += 50;
    E += (Math.max(1, s.laps) - 1) * 30; I += (Math.max(1, s.laps) - 1) * 15;
  }
  const [tE, tI, tN] = turnsSubRating(s.turns || [], 0);
  E += tE * 0.068; I += tI * 0.053; N += tN * 0.087;
  const [dE, dI, dN] = dropsSubRating(s.drops, s.H);
  E += dE * 0.133; I += dI * 0.083; N += dN * 0.1;
  const [sE, sI, sN] = shelteredSubRating(s);
  E += sE * 0.039; I += sI * 0.133; N += sN * 0.036;
  E += (s.proximity || 0) * 0.171;
  E += (s.scenery || 0) * 0.255;
  if ((s.shelteredFrac || 0) >= 0.75) E /= 2;
  return [Math.max(0, Math.round(E)), Math.max(0, Math.round(I)), Math.max(0, Math.round(N))];
}

/** Log-flume style water ride ratings (spec 8.5). s also has: splash (bool) */
export function flumeRatings(s) {
  let E = 150, I = 55, N = 30;
  E += Math.min(s.L, 2000) * 0.11;
  E += s.Smax * 8.11; I += s.Smax * 10.0; N += s.Smax * 4.59;
  E += Math.min(s.T, 300) * 0.2;
  const [tE, tI, tN] = turnsSubRating(s.turns || [], 0);
  E += tE * 0.34; I += tI * 0.318; N += tN * 0.07;
  const [dE, dI, dN] = dropsSubRating(s.drops, s.H);
  E += dE * 1.067; I += dI * 0.952; N += dN * 0.75;
  const [sE, sI, sN] = shelteredSubRating(s);
  E += sE * 0.255; I += sI * 0.467; N += sN * 0.536;
  E += (s.proximity || 0) * 0.341;
  E += (s.scenery || 0) * 0.17;
  if (s.splash) { E += 50; I += 30; N += 20; }
  E += Math.min(s.airtime || 0, 200) / 8;
  N += (s.airtime || 0) / 16;
  if (s.H < 6) { E /= 2; I /= 2; N /= 2; }
  E = intensityPenalty(E, I);
  return [Math.max(0, Math.round(E)), Math.max(0, Math.round(I)), Math.max(0, Math.round(N))];
}

// ---------------------------------------------------------------- value & upkeep
/** Ride value in cents (spec 8.2). ratings: [E,I,N]; mult [mE,mI,mN] */
export function rideValue(ratings, mult, ageMonths = 0, duplicateOpen = false) {
  const [E, I, N] = ratings;
  let v = ((E * mult[0] + I * mult[1] + N * mult[2]) / 10240) * 100; // cents
  if (ageMonths < 5) v += 300;
  else if (ageMonths < 13) v += 100;
  else if (ageMonths < 40) v *= 1;
  else if (ageMonths < 64) v = (v * 3) / 4;
  else if (ageMonths < 88) v = (v * 9) / 16;
  else if (ageMonths < 104) v = (v * 27) / 64;
  else if (ageMonths < 120) v = (v * 81) / 256;
  else if (ageMonths < 128) v = (v * 81) / 512;
  else v = (v * 81) / 1024;
  if (duplicateOpen) v -= v / 4;
  return Math.max(0, Math.round(v));
}

/**
 * Upkeep charged per fortnight in cents (spec 8.2).
 * u: upkeep def {base, lift, len, train, car, station, brake}; p: {lifts, L, brakes, trains, cars, stations}
 */
export function rideUpkeep(u, p = {}) {
  // len_mult is in the reference's 0.10 units, so the length term in cents is len x L x 10 / 1024
  const v = (u.base || 0) + (u.lift || 0) * (p.lifts || 0) + ((u.len || 0) * (p.L || 0) * 10) / 1024
    + (u.brake || 0) * (p.brakes || 0)
    + (u.train || 0) * (p.trains || 0) + (u.car || 0) * (p.cars || 0) + (u.station || 0) * (p.stations || 0);
  return Math.round((v * 5) / 8);
}

// ---------------------------------------------------------------- park rating (spec 4)
/**
 * p: { guests, happy, lost, rides: [{downtime, rated, E, I}], oldLitter, casualty, harder }
 */
export function parkRating(p) {
  let r = p.harder ? 1050 : 1150;
  r -= 150 - Math.floor(Math.min(2000, p.guests) / 13);
  r -= 500;
  if (p.guests > 0) r += 2 * Math.min(250, Math.floor((p.happy * 300) / p.guests));
  if (p.lost > 25) r -= (p.lost - 25) * 7;
  r -= 200;
  const rides = p.rides || [];
  if (rides.length > 0) {
    let up = 0;
    for (const rd of rides) up += 100 - rd.downtime;
    r += 2 * Math.floor(up / rides.length);
  }
  r -= 100;
  const rated = rides.filter((x) => x.rated);
  let sumE = 0, sumI = 0;
  if (rated.length > 0) {
    let aE = 0, aI = 0;
    for (const rd of rated) { aE += Math.floor(rd.E / 8); aI += Math.floor(rd.I / 8); }
    sumE = aE; sumI = aI;
    aE = Math.floor(aE / rated.length); aI = Math.floor(aI / rated.length);
    const dE = Math.min(Math.floor(Math.abs(aE - 46) / 2), 50);
    const dI = Math.min(Math.floor(Math.abs(aI - 65) / 2), 50);
    r += 100 - dE - dI;
  }
  r -= 200 - Math.floor((Math.min(1000, sumE) + Math.min(1000, sumI)) / 10);
  r -= 600 - 4 * (150 - Math.min(150, p.oldLitter || 0));
  r -= p.casualty || 0;
  return clamp(Math.round(r), 0, 999);
}

// ---------------------------------------------------------------- guest generation (spec 5)
/** Suggested max guests. rides: [{typeBonus, open, broken}] */
export function guestCap(rides) {
  let cap = 0;
  for (const r of rides) if (r.open && !r.broken) cap += r.typeBonus;
  return Math.min(cap, 65535);
}

/** Per-tick spawn probability out of 65536. */
export function spawnProbability({ rating, guests, walking = 0, cap, entranceFee = 0, rideValueForMoney = 0 }) {
  let P = 50 + clamp(rating - 200, 0, 650);
  const N = guests + walking;
  if (N > cap) P = Math.floor(P / 4);
  if (N > 52000) P = Math.floor(P / 4);
  if (entranceFee > rideValueForMoney) {
    P = Math.floor(P / 4);
    if (entranceFee / 2 > rideValueForMoney) P = Math.floor(P / 4);
  }
  return P;
}

/** Weekly loan interest in cents (spec 3.2). */
export function weeklyInterest(loan, ratePct) {
  return Math.floor((loan * ratePct * 5) / 16384);
}

export function ratingLabel(v) {
  if (v < 200) return 'Low';
  if (v < 400) return 'Medium';
  if (v < 600) return 'High';
  if (v < 800) return 'Very high';
  if (v < 1000) return 'Extreme';
  return 'Off the scale';
}
