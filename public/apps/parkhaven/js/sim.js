// Parkhaven - the simulation core: calendar, economy, weather, park rating, guest generation,
// research, marketing, objectives, notices and save/load. Renderer-independent; runs in node.
import { Rng } from './rng.js';
import { World, DX, DY } from './world.js';
import {
  MONTH_NAMES, MONTH_DAYS, WEATHER, CLIMATE, FIN, FIN_TODAY, STALLS, FLAT_RIDES, TRACK_RIDES, STAFF,
  RESEARCH_FUNDING, RESEARCH_LIST, START_AVAILABLE, CAMPAIGNS, ITEMS,
} from './data.js';
import { parkRating, guestCap, spawnProbability, weeklyInterest } from './ratings.js';
import { generateWorld, SCENARIOS } from './scenario.js';
import * as Guests from './guests.js';
import * as Rides from './rides.js';
import * as Staff from './staff.js';

export const SAVE_VERSION = 3;

export class Game {
  constructor() {
    this.events = [];
    this.fields = new Map();
    this.fieldsVersion = -1;
    this.connDirty = true;
    this.accessMap = new Map();
    this.rideById = new Map();
    this.tileCount = null;
  }

  // ------------------------------------------------------------------ setup
  static create(scenarioId) {
    const sc = SCENARIOS.find((s) => s.id === scenarioId) || SCENARIOS[0];
    const g = new Game();
    g.scenarioId = sc.id;
    g.sc = sc;
    g.w = generateWorld(sc);
    g.rng = new Rng(sc.seed * 7919 + 13);
    g.tick = 0; g.mp = 0; g.month = 0; g.year = 1; g.dayIdx = 0;
    g.cash = sc.cash; g.loan = sc.loan; g.maxLoan = sc.maxLoan; g.rate = sc.interest;
    g.pricing = sc.pricing; g.entryFee = sc.pricing === 'gate' ? (sc.entryFee ?? 1000) : 0;
    g.parkOpen = false;
    g.parkName = sc.name;
    g.rating = 0; g.hist = { rating: [], guests: [], cash: [], profit: [], value: [] };
    g.fin = [new Array(14).fill(0)]; g.finLife = new Array(14).fill(0);
    g.todayIn = 0; g.todayOut = 0; g.weekProfitEst = 0; g.lastDayIn = 0; g.lastDayOut = 0;
    g.rides = []; g.nextRideId = 1;
    g.guests = []; g.nextGuestId = 1;
    g.staff = []; g.nextStaffId = 1;
    g.litter = [];
    g.notices = []; g.noticeSeq = 0;
    g.casualty = 0;
    g.parkValue = 0; g.companyValue = 0; g.rideVFM = 0; g.cap = 0; g.spawnP = 50;
    g.totalAdmissions = 0;
    g.weather = { cur: { type: 1, temp: CLIMATE[0].base + WEATHER[1].delta, gloom: 0, effect: 0, level: 0 }, next: null, hold: 0 };
    g.pickWeather();
    g.research = { funding: 2, prio: { gentle: true, coaster: true, thrill: true, water: true, shops: true }, stage: 0, progress: 0, current: null, done: [] };
    g.available = new Set(START_AVAILABLE);
    if (sc.allResearched) { for (const r of RESEARCH_LIST) g.available.add(r.id); g.research.funding = 0; }
    g.campaigns = [];
    g.obj = { status: 'running', monthsMet: 0, lowWeeks: 0 };
    g.negCashWeeks = 0;
    g.warnAt = {};
    g.litterN = new Uint8Array(g.w.N * g.w.N);
    g.vomitN = new Uint8Array(g.w.N * g.w.N);
    g.recalcEveryThing();
    g.notify(`Welcome to ${sc.name}! Build paths and rides, then open the park from the Park window.`, null);
    return g;
  }

  recalcEveryThing() {
    this.connDirty = true;
    this.refreshConnectivity();
    for (const r of this.rides) Rides.refreshRatings(this, r);
    this.recalcPark();
  }

