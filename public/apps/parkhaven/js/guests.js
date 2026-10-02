// Parkhaven - guest movement, needs, shopping, queuing and thoughts (spec section 6).
import { DX, DY } from './world.js';
import { FIN, ITEMS, STALLS, STAFF, FIRST_NAMES, SHIRT_COLORS, PANTS_COLORS, SCENERY } from './data.js';
import {
  rollGuest, addThought, acceptsRide, applyRejection, rideSatisfaction, rideNauseaGain, satisfactionSample,
  purchaseDecision, acceptsToilet, pickRide, wantsReride, decideToLeave,
} from './guestlogic.js';

const BASE_SPEED = 0.016; // tiles per tick at energy 96
export const QSP = 0.33; // queue spacing in tiles
const MAX_GUESTS = 3000;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// ------------------------------------------------------------------ spawning
export function spawnGuest(game, campaign) {
  if (game.guests.length >= MAX_GUESTS) return null;
  const w = game.w, rng = game.rng;
  const a = rollGuest(rng, game.sc.guest || {});
  const id = game.nextGuestId++;
  const g = Object.assign(a, {
    id, name: `${FIRST_NAMES[rng.rand(FIRST_NAMES.length)]} ${String.fromCharCode(65 + rng.rand(26))}.`,
    shirt: rng.rand(SHIRT_COLORS.length), pants: rng.rand(PANTS_COLORS.length),
    state: 'arriving', inPark: false, leaving: false,
    tx: w.spawn.x, ty: w.spawn.y, nx: w.spawn.x, ny: w.spawn.y, px: w.spawn.x, py: w.spawn.y, prog: 0,
    x: w.spawn.x + 0.5, y: w.spawn.y + 0.5, z: 0, dir: 3, lat: (((id * 7919) % 9) - 4) * 0.04,
    spent: 0, items: {}, holding: null, consumeT: 0, container: 0,
    ridden: [], riddenTypes: [], numRides: 0, favourite: null, favScore: 0, thoughts: [],
    goal: null, headCount: 0, timeLost: 0, lostCount: 0, lastRide: null, lastRideT: 0, lastShop: null,
    paidEntry: false, voucher: null, queueRide: null, qd: 0, qTime: 0, rideId: null,
    shopId: null, shopT: 0, shopKind: null, sitT: 0, nUpd: 0, insideT: 0,
    rl: [0, 0, 0], rv: [0, 0, 0], rb: [0, 0, 0, 0, 0, 0], litterCool: 0, disgustT: 0, angry: 0, rideUpd: 0,
    triedPick: false, umbrella: false,
  });
  g.z = w.centreZ(w.idx(g.tx, g.ty));
  if (campaign) {
    if (campaign.key === 'freeEntry' || campaign.key === 'halfEntry') g.voucher = { k: campaign.key };
    else if (campaign.key === 'freeRide') g.voucher = { k: 'freeRide', id: campaign.subject };
    else if (campaign.key === 'freeFood') g.voucher = { k: 'freeFood', item: campaign.subject || 'F1' };
    else if (campaign.key === 'rideAd') g.adRide = campaign.subject;
  }
  game.guests.push(g);
  return g;
}

function removeGuest(game, g) {
  g.gone = true; g.state = 'gone';
  if (g.inPark) { g.inPark = false; game.guestsInPark = Math.max(0, (game.guestsInPark || 0) - 1); }
  game.guestsRemoved = true;
}

// ------------------------------------------------------------------ per tick
export function guestTick(game, g) {
  switch (g.state) {
    case 'arriving': case 'walking': case 'exiting':
      walkTick(game, g); break;
    case 'shop': shopTick(game, g); break;
    case 'sitting':
      if (--g.sitT <= 0) {
        const u = game.benchUse?.get(g.benchTile) || 0;
        if (game.benchUse && u > 0) game.benchUse.set(g.benchTile, u - 1);
        resumeWalking(game, g);
      }
      break;
    default: break; // queuing / riding are driven by the ride
  }
  if (g.gone) return;
  if (g.inPark) g.insideT++;
  const ph = (game.tick + g.id * 37);
  if ((ph & 127) === 0) consumptionUpdate(game, g);
  if ((ph & 511) === 0 && g.inPark) needsUpdate(game, g);
}

function speedOf(game, g) {
  let e = g.energy;
  if (g.state === 'queuing') e = Math.max(95, e);
  let s = (BASE_SPEED * e) / 96;
  const w = game.w;
  if (w.pslope[w.idx(g.tx, g.ty)] >= 0) s *= 0.6;
  return s;
}

function walkTick(game, g) {
  g.prog += speedOf(game, g);
  if (g.prog >= 1) {
    g.px = g.tx; g.py = g.ty;
    g.tx = g.nx; g.ty = g.ny; g.prog = 0;
    arriveTile(game, g);
    if (g.gone) return;
  }
  updatePos(game, g);
}

