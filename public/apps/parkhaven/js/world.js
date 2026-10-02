// Parkhaven - the tile world: terrain (vertex height map), water, ownership, paths, scenery and
// structure occupancy. No rendering here.

export const DX = [1, 0, -1, 0];
export const DY = [0, 1, 0, -1];

export class World {
  constructor(N) {
    this.N = N;
    const T = N * N;
    this.hv = new Int16Array((N + 1) * (N + 1)); // vertex heights, hu
    this.water = new Int16Array(T); // water surface height, hu (0 = none)
    this.own = new Uint8Array(T); // 0 not owned, 1 owned, 2 construction rights
    this.sale = new Uint8Array(T); // bit 1 land for sale, bit 2 rights for sale
    this.ptype = new Uint8Array(T); // 0 none, 1 footpath, 2 queue
    this.pz = new Int16Array(T); // path height at its low edge, hu
    this.pslope = new Int8Array(T).fill(-1); // -1 flat, else direction it rises toward
    this.paddon = new Uint8Array(T); // 1 bench 2 bin 3 lamp
    this.pbroken = new Uint8Array(T);
    this.pbin = new Uint8Array(T); // bin fill level
    this.poutside = new Uint8Array(T); // arrival path outside the park
    this.scen = new Uint8Array(T); // scenery type id
    this.scenRot = new Uint8Array(T);
    this.occ = new Array(T).fill(null); // [{k, id, z0, z1}]
    this.adj = new Uint8Array(T); // footpath connection bits
    this.qadj = new Uint8Array(T); // queue connection bits
    this.gate = null; // {x, y, dir} park entrance (centre tile), dir points into the park
    this.spawn = null; // {x, y} map-edge arrival tile
    this.version = 1; // bumps on any visual change
    this.pathVersion = 1; // bumps when path connectivity may have changed
  }

  idx(x, y) { return y * this.N + x; }
  inMap(x, y) { return x >= 0 && y >= 0 && x < this.N && y < this.N; }
  usable(x, y) { return x >= 1 && y >= 1 && x < this.N - 1 && y < this.N - 1; }
  vh(x, y) { return this.hv[y * (this.N + 1) + x]; }
  setVh(x, y, h) { this.hv[y * (this.N + 1) + x] = h; }
  corners(x, y) { return [this.vh(x, y), this.vh(x + 1, y), this.vh(x + 1, y + 1), this.vh(x, y + 1)]; }
  groundMax(x, y) { const c = this.corners(x, y); return Math.max(c[0], c[1], c[2], c[3]); }
  groundMin(x, y) { const c = this.corners(x, y); return Math.min(c[0], c[1], c[2], c[3]); }
  isFlat(x, y) { const c = this.corners(x, y); return c[0] === c[1] && c[1] === c[2] && c[2] === c[3]; }
  owned(x, y) { return this.inMap(x, y) && this.own[this.idx(x, y)] === 1; }
  wet(x, y) { const i = this.idx(x, y); return this.water[i] > this.groundMin(x, y); }

  /** Bilinear terrain height (hu) at fractional tile coordinates. */
  heightAt(fx, fy) {
    const N = this.N;
    fx = Math.max(0, Math.min(N - 1e-4, fx)); fy = Math.max(0, Math.min(N - 1e-4, fy));
    const x = Math.floor(fx), y = Math.floor(fy), u = fx - x, v = fy - y;
    const c = this.corners(x, y);
    return c[0] * (1 - u) * (1 - v) + c[1] * u * (1 - v) + c[2] * u * v + c[3] * (1 - u) * v;
  }

  // ------------------------------------------------------------ paths
  /** Fit a path to the terrain: flat, a one-step ramp, or flat at the highest corner. */
  pathFit(x, y) {
    const [a, b, c, d] = this.corners(x, y); // nw ne se sw
    if (a === b && b === c && c === d) return { z: a, slope: -1 };
    // ramps rising toward east(0) south(1) west(2) north(3)
    if (a === d && b === c && b === a + 2) return { z: a, slope: 0 };
    if (a === b && d === c && d === a + 2) return { z: a, slope: 1 };
    if (a === d && b === c && a === b + 2) return { z: b, slope: 2 };
    if (a === b && d === c && a === d + 2) return { z: d, slope: 3 };
    return { z: Math.max(a, b, c, d), slope: -1 };
  }
  hasPath(x, y) { return this.inMap(x, y) && this.ptype[this.idx(x, y)] !== 0; }
  /** Height of a path's edge toward direction d, or null if it cannot connect that way. */
  edgeH(i, d) {
    const s = this.pslope[i], z = this.pz[i];
    if (s < 0) return z;
    if (d === s) return z + 2;
    if (d === ((s + 2) & 3)) return z;
    return null;
  }
  centreZ(i) { return this.pz[i] + (this.pslope[i] >= 0 ? 1 : 0); }