  // ------------------------------------------------------------------ calendar
  get daysInMonth() { return MONTH_DAYS[this.month]; }
  get day() { return Math.floor((this.mp * this.daysInMonth) / 65536) + 1; }
  dateString() { return `${this.day} ${MONTH_NAMES[this.month]}, Year ${this.year}`; }
  get absMonth() { return (this.year - 1) * 8 + this.month; }

  // ------------------------------------------------------------------ money
  spend(cat, amount) {
    if (!amount) return;
    this.cash -= amount;
    this.fin[0][cat] -= amount;
    if (FIN_TODAY[cat]) this.todayOut += amount;
  }
  earn(cat, amount) {
    if (!amount) return;
    this.cash += amount;
    this.fin[0][cat] += amount;
    if (FIN_TODAY[cat]) this.todayIn += amount;
  }
  canAfford(amount) { return this.cash >= amount; }
  borrow(delta) {
    if (delta > 0) {
      const amt = Math.min(delta, this.maxLoan - this.loan);
      if (amt <= 0) return false;
      this.loan += amt; this.cash += amt; return true;
    }
    const amt = Math.min(-delta, this.loan, Math.max(0, this.cash));
    if (amt <= 0) return false;
    this.loan -= amt; this.cash -= amt; return true;
  }

  // ------------------------------------------------------------------ notices / events
  notify(text, subject, kind = 'info') {
    const n = { id: ++this.noticeSeq, text, subject, kind, date: this.dateString ? this.dateString() : '', tick: this.tick };
    this.notices.unshift(n);
    if (this.notices.length > 80) this.notices.length = 80;
    this.emit({ type: 'notice', notice: n });
  }
  emit(e) {
    this.events.push(e);
    if (this.events.length > 400) this.events.splice(0, this.events.length - 400);
  }

  // ------------------------------------------------------------------ lookups
  ride(id) {
    if (id == null) return null;
    return this.rideById.get(id) || this.rides.find((r) => r.id === id) || null;
  }
  guestCount() { return this.guestsInPark; }

  /** Recompute queue chains, access tiles and the access map after path/ride edits. */
  refreshConnectivity() {
    if (!this.connDirty) return;
    this.connDirty = false;
    this.rideById.clear();
    for (const r of this.rides) this.rideById.set(r.id, r);
    this.accessMap.clear();
    for (const r of this.rides) Rides.computeAccess(this, r);
    for (const r of this.rides) {
      for (const t of r.access || []) {
        let a = this.accessMap.get(t);
        if (!a) { a = []; this.accessMap.set(t, a); }
        a.push(r.id);
      }
    }
    this.fields.clear();
  }
  markConnDirty() { this.connDirty = true; this.w.version++; }

  /** Path distance field (BFS over footpaths) from a set of seed tiles. Cached. */
  field(key, seedsFn, outside = false) {
    if (this.fieldsVersion !== this.w.pathVersion) { this.fields.clear(); this.fieldsVersion = this.w.pathVersion; }
    let f = this.fields.get(key);
    if (f) return f;
    const w = this.w, N = w.N;
    f = new Int16Array(N * N).fill(-1);
    const q = new Int32Array(N * N);
    let qh = 0, qt = 0;
    for (const i of seedsFn()) { if (f[i] < 0 && w.ptype[i] === 1) { f[i] = 0; q[qt++] = i; } }
    while (qh < qt) {
      const i = q[qh++];
      const a = w.adj[i];
      if (!a) continue;
      const x = i % N, y = (i / N) | 0;
      for (let d = 0; d < 4; d++) {
        if (!(a & (1 << d))) continue;
        const j = (y + DY[d]) * N + x + DX[d];
        if (f[j] >= 0) continue;
        if (!outside && w.poutside[j]) continue;
        f[j] = f[i] + 1;
        q[qt++] = j;
      }
    }
    this.fields.set(key, f);
    return f;
  }
  gateIndex() { return this.w.idx(this.w.gate.x, this.w.gate.y); }
  exitField() { return this.field('exit', () => [this.w.idx(this.w.spawn.x, this.w.spawn.y)], true); }
  gateField() { return this.field('gate', () => [this.gateIndex()], true); }
  rideField(r) { return this.field('r' + r.id, () => r.access || []); }
  rideExitField(r) { return this.field('x' + r.id, () => (r.exitAccess != null ? [r.exitAccess] : [])); }