export function updatePos(game, g) {
  const w = game.w;
  const i0 = w.idx(g.tx, g.ty), i1 = w.idx(g.nx, g.ny);
  const cz0 = w.ptype[i0] ? w.centreZ(i0) : w.groundMax(g.tx, g.ty);
  const dx = g.nx - g.tx, dy = g.ny - g.ty;
  if (dx === 0 && dy === 0) {
    g.x = g.tx + 0.5 + (g.dir & 1 ? g.lat : 0); g.y = g.ty + 0.5 + (g.dir & 1 ? 0 : g.lat); g.z = cz0; return;
  }
  const d = dx === 1 ? 0 : dy === 1 ? 1 : dx === -1 ? 2 : 3;
  g.dir = d;
  const cz1 = w.ptype[i1] ? w.centreZ(i1) : cz0;
  let e = w.ptype[i0] ? w.edgeH(i0, d) : null;
  if (e == null) e = (cz0 + cz1) / 2;
  const p = g.prog;
  g.z = p < 0.5 ? cz0 + (e - cz0) * p * 2 : e + (cz1 - e) * (p - 0.5) * 2;
  g.x = g.tx + 0.5 + dx * p - dy * g.lat;
  g.y = g.ty + 0.5 + dy * p + dx * g.lat;
}

function stand(g) { g.nx = g.tx; g.ny = g.ty; g.prog = 0; }

// ------------------------------------------------------------------ arriving at a tile centre
function arriveTile(game, g) {
  const w = game.w;
  const i = w.idx(g.tx, g.ty);
  if (w.ptype[i] !== 1) { relocate(game, g); return; }
  if (g.state === 'arriving') {
    if (i === game.gateIndex()) { enterPark(game, g); if (g.state !== 'walking') return; }
    else { stepToward(game, g, game.gateField(), true); return; }
  }
  if (g.state === 'exiting') {
    if (g.tx === w.spawn.x && g.ty === w.spawn.y) { removeGuest(game, g); return; }
    stepToward(game, g, game.exitField(), true);
    return;
  }
  // walking inside the park
  tileSample(game, g, i);
  if (g.state !== 'walking') return;
  if (g.leaving) {
    if (i === game.gateIndex()) {
      g.inPark = false; game.guestsInPark = Math.max(0, game.guestsInPark - 1);
      g.state = 'exiting';
      stepToward(game, g, game.exitField(), true);
      return;
    }
    if (!stepToward(game, g, game.exitField(), false)) leavingLost(game, g);
    return;
  }
  const acc = game.accessMap.get(i);
  if (g.goal) {
    const goal = g.goal;
    if (acc && acc.includes(goal.id)) {
      const r = game.ride(goal.id);
      g.goal = null; g.timeLost = 0;
      if (r) {
        if (r.kind === 'stall') { if (visitStall(game, g, r, goal.want)) return; }
        else if (tryJoinQueue(game, g, r, true)) return;
      }
    }
  } else if (acc) {
    for (const rid of acc) {
      const r = game.ride(rid);
      if (!r) continue;
      if (r.kind === 'stall') { if (wantsStall(game, g, r) && visitStall(game, g, r, null)) return; }
      else if (considerPassing(game, g, r) && tryJoinQueue(game, g, r, false)) return;
    }
  }
  chooseNext(game, g);
}

function relocate(game, g) {
  // the path under the guest vanished: hop to the nearest path tile or give up
  const w = game.w;
  for (let r = 1; r <= 6; r++) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const x = g.tx + dx, y = g.ty + dy;
      if (!w.inMap(x, y)) continue;
      const i = w.idx(x, y);
      if (w.ptype[i] === 1 && (!w.poutside[i] || !g.inPark)) {
        g.tx = g.nx = g.px = x; g.ty = g.ny = g.py = y; g.prog = 0; updatePos(game, g); return;
      }
    }
  }
  removeGuest(game, g);
}

/** Step down a distance field. Returns false if the target is unreachable from here. */
function stepToward(game, g, f, outside) {
  const w = game.w, N = w.N;
  const i = w.idx(g.tx, g.ty);
  if (f[i] < 0) { randomStep(game, g, outside); return false; }
  if (f[i] === 0) { stand(g); return true; }
  const a = w.adj[i];
  let best = -1, bestD = 1e9, ties = 0;
  for (let d = 0; d < 4; d++) {
    if (!(a & (1 << d))) continue;
    const j = i + DX[d] + DY[d] * N;
    if (!outside && w.poutside[j]) continue;
    const v = f[j];
    if (v < 0) continue;
    if (v < bestD) { bestD = v; best = d; ties = 1; }
    else if (v === bestD && game.rng.rand(++ties) === 0) best = d;
  }
  if (best < 0) { stand(g); return false; }
  g.nx = g.tx + DX[best]; g.ny = g.ty + DY[best];
  return true;
}

function randomStep(game, g, outside) {
  const w = game.w, N = w.N;
  const i = w.idx(g.tx, g.ty);
  const a = w.adj[i];
  const opts = [];
  let back = -1;
  for (let d = 0; d < 4; d++) {
    if (!(a & (1 << d))) continue;
    const j = i + DX[d] + DY[d] * N;
    if (!outside && w.poutside[j]) continue;
    if (g.tx + DX[d] === g.px && g.ty + DY[d] === g.py) { back = d; continue; }
    opts.push(d);
  }
  let d;
  if (opts.length) d = opts[game.rng.rand(opts.length)];
  else if (back >= 0) d = back;
  else { stand(g); return 0; }
  g.nx = g.tx + DX[d]; g.ny = g.ty + DY[d];
  return opts.length;
}

