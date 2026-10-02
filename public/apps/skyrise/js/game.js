// Skyrise — the simulation core. No DOM here: the UI listens to emitted events.
import { FAC, TRANSPORT, LIMITS, MAINT, START_FUNDS, FLOOR_COST, STAR_POP, PRICE_EVAL_OFFSET, PRICE_MOVE_FACTOR, evalTier, stressTier, floorLabel, isLobbyLevel, FILMS, FILM_COST, FILM_DRAW, INCOME_CATS, MAINT_CATS, MIN_LEVEL, STAR_LANDMARK } from './data.js';
import { DAY_TICKS, MIDNIGHT_TICK, START_TICK, dayTick, dayType, dateDay, quarterOf, yearOf, clockToTick, addMinutes, nextAt, clockMinutes } from './clock.js';
import { Rng } from './rng.js';
import { Tower } from './world.js';
import { Router } from './route.js';
import { Shaft, newCar } from './elevator.js';
import * as P from './people.js';
import * as E from './events.js';

const T21 = clockToTick(21, 0), T23 = clockToTick(23, 0), T17 = clockToTick(17, 0), T22 = clockToTick(22, 0);
const T13 = clockToTick(13, 0), T15 = clockToTick(15, 0), T19 = clockToTick(19, 0);

export class Game {
  constructor(seed = 12345) {
    this.seed = seed;
    this.rng = new Rng(seed);
    this.tower = new Tower();
    this.router = new Router(this.tower);
    this.t = START_TICK;
    this.funds = START_FUNDS;
    this.star = 1;
    this.people = new Map();
    this.nextPid = 1;
    this.movers = new Set();
    this.timers = new Map();
    this.arrivals = new Map();
    this.listeners = [];
    this.named = { people: [], facs: [] };
    this.flags = { vipOk: false, wedding: false, treasure: false, nextVip: 0, vipPending: false };
    this.pop = { total: 0, perm: 0, hotel: 0, comm: 0, workers: 0 };
    this.demands = [];
    this.negQuarters = 0;
    this.gameOver = false;
    this.weather = { rain: false, thunderAt: 0 };
    this.fire = null; this.bomb = null; this.heli = null;
    this.trainTicks = [];
    this.lastTrain = -999;
    this.events = [];
    this._cache = { ver: -1 };
    this.resetFinance();
    this.finance.startBalance = this.funds;
    this.prevFinance = null;
    this.reachVer = -1;
  }

  // ------------------------------------------------------------ plumbing
  on(fn) { this.listeners.push(fn); }
  emit(type, data = {}) { for (const fn of this.listeners) fn(type, data); }
  msg(text, sound = 'notice') { this.emit('msg', { text }); if (sound) this.emit('sound', { name: sound }); }
  timer(p, at, action) {
    if (at <= this.t) at = this.t + 1;
    let a = this.timers.get(at);
    if (!a) { a = []; this.timers.set(at, a); }
    a.push([p.id, action]);
  }
  arrival(at, item) {
    if (at <= this.t) at = this.t + 1;
    let a = this.arrivals.get(at);
    if (!a) { a = []; this.arrivals.set(at, a); }
    a.push(item);
  }
  _lists() {
    const v = this.tower.version;
    if (this._cache.ver === v) return this._cache;
    const c = { ver: v, shafts: [], comm: [], byType: {} };
    for (const o of this.tower.trans.values()) if (o.cars) c.shafts.push(o);
    for (const f of this.tower.facs.values()) {
      (c.byType[f.type] = c.byType[f.type] || []).push(f);
      if (FAC[f.type] && FAC[f.type].commercial) c.comm.push(f);
    }
    this._cache = c;
    return c;
  }
  shafts() { return this._lists().shafts; }
  commercial() { return this._lists().comm; }
  facsOf(type) { return this._lists().byType[type] || []; }
  transitStation() { const s = this.facsOf('transit')[0]; return s && this.ready(s) ? s : null; }
  ready(f) { return this.t >= (f.readyAt || 0) && !f.burning; }
  get dayTick() { return dayTick(this.t); }
  get dayType() { return dayType(this.t); }
  get quarter() { return quarterOf(this.t); }
  get year() { return yearOf(this.t); }
  get dateDay() { return dateDay(this.t); }
  isFestive() { return this.quarter === 4; }

  resetFinance() {
    this.finance = { income: {}, maint: {}, construction: 0, other: 0, refunds: 0, startBalance: this.funds };
    for (const k of INCOME_CATS) this.finance.income[k] = 0;
    for (const k of MAINT_CATS) this.finance.maint[k] = 0;
  }
  earn(cat, amt) {
    if (!amt) return;
    this.funds += amt;
    if (cat in this.finance.income) this.finance.income[cat] += amt; else this.finance.other += amt;
    if (amt > 0) this.emit('sound', { name: 'coins' });
  }
  spend(amt, cat = 'construction') {
    this.funds -= amt;
    if (cat === 'construction') this.finance.construction += amt;
    else if (cat in this.finance.maint) this.finance.maint[cat] += amt;
    else this.finance.other -= amt;
  }

  // ------------------------------------------------------------ building
  canAfford(c) { return this.funds >= 0 && this.funds >= c; }
  countLimit(type) {
    const d = FAC[type];
    if (d.commercial) return this.commercial().length < LIMITS.commercial;
    if (d.limitGroup === 'ent') return this.facsOf('cinema').length + this.facsOf('party').length < LIMITS.ent;
    if (d.limit) return this.facsOf(type).length < d.limit;
    return true;
  }