  // ------------------------------------------------------------------ main tick
  step() {
    this.refreshConnectivity();
    this.tick++;
    const prevMp = this.mp;
    this.mp = (this.mp + 4) & 0xffff;
    const monthEnd = this.mp < prevMp;
    if (monthEnd) {
      this.month++;
      if (this.month >= 8) { this.month = 0; this.year++; }
    }
    const dayNow = Math.floor((this.mp * this.daysInMonth) / 65536);
    const newDay = monthEnd || dayNow !== this.dayIdx;
    this.dayIdx = dayNow;

    this.weatherStep();
    if (this.parkOpen) this.spawnStep();

    // occupancy grid for crowding, rebuilt every 32 ticks
    if ((this.tick & 31) === 0 || !this.tileCount) {
      const N = this.w.N;
      if (!this.tileCount) this.tileCount = new Uint16Array(N * N);
      this.tileCount.fill(0);
      for (const g of this.guests) if (g.state === 'walking') this.tileCount[g.ty * N + g.tx]++;
    }

    for (let i = 0; i < this.guests.length; i++) Guests.guestTick(this, this.guests[i]);
    if (this.guestsRemoved) {
      this.guests = this.guests.filter((g) => !g.gone);
      this.guestsRemoved = false;
    }
    for (const s of this.staff) Staff.staffTick(this, s);
    for (const r of this.rides) Rides.rideTick(this, r);

    if ((this.tick & 255) === 0) Rides.reliabilityStep(this);
    if ((this.tick & 31) === 0) this.researchStep();
    if ((this.tick & 511) === 0) this.recalcPark();
    if ((this.tick & 2047) === 0) Rides.inspectionStep(this);
    if ((this.tick & 8191) === 0) Rides.downtimeStep(this);
    if ((this.tick & 1023) === 0) Rides.backgroundRatings(this);

    if (newDay) this.onDay();
    if ((this.mp & 0x3fff) === 0) this.onWeek();
    if ((this.mp & 0x7fff) === 0) this.onFortnight();
    if (monthEnd) this.onMonth();
  }

  // ------------------------------------------------------------------ periodic
  recalcPark() {
    let inPark = 0, happy = 0, lost = 0, walking = 0;
    for (const g of this.guests) {
      if (g.inPark) {
        inPark++;
        if (g.happy > 128) happy++;
        if (g.leaving && g.lostCount > 0 && g.lostCount < 90) lost++;
      } else if (g.state === 'arriving') walking++;
    }
    this.guestsInPark = inPark;
    this.guestsArriving = walking;
    const rideInfo = [];
    let vfm = 0, rideParkValue = 0;
    for (const r of this.rides) {
      if (r.kind === 'stall') continue;
      rideInfo.push({ downtime: r.downtime || 0, rated: !!r.ratings, E: r.ratings ? r.ratings[0] : 0, I: r.ratings ? r.ratings[1] : 0 });
      Rides.updateValue(this, r);
      if (r.status === 'open' && !r.broken && r.value) {
        vfm += 2 * Math.max(0, r.value - (this.pricing === 'gate' ? 0 : r.price));
      }
      if (r.value) {
        const cust = (r.custBuckets || []).reduce((a, b) => a + b, 0);
        rideParkValue += r.value * 10 * (cust + 4 * Rides.typeBonus(r));
      }
    }
    let oldLitter = 0;
    for (const l of this.litter) if (this.tick - l.born >= 7680) oldLitter++;
    this.rating = parkRating({ guests: inPark, happy, lost, rides: rideInfo, oldLitter, casualty: this.casualty });
    this.rideVFM = vfm;
    this.parkValue = Math.round(rideParkValue + 700 * inPark);
    this.companyValue = this.parkValue - this.loan + this.cash;
    const capRides = this.rides.map((r) => ({ typeBonus: Rides.typeBonus(r), open: r.status === 'open', broken: !!r.broken }));
    this.cap = guestCap(capRides);
    this.spawnP = spawnProbability({ rating: this.rating, guests: inPark, walking, cap: this.cap, entranceFee: this.pricing === 'ride' ? 0 : this.entryFee, rideValueForMoney: vfm });
  }