function chooseNext(game, g) {
  if (g.goal) {
    const r = game.ride(g.goal.id);
    if (!r) { g.goal = null; return chooseNext(game, g); }
    const f = game.rideField(r);
    const lucky = g.items.M || game.rng.rand(100) >= 3;
    g.headCount--;
    if (g.headCount === 60 || g.headCount === 30) {
      if (r.kind !== 'stall') { addThought(g, 'cantFind', r.id, game.tick); g.happyT = Math.max(0, g.happyT - 30); }
    }
    if (g.headCount <= 0) { g.goal = null; randomStep(game, g, false); return; }
    if (!lucky || !stepToward(game, g, f, false)) {
      if (f[game.w.idx(g.tx, g.ty)] < 0) g.goal = null;
      randomStep(game, g, false);
    }
    return;
  }
  const n = randomStep(game, g, false);
  if (n >= 2 && game.rides.length >= 2) {
    g.timeLost++;
    if (g.timeLost >= 254) {
      addThought(g, 'lost', null, game.tick);
      g.happyT = Math.max(0, g.happyT - 30);
      g.timeLost = 230;
    }
  }
}

function leavingLost(game, g) {
  g.lostCount++;
  if (g.lostCount % 90 === 0) {
    addThought(g, 'cantFindExit', null, game.tick);
    g.happyT = Math.max(0, g.happyT - 30);
  }
  // [D] a guest who cannot reach the exit for a very long time eventually gives up and is removed
  if (g.lostCount > 900) removeGuest(game, g);
}

function enterPark(game, g) {
  const w = game.w;
  if (!game.parkOpen) { turnBack(game, g); return; }
  let fee = game.pricing === 'ride' ? 0 : game.entryFee;
  if (g.voucher?.k === 'freeEntry') fee = 0;
  if (g.voucher?.k === 'halfEntry') fee = Math.floor(fee / 2);
  if (fee > g.cash) { turnBack(game, g); return; }
  if (fee > 0) {
    g.cash -= fee; g.spent += fee; g.paidEntry = true;
    game.earn(FIN.PARK_TICKETS, fee);
    game.emit({ type: 'money', x: g.x, y: g.y, z: g.z, amount: fee });
  }
  g.state = 'walking'; g.inPark = true; g.insideT = 0;
  game.guestsInPark = (game.guestsInPark || 0) + 1;
  game.totalAdmissions = (game.totalAdmissions || 0) + 1;
  if (game.totalAdmissions === 1) game.notify('Your first guest has arrived!', null, 'good');
  if (g.voucher?.k === 'freeRide') headFor(game, g, g.voucher.id);
  else if (g.adRide) headFor(game, g, g.adRide);
  chooseNext(game, g);
  void w;
}

function turnBack(game, g) {
  g.state = 'exiting';
  stepToward(game, g, game.exitField(), true);
}

function headFor(game, g, rideId, want = null) {
  const r = game.ride(rideId);
  if (!r) return;
  g.goal = { id: rideId, want };
  g.headCount = 200;
}

function resumeWalking(game, g) {
  g.state = 'walking';
  g.shopKind = null;
  g.hidden = false;
  chooseNext(game, g);
  updatePos(game, g);
}

export function startLeaving(game, g) {
  if (g.leaving) return;
  g.leaving = true;
  g.goal = null;
  addThought(g, 'goHome', null, game.tick);
}

// ------------------------------------------------------------------ path sampling (spec 6.11)
function tileSample(game, g, i) {
  const w = game.w, rng = game.rng;
  if (game.tileCount && game.tileCount[i] >= 10 && rng.rand(3) === 0) {
    addThought(g, 'crowded', null, game.tick); g.happyT = Math.max(0, g.happyT - 14);
  }
  g.rl.shift(); g.rl.push(game.litterN[i]);
  g.rv.shift(); g.rv.push(game.vomitN[i]);
  g.rb.shift(); g.rb.push(w.paddon[i] && w.pbroken[i] ? 1 : 0);
  if (g.litterCool > 0) g.litterCool--;
  else {
    const sl = g.rl[0] + g.rl[1] + g.rl[2], sv = g.rv[0] + g.rv[1] + g.rv[2];
    if (sv >= 3 && rng.rand(6) === 0) { addThought(g, 'disgusting', null, game.tick); g.happyT = Math.max(0, g.happyT - 17); g.litterCool = 3; g.disgustT = 4; }
    else if (sl >= 3 && rng.rand(6) === 0) { addThought(g, 'litter', null, game.tick); g.happyT = Math.max(0, g.happyT - 17); g.litterCool = 3; g.disgustT = 4; }
  }
  if (g.rb.reduce((a, b) => a + b, 0) >= 2 && rng.rand(6) === 0) {
    addThought(g, 'vandalism', null, game.tick); g.happyT = Math.max(0, g.happyT - 17);
  }
  // bins
  if (g.container && w.paddon[i] === 2 && !w.pbroken[i] && w.pbin[i] < 24) {
    w.pbin[i]++; g.container = 0;
  }
  // vandalism (spec 6.11)
  if (g.happy < 48 && g.energy >= 85 && g.disgustT > 0 && w.paddon[i] && !w.pbroken[i] && rng.rand(20) === 0) {
    const guard = game.staff.find((s) => s.type === 'security' && Math.abs(s.tx - g.tx) <= 7 && Math.abs(s.ty - g.ty) <= 7);
    if (guard) guard.stats.stopped = (guard.stats.stopped || 0) + 1;
    else if (!(w.paddon[i] === 1 && (game.benchUse?.get(i) || 0) > 0)) {
      w.pbroken[i] = 1; w.version++;
      g.angry = 16;
      game.emit({ type: 'vandal', x: g.x, y: g.y, z: g.z });
    }
  }
  // benches
  if (w.paddon[i] === 1 && !w.pbroken[i] && (g.nausea > 170 || g.energy <= 50 || (g.holding && g.happy < 100))) {
    if (!game.benchUse) game.benchUse = new Map();
    const used = game.benchUse.get(i) || 0;
    if (used < 4) {
      game.benchUse.set(i, used + 1);
      g.state = 'sitting'; g.sitT = 900 + game.rng.rand(600); g.benchTile = i; g.seat = used;
      stand(g);
      const sx = [0.25, 0.75, 0.25, 0.75][used], sy = [0.2, 0.2, 0.8, 0.8][used];
      g.x = g.tx + sx; g.y = g.ty + sy; g.dir = used < 2 ? 1 : 3;
    }
  }
}