  // validate a facility placement without changing anything
  checkBuild(type, x, L, opts = {}) {
    if (this.gameOver) return { ok: false, reason: 'The tower has gone bankrupt.' };
    const d = FAC[type];
    if (!d) return { ok: false, reason: 'Unknown tool.' };
    if (type !== 'lobby' && !this.hasGroundLobby()) return { ok: false, reason: 'Build a ground-floor lobby first.' };
    if (type === 'lobby' && !this.hasGroundLobby() && L !== 0) return { ok: false, reason: 'The first lobby goes on the ground floor.' };
    if (this.star < d.star) return { ok: false, reason: d.label + ' unlocks at ' + d.star + ' stars.' };
    if (!this.countLimit(type)) return { ok: false, reason: 'The tower already has as many of these as it can take.' };
    const chk = this.tower.checkFacility(type, x, L, opts);
    if (!chk.ok) return chk;
    let cost = d.cost;
    if (type === 'lobby') cost = 4 * 5000 * chk.h;
    cost += chk.slabCost;
    if (this.funds < 0) return { ok: false, reason: 'Funds are negative: construction is frozen.' };
    if (!this.canAfford(cost)) return { ok: false, reason: 'Not enough funds ($' + cost.toLocaleString() + ' needed).' };
    if (type === 'parkramp' && !this.rampColumnOk(x, L)) return { ok: false, reason: 'Car ramps form one column that must reach up to the lobby.' };
    return { ok: true, chk, cost };
  }
  // place a facility; returns {ok, reason}
  build(type, x, L, opts = {}) {
    const r = this.checkBuild(type, x, L, opts);
    if (!r.ok) return r;
    const { chk, cost } = r;
    for (const id of chk.replace) this.demolish(id, true);
    this.tower.addSlab(chk.newSlab);
    const f = this.tower.addFacility(type, x, L, chk.h, chk.w, this.initFac(type));
    this.spend(cost);
    this.emit('sound', { name: type === 'lobby' ? 'buildFlex' : 'build' });
    this.emit('built', { f });
    if (L < 0) E.maybeTreasure(this);
    return { ok: true, f, cost };
  }
  hasGroundLobby() { return this.facsOf('lobby').some(f => f.L === 0); }
  initFac(type) {
    const d = FAC[type];
    const f = { readyAt: (d.struct || type === 'parkspace') ? this.t : addMinutes(this.t, 90), price: 1, eval: 200, evalTier: 2, variant: this.rng.int(0, 3), name: '', pen: 0, here: [], occupied: false, poor: 0, occSince: 0, reach: true };
    if (d.hotel) Object.assign(f, { hstate: 'vacant', dirtyNights: 0, guests: [], stayStress: 0 });
    if (d.commercial) Object.assign(f, { open: false, today: 0, yday: 0, stressSum: 0 });
    if (type === 'cinema') Object.assign(f, { film: 0, filmAge: 0, today: 0, yday: 0, showing: false, income: 0 });
    if (type === 'party') Object.assign(f, { today: 0, yday: 0, partying: false });
    if (type === 'recycling') f.load = 0;
    if (type === 'landmark') f.wedding = false;
    if (type === 'housekeeping' || type === 'security') f.occupied = true;
    return f;
  }
  buildFloor(x0, x1, L) {
    if (!this.hasGroundLobby()) return { ok: false, reason: 'Build a ground-floor lobby first.' };
    const chk = this.tower.checkFloor(x0, x1, L);
    if (!chk.ok) return chk;
    if (!this.canAfford(chk.slabCost)) return { ok: false, reason: 'Not enough funds.' };
    this.tower.addSlab(chk.newSlab);
    this.tower.bump();
    this.spend(chk.slabCost);
    this.emit('sound', { name: 'buildFlex' });
    return { ok: true, cost: chk.slabCost };
  }
  checkTransport(kind, x, b, t) {
    const d = TRANSPORT[kind];
    if (!this.hasGroundLobby()) return { ok: false, reason: 'Build a ground-floor lobby first.' };
    if (this.star < d.star) return { ok: false, reason: d.label + ' unlocks at ' + d.star + ' stars.' };
    if (d.mode === 'elev' && this.shafts().length >= LIMITS.shafts) return { ok: false, reason: 'The tower has the maximum of 24 lift shafts.' };
    if (d.mode !== 'elev') {
      let n = 0; for (const o of this.tower.trans.values()) if (!o.cars) n++;
      if (n >= LIMITS.stairsEsc) return { ok: false, reason: 'The tower has the maximum of 64 stairs and escalators.' };
    }
    const chk = this.tower.checkTransport(kind, x, b, t);
    if (!chk.ok) return chk;
    const cost = d.cost + chk.slabCost;
    if (this.funds < 0) return { ok: false, reason: 'Funds are negative: construction is frozen.' };
    if (!this.canAfford(cost)) return { ok: false, reason: 'Not enough funds ($' + cost.toLocaleString() + ' needed).' };
    return { ok: true, chk, cost };
  }
  buildTransport(kind, x, b, t) {
    const d = TRANSPORT[kind];
    const r = this.checkTransport(kind, x, b, t);
    if (!r.ok) return r;
    const { chk, cost } = r;
    this.tower.addSlab(chk.newSlab);
    let o;
    if (d.mode === 'elev') o = new Shaft(this.tower.nextId++, kind, x, chk.b, chk.t);
    else o = { kind, x, L: chk.b, w: d.w, name: '' };
    this.tower.addTransport(o);
    this.spend(cost);
    this.emit('sound', { name: 'build' });
    return { ok: true, o, cost };
  }
  addCar(sid, L) {
    const s = this.tower.trans.get(sid);
    if (!s || !s.cars) return { ok: false, reason: 'No shaft there.' };
    if (s.cars.length >= LIMITS.carsPerShaft) return { ok: false, reason: 'A shaft holds at most 8 cars.' };
    const c = TRANSPORT[s.kind].carCost;
    if (!this.canAfford(c)) return { ok: false, reason: 'Not enough funds.' };
    L = Math.max(s.bottom, Math.min(s.top, L));
    s.cars.push(newCar(L));
    this.spend(c);
    this.emit('sound', { name: 'build' });
    return { ok: true, cost: c };
  }
  resizeShaft(sid, b, t) {
    const s = this.tower.trans.get(sid);
    if (!s || !s.cars) return { ok: false };
    if (b > t) [b, t] = [t, b];
    const chk = this.tower.checkTransport(s.kind, s.x, b, t, s.id);
    if (!chk.ok) return chk;
    const cost = chk.slabCost;
    if (!this.canAfford(cost)) return { ok: false, reason: 'Not enough funds.' };
    this.evacuateShaft(s);
    this.tower.stampTransport(s, false);
    this.tower.addSlab(chk.newSlab);
    s.bottom = chk.b; s.top = chk.t;
    for (const c of s.cars) { c.home = Math.max(s.bottom, Math.min(s.top, c.home)); c.pos = Math.max(s.bottom, Math.min(s.top, Math.round(c.pos))); c.prev = c.pos; c.v = 0; c.state = 'idle'; }
    for (const L of [...s.off]) if (L < s.bottom || L > s.top) s.off.delete(L);
    this.tower.stampTransport(s, true);
    this.tower.bump();
    this.spend(cost);
    this.emit('sound', { name: 'buildFlex' });
    return { ok: true };
  }
  toggleService(sid, L) {
    const s = this.tower.trans.get(sid);
    if (!s || !s.cars || L < s.bottom || L > s.top) return;
    if (s.kind === 'express') { this.msg('Express lift stops are fixed.', 'refuse'); return; }
    if (s.off.has(L)) s.off.delete(L); else s.off.add(L);
    this.evacuateShaft(s);
    this.tower.bump();
  }
  // everyone waiting or riding in shaft s gets re-routed from the nearest floor
  evacuateShaft(s) {
    const folks = [];
    for (const q of s.queues.values()) for (const p of q.people) folks.push([p, q.L]);
    for (const c of s.cars) { for (const p of c.pax) folks.push([p, Math.round(c.pos)]); c.pax = []; c.state = 'idle'; c.v = 0; c.pos = Math.round(c.pos); }
    s.queues.clear();
    for (const [p, L] of folks) { p.state = 'walk'; p.L = L; p.x = s.cx; this._pendingReroute.push(p); }
  }
  get _pendingReroute() { return this.__pr || (this.__pr = []); }

