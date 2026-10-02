// Parkhaven - player construction actions that are not rides: paths, queues, path furniture,
// scenery, land purchase, terraforming and the bulldozer. Each returns {ok, cost, reason}.
import { FIN, ADDONS, SCENERY } from './data.js';

export const PATH_COST = 1200;
export const PATH_SUPPORT = 500;

function err(reason, cost) { return { ok: false, reason, cost }; }

export function checkPath(game, x, y, queue) {
  const w = game.w;
  if (!w.usable(x, y)) return err('Outside the map');
  const i = w.idx(x, y);
  if (w.own[i] !== 1) return err('You do not own this land');
  if (w.poutside[i]) return err('That is the public road');
  if (w.wet(x, y)) return err('Cannot build paths on water');
  const t = queue ? 2 : 1;
  if (w.ptype[i] === t) return { ok: true, cost: 0, same: true };
  if (w.gate && x === w.gate.x && y === w.gate.y) return err('That is the park entrance');
  const f = w.pathFit(x, y);
  if (w.ptype[i]) return game.cash >= 600 ? { ok: true, cost: 600, fit: f, replace: true } : err('Not enough cash', 600);
  const hit = w.collides(x, y, f.z, f.z + 4 + (f.slope >= 0 ? 2 : 0), null);
  if (hit) return err('Something is in the way');
  const steps = Math.max(0, Math.floor((f.z - w.groundMin(x, y)) / 2));
  const cost = PATH_COST + steps * PATH_SUPPORT;
  if (game.cash < cost) return err('Not enough cash', cost);
  return { ok: true, cost, fit: f };
}

export function placePath(game, x, y, queue) {
  const c = checkPath(game, x, y, queue);
  if (!c.ok || c.same) return c;
  const w = game.w, i = w.idx(x, y);
  if (!c.replace) { w.pz[i] = c.fit.z; w.pslope[i] = c.fit.slope; }
  w.ptype[i] = queue ? 2 : 1;
  if (queue && w.paddon[i]) { w.paddon[i] = 0; w.pbroken[i] = 0; }
  w.scen[i] = 0;
  game.spend(FIN.LANDSCAPE, c.cost);
  w.rebuildAdjacency();
  game.markConnDirty();
  return c;
}

export function removePath(game, x, y) {
  const w = game.w, i = w.idx(x, y);
  if (!w.ptype[i] || w.poutside[i]) return err('No path here');
  if (w.gate && x === w.gate.x && y === w.gate.y) return err('The park entrance cannot be removed');
  w.ptype[i] = 0; w.paddon[i] = 0; w.pbroken[i] = 0; w.pbin[i] = 0; w.pslope[i] = -1;
  game.litter = game.litter.filter((l) => !(Math.floor(l.x) === x && Math.floor(l.y) === y));
  game.litterN[i] = 0; game.vomitN[i] = 0;
  game.spend(FIN.LANDSCAPE, -PATH_COST);
  w.rebuildAdjacency();
  game.markConnDirty();
  return { ok: true, cost: -PATH_COST };
}

export function placeAddon(game, x, y, kind) {
  const w = game.w, i = w.idx(x, y);
  const a = ADDONS[kind];
  if (!a) return err('Unknown item');
  if (w.ptype[i] !== 1 || w.poutside[i]) return err('Path furniture goes on footpaths');
  if (w.paddon[i] === kind && !w.pbroken[i]) return err('Already there');
  if (game.cash < a.cost) return err('Not enough cash', a.cost);
  w.paddon[i] = kind; w.pbroken[i] = 0; w.pbin[i] = 0;
  game.spend(FIN.LANDSCAPE, a.cost);
  w.version++;
  return { ok: true, cost: a.cost };
}

export function placeScenery(game, x, y, type) {
  const w = game.w, i = w.idx(x, y);
  const s = SCENERY[type];
  if (!s) return err('Unknown item');
  if (!w.usable(x, y) || w.own[i] !== 1) return err('You do not own this land');
  if (w.ptype[i]) return err('There is a path here');
  if (w.wet(x, y)) return err('Cannot plant in water');
  const g = w.groundMax(x, y);
  if (w.collides(x, y, g, g + Math.ceil(s.tall * 4), null)) return err('Something is in the way');
  if (w.scen[i] === type) return err('Already there');
  if (game.cash < s.cost) return err('Not enough cash', s.cost);
  w.scen[i] = type; w.scenRot[i] = (x * 7 + y * 13) & 3;
  game.spend(FIN.LANDSCAPE, s.cost);
  w.version++;
  return { ok: true, cost: s.cost };
}