// ------------------------------------------------------------------ shops (spec 7.3)
function stallOpen(r) { return r.kind === 'stall' && r.status === 'open' && r.access && r.access.length; }

function wantsStall(game, g, r) {
  if (!stallOpen(r) || g.lastShop === r.id || g.leaving) return false;
  const def = STALLS[r.type];
  if (def.facility === 'toilet') return g.toilet >= 70;
  if (def.facility === 'firstaid') return g.nausea >= 128;
  if (def.facility === 'cash') return g.cash <= 2000 && g.energy >= 80;
  for (const k of def.sells) {
    const it = ITEMS[k];
    if (it.cat === 'food' && g.hunger <= 75 && !g.holding) return true;
    if (it.cat === 'drink' && g.thirst <= 75 && !g.holding) return true;
    if (k === 'M' && !g.items.M && game.rng.rand(6) === 0) return true;
    if (k === 'S2' && game.raining && !g.items.S2) return true;
    if (k === 'S1' && !g.items.S1 && g.numRides >= 3 && game.rng.rand(4) === 0) return true;
  }
  return false;
}

export function visitStall(game, g, r, want) {
  if (!stallOpen(r)) return false;
  const def = STALLS[r.type];
  const tick = game.tick;
  g.lastShop = r.id;
  const faceStall = () => { stand(g); g.dir = (r.dir + 2) & 3; };
  if (def.facility === 'toilet') {
    const fee = game.pricing === 'gate' && !r.fee ? 0 : r.fee || 0;
    const res = acceptsToilet(g, fee);
    if (!res.ok) { if (res.thought) addThought(g, res.thought, null, tick); if (res.pen) g.happyT = Math.max(0, g.happyT - res.pen); return false; }
    if (fee) { g.cash -= fee; g.spent += fee; game.earn(FIN.SHOP_SALES, fee); r.profit += fee; game.emit({ type: 'money', x: g.x, y: g.y, z: g.z, amount: fee }); }
    r.customers++; r.custCur = (r.custCur || 0) + 1;
    g.state = 'shop'; g.shopKind = 'toilet'; g.hidden = true; g.shopId = r.id; faceStall();
    return true;
  }
  if (def.facility === 'firstaid') {
    if (g.nausea < 128) return false;
    r.customers++; r.custCur = (r.custCur || 0) + 1;
    g.state = 'shop'; g.shopKind = 'aid'; g.hidden = true; g.shopId = r.id; faceStall();
    return true;
  }
  if (def.facility === 'cash') {
    if (g.leaving || g.cash > 2000 || g.energy < 80 || g.happy < 115 + game.rng.rand(128)) return false;
    g.cash += 5000; r.customers++; r.custCur = (r.custCur || 0) + 1;
    g.state = 'shop'; g.shopKind = 'buy'; g.shopT = 40; faceStall();
    return true;
  }
  const ctx = { temp: game.temp, raining: game.raining, rand: (n) => game.rng.rand(n) };
  let order = def.sells.slice();
  if (want) order.sort((a, b) => (ITEMS[b].cat === want ? 1 : 0) - (ITEMS[a].cat === want ? 1 : 0));
  for (const k of order) {
    const voucher = g.voucher?.k === 'freeFood' && g.voucher.item === k;
    const price = r.prices[k] ?? ITEMS[k].price;
    const res = purchaseDecision(g, k, price, ctx, voucher);
    r.pop = r.pop || [];
    if (!res.ok) {
      if (res.thought && (want || res.thought === 'itemExpensive')) { addThought(g, res.thought, null, tick); g.thoughts[0].i = res.item || k; }
      if (res.thought === 'itemExpensive') pushSample(r.pop, 0, 25);
      continue;
    }
    buyItem(game, g, r, k, res, voucher);
    pushSample(r.pop, 1, 25);
    faceStall();
    g.state = 'shop'; g.shopKind = 'buy'; g.shopT = 40;
    return true;
  }
  return false;
}