  onDay() {
    this.lastDayIn = this.todayIn; this.lastDayOut = this.todayOut;
    let wages = 0;
    for (const s of this.staff) wages += STAFF[s.type].wage;
    let upkeep = 0;
    for (const r of this.rides) if (r.status !== 'closed') upkeep += r.upkeep || 0;
    this.weekProfitEst = Math.round(7 * (this.todayIn - this.todayOut)
      + (-wages - RESEARCH_FUNDING[this.research.funding].monthly - this.loan / 600 - 2 * upkeep) / 4);
    this.todayIn = 0; this.todayOut = 0;
    this.casualty = Math.max(0, this.casualty - 7);
    for (const r of this.rides) Rides.dailyRide(this, r);
    this.checkObjective(true);
  }

  onWeek() {
    let wages = 0;
    for (const s of this.staff) wages += STAFF[s.type].wage;
    this.spend(FIN.WAGES, Math.round(wages / 4));
    this.spend(FIN.RESEARCH, Math.round(RESEARCH_FUNDING[this.research.funding].monthly / 4));
    this.spend(FIN.INTEREST, weeklyInterest(this.loan, this.rate));
    // campaigns
    for (const c of this.campaigns) {
      if (c.fresh) { c.fresh = false; continue; }
      c.weeks--;
    }
    const ended = this.campaigns.filter((c) => c.weeks <= 0);
    for (const c of ended) {
      const def = CAMPAIGNS.find((d) => d.key === c.key);
      this.notify(`Your "${def.name}" campaign has finished.`, null);
    }
    this.campaigns = this.campaigns.filter((c) => c.weeks > 0);
    Guests.weeklyWarnings(this);
    // cash warning
    if (this.cash < 0) { this.negCashWeeks++; if (this.negCashWeeks === 4) this.notify('The park has been in the red for a month. Take out a loan or cut costs.', null, 'warn'); }
    else this.negCashWeeks = 0;
    // low-rating failure window (after the first month)
    if (this.absMonth >= 1 && this.obj.status === 'running' && this.sc.objective.type !== 'none') {
      if (this.rating < 200) {
        this.obj.lowWeeks++;
        if (this.obj.lowWeeks >= 4) this.failObjective('The park rating stayed below 200 for four weeks, and the council has closed the park.');
        else this.notify(`Park rating is dangerously low (${this.rating}). Improve it within ${4 - this.obj.lowWeeks + 1} week(s) or the park will be closed.`, null, 'warn');
      } else this.obj.lowWeeks = 0;
    }
    // history
    const H = this.hist;
    H.rating.push(this.rating); H.guests.push(this.guestsInPark); H.cash.push(this.cash);
    H.profit.push(this.weekProfitEst); H.value.push(this.parkValue);
    for (const k in H) if (H[k].length > 64) H[k].shift();
    this.emit({ type: 'week' });
  }

  onFortnight() {
    for (const r of this.rides) {
      if (r.status === 'closed') continue;
      this.spend(FIN.RIDE_RUN, r.upkeep || 0);
    }
  }

