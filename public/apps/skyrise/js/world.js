// Skyrise — the spatial model: slabs, facilities, transport footprints and placement rules.
// Pure data + rules, no DOM.
import { WORLD_W, MIN_LEVEL, TOP_LEVEL, LEVELS, FAC, TRANSPORT, FLOOR_COST, isLobbyLevel, isExpressStop, MIN_BUILD_BASEMENT, MAX_BUILD_LEVEL } from './data.js';

export class Tower {
  constructor() {
    this.W = WORLD_W;
    this.slab = [];
    this.occ = [];
    this.tocc = [];
    for (let i = 0; i < LEVELS; i++) {
      this.slab.push(new Uint8Array(WORLD_W));
      this.occ.push(new Int32Array(WORLD_W));
      this.tocc.push(new Int32Array(WORLD_W));
    }
    this.facs = new Map();
    this.trans = new Map();
    this.nextId = 1;
    this.version = 1;
    this.lobbyHeight = 0;
    this._segVer = -1; this._seg = null; this._segCount = 0;
    this._lobVer = -1; this._lob = null;
    this.transitBottom = null;
    this.span = { minL: 0, maxL: 0, minX: WORLD_W, maxX: 0 };
  }
  li(L) { return L - MIN_LEVEL; }
  inLevels(L) { return L >= MIN_LEVEL && L <= TOP_LEVEL; }
  hasSlab(L, x) { return this.inLevels(L) && x >= 0 && x < this.W && this.slab[this.li(L)][x] === 1; }
  facIdAt(L, x) { return this.inLevels(L) && x >= 0 && x < this.W ? this.occ[this.li(L)][x] : 0; }
  facAt(L, x) { const id = this.facIdAt(L, x); return id ? this.facs.get(id) : null; }
  transIdAt(L, x) { return this.inLevels(L) && x >= 0 && x < this.W ? this.tocc[this.li(L)][x] : 0; }
  transAt(L, x) { const id = this.transIdAt(L, x); return id > 0 ? this.trans.get(id) : (id < 0 ? this.trans.get(-id) : null); }
  bump() { this.version++; this._updateSpan(); }

  _updateSpan() {
    let minL = 0, maxL = 0, minX = WORLD_W, maxX = 0;
    for (let L = MIN_LEVEL; L <= TOP_LEVEL; L++) {
      const row = this.slab[this.li(L)];
      let any = false;
      for (let x = 0; x < this.W; x++) if (row[x]) { any = true; if (x < minX) minX = x; if (x > maxX) maxX = x; }
      if (any) { if (L < minL) minL = L; if (L > maxL) maxL = L; }
    }
    this.span = { minL, maxL, minX, maxX };
  }
  levelExtent(L) {
    if (!this.inLevels(L)) return null;
    const row = this.slab[this.li(L)];
    let a = -1, b = -1;
    for (let x = 0; x < this.W; x++) if (row[x]) { if (a < 0) a = x; b = x; }
    return a < 0 ? null : [a, b];
  }

  // A cell is walkable if it has slab and is not the upper part of a tall lobby.
  walkable(L, x) {
    if (!this.hasSlab(L, x)) return false;
    const f = this.facAt(L, x);
    if (f && f.type === 'lobby' && L > f.L) return false;
    if (f && f.burning) return false;
    return true;
  }
  _buildSegs() {
    this._seg = [];
    let id = 0;
    for (let i = 0; i < LEVELS; i++) {
      const L = i + MIN_LEVEL;
      const s = new Int32Array(this.W).fill(-1);
      let cur = -1;
      for (let x = 0; x < this.W; x++) {
        if (this.walkable(L, x)) { if (cur < 0) cur = id++; s[x] = cur; } else cur = -1;
      }
      this._seg.push(s);
    }
    this._segCount = id;
    this._segVer = this.version;
  }
  segAt(L, x) {
    if (this._segVer !== this.version) this._buildSegs();
    if (!this.inLevels(L) || x < 0 || x >= this.W) return -1;
    return this._seg[this.li(L)][Math.floor(x)];
  }
  // continuous lobby runs: id per cell occupied by a lobby on its base level
  _buildLobbyRuns() {
    this._lob = new Map();
    let id = 0;
    for (const L of [0, 14, 29, 44, 59, 74, 89]) {
      const s = new Int32Array(this.W).fill(-1);
      let cur = -1;
      for (let x = 0; x < this.W; x++) {
        const f = this.facAt(L, x);
        if (f && f.type === 'lobby' && f.L === L) { if (cur < 0) cur = id++; s[x] = cur; } else cur = -1;
      }
      this._lob.set(L, s);
    }
    this._lobVer = this.version;
  }
  lobbyRunAt(L, x) {
    if (this._lobVer !== this.version) this._buildLobbyRuns();
    const s = this._lob.get(L);
    if (!s || x < 0 || x >= this.W) return -1;
    return s[Math.floor(x)];
  }