export function landCost(game, x, y, rights) {
  const w = game.w, i = w.idx(x, y);
  if (!w.usable(x, y)) return null;
  if (w.own[i] === 1) return null;
  if (rights) return w.sale[i] & 2 ? game.sc.rightsPrice : null;
  return w.sale[i] & 1 ? game.sc.landPrice : null;
}

export function buyLand(game, x, y, rights) {
  const c = landCost(game, x, y, rights);
  if (c == null) return err(rights ? 'Construction rights are not for sale here' : 'This land is not for sale');
  if (game.cash < c) return err('Not enough cash', c);
  const w = game.w, i = w.idx(x, y);
  w.own[i] = rights ? 2 : 1;
  w.sale[i] = 0;
  game.spend(FIN.LAND, c);
  w.version++;
  return { ok: true, cost: c };
}

/** Raise (+1) or lower (-1) a whole tile by one land step (2 hu). */
export function terraformCost(game, x, y, dir) {
  const w = game.w;
  if (!w.usable(x, y)) return err('Outside the map');
  const i = w.idx(x, y);
  if (w.own[i] !== 1) return err('You do not own this land');
  // the four vertices are shared with the 8 neighbours: nothing may be built on any of them
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const X = x + dx, Y = y + dy;
    if (!w.inMap(X, Y)) continue;
    const j = w.idx(X, Y);
    if (w.ptype[j] || (w.occ[j] && w.occ[j].length)) return err('Clear paths and rides from around this tile first');
  }
  const c = w.corners(x, y);
  const mx = Math.max(...c), mn = Math.min(...c);
  let target;
  if (dir > 0) target = c.map(() => (mx === mn ? mx + 2 : mx));
  else target = c.map(() => (mx === mn ? mn - 2 : mn));
  if (target.some((h) => h < 0 || h > 60)) return err('Too far');
  let hu = 0;
  for (let k = 0; k < 4; k++) hu += Math.abs(target[k] - c[k]);
  const cost = Math.round(250 * hu);
  return { ok: true, cost, target };
}

export function terraform(game, x, y, dir) {
  const c = terraformCost(game, x, y, dir);
  if (!c.ok) return c;
  if (game.cash < c.cost) return err('Not enough cash', c.cost);
  const w = game.w;
  const V = [[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1]];
  V.forEach(([vx, vy], k) => w.setVh(vx, vy, c.target[k]));
  w.scen[w.idx(x, y)] = 0;
  game.spend(FIN.LANDSCAPE, c.cost);
  w.version++;
  return c;
}

export function removeScenery(game, x, y) {
  const w = game.w, i = w.idx(x, y);
  if (!w.scen[i]) return err('Nothing to remove');
  w.scen[i] = 0; w.version++;
  return { ok: true, cost: 0 };
}

/** What would the bulldozer remove here? */
export function bulldozeTarget(game, x, y) {
  const w = game.w;
  if (!w.inMap(x, y)) return null;
  const i = w.idx(x, y);
  for (const e of w.occAt(x, y)) {
    if (e.k === 'gate') continue;
    const r = game.ride(e.id);
    if (r) return { kind: 'ride', ride: r };
  }
  if (w.ptype[i] && w.paddon[i]) return { kind: 'addon' };
  if (w.ptype[i]) return { kind: 'path' };
  if (w.scen[i]) return { kind: 'scenery' };
  return null;
}

export function bulldozeSmall(game, x, y) {
  const t = bulldozeTarget(game, x, y);
  if (!t) return err('Nothing here');
  const w = game.w, i = w.idx(x, y);
  if (t.kind === 'addon') { w.paddon[i] = 0; w.pbroken[i] = 0; w.pbin[i] = 0; w.version++; return { ok: true, cost: 0 }; }
  if (t.kind === 'path') return removePath(game, x, y);
  if (t.kind === 'scenery') return removeScenery(game, x, y);
  return err('Use the ride window to demolish rides');
}
