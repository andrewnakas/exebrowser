// Skyrise — lift shafts, cars and the dispatcher (spec 5.4–5.8).
import { TRANSPORT } from './data.js';
import { periodOf, dayTick, dayType } from './clock.js';

const DOOR_TICKS = 2;
const MIN_DWELL = 3;
const EPS = 1e-4;

export function newCar(home, pos) {
  return { pos: pos ?? home, prev: pos ?? home, v: 0, dir: 0, state: 'idle', timer: 0, pax: [], home, dwell: 0, exprun: false, moved: false };
}

export class Shaft {
  constructor(id, kind, x, bottom, top) {
    const def = TRANSPORT[kind];
    this.id = id; this.kind = kind; this.x = x; this.w = def.w;
    this.bottom = bottom; this.top = top;
    this.off = new Set();
    this.cars = [newCar(bottom)];
    this.queues = new Map();
    this.responseDistance = 4;
    this.delay = 0; // departure delay, ticks
    this.modes = [Array(6).fill('local'), Array(6).fill('local')];
    this.hidden = false;
    this.name = '';
    this.active = false;
  }
  get def() { return TRANSPORT[this.kind]; }
  get cap() { return this.def.cap; }
  get cx() { return this.x + (this.w >> 1); }
  qkey(L, d) { return L * 2 + (d > 0 ? 1 : 0); }
  queue(L, d, create) {
    const k = this.qkey(L, d);
    let q = this.queues.get(k);
    if (!q && create) { q = { L, d, people: [], assigned: -1, since: 0 }; this.queues.set(k, q); }
    return q;
  }
  qlen(L, d) { const q = this.queue(L, d); return q ? q.people.length : 0; }
  totalWaiting() { let n = 0; for (const q of this.queues.values()) n += q.people.length; return n; }

  modeNow(a) {
    const we = dayType(a) === 2 ? 1 : 0;
    return this.modes[we][periodOf(dayTick(a))];
  }
  servedLevels(tower) {
    const r = [];
    for (let L = this.bottom; L <= this.top; L++) if (tower.shaftServes(this, L)) r.push(L);
    return r;
  }

  // person p arrives at floor L wanting direction d
  call(p, L, d, now) {
    const q = this.queue(L, d, true);
    if (!q.people.length) q.since = now;
    q.people.push(p);
  }
  removeFromQueues(p) {
    for (const [k, q] of this.queues) {
      const i = q.people.indexOf(p);
      if (i >= 0) { q.people.splice(i, 1); if (!q.people.length && q.assigned < 0) this.queues.delete(k); return true; }
    }
    return false;
  }

  canStop(car, L) {
    const dist = Math.abs(L - car.pos);
    if (dist < EPS || dist <= Math.abs(car.v) + 0.02) return true;
    const brake = (car.v * car.v) / (2 * this.def.acc);
    return dist + EPS + Math.abs(car.v) >= brake;
  }
  ahead(car, L, d) {
    return d > 0 ? L > car.pos + EPS : L < car.pos - EPS;
  }
  excluded(car, d) {
    return car.exprun && ((this._mode === 'top' && d > 0) || (this._mode === 'bottom' && d < 0));
  }