function buyItem(game, g, r, k, res, voucher) {
  const it = ITEMS[k];
  const price = res.price;
  g.cash = Math.max(0, g.cash - price); g.spent += price;
  const food = it.cat === 'food' || it.cat === 'drink';
  if (price) game.earn(food ? FIN.FOOD_SALES : FIN.SHOP_SALES, price);
  game.spend(food ? FIN.FOOD_STOCK : FIN.SHOP_STOCK, it.cost);
  r.profit += price - it.cost; r.sold++; r.customers++; r.custCur = (r.custCur || 0) + 1;
  r.soldBy = r.soldBy || {}; r.soldBy[k] = (r.soldBy[k] || 0) + 1;
  if (voucher) g.voucher = null;
  g.happy = clamp(g.happy + res.gain, 0, 255); g.happyT = clamp(g.happyT + res.gain, 0, 255);
  if (res.thought) { addThought(g, res.thought, null, game.tick); g.thoughts[0].i = k; }
  r.sat = r.sat || []; pushSample(r.sat, res.sample, 20);
  if (food) { g.holding = k; g.consumeT = Math.min(255, g.consumeT + it.consume); }
  else g.items[k] = 1;
  if (k === 'S2' && game.raining) g.umbrella = true;
  if (price) game.emit({ type: 'money', x: g.x, y: g.y, z: g.z, amount: price });
}

function shopTick(game, g) {
  if (g.shopKind === 'toilet') {
    g.toilet = Math.max(0, g.toilet - 1);
    if (g.toilet === 0) { g.happyT = clamp(g.happyT + 30, 0, 255); g.happy = g.happyT; game.emit({ type: 'flush', x: g.x, y: g.y }); resumeWalking(game, g); }
  } else if (g.shopKind === 'aid') {
    g.nausea = Math.max(0, g.nausea - 1); g.nauseaT = Math.min(g.nauseaT, g.nausea);
    if (g.nausea <= 35) { g.happyT = clamp(g.happyT + 30, 0, 255); resumeWalking(game, g); }
  } else if (--g.shopT <= 0) resumeWalking(game, g);
}

export function pushSample(arr, v, max) { arr.push(v); if (arr.length > max) arr.shift(); }

// ------------------------------------------------------------------ rides
function rideCtx(game) {
  return { raining: game.raining, payRides: game.pricing !== 'gate', tick: game.tick };
}

function considerPassing(game, g, r) {
  if (r.status !== 'open' || g.leaving || g.holding) return false;
  if (g.ridden.includes(r.id)) return game.rng.rand(5) === 0;
  return game.rng.rand(3) !== 0;
}

/** Guest at the queue entrance decides whether to join. */
export function tryJoinQueue(game, g, r, decided) {
  const voucher = g.voucher?.k === 'freeRide' && g.voucher.id === r.id;
  r.queueFull = r.queue.length >= r.queueCap;
  const res = acceptsRide(g, r, {
    atRide: true, decided, paidEntry: g.paidEntry, voucher, ctx: rideCtx(game), rngRoll: game.rng.rand(100),
  });
  r.pop = r.pop || [];
  if (!res.ok) {
    if (decided || res.thought === 'queueFull') applyRejection(g, res, r.id, game.tick);
    if (res.thought) pushSample(r.pop, 0, 25);
    g.lastRide = r.id; g.lastRideT = game.tick;
    return false;
  }
  if (res.thought) addThought(g, res.thought, r.id, game.tick);
  pushSample(r.pop, 1, 25);
  r.queue.push(g.id);
  g.state = 'queuing'; g.queueRide = r.id; g.qTime = 0; g.timeLost = 0;
  g.qd = Math.max(0, (r.qpts.length - 1)) + 0.45;
  g.goal = null;
  return true;
}

/** Guest leaves a queue (gave up, ride closed). */
export function leaveQueue(game, g, r) {
  const k = r.queue.indexOf(g.id);
  if (k >= 0) r.queue.splice(k, 1);
  g.queueRide = null;
  g.state = 'walking';
  const t = r.access && r.access[0];
  if (t != null) { const w = game.w; g.tx = g.px = t % w.N; g.ty = g.py = (t / w.N) | 0; }
  stand(g);
  g.lastRide = r.id; g.lastRideT = game.tick;
  updatePos(game, g);
}

/** Called when the guest boards. Returns false if they refuse at the gate. */
export function onBoard(game, g, r) {
  const pay = game.pricing !== 'gate';
  const voucher = g.voucher?.k === 'freeRide' && g.voucher.id === r.id;
  let price = pay && !voucher ? r.price : 0;
  if (price > 0 && (g.cash <= 0 || price > g.cash || (r.value && price > 2 * (g.paidEntry ? r.value / 4 : r.value)))) {
    addThought(g, price > g.cash ? 'cantAfford' : 'badValue', r.id, game.tick);
    return false;
  }
  if (price > 0) {
    g.cash -= price; g.spent += price;
    game.earn(FIN.RIDE_TICKETS, price);
    r.income += price; r.incomeMonth = (r.incomeMonth || 0) + price;
    game.emit({ type: 'money', x: g.x, y: g.y, z: g.z, amount: price });
  }
  if (voucher) g.voucher = null;
  const sat = rideSatisfaction(g, r, {
    payRides: pay && !voucher, queueTime: g.qTime, riddenType: g.riddenTypes.includes(r.type), riddenRide: g.ridden.includes(r.id),
  });
  g.happyT = clamp(g.happyT + sat, 0, 255);
  r.sat = r.sat || []; pushSample(r.sat, satisfactionSample(sat), 20);
  if (r.ratings) g.nauseaT = clamp(g.nauseaT + rideNauseaGain(g, r.ratings[2]), 0, 255);
  g.lastSat = sat;
  g.state = 'riding'; g.rideId = r.id; g.queueRide = null; g.rideUpd = 0; g.hidden = true;
  g.numRides++;
  if (!g.ridden.includes(r.id)) g.ridden.push(r.id);
  if (!g.riddenTypes.includes(r.type)) g.riddenTypes.push(r.type);
  r.totalCustomers++; r.custCur = (r.custCur || 0) + 1;
  return true;
}