  onMonth() {
    // shift finance table
    this.fin.unshift(new Array(14).fill(0));
    if (this.fin.length > 16) {
      const old = this.fin.pop();
      for (let i = 0; i < 14; i++) this.finLife[i] += old[i];
    }
    if (this.pricing !== 'ride' && this.entryFee > 1.5 * this.rideVFM && this.entryFee > 0) {
      this.notify('Guests think the admission price is too high for what the park offers.', null, 'warn');
    }
    this.checkObjective(false);
    this.emit({ type: 'month' });
  }

  // ------------------------------------------------------------------ objectives
  objectiveText() {
    const o = this.sc.objective;
    if (o.type === 'attendance') return `Have at least ${o.guests} guests in the park with a park rating of ${o.rating} or more by the end of Year ${o.year}.`;
    if (o.type === 'value') return `Reach a park value of at least ${(o.value / 100).toLocaleString()} cr by the end of Year ${o.year}.`;
    if (o.type === 'takings') return `Earn at least ${(o.amount / 100).toLocaleString()} cr from ride tickets in a single month${o.months > 1 ? ` for ${o.months} months running` : ''}, before the end of Year ${o.year}.`;
    return 'No objective: build freely.';
  }
  objectiveProgress() {
    const o = this.sc.objective;
    if (o.type === 'attendance') return `${this.guestsInPark} / ${o.guests} guests, rating ${this.rating} / ${o.rating}`;
    if (o.type === 'value') return `Park value ${(this.parkValue / 100).toFixed(0)} / ${(o.value / 100).toFixed(0)} cr`;
    if (o.type === 'takings') return `Ride tickets this month ${(this.fin[0][FIN.RIDE_TICKETS] / 100).toFixed(0)} / ${(o.amount / 100).toFixed(0)} cr (months met ${this.obj.monthsMet}/${o.months})`;
    return '';
  }
  checkObjective(daily) {
    if (this.obj.status !== 'running') return;
    const o = this.sc.objective;
    if (o.type === 'none') return;
    const deadlinePassed = this.year > o.year; // first tick of year o.year+1
    if (o.type === 'attendance') {
      if (this.guestsInPark >= o.guests && this.rating >= o.rating) return this.winObjective();
      if (!daily && deadlinePassed) return this.failObjective('The deadline passed without enough guests.');
    } else if (o.type === 'value') {
      if (this.parkValue >= o.value) return this.winObjective();
      if (!daily && deadlinePassed) return this.failObjective('The deadline passed before the park was valuable enough.');
    } else if (o.type === 'takings') {
      if (!daily) {
        const last = this.fin[1] ? this.fin[1][FIN.RIDE_TICKETS] : 0;
        if (last >= o.amount) { this.obj.monthsMet++; if (this.obj.monthsMet >= o.months) return this.winObjective(); }
        else this.obj.monthsMet = 0;
        if (deadlinePassed) return this.failObjective('The deadline passed before ride takings were high enough.');
      }
    }
  }
  winObjective() {
    this.obj.status = 'won';
    this.notify(`Objective achieved! Company value: ${(this.companyValue / 100).toLocaleString()} cr. You can keep playing.`, null, 'good');
    this.emit({ type: 'won' });
  }
  failObjective(why) {
    this.obj.status = 'lost';
    this.notify(`Scenario failed: ${why}`, null, 'bad');
    this.emit({ type: 'lost', why });
  }