  // bulldoze whatever is at (L,x): transport first (it sits in front), then facility
  bulldoze(L, x) {
    const tid = this.tower.transIdAt(L, x);
    if (tid > 0) { this.demolishTransport(tid); return { ok: true }; }
    const f = this.tower.facAt(L, x);
    if (!f) return { ok: false, reason: 'Nothing to clear there.' };
    if (!FAC[f.type].removable) return { ok: false, reason: FAC[f.type].label + ' cannot be bulldozed.' };
    this.demolish(f.id);
    return { ok: true };
  }
  demolishTransport(id) {
    const o = this.tower.trans.get(id);
    if (!o) return;
    if (o.cars) this.evacuateShaft(o);
    // people on stairs keep going (they finish the flight), then re-route at the next step
    this.tower.removeTransport(id);
    this.emit('sound', { name: 'bulldoze' });
  }
  demolish(id, silent) {
    const f = this.tower.facs.get(id);
    if (!f) return;
    if (f.type === 'condo' && f.occupied) { this.vacate(f, 'bulldozed'); }
    else if (f.occupied || f.open) this.vacate(f, 'bulldozed');
    // anyone heading there or inside goes elsewhere
    for (const p of [...this.people.values()]) {
      if (p.home === id) { P.removePerson(this, p); continue; }
      if (p.at === id || p.goalFac === id) { if (p.transient) P.removePerson(this, p); else { P.detach(this, p); p.state = 'off'; p.at = 0; } }
    }
    this.named.facs = this.named.facs.filter(i => i !== id);
    this.tower.removeFacility(id);
    if (!silent) this.emit('sound', { name: 'bulldoze' });
  }

  // ------------------------------------------------------------ tenancy
  occupy(f) {
    const d = FAC[f.type];
    f.occupied = true; f.occSince = this.t; f.poor = 0; f.pen = 0; f.variant = this.rng.int(0, 3);
    f.eval = 200; f.evalTier = 2;
    if (f.type === 'office') {
      for (let i = 0; i < 6; i++) P.newPerson(this, i < 2 ? 'sales' : 'worker', f.id);
      if (dayType(this.t) !== 2 && this.dayTick < clockToTick(14, 0)) {
        for (const p of this.residents(f)) {
          this.timer(p, this.t + this.rng.int(1, 40), 'commute');
          this.timer(p, this.t - this.dayTick + this.rng.int(clockToTick(17, 0), clockToTick(19, 0)), 'gohome');
        }
      }
    } else if (f.type === 'condo') {
      const sale = d.prices[f.price];
      f.salePrice = sale;
      this.earn('condo', sale);
      for (let i = 0; i < 3; i++) P.newPerson(this, 'resident', f.id);
      const kids = this.rng.int(0, 2);
      for (let i = 0; i < kids; i++) P.newPerson(this, 'child', f.id, { look: 4 });
      for (const p of this.residents(f)) {
        if (!P.travel(this, p, f, 'home')) P.placeIn(this, p, f);
      }
    }
    this.emit('sound', { name: 'notice' });
  }
  residents(f) { const r = []; for (const p of this.people.values()) if (p.home === f.id && !p.transient) r.push(p); return r; }
  vacate(f, why) {
    if (f.type === 'condo' && f.occupied && f.salePrice) {
      this.funds -= f.salePrice;
      this.finance.income.condo -= f.salePrice;
      this.msg((why === 'bulldozed' ? 'Apartment demolished' : 'Residents moved out') + ' on floor ' + floorLabel(f.L) + ': the $' + f.salePrice.toLocaleString() + ' sale is refunded.', 'refuse');
      f.salePrice = 0;
    } else if (why !== 'bulldozed') {
      this.msg(FAC[f.type].label + ' on floor ' + floorLabel(f.L) + (FAC[f.type].commercial ? ' has closed down.' : ': the tenants have moved out.'), 'refuse');
    }
    for (const p of this.residents(f)) P.removePerson(this, p);
    f.occupied = false; f.open = false; f.here = []; f.poor = 0;
  }