/** Called when the guest gets off at the exit. */
export function onUnload(game, g, r) {
  const w = game.w, rng = game.rng;
  g.happy = g.happyT; g.nausea = g.nauseaT;
  if (r.controlFailed) g.nauseaT = clamp(g.nauseaT + 50, 0, 255);
  if (g.happy >= 200 && !game.sc.lessIntense && rng.rand(256) < 256 - g.prefMax * 16) g.prefMax = Math.min(15, g.prefMax + 1);
  const I = r.ratings ? r.ratings[1] : 0;
  if (g.happy >= 215 && g.nausea <= 120 && I <= 1000) {
    addThought(g, 'rideGreat', r.id, game.tick);
    if (rng.rand(8) < 3) game.emit({ type: 'laugh', x: r.exit.x + 0.5, y: r.exit.y + 0.5 });
  }
  const score = Math.min(255, Math.floor((r.ratings ? r.ratings[0] : 0) / 4) + (g.lastSat || 0));
  if (score > g.favScore && g.happy >= 160 && g.happyT >= 160) {
    const old = game.ride(g.favourite);
    if (old && old.favCount) old.favCount--;
    g.favourite = r.id; g.favScore = score; r.favCount = (r.favCount || 0) + 1;
  }
  g.hidden = false; g.rideId = null;
  g.state = 'walking';
  const ex = r.exit;
  g.tx = g.px = ex.x; g.ty = g.py = ex.y;
  g.nx = ex.x + DX[ex.dir]; g.ny = ex.y + DY[ex.dir];
  g.prog = 0.05 + rng.float() * 0.3; g.dir = ex.dir;
  g.lastRide = r.id; g.lastRideT = game.tick;
  if (wantsReride(g, r, (n) => rng.rand(n))) { headFor(game, g, r.id); g.lastRide = null; }
  updatePos(game, g);
  void w;
}

// ------------------------------------------------------------------ consumption (spec 6.3)
function consumptionUpdate(game, g) {
  if (g.holding && g.consumeT === 0) g.consumeT += 3;
  if (g.consumeT > 0 && g.state !== 'riding') {
    g.consumeT = Math.max(0, g.consumeT - 3);
    if (g.holding === 'D1') g.thirst = Math.min(255, g.thirst + 7);
    else { g.hunger = Math.min(255, g.hunger + 7); g.thirst = Math.max(0, g.thirst - 3); g.toilet = Math.min(255, g.toilet + 2); }
    if (g.consumeT === 0 && g.holding) { g.container = ITEMS[g.holding].container || 0; g.holding = null; }
  }
  if (g.energy > g.energyT) g.energy = Math.max(g.energyT, g.energy - 2);
  else if (g.energy < g.energyT) g.energy = Math.min(g.energyT, g.energy + 4);
  g.energy = clamp(g.energy, 32, 128);
  if (g.happy < g.happyT) g.happy = Math.min(g.happyT, g.happy + 4); else g.happy = Math.max(g.happyT, g.happy - 4);
  if (g.nausea < g.nauseaT) g.nausea = Math.min(g.nauseaT, g.nausea + 4); else g.nausea = Math.max(g.nauseaT, g.nausea - 4);
}

function hungerTick(g) {
  if (g.hunger >= 3) { g.hunger -= 4; g.energyT = Math.min(128, g.energyT + 2); g.toilet = Math.min(255, g.toilet + 1); }
  if (g.hunger < 0) g.hunger = 0;
}