  // ------------------------------------------------------------------ weather (spec 2.3)
  pickWeather() {
    const cl = CLIMATE[this.month];
    const tot = cl.w.reduce((a, b) => a + b, 0);
    let r = this.rng.rand(tot), t = 0;
    while (r >= cl.w[t]) { r -= cl.w[t]; t++; }
    const W = WEATHER[t];
    this.weather.next = { type: t, temp: cl.base + W.delta, gloom: W.gloom, effect: W.effect, level: W.level };
    this.weather.hold = 1920;
  }
  weatherStep() {
    const W = this.weather;
    if (W.cur.effect === 2 && this.rng.rand(65536) < 436) this.emit({ type: 'thunder' });
    if (W.hold > 0) { W.hold--; return; }
    if ((this.tick & 127) !== 0) return;
    const c = W.cur, n = W.next;
    const toward = (a, b) => a + Math.sign(b - a);
    if (c.temp !== n.temp) c.temp = toward(c.temp, n.temp);
    else if (c.gloom !== n.gloom) c.gloom = toward(c.gloom, n.gloom);
    else {
      c.effect = n.effect;
      if (c.level !== n.level) c.level = toward(c.level, n.level);
      else { c.type = n.type; this.pickWeather(); }
    }
  }
  get raining() { return this.weather.cur.level > 0; }
  get temp() { return this.weather.cur.temp; }

  // ------------------------------------------------------------------ guest generation (spec 5)
  spawnStep() {
    if (this.rng.rand(65536) < this.spawnP) Guests.spawnGuest(this, null);
    for (const c of this.campaigns) {
      const def = CAMPAIGNS.find((d) => d.key === c.key);
      let pc = def.pc;
      if (c.key === 'freeEntry' && this.entryFee < 400) pc >>= 3;
      if (c.key === 'halfEntry' && this.entryFee < 600) pc >>= 3;
      if (c.key === 'freeRide') { const r = this.ride(c.subject); if (!r || r.price < 30) pc >>= 3; }
      if (this.rng.rand(65536) < pc) Guests.spawnGuest(this, c);
    }
  }

  // ------------------------------------------------------------------ marketing
  startCampaign(key, weeks, subject) {
    const def = CAMPAIGNS.find((d) => d.key === key);
    if (!def) return 'Unknown campaign';
    weeks = Math.max(2, Math.min(12, weeks | 0));
    if (def.needs === 'gate' && this.pricing === 'ride') return 'Admission vouchers need a pay-at-the-gate park.';
    if (key === 'freeRide' && this.pricing === 'gate') return 'Ride vouchers need a pay-per-ride park.';
    if (def.subject === 'ride') {
      const r = this.ride(subject);
      if (!r || r.kind === 'stall' || r.status !== 'open') return 'Choose an open ride for this campaign.';
    }
    const cost = def.weekly * weeks;
    if (this.cash < cost) return 'Not enough cash for this campaign.';
    this.spend(FIN.MARKETING, cost);
    this.campaigns = this.campaigns.filter((c) => c.key !== key);
    this.campaigns.push({ key, weeks, subject: subject ?? null, fresh: true });
    return null;
  }

  // ------------------------------------------------------------------ research (spec 11)
  researchStep() {
    const R = this.research;
    const rate = RESEARCH_FUNDING[R.funding].rate;
    if (!rate) return;
    const remaining = RESEARCH_LIST.filter((it) => !this.available.has(it.id));
    if (!remaining.length) { R.funding = 0; R.current = null; return; }
    R.progress += rate;
    if (R.progress < 65536) return;
    R.progress -= 65536;
    R.stage++;
    if (R.stage === 1) {
      const pick = remaining.find((it) => R.prio[it.cat]) || remaining[0];
      R.current = pick.id;
    } else if (R.stage >= 3) {
      const it = RESEARCH_LIST.find((x) => x.id === R.current) || remaining[0];
      this.available.add(it.id);
      R.done.push(it.id);
      R.stage = 0; R.current = null;
      this.notify(`Research complete: ${it.name} is now available to build.`, null, 'good');
      if (!RESEARCH_LIST.some((x) => !this.available.has(x.id))) { R.funding = 0; this.notify('Every research project is finished.', null); }
    }
  }
  researchEta() {
    const R = this.research;
    const rate = RESEARCH_FUNDING[R.funding].rate;
    if (!rate) return null;
    const left = (3 - R.stage) * 65536 - R.progress;
    return Math.ceil((left / rate) * 32);
  }

