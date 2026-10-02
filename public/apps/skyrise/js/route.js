// Skyrise — route finding (spec 5.9). Dijkstra over transport access points with
// the "at most two vertical legs" rule, stair/escalator run limits and lobby-only
// lift-to-lift transfers.
import { TRANSPORT } from './data.js';

const MODE = { stairs: 1, esc: 2, elev: 3 };
const RUN_LIMIT = { 1: 4, 2: 7, 3: 1 };
const WALK_LIMIT = 120;

class Heap {
  constructor() { this.a = []; }
  push(c, v) { const a = this.a; a.push([c, v]); let i = a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; } }
  pop() {
    const a = this.a; const top = a[0]; const last = a.pop();
    if (a.length) { a[0] = last; let i = 0; for (;;) { const l = i * 2 + 1, r = l + 1; let m = i; if (l < a.length && a[l][0] < a[m][0]) m = l; if (r < a.length && a[r][0] < a[m][0]) m = r; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; } }
    return top;
  }
  get size() { return this.a.length; }
}

export class Router {
  constructor(tower) {
    this.tower = tower;
    this.ver = -1;
    this.cache = new Map();
  }
  _build() {
    const T = this.tower;
    this.nodes = [];
    this.bySeg = new Map();
    const add = (n) => {
      n.i = this.nodes.length;
      n.seg = T.segAt(n.L, n.x);
      if (n.seg < 0) { n.dead = true; }
      this.nodes.push(n);
      if (!n.dead) { if (!this.bySeg.has(n.seg)) this.bySeg.set(n.seg, []); this.bySeg.get(n.seg).push(n); }
      return n;
    };
    for (const o of T.trans.values()) {
      if (o.cars) {
        o._nodes = new Map();
        const cx = o.x + (o.w >> 1);
        for (let L = o.bottom; L <= o.top; L++) {
          if (!T.shaftServes(o, L)) continue;
          o._nodes.set(L, add({ L, x: cx, t: o, mode: 3, staff: o.kind === 'service' }));
        }
      } else {
        const m = o.kind === 'escalator' ? 2 : 1;
        const a = add({ L: o.L, x: o.x, t: o, mode: m });
        const b = add({ L: o.L + 1, x: o.x + o.w - 1, t: o, mode: m });
        a.other = b; b.other = a;
      }
    }
    this.cache.clear();
    this.ver = T.version;
  }
  ensure() { if (this.ver !== this.tower.version) this._build(); }

  // cls: 'normal' | 'staff'
  // from/to: {L, x} or {street:true}
  find(from, to, cls = 'normal') {
    this.ensure();
    const key = cls + '|' + (from.street ? 'S' : from.L + ':' + Math.round(from.x)) + '>' + (to.street ? 'S' : to.L + ':' + Math.round(to.x));
    if (this.cache.has(key)) return this.cache.get(key);
    const r = this._search(from, to, cls);
    if (this.cache.size > 20000) this.cache.clear();
    this.cache.set(key, r);
    return r;
  }

  _allowed(n, cls) {
    if (n.dead) return false;
    if (cls === 'staff') return n.mode === 1 || (n.mode === 3 && n.staff);
    return !(n.mode === 3 && n.staff);
  }

  // which places can be reached from the street at all? one search for the whole tower.
  // returns a function (L, x) -> boolean
  reachFromStreet(cls = 'normal') {
    this.ensure();
    const key = 'reach|' + cls;
    if (this.cache.has(key)) return this.cache.get(key);
    const minWalk = new Float64Array(this.nodes.length).fill(Infinity);
    this._search({ street: true }, null, cls, (lab, n) => { if (lab.legs > 0 && lab.walk < minWalk[n.i]) minWalk[n.i] = lab.walk; });
    const T = this.tower;
    const fn = (L, x) => {
      const seg = T.segAt(L, x);
      if (seg < 0) return false;
      if (L === 0) return true; // the ground floor is the street frontage
      for (const n of this.bySeg.get(seg) || []) if (minWalk[n.i] + Math.abs(n.x - x) <= WALK_LIMIT) return true;
      return false;
    };
    this.cache.set(key, fn);
    return fn;
  }