  /** Recompute path connection bitmasks. */
  rebuildAdjacency() {
    const N = this.N;
    this.adj.fill(0); this.qadj.fill(0);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const i = this.idx(x, y);
      const t = this.ptype[i];
      if (!t) continue;
      for (let d = 0; d < 4; d++) {
        const nx = x + DX[d], ny = y + DY[d];
        if (!this.inMap(nx, ny)) continue;
        const j = this.idx(nx, ny);
        const u = this.ptype[j];
        if (!u) continue;
        const h1 = this.edgeH(i, d), h2 = this.edgeH(j, (d + 2) & 3);
        if (h1 == null || h2 == null || h1 !== h2) continue;
        if (t === 1 && u === 1) this.adj[i] |= 1 << d;
        else if (t === 2 && u === 2) this.qadj[i] |= 1 << d;
      }
    }
    this.pathVersion++;
  }

  // ------------------------------------------------------------ occupancy
  occAt(x, y) { return this.occ[this.idx(x, y)] || []; }
  addOcc(x, y, e) {
    const i = this.idx(x, y);
    if (!this.occ[i]) this.occ[i] = [];
    this.occ[i].push(e);
  }
  removeOccId(id, kind) {
    for (let i = 0; i < this.occ.length; i++) {
      const a = this.occ[i];
      if (!a) continue;
      const b = a.filter((e) => !(e.id === id && (!kind || e.k === kind)));
      this.occ[i] = b.length ? b : null;
    }
  }
  removeOccWhere(x, y, fn) {
    const i = this.idx(x, y);
    const a = this.occ[i];
    if (!a) return;
    const b = a.filter((e) => !fn(e));
    this.occ[i] = b.length ? b : null;
  }
  /** First structure overlapping [z0, z1) on this tile, ignoring entries matching skip(e). */
  collides(x, y, z0, z1, skip) {
    for (const e of this.occAt(x, y)) {
      if (skip && skip(e)) continue;
      if (z0 < e.z1 && e.z0 < z1) return e;
    }
    return null;
  }
  /** Structure at ground level occupying the tile (ride, stall, gate, entrance). */
  groundStructure(x, y) {
    const g = this.groundMax(x, y);
    for (const e of this.occAt(x, y)) if (e.z0 <= g + 4) return e;
    return null;
  }

  // ------------------------------------------------------------ serialisation
  save() {
    const enc = (a) => Array.from(a);
    return {
      N: this.N, hv: enc(this.hv), water: enc(this.water), own: enc(this.own), sale: enc(this.sale),
      ptype: enc(this.ptype), pz: enc(this.pz), pslope: enc(this.pslope), paddon: enc(this.paddon),
      pbroken: enc(this.pbroken), pbin: enc(this.pbin), poutside: enc(this.poutside), scen: enc(this.scen),
      scenRot: enc(this.scenRot), occ: this.occ.map((a) => (a ? a : 0)), gate: this.gate, spawn: this.spawn,
    };
  }
  static load(o) {
    const w = new World(o.N);
    w.hv.set(o.hv); w.water.set(o.water); w.own.set(o.own); w.sale.set(o.sale); w.ptype.set(o.ptype);
    w.pz.set(o.pz); w.pslope.set(o.pslope); w.paddon.set(o.paddon); w.pbroken.set(o.pbroken);
    w.pbin.set(o.pbin); w.poutside.set(o.poutside); w.scen.set(o.scen); w.scenRot.set(o.scenRot);
    w.occ = o.occ.map((a) => (a ? a : null));
    w.gate = o.gate; w.spawn = o.spawn;
    w.rebuildAdjacency();
    return w;
  }
}