  // ---- placement checks -------------------------------------------------
  // returns {ok, reason, newSlab:[[L,x]...], replace:[ids]}
  _slabPlan(cells, allowGround) {
    // cells: array of [L,x] that must have slab after placement
    const want = new Set(cells.map(([L, x]) => L * 1000 + x));
    const newSlab = [];
    // process from ground outward so support can come from cells in this same plan
    const sorted = cells.slice().sort((a, b) => Math.abs(a[0]) - Math.abs(b[0]) || (a[0] - b[0]));
    for (const [L, x] of sorted) {
      if (this.hasSlab(L, x)) continue;
      if (L === 0) { if (!allowGround) return { ok: false, reason: 'Only a lobby can widen the ground floor.' }; newSlab.push([L, x]); continue; }
      const sL = L > 0 ? L - 1 : L + 1;
      if (!(this.hasSlab(sL, x) || want.has(sL * 1000 + x))) {
        return { ok: false, reason: L > 0 ? 'A floor cannot overhang the floor below it.' : 'A basement cannot reach past the floor above it.' };
      }
      newSlab.push([L, x]);
    }
    return { ok: true, newSlab };
  }

  checkFacility(type, x, L, opts = {}) {
    const def = FAC[type];
    if (!def || def.nobuild) return { ok: false, reason: 'Unknown facility.' };
    let h = def.h;
    if (type === 'lobby' && L === 0) h = this.lobbyHeight || opts.lobbyHeight || 1;
    const w = def.w;
    if (x < 0 || x + w > this.W) return { ok: false, reason: 'That is off the edge of the plot.' };
    const top = L + h - 1;
    if (type === 'landmark') {
      if (L !== MAX_BUILD_LEVEL) return { ok: false, reason: 'The sky chapel can only crown floor 100.' };
    } else if (top > MAX_BUILD_LEVEL) return { ok: false, reason: 'The tower cannot rise above floor 100.' };
    const minL = type === 'transit' ? MIN_LEVEL : MIN_BUILD_BASEMENT;
    if (L < minL) return { ok: false, reason: 'That is too deep to dig.' };
    if (type === 'lobby') {
      if (!isLobbyLevel(L)) return { ok: false, reason: 'Lobbies go on the ground floor or on floors 15, 30, 45, 60, 75 and 90.' };
    } else {
      if (L <= 0 && top >= 0) return { ok: false, reason: 'Only lobbies and transport can use the ground floor.' };
      if (this.lobbyHeight > 1 && L <= this.lobbyHeight - 1 && L > 0) {
        // inside the height of a tall ground lobby: only outside its span, which the width rule forbids anyway
      }
      if (L < 0 && !def.under) return { ok: false, reason: def.label + ' cannot go underground.' };
      if (L > 0 && !def.above) return { ok: false, reason: def.label + ' must go underground.' };
    }
    if (this.transitBottom !== null && L < this.transitBottom) return { ok: false, reason: 'Nothing can be built below the metro station.' };
    if (type === 'transit') {
      if (top > -1) return { ok: false, reason: 'The metro station must be fully underground.' };
      const below = L - 1;
      if (below >= MIN_LEVEL) {
        const row = this.slab[this.li(below)];
        for (let i = 0; i < this.W; i++) if (row[i]) return { ok: false, reason: 'The metro station must sit at the very bottom.' };
      }
    }
    // overlap
    const replace = new Set();
    for (let l = L; l <= top; l++) for (let i = x; i < x + w; i++) {
      const id = this.facIdAt(l, i);
      if (id) {
        if (!opts.replace) return { ok: false, reason: 'Something is already built there.' };
        const f = this.facs.get(id);
        if (!FAC[f.type].removable) return { ok: false, reason: FAC[f.type].label + ' cannot be replaced.' };
        replace.add(id);
      }
    }
    // replaced facilities must lie wholly inside? no: replacing bulldozes them entirely.
    const cells = [];
    for (let l = L; l <= top; l++) for (let i = x; i < x + w; i++) cells.push([l, i]);
    const sp = this._slabPlan(cells, type === 'lobby' && L === 0);
    if (!sp.ok) return sp;
    // lobbies above ground still need the floor under them (width rule handled by slab plan)
    return { ok: true, newSlab: sp.newSlab, replace: [...replace], h, w, top, slabCost: sp.newSlab.length * FLOOR_COST };
  }