  // ------------------------------------------------------------ hotel
  roomAvailable(f) { return this.ready(f) && f.hstate === 'vacant' && !f.infested; }
  bookRoom(f, vip) {
    f.hstate = 'booked'; f.guests = []; f.stayStress = 0; f.vip = !!vip; f.dirtyArrival = false;
    const n = vip ? 1 : FAC[f.type].guests;
    for (let i = 0; i < n; i++) {
      const p = P.newPerson(this, vip ? 'vip' : 'guest', f.id, { transient: false, guest: true, look: this.rng.int(0, 3) });
      f.guests.push(p.id);
      this.arrival(this.t + this.rng.int(1, 60), { pid: p.id, kind: 'guest' });
    }
  }
  guestArrived(p, f, first) {
    if (first) {
      if (f.hstate === 'booked') f.hstate = 'occupied';
      if (this.tower.isNoisy(f) && FAC[f.type].sensitive) P.addStress(p, 40);
      if (this.dayTick < clockToTick(22, 0)) this.timer(p, addMinutes(this.t, 30), 'dinner');
      const base = nextAt(this.t + 1, 0);
      this.timer(p, base + this.rng.int(clockToTick(8, 0), clockToTick(10, 0)), 'checkout');
      if (p.kind === 'vip') this.msg('The VIP has checked in on floor ' + floorLabel(f.L) + '.', 'notice');
    }
  }
  checkout(p) {
    const f = this.tower.facs.get(p.home);
    if (!f) { P.removePerson(this, p); return; }
    f.stayStress += p.stress; f.stayCount = (f.stayCount || 0) + 1;
    const isVip = p.kind === 'vip';
    const vipStress = p.stress;
    f.guests = f.guests.filter(i => i !== p.id);
    if (p.state === 'in' && p.at === f.id) {
      p.transient = true;
      if (!P.travel(this, p, 'street', 'checkoutDone')) P.removePerson(this, p);
    } else P.removePerson(this, p);
    p.home = 0;
    if (!f.guests.length) this.finishStay(f);
    if (isVip) E.judgeVip(this, f, vipStress);
  }
  finishStay(f) {
    if (f.hstate !== 'occupied' && f.hstate !== 'booked') return;
    const d = FAC[f.type];
    const n = Math.max(1, f.stayCount || 1);
    const ev = 300 - f.stayStress / n - PRICE_EVAL_OFFSET[f.price] - (f.pen || 0);
    f.eval = Math.max(0, Math.min(300, ev)); f.evalTier = evalTier(f.eval);
    if (!f.burning) this.earn(f.type, d.prices[f.price]);
    f.hstate = 'dirty'; f.dirtyNights = 0; f.stayCount = 0; f.stayStress = 0; f.pen = 0; f.vip = false;
    f.here = [];
  }
  hotelRooms() { return [...this.facsOf('single'), ...this.facsOf('twin'), ...this.facsOf('suite')]; }
  keeperIdle(p) {
    if (!p.onShift || p.cleaning || p.state !== 'in') return;
    const T = this.tower;
    const here = T.facs.get(p.at);
    if (!here) return;
    let best = null, bd = Infinity;
    for (const r of this.hotelRooms()) {
      if (r.hstate !== 'dirty' || r.claim || r.infested) continue;
      const d = Math.abs(r.L - here.L) * 8 + Math.abs(r.x - here.x) / 4;
      if (d < bd) { bd = d; best = r; }
    }
    if (best) {
      best.claim = p.id;
      if (P.travel(this, p, best, 'clean')) return;
      best.claim = 0; best.noKeeper = true;
    }
    const home = T.facs.get(p.home);
    if (home && p.at !== home.id) { if (!P.travel(this, p, home, 'hk')) P.placeIn(this, p, home); }
  }
  startCleaning(p, f) {
    if (f.hstate !== 'dirty' || f.infested) { f.claim = 0; this.keeperIdle(p); return; }
    f.hstate = 'cleaning'; p.cleaning = f.id;
    this.timer(p, addMinutes(this.t, 60), 'cleaned');
  }
  roomCleaned(p) {
    const f = this.tower.facs.get(p.cleaning);
    p.cleaning = 0;
    if (f && f.hstate === 'cleaning') { f.hstate = 'vacant'; f.dirtyNights = 0; f.claim = 0; f.noKeeper = false; }
    if (p.onShift) this.keeperIdle(p);
    else { const h = this.tower.facs.get(p.home); if (h && !P.travel(this, p, h, 'hk')) P.placeIn(this, p, h); }
  }

  // ------------------------------------------------------------ commerce
  isOpenNow(f) {
    if (!this.ready(f) || !f.open || f.burning) return false;
    const d = FAC[f.type];
    if (!d.open) return true;
    const m = clockMinutes(this.dayTick);
    return m >= d.open[0] && m < d.open[1];
  }
  addCustomer(f, p) {
    f.today++; f.stressSum += p.stress;
  }
  closeCommercial(type) {
    for (const f of this.facsOf(type)) {
      if (!f.open || !this.ready(f)) continue;
      const d = FAC[f.type];
      if (d.perCustomer && !f.burnedToday) {
        this.earn(f.type, f.today * d.perCustomer);
        this.spend(d.dailyCost, 'other');
      }
      f.closedCount = f.today;
    }
  }
  audienceArrived(p, f) {
    f.today = (f.today || 0) + 1;
  }

  // ------------------------------------------------------------ parking
  parking() {
    const v = this.tower.version;
    if (this._park && this._park.ver === v && this.t - this._park.t < 26 && this.t >= this._park.t) return this._park;
    const ramps = this.facsOf('parkramp').filter(f => this.ready(f));
    let usable = 0;
    const rampOk = new Set();
    // the ramp column must run down continuously from B1
    const byL = new Map(ramps.map(r => [r.L, r]));
    let prev = byL.get(-1);
    for (let L = -1; prev; L--) {
      const r = byL.get(L);
      if (!r || (r.x !== prev.x)) break;
      rampOk.add(r.id); prev = r;
    }
    for (const r of ramps) if (!rampOk.has(r.id)) r.badRamp = true; else r.badRamp = false;
    const spaces = this.facsOf('parkspace');
    for (const s of spaces) s.linked = false;
    for (const r of ramps) {
      if (!rampOk.has(r.id)) continue;
      if (!this.router.find({ street: true }, P.accessPoint(r))) continue;
      // flood fill along touching spaces on the same floor
      let edgeL = r.x, edgeR = r.x + r.w;
      let grew = true;
      const row = spaces.filter(s => s.L === r.L).sort((a, b) => a.x - b.x);
      while (grew) {
        grew = false;
        for (const s of row) {
          if (s.linked) continue;
          if (s.x + s.w === edgeL || s.x === edgeR) { s.linked = true; grew = true; edgeL = Math.min(edgeL, s.x); edgeR = Math.max(edgeR, s.x + s.w); }
        }
      }
    }
    for (const s of spaces) if (s.linked) usable++;
    this._park = { ver: v, usable, t: this.t };
    return this._park;
  }
  rampColumnOk(x, L) {
    const ramps = this.facsOf('parkramp');
    if (!ramps.length) return L === -1;
    return ramps.some(r => r.x === x && Math.abs(r.L - L) === 1);
  }
  parkingInUse() {
    let n = 0;
    for (const f of this.facsOf('suite')) if (f.hstate === 'booked' || f.hstate === 'occupied') n++;
    return n;
  }

