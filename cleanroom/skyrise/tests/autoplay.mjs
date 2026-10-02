// A naive auto-player that grows a tower from the normal $2M start. Used to sanity-check balance.
import { Game } from '../../../public/apps/skyrise/js/game.js';
import { DAY_TICKS, clockToTick, dayTick } from '../../../public/apps/skyrise/js/clock.js';
import { FAC } from '../../../public/apps/skyrise/js/data.js';

const DAYS = +process.argv[2] || 60;
const g = new Game(+process.argv[3] || 77);
const X0 = 168, W = 64, X1 = X0 + W; // 64-unit footprint
const log = [];
g.on((t, d) => { if (t === 'dialog') log.push(`day ${g.dateDay}: ${d.kind} ${d.text.slice(0, 70)}`); });
for (let x = X0; x < X1; x += 4) g.build('lobby', x, 0);
const shaftXs = [X0 + 14, X0 + 44];
let top = 0;
const peak = new Map();
function rowFor(L) {
  if (g.star >= 2 && L % 6 === 5) return ['housekeeping', 'single', 'single', 'single', 'single', 'single', 'single', 'single', 'single', 'single'];
  if (L % 5 === 0) return ['fastfood', 'fastfood', 'fastfood', 'fastfood'];
  if (L % 3 === 0) return ['condo', 'condo', 'condo', 'condo'];
  return Array(7).fill('office');
}
function tryFloor() {
  const L = top + 1;
  if (L > 28) return false;
  let cost = W * 500;
  const row = rowFor(L);
  for (const t of row) cost += FAC[t].cost;
  if (g.funds < cost + 150000) return false;
  g.buildFloor(X0, X1 - 1, L);
  let x = X0;
  for (const t of row) { const r = g.build(t, x, L); x += FAC[t].w; }
  top = L;
  for (const s of g.shafts()) if (s.kind === 'elevator' && s.top < top + 1 && s.top - s.bottom < 29) g.resizeShaft(s.id, s.bottom, Math.min(top + 1, s.bottom + 29));
  return true;
}
let lastStar = 1;
for (let day = 0; day < DAYS; day++) {
  // morning decisions at 04:00
  while (dayTick(g.t) !== clockToTick(4, 0)) g.step();
  if (!g.shafts().length && g.funds > 260000) g.buildTransport('elevator', shaftXs[0], 0, Math.max(2, top + 1));
  if (g.shafts().length === 1 && top >= 8 && g.funds > 400000) g.buildTransport('elevator', shaftXs[1], 0, top + 1);
  // add cars where queues peaked
  for (const s of g.shafts()) if ((peak.get(s.id) || 0) > 25 && s.cars.length < 8 && g.funds > 200000) g.addCar(s.id, s.bottom + s.cars.length * 3 % (s.top - s.bottom));
  peak.clear();
  if (g.star >= 2 && g.facsOf('security').length < 2 && g.funds > 250000) { g.buildFloor(X0, X1 - 1, top + 1); if (g.build('security', X0, top + 1).ok) { g.build('security', X0 + 16, top + 1); top++; } }
  if (g.star >= 2 && !g.facsOf('service' === 'x').length && g.facsOf('housekeeping').length && !g.shafts().some(s => s.kind === 'service') && g.funds > 200000) g.buildTransport('service', X0 + 60, 1, Math.min(29, top));
  for (let k = 0; k < 3; k++) if (!tryFloor()) break;
  for (let i = 0; i < DAY_TICKS; i++) { g.step(); if (i % 13 === 0) for (const s of g.shafts()) peak.set(s.id, Math.max(peak.get(s.id) || 0, s.totalWaiting())); }
  if (day % 5 === 4 || g.star !== lastStar) console.log(`day ${g.dateDay} star=${g.star} pop=${g.pop.total} (perm ${g.pop.perm}) funds=$${Math.round(g.funds / 1000)}k floors=${top} shafts=${g.shafts().map(s => s.cars.length).join('/')} unmet=${g.demands.filter(d => !d.met).map(d => d.key)}`);
  lastStar = g.star;
}
console.log(log.join('\n'));