  checkFloor(x0, x1, L) {
    if (x0 > x1) [x0, x1] = [x1, x0];
    x0 = Math.max(0, x0); x1 = Math.min(this.W - 1, x1);
    if (L === 0) return { ok: false, reason: 'The ground floor is built with lobby sections.' };
    if (L > MAX_BUILD_LEVEL || L < MIN_BUILD_BASEMENT) return { ok: false, reason: 'Out of bounds.' };
    if (this.transitBottom !== null && L < this.transitBottom) return { ok: false, reason: 'Nothing can be built below the metro station.' };
    const cells = [];
    for (let i = x0; i <= x1; i++) cells.push([L, i]);
    // allow partial: keep the supported cells only
    const newSlab = [];
    for (let i = x0; i <= x1; i++) {
      if (this.hasSlab(L, i)) continue;
      const sL = L > 0 ? L - 1 : L + 1;
      if (this.hasSlab(sL, i)) newSlab.push([L, i]);
    }
    if (!newSlab.length) return { ok: false, reason: L > 0 ? 'A floor cannot overhang the floor below it.' : 'A basement cannot reach past the floor above it.' };
    return { ok: true, newSlab, slabCost: newSlab.length * FLOOR_COST };
  }

  // shaft span checks for elevators; stairs/escalators use span of 2
  checkTransport(kind, x, b, t, selfId = 0) {
    const def = TRANSPORT[kind];
    const w = def.w;
    if (x < 0 || x + w > this.W) return { ok: false, reason: 'That is off the edge of the plot.' };
    if (b > t) [b, t] = [t, b];
    if (kind === 'stairs' || kind === 'escalator') t = b + 1;
    if (t > MAX_BUILD_LEVEL) return { ok: false, reason: 'The tower cannot rise above floor 100.' };
    if (b < MIN_LEVEL) return { ok: false, reason: 'That is too deep.' };
    if (def.mode === 'elev') {
      if (t - b + 1 > def.maxSpan) return { ok: false, reason: def.label + ' shafts can span at most ' + def.maxSpan + ' floors.' };
      if (t === b) return { ok: false, reason: 'Drag to cover at least two floors.' };
    }
    if (this.transitBottom !== null && b < this.transitBottom) return { ok: false, reason: 'Nothing can be built below the metro station.' };
    const isShaft = def.mode === 'elev';
    // body overlap
    for (let l = b; l <= t; l++) for (let i = x; i < x + w; i++) {
      const id = this.transIdAt(l, i);
      if (id && Math.abs(id) !== selfId) return { ok: false, reason: 'That would cross other transport or lift machinery.' };
    }
    if (isShaft) {
      for (const l of [b - 1, t + 1]) {
        if (!this.inLevels(l)) continue;
        for (let i = x; i < x + w; i++) {
          const id = this.transIdAt(l, i);
          if (id && Math.abs(id) !== selfId) return { ok: false, reason: 'Lift machinery needs a clear floor above and below the shaft.' };
        }
      }
    }
    // slabs
    const cells = [];
    for (let l = b; l <= t; l++) for (let i = x; i < x + w; i++) cells.push([l, i]);
    let newSlab = [];
    if (isShaft) {
      const sp = this._slabPlan(cells, false);
      if (!sp.ok) return sp;
      newSlab = sp.newSlab;
    } else {
      for (const [l, i] of cells) if (!this.hasSlab(l, i)) return { ok: false, reason: 'Stairs need finished floor on both levels.' };
      for (const l of [b, t]) for (let i = x; i < x + w; i++) {
        const f = this.facAt(l, i);
        if (f && f.type === 'lobby' && l > f.L) return { ok: false, reason: 'That is inside a tall lobby.' };
      }
    }
    if (kind === 'escalator') {
      for (const l of [b, t]) if (!this.levelHasPublic(l)) return { ok: false, reason: 'Escalators only link floors that hold a lobby, shops, food or entertainment.' };
    }
    return { ok: true, newSlab, b, t, w, slabCost: newSlab.length * FLOOR_COST };
  }
  levelHasPublic(L) {
    for (const f of this.facs.values()) {
      if (f.L <= L && f.L + f.h - 1 >= L && ['fastfood', 'restaurant', 'shop', 'lobby', 'cinema', 'party'].includes(f.type)) return true;
    }
    return false;
  }