// ------------------------------------------------------------------ needs update (spec 6.4)
function needsUpdate(game, g) {
  const rng = game.rng, tick = game.tick, w = game.w;
  g.nUpd++;
  if (g.disgustT > 0) g.disgustT--;
  if (g.angry > 0) g.angry--;
  // forget old thoughts
  if (g.thoughts.length && tick - g.thoughts[g.thoughts.length - 1].at > 6900) g.thoughts.pop();
  // 2. surroundings
  if ((g.state === 'walking' || g.state === 'sitting') && g.nUpd % 18 === 0) surroundings(game, g);
  // 3. on a ride for a long time
  if (g.state === 'riding') {
    g.rideUpd++;
    if (g.rideUpd >= 15) g.happyT = Math.max(0, g.happyT - 5);
    if (g.rideUpd === 22) addThought(g, 'wantOff', g.rideId, tick);
  }
  const walking = g.state === 'walking';
  // 4. has not ridden anything for a while
  if (walking && !g.leaving && !g.triedPick && g.numRides === 0 && g.insideT >= 5 * 2048) {
    g.triedPick = true;
    const r = pickRide(g, game.rides.filter((x) => x.kind !== 'stall'), { ctx: rideCtx(game), paidEntry: g.paidEntry });
    if (r) headFor(game, g, r.id);
    else if (game.rides.some((x) => x.kind !== 'stall' && x.status === 'open')) {
      g.happyT = Math.max(0, g.happyT - 64); startLeaving(game, g);
    }
  }
  // 5. ride choice
  const chanceP = g.items.M ? 8192 : 2184;
  if (walking && !g.goal && !g.leaving && !g.holding && rng.rand(65536) < chanceP * 2) {
    const r = pickRide(g, game.rides.filter((x) => x.kind !== 'stall'), { ctx: rideCtx(game), paidEntry: g.paidEntry });
    if (r) headFor(game, g, r.id);
  }
  // 6. needs thoughts (alternate updates)
  if (!g.leaving) {
    if (g.nUpd & 1) {
      const c = [];
      if (g.energy <= 70 && g.happy < 128) c.push('tired');
      if (g.hunger <= 10 && !g.holding) c.push('hungry');
      if (g.thirst <= 25 && !g.holding) c.push('thirsty');
      if (g.toilet >= 160) c.push('toilet');
      if (g.cash <= 900 && g.happy >= 105 && g.energy >= 70) c.push('lowCash');
      if (c.length) {
        const t = c[rng.rand(c.length)];
        addThought(g, t, null, tick);
        if (walking && !g.goal) {
          if (t === 'hungry') seekStall(game, g, 'food');
          else if (t === 'thirsty') seekStall(game, g, 'drink');
          else if (t === 'toilet') seekStall(game, g, 'toilet');
          else if (t === 'lowCash') seekStall(game, g, 'cash');
        }
      }
    } else {
      if (g.nausea >= 200) { addThought(g, 'verySick', null, tick); if (walking && !g.goal) seekStall(game, g, 'firstaid'); }
      else if (g.nausea >= 140) addThought(g, 'sick', null, tick);
    }
  }
  // 7. state specific
  if (walking || g.state === 'exiting') {
    if (decideToLeave(g, game.pricing === 'gate', (n) => rng.rand(n))) startLeaving(game, g);
    g.energyT = Math.max(33, g.energyT - 2);
    if (game.temp >= 21) g.thirst = Math.max(0, g.thirst - 1);
    hungerTick(g);
    if (game.raining && !g.items.S2) g.happyT = Math.max(0, g.happyT - 2);
    g.umbrella = !!(game.raining && g.items.S2);
  } else if (g.state === 'sitting') {
    g.energyT = Math.min(128, g.energyT + 5); g.thirst = Math.max(0, g.thirst - 4); g.toilet = Math.min(255, g.toilet + 3);
    g.nauseaT = Math.max(0, g.nauseaT - 6);
    hungerTick(g);
  } else if (g.state === 'queuing') {
    if (g.qTime >= 2000) g.happyT = Math.max(0, g.happyT - 4);
    hungerTick(g);
  } else if (g.state === 'riding') {
    if (g.hunger >= 3) g.hunger -= 1;
  }
  g.thirst = Math.max(0, g.thirst - 2);
  // 8. idle drift
  if (g.happyT < 128) g.happyT++; else if (g.happyT > 128) g.happyT--;
  g.nauseaT = Math.max(0, g.nauseaT - 2);
  if (g.energy <= 50) g.happyT = Math.max(0, g.happyT - 2);
  if (g.hunger < 10) g.happyT = Math.max(0, g.happyT - 1);
  if (g.thirst < 10) g.happyT = Math.max(0, g.happyT - 1);
  if (g.toilet >= 195) g.happyT = Math.max(0, g.happyT - 1);
  // 9. vomit roll
  if (walking && g.nauseaT >= 128 && rng.rand(256) < (g.nausea - 128) / 2) vomit(game, g);
  // litter
  if (walking && g.container && rng.rand(16) === 0) {
    const i = w.idx(g.tx, g.ty);
    if (!(w.paddon[i] === 2 && !w.pbroken[i])) { addLitter(game, g.x, g.y, g.container - 1); g.container = 0; }
  }
}

function surroundings(game, g) {
  const w = game.w;
  let fountains = 0, scen = 0, litter = 0, music = false;
  for (let y = g.ty - 5; y < g.ty + 5; y++) for (let x = g.tx - 5; x < g.tx + 5; x++) {
    if (!w.inMap(x, y)) continue;
    const i = w.idx(x, y);
    const s = w.scen[i];
    if (s) { scen++; if (SCENERY[s]?.fountain) fountains++; }
    litter += game.litterN[i] + game.vomitN[i];
  }
  for (const r of game.rides) {
    if (r.music && r.status === 'open' && Math.abs(r.x + 1 - g.tx) < 6 && Math.abs(r.y + 1 - g.ty) < 6) { music = true; break; }
  }
  let t = null;
  if (fountains >= 5 && litter < 20) t = 'fountains';
  else if (scen >= 40 && litter < 8) t = 'scenery';
  else if (music && litter < 20) t = 'music';
  else if (litter < 2) t = 'clean';
  if (t) { addThought(g, t, null, game.tick); g.happyT = clamp(g.happyT + 45, 0, 255); }
}