  // ------------------------------------------------------------ the tick
  step() {
    if (this.gameOver) return;
    this.t++;
    const t = this.t, dt = dayTick(t);
    if (this.__pr && this.__pr.length) { const l = this.__pr; this.__pr = []; for (const p of l) if (!p.dead) P.reroute(this, p); }
    if (dt === MIDNIGHT_TICK) this.midnight();
    // timers
    const tl = this.timers.get(t);
    if (tl) {
      this.timers.delete(t);
      for (const [pid, action] of tl) { const p = this.people.get(pid); if (p && !p.dead) P.onTimer(this, p, action); }
    }
    const al = this.arrivals.get(t);
    if (al) { this.arrivals.delete(t); for (const a of al) this.spawnArrival(a); }
    // daily clock points
    if (dt === T21) { this.closeCommercial('fastfood'); this.closeCommercial('shop'); }
    if (dt === T23) this.closeCommercial('restaurant');
    E.dailyClock(this, dt);
    if (t % 13 === 0) this.periodic13(dt);
    if (t % 26 === 0) this.periodic26(dt);
    P.updateMovers(this);
    for (const s of this.shafts()) s.tick(this);
    P.transitStress(this);
    E.tick(this, dt);
  }
  onBoard(p, car, s) { P.onBoard(this, p, car, s); }
  onAlight(p, L, s) { P.onAlight(this, p, L, s); }
  gaveUp(p) {
    const h = p.home && this.tower.facs.get(p.home);
    if (h) { h.pen = Math.min(120, (h.pen || 0) + 20); h.sSum = (h.sSum || 0) + 300; h.sN = (h.sN || 0) + 1; }
    if (p.goalFac) { const g = this.tower.facs.get(p.goalFac); if (g && g !== h && FAC[g.type].commercial) g.pen = Math.min(200, (g.pen || 0) + 10); }
    p.state = 'walk';
    P.bail(this, p);
  }

  spawnArrival(a) {
    if (a.kind === 'guest') {
      const p = this.people.get(a.pid);
      if (!p) return;
      const f = this.tower.facs.get(p.home);
      if (!f || !P.travel(this, p, f, 'checkin')) {
        if (f) { f.guests = f.guests.filter(i => i !== p.id); if (!f.guests.length && f.hstate === 'booked') f.hstate = 'vacant'; }
        P.removePerson(this, p);
      }
      return;
    }
    const f = this.tower.facs.get(a.fid);
    if (!f) return;
    const p = P.newPerson(this, a.kind || 'visitor', 0, { transient: true });
    p.after = a.after || 'street';
    const goal = a.goal || 'visit';
    const ok = a.from ? P.travel(this, p, f, goal, { fromFac: this.tower.facs.get(a.from) }) : P.travel(this, p, f, goal);
    if (!ok) P.removePerson(this, p);
  }

  periodic13(dt) {
    const wd = dayType(this.t) !== 2;
    const T = this.tower;
    // hotel bookings 17:00–22:00
    if (dt >= T17 && dt < T22) {
      const park = this.parking().usable - this.parkingInUse();
      let freePark = park;
      for (const f of this.hotelRooms()) {
        if (!this.roomAvailable(f) || !f.reach) continue;
        if (f.type === 'suite' && freePark <= 0) continue;
        if (this.flags.vipPending && f.type === 'suite' && this.star >= 3) {
          this.flags.vipPending = false;
          this.bookRoom(f, true); freePark--;
          this.emit('dialog', { kind: 'vip', text: 'A very important guest has booked the suite on floor ' + floorLabel(f.L) + ' for tonight. Their verdict on the room and the lifts could make the tower\'s reputation.' });
          this.emit('sound', { name: 'notice' });
          continue;
        }
        let pb = 0.05 * PRICE_MOVE_FACTOR[f.price] * (this.weather.rain ? 0.85 : 1);
        if (f.evalTier === 0) pb *= 0.25;
        if (this.rng.chance(pb)) { this.bookRoom(f, false); if (f.type === 'suite') freePark--; }
      }
    }
    // keepers looking for work
    if (dt >= clockToTick(10, 0) && dt < clockToTick(17, 0) && (this.t % 52 === 0)) {
      for (const p of this.people.values()) if (p.kind === 'keeper' && p.onShift && p.state === 'in' && !p.cleaning) this.keeperIdle(p);
    }
  }

  periodic26(dt) {
    const wd = dayType(this.t) !== 2;
    const T = this.tower;
    this.updateReach();
    const hour = clockMinutes(dt) / 60;
    for (const f of T.facs.values()) {
      if (!this.ready(f) || !f.reach) continue;
      const d = FAC[f.type];
      if (f.type === 'office' && !f.occupied && wd && hour >= 7 && hour < 17) {
        if (this.rng.chance(0.06 * PRICE_MOVE_FACTOR[f.price])) { this.occupy(f); this.msg('New office tenants have signed a lease on floor ' + floorLabel(f.L) + '.', null); }
      } else if (f.type === 'condo' && !f.occupied && hour >= 7 && hour < 21) {
        let pr = 0.05 * PRICE_MOVE_FACTOR[f.price];
        if (this.star >= 3) pr *= 0.5; // apartments matter less in a big tower
        if (this.rng.chance(pr)) { this.occupy(f); this.msg('An apartment on floor ' + floorLabel(f.L) + ' has sold for $' + f.salePrice.toLocaleString() + '.', null); }
      } else if (d.commercial && !f.open && hour >= 7 && hour < 20) {
        let pr = 0.08;
        if (f.type === 'shop') pr *= PRICE_MOVE_FACTOR[f.price];
        if (this.rng.chance(pr)) { f.open = true; f.occupied = true; f.occSince = this.t; f.poor = 0; f.pen = 0; f.variant = this.rng.int(0, 3); f.eval = 200; f.evalTier = 2; this.msg('A new ' + d.label.toLowerCase() + ' has opened on floor ' + floorLabel(f.L) + '.', null); }
      } else if ((f.type === 'housekeeping' || f.type === 'security') && !f.staffed) {
        f.staffed = true;
        for (let i = 0; i < 6; i++) { const p = P.newPerson(this, f.type === 'housekeeping' ? 'keeper' : 'guard', f.id); P.placeIn(this, p, f); }
        if (f.type === 'housekeeping') {
          const m = clockMinutes(dt);
          if (m >= 600 && m < 1020) for (const p of this.residents(f)) { p.onShift = true; this.timer(p, this.t + 2, 'shift'); this.timer(p, this.t - dt + clockToTick(17, 0), 'shiftEnd'); }
        }
      }
    }
    this.computePop();
    this.computeDemands();
    this.checkStars();
  }

  updateReach() {
    if (this.reachVer === this.tower.version) return;
    this.reachVer = this.tower.version;
    const reach = this.router.reachFromStreet('normal');
    const lost = [];
    for (const f of this.tower.facs.values()) {
      if (f.type === 'lobby' || f.type === 'ruin' || f.type === 'parkspace') { f.reach = true; continue; }
      if (f.type === 'parkramp' || f.type === 'housekeeping' || f.type === 'security' || f.type === 'recycling') { f.reach = true; continue; }
      const ap = P.accessPoint(f);
      const was = f.reach;
      f.reach = reach(ap.L, ap.x);
      if (was && !f.reach && (f.occupied || f.open || f.hstate === 'occupied')) lost.push(f);
    }
    if (lost.length) {
      const f = lost[0];
      this.msg('People in the lobby can no longer reach floor ' + floorLabel(f.L) + (lost.length > 1 ? ' (and ' + (lost.length - 1) + ' more places)' : '') + '.', 'refuse');
    }
  }