  // ---- mutation -----------------------------------------------------------
  addSlab(cells) { for (const [L, x] of cells) this.slab[this.li(L)][x] = 1; }
  addFacility(type, x, L, h, w, extra = {}) {
    const id = this.nextId++;
    const f = Object.assign({ id, type, x, L, w, h }, extra);
    this.facs.set(id, f);
    for (let l = L; l < L + h; l++) for (let i = x; i < x + w; i++) { this.occ[this.li(l)][i] = id; this.slab[this.li(l)][i] = 1; }
    if (type === 'lobby' && L === 0 && !this.lobbyHeight) this.lobbyHeight = h;
    if (type === 'transit') this.transitBottom = L;
    this.bump();
    return f;
  }
  removeFacility(id) {
    const f = this.facs.get(id);
    if (!f) return;
    for (let l = f.L; l < f.L + f.h; l++) for (let i = f.x; i < f.x + f.w; i++) if (this.occ[this.li(l)][i] === id) this.occ[this.li(l)][i] = 0;
    this.facs.delete(id);
    this.bump();
  }
  addTransport(obj) {
    const id = obj.id || this.nextId++;
    obj.id = id;
    this.trans.set(id, obj);
    this.stampTransport(obj, true);
    this.bump();
    return obj;
  }
  stampTransport(o, on) {
    const isShaft = !!o.cars;
    const b = isShaft ? o.bottom : o.L, t = isShaft ? o.top : o.L + 1;
    for (let l = b; l <= t; l++) for (let i = o.x; i < o.x + o.w; i++) {
      const row = this.tocc[this.li(l)];
      if (on) row[i] = o.id; else if (Math.abs(row[i]) === o.id) row[i] = 0;
    }
    if (isShaft) for (const l of [b - 1, t + 1]) {
      if (!this.inLevels(l)) continue;
      for (let i = o.x; i < o.x + o.w; i++) {
        const row = this.tocc[this.li(l)];
        if (on) { if (!row[i]) row[i] = -o.id; } else if (row[i] === -o.id) row[i] = 0;
      }
    }
  }
  removeTransport(id) {
    const o = this.trans.get(id);
    if (!o) return;
    this.stampTransport(o, false);
    this.trans.delete(id);
    this.bump();
  }

  // Is level L served by shaft s for riders (not off, has walkable floor at its door)?
  shaftServes(s, L) {
    if (L < s.bottom || L > s.top) return false;
    if (s.off.has(L)) return false;
    if (s.kind === 'express' && !isExpressStop(L)) return false;
    const cx = s.x + (s.w >> 1);
    return this.walkable(L, cx);
  }

  // noise check for a sensitive facility (spec 4.21)
  isNoisy(f) {
    const L = f.L;
    const a = f.x - 4, b = f.x + f.w + 4;
    for (let i = Math.max(0, a); i < Math.min(this.W, b); i++) {
      const g = this.facAt(L, i);
      if (g && g !== f && FAC[g.type] && FAC[g.type].noisy) return true;
    }
    // transport touching the unit
    for (let i = f.x; i < f.x + f.w; i++) {
      const id = this.transIdAt(L, i);
      if (id > 0) {
        const o = this.trans.get(id);
        if (o && (o.cars || o.kind === 'escalator')) return true;
      }
    }
    return false;
  }
}