  tryAssign(q, cars) {
    const R = this.responseDistance;
    let best = -1, bd = Infinity;
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i];
      if (!(c.state === 'moving' || c.state === 'load' || c.state === 'opening' || c.state === 'unload')) continue;
      if (c.dir !== q.d) continue;
      if (!this.ahead(c, q.L, q.d) || !this.canStop(c, q.L)) continue;
      if (Math.abs(c.pos - q.L) > R) continue;
      if (c.pax.length >= this.cap) continue;
      if (this.excluded(c, q.d)) continue;
      const d = Math.abs(c.pos - q.L);
      if (d < bd) { bd = d; best = i; }
    }
    if (best >= 0) { q.assigned = best; return true; }
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i];
      if (c.state !== 'idle') continue;
      const d = Math.abs(c.pos - q.L);
      if (d < bd) { bd = d; best = i; }
    }
    if (best >= 0) {
      const c = cars[best];
      q.assigned = best;
      c.exprun = false;
      if (Math.abs(c.pos - q.L) < EPS && Math.abs(c.v) < EPS) {
        c.pos = q.L; c.dir = q.d; c.state = 'opening'; c.timer = DOOR_TICKS;
      } else {
        c.dir = q.L > c.pos ? 1 : -1;
        c.state = 'moving';
      }
      return true;
    }
    return false;
  }

  validAssignment(q) {
    const c = this.cars[q.assigned];
    if (!c) return false;
    if (c.state === 'idle') return false;
    const atFloor = Math.abs(c.pos - q.L) < EPS && (c.state === 'opening' || c.state === 'unload' || c.state === 'load');
    if (atFloor) return true;
    if (c.pax.length >= this.cap) return false;
    if (!this.ahead(c, q.L, c.dir)) return false;
    if (!this.canStop(c, q.L)) return false;
    if (q.d === c.dir && this.excluded(c, q.d)) return false;
    return true;
  }

  nextStop(car) {
    const D = car.dir;
    if (!D) return null;
    let best = null, bd = Infinity;
    for (const p of car.pax) {
      const t = p._dest;
      if (this.ahead(car, t, D) && this.canStop(car, t)) { const d = Math.abs(t - car.pos); if (d < bd) { bd = d; best = t; } }
    }
    const full = car.pax.length >= this.cap;
    const ci = this.cars.indexOf(car);
    if (!full) {
      for (const q of this.queues.values()) {
        if (!q.people.length || q.d !== D) continue;
        if (q.assigned !== ci && q.assigned !== -1) continue;
        if (this.excluded(car, D)) continue;
        if (!this.ahead(car, q.L, D) || !this.canStop(car, q.L)) continue;
        const d = Math.abs(q.L - car.pos);
        if (d < bd) { bd = d; best = q.L; }
      }
    }
    if (best !== null) return best;
    // turnaround: the farthest call assigned to this car ahead (any direction)
    let far = null, fd = -1;
    for (const q of this.queues.values()) {
      if (q.assigned !== ci || !q.people.length) continue;
      if (!this.ahead(car, q.L, D) || !this.canStop(car, q.L)) continue;
      const d = Math.abs(q.L - car.pos);
      if (d > fd) { fd = d; far = q.L; }
    }
    return far;
  }

  hasWorkBehind(car) {
    const ci = this.cars.indexOf(car);
    if (car.pax.length) return true;
    for (const q of this.queues.values()) if (q.people.length && q.assigned === ci) return true;
    return false;
  }

  move(car, target) {
    const def = this.def;
    const dist = target - car.pos;
    const s = Math.sign(dist);
    const desired = s * Math.min(def.vmax, Math.sqrt(2 * def.acc * Math.abs(dist)));
    if (car.v < desired) car.v = Math.min(desired, car.v + def.acc);
    else if (car.v > desired) car.v = Math.max(desired, car.v - def.acc);
    if (Math.abs(dist) <= Math.abs(car.v) + 0.02 || Math.abs(dist) < EPS) {
      car.pos = target; car.v = 0; return true;
    }
    car.pos += car.v;
    car.moved = true;
    return false;
  }

  homeFor(car, tower) {
    if (this._mode === 'top' || this._mode === 'bottom') {
      const lv = this.servedLevels(tower);
      if (!lv.length) return null;
      return this._mode === 'top' ? lv[0] : lv[lv.length - 1];
    }
    if (this.kind === 'express') return null;
    return car.home;
  }

  // hooks: onAlight(p, L), onBoard(p, car)
  tick(game) {
    const tower = game.tower;
    this._mode = this.modeNow(game.t);
    const cars = this.cars;
    this.active = false;
    for (const c of cars) { c.prev = c.pos; c.moved = false; }
    // validate assignments, drop empty queues
    const pending = [];
    for (const [k, q] of this.queues) {
      if (!q.people.length) {
        const c = cars[q.assigned];
        const busyHere = c && Math.abs(c.pos - q.L) < EPS && (c.state === 'load' || c.state === 'unload' || c.state === 'opening');
        if (!busyHere) { this.queues.delete(k); continue; }
      }
      if (q.assigned >= 0 && !this.validAssignment(q)) q.assigned = -1;
      if (q.assigned < 0 && q.people.length) pending.push(q);
    }
    pending.sort((a, b) => a.since - b.since);
    for (const q of pending) this.tryAssign(q, cars);

    const board = this.def.board;
    for (let ci = 0; ci < cars.length; ci++) {
      const car = cars[ci];
      switch (car.state) {
        case 'idle': {
          car.dir = 0; car.exprun = false;
          const h = this.homeFor(car, tower);
          if (h !== null && h !== undefined && Math.abs(car.pos - h) > EPS) this.move(car, h);
          else if (Math.abs(car.v) > 0) { car.v = 0; car.pos = Math.round(car.pos); }
          break;
        }
        case 'moving': {
          let stop = this.nextStop(car);
          if (stop === null) {
            if (Math.abs(car.v) > EPS) { // brake to the first floor we can still stop at
              if (car.brakeTo == null) {
                const sg = Math.sign(car.v);
                let f = sg > 0 ? Math.ceil(car.pos - EPS) : Math.floor(car.pos + EPS);
                while (!this.canStop(car, f)) f += sg;
                car.brakeTo = Math.max(this.bottom, Math.min(this.top, f));
              }
              if (this.move(car, car.brakeTo)) car.brakeTo = null;
              break;
            }
            car.pos = Math.round(car.pos);
            if (this.hasWorkBehind(car)) {
              car.dir = -car.dir; car.exprun = false;
              stop = this.nextStop(car);
              if (stop === null) { car.dir = -car.dir; stop = this.nextStop(car); }
            }
            if (stop === null) {
              // a call at this very floor?
              const F = car.pos, ci = this.cars.indexOf(car);
              const here = [1, -1].map(d => this.queue(F, d)).find(q => q && q.people.length && (q.assigned === ci || q.assigned < 0));
              if (here || car.pax.some(p => p._dest === F)) { car.state = 'opening'; car.timer = DOOR_TICKS; if (here) car.dir = here.d; break; }
              car.state = 'idle'; break;
            }
          }
          car.brakeTo = null;
          if (this.move(car, stop)) { car.state = 'opening'; car.timer = DOOR_TICKS; }
          break;
        }
        case 'opening':
          if (--car.timer <= 0) { car.state = 'unload'; }
          break;
        case 'unload': {
          const F = Math.round(car.pos);
          let k = board, any = false;
          for (let i = 0; i < car.pax.length && k > 0; i++) {
            const p = car.pax[i];
            if (p._dest === F) { car.pax.splice(i, 1); i--; k--; game.onAlight(p, F, this); any = true; }
          }
          if (any && car.pax.some(p => p._dest === F)) break;
          // decide direction
          if (car.pax.length) car.dir = car.pax[0]._dest > F ? 1 : -1;
          else {
            const qs = this.queue(F, car.dir || 1), qo = this.queue(F, -(car.dir || 1));
            if (!car.dir) car.dir = qs && qs.people.length ? 1 : -1;
            if (!(qs && qs.people.length) && qo && qo.people.length) car.dir = -(car.dir || 1);
            if (car.dir === 0) car.dir = 1;
          }
          if (this._mode === 'top' && car.dir > 0) car.exprun = (F === this.servedLevels(tower)[0]);
          else if (this._mode === 'bottom' && car.dir < 0) { const lv = this.servedLevels(tower); car.exprun = (F === lv[lv.length - 1]); }
          else car.exprun = false;
          car.state = 'load'; car.dwell = 0;
          break;
        }
        case 'load': {
          const F = Math.round(car.pos);
          let q = this.queue(F, car.dir);
          if ((!q || !q.people.length) && !car.pax.length) {
            const qo = this.queue(F, -car.dir);
            if (qo && qo.people.length) { car.dir = -car.dir; q = qo; car.exprun = false; }
          }
          if (q) q.assigned = ci;
          let k = board;
          while (q && q.people.length && car.pax.length < this.cap && k > 0) {
            const p = q.people.shift();
            car.pax.push(p); k--;
            game.onBoard(p, car, this);
          }
          car.dwell++;
          const full = car.pax.length >= this.cap;
          const empty = !q || !q.people.length;
          if (full || (empty && car.dwell >= Math.max(this.delay, MIN_DWELL))) { car.state = 'closing'; car.timer = DOOR_TICKS; }
          break;
        }
        case 'closing':
          if (--car.timer <= 0) {
            const F = Math.round(car.pos);
            for (const d of [1, -1]) {
              const q = this.queue(F, d);
              if (q && q.assigned === ci) { q.assigned = -1; if (!q.people.length) this.queues.delete(this.qkey(F, d)); }
            }
            if (car.pax.length) car.state = 'moving';
            else {
              let work = false;
              for (const q of this.queues.values()) if (q.assigned === ci && q.people.length) work = true;
              car.state = work ? 'moving' : 'idle';
              if (work) { const t = this.nextStop(car); if (t === null) car.dir = -car.dir; }
            }
          }
          break;
      }
      if (car.moved || car.state !== 'idle') this.active = this.active || car.moved;
    }
  }

  serialize() {
    return { id: this.id, kind: this.kind, x: this.x, bottom: this.bottom, top: this.top, off: [...this.off], homes: this.cars.map(c => c.home), rd: this.responseDistance, delay: this.delay, modes: this.modes, hidden: this.hidden, name: this.name };
  }
  static from(o) {
    const s = new Shaft(o.id, o.kind, o.x, o.bottom, o.top);
    s.off = new Set(o.off || []);
    s.cars = (o.homes || [o.bottom]).map(h => newCar(h));
    s.responseDistance = o.rd ?? 4; s.delay = o.delay || 0;
    if (o.modes) s.modes = o.modes;
    s.hidden = !!o.hidden; s.name = o.name || '';
    return s;
  }
}