function vomit(game, g) {
  g.hunger = Math.floor(g.hunger / 2); g.nauseaT = Math.floor(g.nauseaT / 2); g.nausea = Math.max(0, g.nausea - 30);
  addLitter(game, g.x, g.y, 4 + game.rng.rand(2));
  game.emit({ type: 'vomit', x: g.x, y: g.y, z: g.z });
}

export function addLitter(game, x, y, t) {
  const w = game.w;
  const tx = Math.floor(x), ty = Math.floor(y);
  if (!w.inMap(tx, ty)) return;
  const i = w.idx(tx, ty);
  if (!w.ptype[i] || w.own[i] !== 1) return;
  if (t >= 4) { if (game.vomitN[i] >= 3) return; game.vomitN[i]++; }
  else { if (game.litterN[i] >= 3) return; game.litterN[i]++; }
  game.litter.push({ x, y, t, born: game.tick });
}

/** Head for the nearest open stall of a kind ('food','drink','toilet','firstaid','cash'). */
function seekStall(game, g, kind) {
  const w = game.w;
  const i = w.idx(g.tx, g.ty);
  let best = null, bestD = 1e9;
  for (const r of game.rides) {
    if (!stallOpen(r) || r.id === g.lastShop && kind !== 'toilet') continue;
    const def = STALLS[r.type];
    let ok = false;
    if (def.facility) ok = def.facility === kind;
    else ok = def.sells.some((k) => ITEMS[k].cat === kind);
    if (!ok) continue;
    const f = game.rideField(r);
    if (f[i] >= 0 && f[i] < bestD) { bestD = f[i]; best = r; }
  }
  if (best) { headFor(game, g, best.id, kind); g.lastShop = null; }
}

// ------------------------------------------------------------------ weekly warnings (spec 6.13)
export function weeklyWarnings(game) {
  const tick = game.tick;
  const counts = {};
  let total = 0;
  for (const g of game.guests) {
    if (!g.inPark) continue;
    total++;
    const t = g.thoughts[0];
    if (!t || tick - t.at > 1024) continue; // [D] "fresh" widened to the last 1024 ticks for weekly checks
    if (t.t === 'hungry' && g.goal) continue;
    counts[t.t] = (counts[t.t] || 0) + 1;
  }
  const warn = (key, text) => {
    const last = game.warnAt[key] ?? -1e9;
    if (tick - last < 4 * 4096) return;
    game.warnAt[key] = tick;
    game.notify(text, null, 'warn');
  };
  const c = (k) => counts[k] || 0;
  if (c('hungry') >= 25 && c('hungry') >= total / 16) warn('hungry', 'Lots of guests are hungry. Build more food stalls.');
  if (c('thirsty') >= 25 && c('thirsty') >= total / 16) warn('thirsty', 'Lots of guests are thirsty. Build more drink stands.');
  if (c('toilet') >= 28 && c('toilet') >= total / 16) warn('toilet', "Guests can't find a restroom!");
  if (c('litter') >= 23 && c('litter') >= total / 32) warn('litter', 'Guests are complaining about litter. Hire more handymen and place bins.');
  if (c('disgusting') >= 22 && c('disgusting') >= total / 32) warn('disgusting', 'Guests are disgusted by the state of the paths.');
  if (c('vandalism') >= 15 && c('vandalism') >= total / 32) warn('vandalism', 'Guests are upset about vandalism. Security guards would help.');
  if (c('lost') + c('cantFindExit') >= 8) warn('lost', 'Guests are getting lost. Simplify the paths or sell park maps.');
  // queue too long
  let worst = null, worstN = 0, queuers = 0;
  const per = new Map();
  for (const g of game.guests) {
    if (g.state === 'queuing') queuers++;
    const t = g.thoughts[0];
    if (t && t.t === 'waitedLong' && tick - t.at <= 1024) per.set(t.s, (per.get(t.s) || 0) + 1);
  }
  for (const [rid, n] of per) if (n > worstN) { worstN = n; worst = rid; }
  if (worstN > 25 && worstN > queuers / 20) {
    const r = game.ride(worst);
    if (r) warn('queue' + worst, `Guests have been queuing too long for ${r.name}.`);
  }
}

export function moodOf(g) {
  if (g.nausea >= 200) return 'very sick';
  if (g.nausea >= 140) return 'sick';
  if (g.angry > 0) return 'angry';
  if (g.energy <= 50) return 'tired';
  const h = g.happy;
  return h < 37 ? 'miserable' : h < 73 ? 'unhappy' : h < 110 ? 'a bit glum' : h < 146 ? 'content' : h < 183 ? 'happy' : h < 219 ? 'very happy' : 'delighted';
}

export function guestStatus(game, g) {
  const r = (id) => game.ride(id)?.name || 'a ride';
  if (g.state === 'arriving') return 'Walking to the park';
  if (g.state === 'exiting') return 'Heading home';
  if (g.state === 'queuing') return `Queuing for ${r(g.queueRide)}`;
  if (g.state === 'riding') return `On ${r(g.rideId)}`;
  if (g.state === 'sitting') return 'Resting on a bench';
  if (g.state === 'shop') return g.shopKind === 'toilet' ? 'In the restroom' : g.shopKind === 'aid' ? 'At first aid' : `Buying at ${r(g.shopId)}`;
  if (g.leaving) return 'Looking for the exit';
  if (g.goal) return `Heading for ${r(g.goal.id)}`;
  return 'Wandering';
}