  // ------------------------------------------------------------------ save / load
  save() {
    return {
      v: SAVE_VERSION, scenarioId: this.scenarioId, parkName: this.parkName, world: this.w.save(), rng: this.rng.save(),
      tick: this.tick, mp: this.mp, month: this.month, year: this.year, dayIdx: this.dayIdx,
      cash: this.cash, loan: this.loan, maxLoan: this.maxLoan, rate: this.rate, pricing: this.pricing,
      entryFee: this.entryFee, parkOpen: this.parkOpen, rating: this.rating, hist: this.hist,
      fin: this.fin, finLife: this.finLife, todayIn: this.todayIn, todayOut: this.todayOut, weekProfitEst: this.weekProfitEst,
      rides: this.rides.map((r) => Rides.saveRide(r)), nextRideId: this.nextRideId,
      guests: this.guests, nextGuestId: this.nextGuestId, staff: this.staff, nextStaffId: this.nextStaffId,
      litter: this.litter, notices: this.notices.slice(0, 30), noticeSeq: this.noticeSeq, casualty: this.casualty,
      weather: this.weather, research: this.research, available: [...this.available], campaigns: this.campaigns,
      obj: this.obj, negCashWeeks: this.negCashWeeks, warnAt: this.warnAt, totalAdmissions: this.totalAdmissions,
      derived: { spawnP: this.spawnP, cap: this.cap, rideVFM: this.rideVFM, parkValue: this.parkValue, companyValue: this.companyValue, guestsInPark: this.guestsInPark, guestsArriving: this.guestsArriving, rating: this.rating },
      tileCount: this.tileCount ? Array.from(this.tileCount) : null,
    };
  }
  static load(o) {
    if (!o || o.v !== SAVE_VERSION) throw new Error('Incompatible save');
    const g = new Game();
    const sc = SCENARIOS.find((s) => s.id === o.scenarioId) || SCENARIOS[0];
    g.sc = sc; g.scenarioId = sc.id;
    g.w = World.load(o.world);
    g.rng = new Rng(1); g.rng.load(o.rng);
    for (const k of ['parkName', 'tick', 'mp', 'month', 'year', 'dayIdx', 'cash', 'loan', 'maxLoan', 'rate', 'pricing', 'entryFee', 'parkOpen',
      'rating', 'hist', 'fin', 'finLife', 'todayIn', 'todayOut', 'weekProfitEst', 'nextRideId', 'guests', 'nextGuestId', 'staff',
      'nextStaffId', 'litter', 'notices', 'noticeSeq', 'casualty', 'weather', 'research', 'campaigns', 'obj', 'negCashWeeks', 'warnAt', 'totalAdmissions']) g[k] = o[k];
    g.available = new Set(o.available);
    g.rides = o.rides.map((r) => Rides.loadRide(g, r));
    g.litterN = new Uint8Array(g.w.N * g.w.N);
    g.vomitN = new Uint8Array(g.w.N * g.w.N);
    for (const l of g.litter) { const i = g.w.idx(Math.floor(l.x), Math.floor(l.y)); if (l.t >= 4) g.vomitN[i]++; else g.litterN[i]++; }
    g.lastDayIn = 0; g.lastDayOut = 0;
    g.recalcEveryThing();
    // values that are only refreshed every 512 ticks are restored exactly, so a loaded game
    // carries on deterministically from the same state
    if (o.derived) Object.assign(g, o.derived);
    // a tracked ride saved mid-test simply runs its test again
    for (const r of g.rides) if (r.kind === 'track' && r.status !== 'closed' && !r.tested && r.circuit) Rides.startTest(g, r);
    if (o.tileCount) g.tileCount = Uint16Array.from(o.tileCount);
    g.benchUse = new Map();
    for (const q of g.guests) if (q.state === 'sitting' && q.benchTile != null) g.benchUse.set(q.benchTile, (g.benchUse.get(q.benchTile) || 0) + 1);
    return g;
  }
}

export { SCENARIOS };
