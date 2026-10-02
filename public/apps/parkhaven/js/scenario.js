// Parkhaven - scenarios and procedural starting maps. All scenario names and text are original.
import { World } from './world.js';
import { Rng } from './rng.js';

export const SCENARIOS = [
  {
    id: 'willowmere', name: 'Willowmere Green',
    blurb: 'A quiet village green beside a reed-fringed pond. The parish wants visitors: fill the park by the end of your second season.',
    objective: { type: 'attendance', guests: 400, rating: 600, year: 2 },
    pricing: 'ride', cash: 1000000, loan: 1000000, maxLoan: 2000000, interest: 10,
    landPrice: 9000, rightsPrice: 4000, seed: 1207, hills: 0.5, lake: 'pond',
  },
  {
    id: 'copperhill', name: 'Copperhill Quarry',
    blurb: 'An old copper quarry with dramatic slopes. Visitors pay at the gate; build the park up to a value of 30,000 cr by the end of year 3.',
    objective: { type: 'value', value: 3000000, year: 3 },
    pricing: 'gate', entryFee: 1000, cash: 1000000, loan: 1000000, maxLoan: 2500000, interest: 10,
    landPrice: 9000, rightsPrice: 4000, seed: 4242, hills: 1.4, lake: 'pit',
  },
  {
    id: 'saltmarsh', name: 'Saltmarsh Bay',
    blurb: 'A breezy strip of land along the bay. Earn at least 3,000 cr in ride tickets in a single month before the end of year 3.',
    objective: { type: 'takings', amount: 300000, months: 1, year: 3 },
    pricing: 'ride', cash: 1000000, loan: 1000000, maxLoan: 2000000, interest: 10,
    landPrice: 9000, rightsPrice: 4000, seed: 777, hills: 0.3, lake: 'bay',
  },
  {
    id: 'sandbox', name: 'Open Meadow (sandbox)',
    blurb: 'Plenty of money, every ride unlocked and no goal. Build whatever you like.',
    objective: { type: 'none' },
    pricing: 'ride', cash: 5000000, loan: 0, maxLoan: 5000000, interest: 5,
    landPrice: 5000, rightsPrice: 2000, seed: 99, hills: 0.4, lake: 'pond', allResearched: true,
  },
];

function valueNoise(rng, N, cell) {
  const G = Math.ceil(N / cell) + 2;
  const g = new Float32Array(G * G);
  for (let i = 0; i < g.length; i++) g[i] = rng.float();
  const sm = (t) => t * t * (3 - 2 * t);
  return (x, y) => {
    const fx = x / cell, fy = y / cell;
    const ix = Math.floor(fx), iy = Math.floor(fy);
    const u = sm(fx - ix), v = sm(fy - iy);
    const a = g[iy * G + ix], b = g[iy * G + ix + 1], c = g[(iy + 1) * G + ix], d = g[(iy + 1) * G + ix + 1];
    return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
  };
}