  computePop() {
    let perm = 0, hotel = 0, comm = 0, workers = 0;
    for (const f of this.tower.facs.values()) {
      const d = FAC[f.type];
      if (!d) continue;
      if ((f.type === 'office' || f.type === 'condo') && f.occupied) { perm += d.pop; if (f.type === 'office') workers += 6; }
      else if ((f.type === 'housekeeping' || f.type === 'security') && f.staffed) perm += 6;
      else if (d.hotel && (f.hstate === 'occupied' || f.hstate === 'booked')) hotel += d.pop;
      else if (d.commercial && f.open) comm += Math.max(f.today, f.yday);
      else if (f.type === 'cinema' || f.type === 'party') comm += Math.max(f.today || 0, f.yday || 0);
    }
    perm += comm;
    this.pop = { total: perm + hotel, perm, hotel, comm, workers };
  }
  starPop() { return this.star >= 3 ? this.pop.perm : this.pop.total; }

  // ------------------------------------------------------------ demands & stars
  computeDemands() {
    const D = [];
    const security = this.facsOf('security').length;
    if (this.star >= 2 && this.pop.total >= 600) D.push({ key: 'security', text: 'Tenants want at least two security posts.', met: security >= 2 });
    // medical
    if (this.pop.total >= 2000) {
      const clinics = this.facsOf('clinic').filter(f => this.ready(f));
      const need = Math.max(1, Math.ceil(this.pop.workers / 1500));
      let near = true;
      for (const o of this.facsOf('office')) if (o.occupied && !clinics.some(c => Math.abs(c.L - o.L) <= 10)) { near = false; break; }
      D.push({ key: 'medical', text: clinics.length < need ? 'Office workers are asking for a clinic (' + need + ' needed).' : 'Some offices are more than 10 floors from a clinic.', met: clinics.length >= need && near });
    }
    // recycling
    const have = this.recyclingServed();
    if (this.pop.total > 2000) {
      const need = Math.ceil((this.pop.total - 2000) / 1000);
      D.push({ key: 'recycling', text: 'The tower needs more recycling capacity (' + have + ' of ' + need + ' plants working).', met: have >= need });
    }
    // parking
    const usable = this.parking().usable;
    let pneed = 0;
    if (this.star >= 4) for (const f of this.tower.facs.values()) if ((f.type === 'office' || f.type === 'condo') && f.occupied) pneed++;
    pneed += this.parkingInUse();
    const suites = this.facsOf('suite').length;
    if (pneed > 0 || (suites > 0 && usable === 0)) D.push({ key: 'parking', text: suites && !usable ? 'Suite guests need a parking bay linked to a car ramp.' : 'Tenants need more parking (' + usable + ' of ' + pneed + ' bays).', met: usable >= Math.max(pneed, suites ? 1 : 0) });
    // access
    const noAccess = [...this.tower.facs.values()].filter(f => !f.reach && FAC[f.type] && !FAC[f.type].struct);
    if (noAccess.length) D.push({ key: 'access', text: 'Floor ' + floorLabel(noAccess[0].L) + ' cannot be reached from the lobby' + (noAccess.length > 1 ? ' (' + noAccess.length + ' places)' : '') + '.', met: false });
    if (this.flags.vipWaiting) D.push({ key: 'vip', text: 'A VIP is looking for a clean suite.', met: true });
    this.demands = D;
  }
  demandMet(key) { const d = this.demands.find(x => x.key === key); return !d || d.met; }
  recyclingServed() {
    const cs = this.facsOf('recycling').filter(f => this.ready(f));
    if (!cs.length) return 0;
    const T = this.tower;
    const served = (c) => {
      for (const s of this.shafts()) {
        if (s.kind !== 'service') continue;
        for (let L = c.L; L < c.L + c.h; L++) {
          if (!T.shaftServes(s, L)) continue;
          const sg = T.segAt(L, s.cx);
          if (sg >= 0 && sg === T.segAt(L, c.x + (c.w >> 1))) return true;
        }
      }
      return false;
    };
    // groups of touching plants
    const parent = cs.map((_, i) => i);
    const find = (i) => parent[i] === i ? i : (parent[i] = find(parent[i]));
    const touch = (a, b) => {
      const vx = a.x <= b.x + b.w && b.x <= a.x + a.w;
      const vy = a.L <= b.L + b.h && b.L <= a.L + a.h;
      return (vx && (a.L + a.h === b.L || b.L + b.h === a.L) && a.x < b.x + b.w && b.x < a.x + a.w) ||
        (vy && (a.x + a.w === b.x || b.x + b.w === a.x) && a.L < b.L + b.h && b.L < a.L + a.h);
    };
    for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) if (touch(cs[i], cs[j])) parent[find(i)] = find(j);
    const ok = new Set();
    cs.forEach((c, i) => { if (served(c)) ok.add(find(i)); });
    let n = 0;
    cs.forEach((c, i) => { c.serviced = ok.has(find(i)); if (c.serviced) n++; });
    return n;
  }
  starBlockers() {
    const s = this.star, pop = this.starPop();
    const out = [];
    if (s === 1) { if (pop < 300) out.push('population 300'); }
    else if (s === 2) { if (pop < 1000) out.push('population 1,000'); if (this.facsOf('security').length < 2) out.push('two security posts'); }
    else if (s === 3) {
      if (pop < 5000) out.push('5,000 permanent residents and workers');
      if (this.facsOf('suite').length < 2) out.push('at least two suites');
      if (!this.demandMet('recycling') || this.pop.total <= 2000) { if (!this.demandMet('recycling')) out.push('enough recycling'); }
      if (!this.demandMet('medical')) out.push('medical care');
      if (!this.flags.vipOk) out.push('a happy VIP');
    } else if (s === 4) {
      if (pop < 10000) out.push('10,000 permanent population');
      if (!this.facsOf('transit').length) out.push('a metro station');
      for (const d of this.demands) if (!d.met) { out.push('every demand met'); break; }
    } else if (s === 5) {
      if (pop < 15000) out.push('15,000 permanent population');
      if (!this.facsOf('landmark').length) out.push('a sky chapel on floor 100');
      if (!this.flags.wedding) out.push('a weekend wedding in the chapel');
    } else return [];
    return out;
  }
  checkStars() {
    if (this.star >= STAR_LANDMARK) return;
    if (this.starBlockers().length === 0) {
      this.star++;
      this.computeDemands();
      if (this.star === STAR_LANDMARK) {
        this.emit('dialog', { kind: 'final', text: 'The wedding bells have rung at the top of the tower. Skyrise names your building a Landmark Tower, the highest honour a skyline can give.' });
        this.emit('sound', { name: 'finalFanfare' });
      } else {
        this.emit('dialog', { kind: 'star', star: this.star, text: 'Your tower has earned its ' + ['', 'first', 'second', 'third', 'fourth', 'fifth'][this.star] + ' star!' });
        this.emit('sound', { name: 'fanfare' });
      }
      this.emit('star', { star: this.star });
    }
  }

  // ------------------------------------------------------------ midnight
  midnight() {
    const T = this.tower;
    const endedType = dayType(this.t - 1);
    // 1. evaluate the day that ended
    const dayStart = this.t - MIDNIGHT_TICK;
    const unmetPark = !this.demandMet('parking') && this.star >= 4;
    const unmetMed = !this.demandMet('medical');
    for (const f of [...T.facs.values()]) {
      const d = FAC[f.type];
      if (!d) continue;
      if ((f.type === 'office' || f.type === 'condo') && f.occupied) {
        if (f.type === 'office' && endedType === 2) continue;
        if (!f.sN) { f.pen = 0; continue; }
        const avg = f.sSum / f.sN;
        f.sSum = 0; f.sN = 0;
        let ev = 300 - avg - PRICE_EVAL_OFFSET[f.price] - (f.pen || 0);
        if (unmetPark) ev -= 30;
        if (unmetMed && f.type === 'office') ev -= 30;
        f.eval = Math.max(0, Math.min(300, ev)); f.evalTier = evalTier(f.eval);
        f.pen = 0;
        if (f.occSince <= dayStart && f.evalTier === 0) this.vacate(f, 'left');
      } else if (d.commercial && f.open) {
        const cap = d.cap;
        const avg = f.today ? f.stressSum / f.today : 0;
        let ev = 300 - avg - (f.pen || 0);
        if (f.type === 'shop') ev -= PRICE_EVAL_OFFSET[f.price];
        if (f.today < cap * 0.15) ev -= 140; else if (f.today < cap * 0.35) ev -= 50;
        f.eval = Math.max(0, Math.min(300, ev)); f.evalTier = evalTier(f.eval);
        f.pen = 0;
        if (f.occSince <= dayStart && f.evalTier === 0) this.vacate(f, 'left');
      }
      if (d.commercial || f.type === 'cinema' || f.type === 'party') { f.yday = f.today || 0; f.today = 0; f.stressSum = 0; }
      f.burnedToday = false;
    }
    // 2. hotel nights
    const rooms = this.hotelRooms();
    for (const r of rooms) if (r.hstate === 'dirty' && !r.infested) { r.dirtyNights++; if (r.dirtyNights >= 3) { r.infested = true; r.hstate = 'infested'; this.msg('Pests have moved into a neglected room on floor ' + floorLabel(r.L) + '. Only demolition will fix it.', 'refuse'); } }
    for (const r of rooms) if (r.infested) {
      for (const o of rooms) {
        if (o === r || o.L !== r.L || o.infested || o.hstate !== 'dirty') continue;
        if ((o.x + o.w === r.x || r.x + r.w === o.x) && this.rng.chance(0.3)) { o.infested = true; o.hstate = 'infested'; }
      }
    }
    // 3. quarter
    const nd = dateDay(this.t);
    if (nd % 3 === 0 && nd > 0) this.newQuarter();
    // 4. stress reset & plans
    const base = this.t + (DAY_TICKS - MIDNIGHT_TICK);
    const ntype = dayType(this.t);
    for (const p of this.people.values()) {
      if (p.transient || p.guest) continue;
      if (p.state === 'in' || p.state === 'off') p.stress = 0;
      P.planDay(this, p, base, ntype);
    }
    E.planDay(this, base, ntype);
    this.computePop(); this.computeDemands(); this.checkStars();
    this.emit('day', { day: nd });
  }
  newQuarter() {
    this.prevFinance = this.finance;
    this.resetFinance();
    for (const f of this.tower.facs.values()) {
      if (f.type === 'office' && f.occupied) this.earn('office', FAC.office.prices[f.price]);
      if (f.type === 'shop' && f.open) this.earn('shop', FAC.shop.prices[f.price]);
    }
    // maintenance
    const m = (cat, amt) => { if (amt) this.spend(amt, cat); };
    for (const s of this.shafts()) m(s.kind, MAINT[s.kind]);
    for (const o of this.tower.trans.values()) if (o.kind === 'escalator') m('escalator', MAINT.escalator);
    for (const f of this.tower.facs.values()) {
      if (f.type === 'lobby') m('lobby', MAINT.lobbyUnit * f.w);
      else if (MAINT[f.type]) m(f.type, MAINT[f.type]);
    }
    this.finance.startBalance = this.prevFinance ? this.funds : this.funds;
    if (this.funds < 0) {
      this.negQuarters++;
      if (this.negQuarters >= 4) { this.gameOver = true; this.emit('dialog', { kind: 'bankrupt', text: 'Funds have been negative for four quarters in a row. The bank has taken the keys. Load a save or start a new tower.' }); }
      else this.msg('Funds are negative. Construction is frozen until the balance recovers.', 'refuse');
    } else this.negQuarters = 0;
    this.emit('quarter', {});
  }

  // ------------------------------------------------------------ prices etc.
  setPrice(f, lvl) {
    if (!FAC[f.type].prices) return false;
    if (f.type === 'condo' && f.occupied) return false;
    f.price = Math.max(0, Math.min(3, lvl));
    return true;
  }
  rename(kind, id, name) {
    name = String(name || '').slice(0, LIMITS.nameLen).trim();
    const list = kind === 'person' ? this.named.people : this.named.facs;
    const obj = kind === 'person' ? this.people.get(id) : (this.tower.facs.get(id) || this.tower.trans.get(id));
    if (!obj) return { ok: false };
    if (name && !list.includes(id)) {
      if (list.length >= 20) return { ok: false, reason: 'Only 20 names can be kept on the list.' };
      list.push(id);
    }
    if (!name) { const i = list.indexOf(id); if (i >= 0) list.splice(i, 1); }
    obj.name = name;
    return { ok: true };
  }
  setFilm(f, idx) {
    const film = FILMS[idx];
    const cost = FILM_COST[film.kind];
    if (!this.canAfford(cost)) return { ok: false, reason: 'Not enough funds.' };
    this.spend(cost, 'other');
    f.film = idx; f.filmAge = 0;
    return { ok: true };
  }

  // ------------------------------------------------------------ what-if preview
  // A deep copy of the whole simulation that can be fast-forwarded without touching the real one.
  cloneForPreview() {
    const keep = this.listeners, cache = this.router.cache;
    this.listeners = []; this.router.cache = new Map(); // listeners and cached closures cannot be copied
    let c;
    try { c = structuredClone(this); } finally { this.listeners = keep; this.router.cache = cache; }
    Object.setPrototypeOf(c, Game.prototype);
    Object.setPrototypeOf(c.tower, Tower.prototype);
    Object.setPrototypeOf(c.router, Router.prototype);
    Object.setPrototypeOf(c.rng, Rng.prototype);
    for (const o of c.tower.trans.values()) if (o.cars) Object.setPrototypeOf(o, Shaft.prototype);
    c.listeners = [];
    c.preview = true;
    return c;
  }

  // ------------------------------------------------------------ save / load
  serialize() {
    const T = this.tower;
    const facs = [];
    for (const f of T.facs.values()) { const o = Object.assign({}, f); delete o.here; facs.push(o); }
    const trans = [];
    for (const o of T.trans.values()) trans.push(o.cars ? Object.assign({ shaft: true }, o.serialize()) : { id: o.id, kind: o.kind, x: o.x, L: o.L, w: o.w, name: o.name || '' });
    const slab = [];
    for (let i = 0; i < T.slab.length; i++) {
      // run-length encode
      const row = T.slab[i]; const runs = [];
      let x = 0; while (x < T.W) { if (row[x]) { const s = x; while (x < T.W && row[x]) x++; runs.push([s, x - s]); } else x++; }
      if (runs.length) slab.push([i + MIN_LEVEL, runs]);
    }
    const people = [];
    for (const p of this.people.values()) {
      if (p.transient) continue;
      people.push({ id: p.id, kind: p.kind, home: p.home, name: p.name, look: p.look, guest: p.guest, stress: Math.round(p.stress) });
    }
    return {
      v: 1, seed: this.seed, rng: this.rng.s, t: this.t, funds: this.funds, star: this.star, nextId: T.nextId, nextPid: this.nextPid,
      lobbyHeight: T.lobbyHeight, transitBottom: T.transitBottom, facs, trans, slab, people,
      named: this.named, flags: this.flags, finance: this.finance, prevFinance: this.prevFinance, negQuarters: this.negQuarters, weather: this.weather,
    };
  }
  static load(o) {
    const g = new Game(o.seed);
    const T = g.tower;
    g.rng.s = o.rng; g.t = o.t; g.funds = o.funds; g.star = o.star; g.nextPid = o.nextPid;
    T.lobbyHeight = o.lobbyHeight; T.transitBottom = o.transitBottom;
    for (const [L, runs] of o.slab) for (const [s, n] of runs) for (let x = s; x < s + n; x++) T.slab[L - MIN_LEVEL][x] = 1;
    for (const f of o.facs) {
      f.here = [];
      T.facs.set(f.id, f);
      for (let l = f.L; l < f.L + f.h; l++) for (let i = f.x; i < f.x + f.w; i++) T.occ[l - MIN_LEVEL][i] = f.id;
      f.claim = 0;
      if (f.hotel || FAC[f.type] && FAC[f.type].hotel) f.guests = [];
    }
    for (const t of o.trans) {
      let obj;
      if (t.shaft) obj = Shaft.from(t); else obj = { id: t.id, kind: t.kind, x: t.x, L: t.L, w: t.w, name: t.name };
      T.trans.set(obj.id, obj); T.stampTransport(obj, true);
    }
    T.nextId = o.nextId;
    T.bump();
    Object.assign(g.named, o.named || {});
    Object.assign(g.flags, o.flags || {});
    if (o.finance) g.finance = o.finance;
    g.prevFinance = o.prevFinance || null;
    g.negQuarters = o.negQuarters || 0;
    if (o.weather) g.weather = o.weather;
    // people: put everyone where they would be now, then plan the rest of today
    const dt = dayTick(g.t), wd = dayType(g.t) !== 2;
    const rooms = new Map();
    for (const q of o.people) {
      const f = T.facs.get(q.home);
      if (!f) continue;
      const p = P.newPerson(g, q.kind, q.home, { name: q.name || '', look: q.look, guest: q.guest });
      p.id = q.id; g.people.delete(g.nextPid - 1); g.people.set(p.id, p);
      p.stress = q.stress || 0;
      if (q.guest) {
        if (f.hstate !== 'occupied' && f.hstate !== 'booked') { g.people.delete(p.id); continue; }
        f.hstate = 'occupied'; f.guests.push(p.id); P.placeIn(g, p, f);
        g.timer(p, nextAt(g.t + 1, 0) + g.rng.int(clockToTick(8, 0), clockToTick(10, 0)), 'checkout');
        continue;
      }
      const atWork = (p.kind === 'worker' || p.kind === 'sales') ? (wd && dt > 80 && dt < 1600 && dt < MIDNIGHT_TICK) : (p.kind === 'keeper' || p.kind === 'guard' || dt >= 1700 || dt < 40 || !wd);
      if (atWork) P.placeIn(g, p, f); else p.state = 'off';
      if (dt < MIDNIGHT_TICK) {
        const base = g.t - dt;
        const before = g.timers.size;
        P.planDay(g, p, base, dayType(g.t));
      }
    }
    g.nextPid = Math.max(g.nextPid, o.nextPid);
    // drop timers that lie in the past (planDay may have scheduled earlier times as "now+1")
    for (const [at, list] of g.timers) if (at <= g.t + 1) {
      g.timers.set(at, list.filter(([pid, a]) => a === 'gohome' || a === 'return' || a === 'shiftEnd'));
    }
    for (const f of T.facs.values()) if (FAC[f.type] && FAC[f.type].hotel && (f.hstate === 'occupied' || f.hstate === 'booked') && !f.guests.length) f.hstate = 'dirty';
    E.planDay(g, g.t - dt + (dt >= MIDNIGHT_TICK ? DAY_TICKS : 0), dayType(g.t), true);
    g.computePop(); g.computeDemands();
    return g;
  }
}