  _search(from, to, cls, onSettle) {
    const T = this.tower;
    const fromSeg = from.street ? -2 : T.segAt(from.L, from.x);
    const open = !to; // explore everything (reachability mode)
    if (open) to = { street: false, L: -999, x: 0 };
    const toSeg = to.street ? -2 : open ? -3 : T.segAt(to.L, to.x);
    if (!from.street && fromSeg < 0) return null;
    if (!to.street && !open && toSeg < 0) return null;
    if (!open && !from.street && !to.street && fromSeg === toSeg) {
      const d = Math.abs(from.x - to.x);
      return { cost: d, steps: [{ t: 'walk', L: to.L, x: to.x }] };
    }
    const nodes = this.nodes;
    const heap = new Heap();
    const best = new Map();
    const labels = [];
    const push = (cost, lab) => {
      const k = lab.n * 64 + lab.legs * 24 + lab.mode * 6 + Math.min(lab.run, 5);
      const prev = best.get(k);
      if (prev !== undefined && prev <= cost) return;
      best.set(k, cost);
      lab.cost = cost;
      labels.push(lab);
      heap.push(cost, labels.length - 1);
    };
    // seeds
    const isDest = (n) => to.street ? (n.L === 0) : (n.seg === toSeg);
    if (from.street) {
      for (const n of nodes) if (n.L === 0 && this._allowed(n, cls)) push(0, { n: n.i, legs: 0, mode: 0, run: 0, walk: 0, arrX: null, prev: -1, act: 'enter' });
    } else {
      const list = this.bySeg.get(fromSeg) || [];
      for (const n of list) {
        if (!this._allowed(n, cls)) continue;
        const d = Math.abs(n.x - from.x);
        if (d > WALK_LIMIT) continue;
        push(d, { n: n.i, legs: 0, mode: 0, run: 0, walk: d, arrX: null, prev: -1, act: 'walk' });
      }
    }
    let bestEnd = null, bestEndCost = Infinity;
    let guard = 0;
    const cap = open ? 400000 : 60000;
    while (heap.size && guard++ < cap) {
      const [c, li] = heap.pop();
      const lab = labels[li];
      if (c >= bestEndCost) break;
      const k = lab.n * 64 + lab.legs * 24 + lab.mode * 6 + Math.min(lab.run, 5);
      if (best.get(k) < c) continue;
      const n = nodes[lab.n];
      if (onSettle) onSettle(lab, n);
      // reached destination segment after at least one ride?
      if (!open && lab.legs > 0 && isDest(n)) {
        const fd = to.street ? 0 : Math.abs(n.x - to.x);
        if (lab.walk + fd <= WALK_LIMIT && c + fd < bestEndCost) { bestEndCost = c + fd; bestEnd = li; }
      }
      // walk to other nodes in same segment
      const segList = this.bySeg.get(n.seg) || [];
      for (const m of segList) {
        if (m === n || !this._allowed(m, cls)) continue;
        const d = Math.abs(m.x - n.x);
        if (lab.walk + d > WALK_LIMIT) continue;
        push(c + d, { n: m.i, legs: lab.legs, mode: lab.mode, run: lab.run, walk: lab.walk + d, arrX: lab.arrX, prev: li, act: 'walk', lastShaft: lab.lastShaft });
      }
      // ride
      const nm = n.mode;
      let legs = lab.legs, run;
      if (nm !== 3 && lab.mode === nm && lab.mode !== 0) { run = lab.run + 1; if (run > RUN_LIMIT[nm]) continue; }
      else {
        legs = lab.legs + 1; run = 1;
        if (legs > 2) continue;
        if (nm === 3 && lab.mode === 3) {
          // lift-to-lift transfer only within one continuous lobby
          if (n.t.id === lab.lastShaft) continue;
          const r1 = T.lobbyRunAt(n.L, lab.arrX), r2 = T.lobbyRunAt(n.L, n.x);
          if (r1 < 0 || r1 !== r2) continue;
        }
      }
      if (nm === 1 || nm === 2) {
        const m = n.other;
        if (!m || m.dead || !this._allowed(m, cls)) continue;
        const cost = nm === 1 ? 30 : 10;
        push(c + cost, { n: m.i, legs, mode: nm, run, walk: lab.walk, arrX: m.x, prev: li, act: nm === 1 ? 'stairs' : 'esc' });
      } else {
        const s = n.t;
        const exp = s.kind === 'express';
        for (const [L2, m] of s._nodes) {
          if (L2 === n.L) continue;
          const fl = Math.abs(L2 - n.L);
          const cost = 20 + (exp ? 15 + fl * 0.15 : fl * 0.6) + (s._waitEst ? s._waitEst : 0);
          push(c + cost, { n: m.i, legs, mode: 3, run: 1, walk: lab.walk, arrX: m.x, prev: li, act: 'elev', lastShaft: s.id });
        }
      }
    }
    if (open || bestEnd === null) return null;
    // reconstruct
    const chain = [];
    for (let i = bestEnd; i >= 0; i = labels[i].prev) chain.push(labels[i]);
    chain.reverse();
    const steps = [];
    let cur = chain[0];
    const n0 = nodes[cur.n];
    if (from.street) steps.push({ t: 'appear', L: 0, x: n0.x });
    else steps.push({ t: 'walk', L: n0.L, x: n0.x });
    for (let i = 1; i < chain.length; i++) {
      const lab = chain[i], pn = nodes[chain[i - 1].n], n = nodes[lab.n];
      if (lab.act === 'walk') steps.push({ t: 'walk', L: n.L, x: n.x });
      else if (lab.act === 'elev') steps.push({ t: 'elev', sid: n.t.id, from: pn.L, to: n.L });
      else steps.push({ t: lab.act, tid: n.t.id, L0: pn.L, L1: n.L, x0: pn.x, x1: n.x });
    }
    const last = nodes[chain[chain.length - 1].n];
    if (to.street) steps.push({ t: 'exit', L: 0, x: last.x });
    else steps.push({ t: 'walk', L: to.L, x: to.x });
    // merge consecutive walks
    const out = [];
    for (const s of steps) {
      if (s.t === 'walk' && out.length && out[out.length - 1].t === 'walk' && out[out.length - 1].L === s.L) out[out.length - 1] = s;
      else out.push(s);
    }
    return { cost: bestEndCost, steps: out };
  }
}

export function stepsVertical(steps) { return steps.filter(s => s.t !== 'walk' && s.t !== 'appear' && s.t !== 'exit').length; }
export { TRANSPORT };