/** Build the starting world for a scenario. */
export function generateWorld(sc, N = 64) {
  const rng = new Rng(sc.seed);
  const w = new World(N);
  const n1 = valueNoise(rng, N + 1, 9), n2 = valueNoise(rng, N + 1, 4);
  const O = { x0: 17, y0: 13, x1: 46, y1: 45 }; // owned rectangle (inclusive)
  const gx = 32, gy = O.y1; // gate tile
  const base = 6;
  // vertex heights
  for (let y = 0; y <= N; y++) for (let x = 0; x <= N; x++) {
    // distance outside the owned rectangle (0 inside)
    const ox = Math.max(O.x0 + 2 - x, 0, x - (O.x1 - 1));
    const oy = Math.max(O.y0 + 2 - y, 0, y - (O.y1 - 1));
    const out = Math.min(1, Math.hypot(ox, oy) / 8);
    const inner = sc.hills > 1 ? 0.55 : 0.12;
    const amp = (inner + (1 - inner) * out) * sc.hills;
    let h = base + Math.round((n1(x, y) * 0.75 + n2(x, y) * 0.25 - 0.35) * 10 * amp) * 2;
    // keep a flat plaza around the gate and starter path
    if (Math.abs(x - gx - 0.5) < 6 && y > O.y1 - 9) h = base;
    if (y >= O.y1 && Math.abs(x - gx - 0.5) < 3) h = base;
    h = Math.max(2, Math.min(40, h));
    w.setVh(x, y, h);
  }
  // water
  const lakeAt = (x, y) => {
    if (sc.lake === 'pond') return Math.hypot((x - 40) / 5.5, (y - 21) / 4.5) < 1;
    if (sc.lake === 'pit') return Math.hypot((x - 24) / 4.5, (y - 22) / 5) < 1;
    if (sc.lake === 'bay') return x < 13 + Math.sin(y / 5) * 2 || (x < 22 && y < 12);
    return false;
  };
  for (let y = 0; y <= N; y++) for (let x = 0; x <= N; x++) {
    if (lakeAt(x, y)) w.setVh(x, y, 2);
  }
  // smooth steps so neighbouring vertices differ by at most 2 hu where possible
  for (let pass = 0; pass < 6; pass++) {
    for (let y = 0; y <= N; y++) for (let x = 0; x <= N; x++) {
      const h = w.vh(x, y);
      let mn = h;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const X = x + dx, Y = y + dy;
        if (X < 0 || Y < 0 || X > N || Y > N) continue;
        mn = Math.min(mn, w.vh(X, Y));
      }
      if (h > mn + 4) w.setVh(x, y, mn + 4);
    }
  }
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = w.idx(x, y);
    if (w.groundMin(x, y) < 4 && (lakeAt(x, y) || lakeAt(x + 1, y + 1) || lakeAt(x + 1, y) || lakeAt(x, y + 1))) w.water[i] = 4;
  }
  // ownership
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = w.idx(x, y);
    if (!w.usable(x, y)) continue;
    if (x >= O.x0 && x <= O.x1 && y >= O.y0 && y <= O.y1) w.own[i] = 1;
    else if (x >= 6 && x <= 57 && y >= 4 && y <= 56) w.sale[i] = (x + y) % 9 === 0 && sc.lake !== 'bay' ? 2 : 1;
  }
  // gate + arrival path
  w.gate = { x: gx, y: gy, dir: 3 };
  w.spawn = { x: gx, y: N - 2 };
  const setPath = (x, y, outside) => {
    const i = w.idx(x, y);
    const f = w.pathFit(x, y);
    w.ptype[i] = 1; w.pz[i] = f.z; w.pslope[i] = f.slope; w.poutside[i] = outside ? 1 : 0;
  };
  for (let y = gy; y <= N - 2; y++) setPath(gx, y, y > gy);
  for (let y = gy - 6; y < gy; y++) setPath(gx, y, false);
  for (let x = gx - 4; x <= gx + 4; x++) setPath(x, gy - 6, false);
  w.addOcc(gx - 1, gy, { k: 'gate', id: -1, z0: base, z1: base + 12 });
  w.addOcc(gx + 1, gy, { k: 'gate', id: -1, z0: base, z1: base + 12 });
  for (let y = gy + 1; y <= N - 2; y++) { w.sale[w.idx(gx, y)] = 0; w.sale[w.idx(gx - 1, y)] = 0; w.sale[w.idx(gx + 1, y)] = 0; }
  // trees and rocks
  const nt = valueNoise(rng, N + 1, 6);
  for (let y = 1; y < N - 1; y++) for (let x = 1; x < N - 1; x++) {
    const i = w.idx(x, y);
    if (w.ptype[i] || w.wet(x, y) || w.occ[i]) continue;
    if (Math.abs(x - gx) <= 2 && y >= gy - 7) continue;
    const inside = w.own[i] === 1;
    const dens = nt(x, y);
    const p = inside ? (dens > 0.68 ? 0.22 : 0.015) : (dens > 0.55 ? 0.5 : 0.08);
    if (rng.float() < p) {
      const r = rng.float();
      w.scen[i] = sc.hills > 1 && r < 0.25 ? 8 : r < 0.45 ? 1 : r < 0.75 ? 2 : r < 0.9 ? 3 : 4;
      w.scenRot[i] = rng.rand(4);
    }
  }
  w.rebuildAdjacency();
  return w;
}
