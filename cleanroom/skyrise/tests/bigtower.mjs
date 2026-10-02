// Builds a large mixed tower with every facility type and runs it, reporting health and speed.
import { Game } from '../../../public/apps/skyrise/js/game.js';
import * as E from '../../../public/apps/skyrise/js/events.js';
import { DAY_TICKS, clockString, dayTick } from '../../../public/apps/skyrise/js/clock.js';
import { FAC } from '../../../public/apps/skyrise/js/data.js';

const g = new Game(42); g.funds = 5e8; g.star = 5;
const fails = {};
const must = (r, w) => { if (!r.ok) fails[w + ': ' + r.reason] = (fails[w + ': ' + r.reason] || 0) + 1; return r; };
const X0 = 120, X1 = 280;
for (let x = X0; x < X1; x += 4) must(g.build('lobby', x, 0), 'lobby');
for (let L = 1; L <= 44; L++) g.buildFloor(X0, X1 - 1, L);
for (let L = -1; L >= -10; L--) g.buildFloor(X0, X1 - 1, L);
// sky lobby at floor 15 and 30
for (const L of [14, 29]) for (let x = X0; x < X1; x += 4) must(g.build('lobby', x, L, { replace: true }), 'skylobby');
// lift banks: locals 1-15, 15-30, 30-44; express 1-30; service 1-44
const bank = (b, t, xs) => xs.forEach(x => { const s = must(g.buildTransport('elevator', x, b, t), 'lift ' + b).o; if (s) for (let i = 0; i < 5; i++) g.addCar(s.id, b + i * 2); });
bank(0, 13, [150, 160, 240, 250]);
bank(14, 28, [170, 230]);
bank(29, 43, [180, 220]);
{ const s = must(g.buildTransport('express', 195, -10, 29), 'express').o; if (s) for (let i = 0; i < 5; i++) g.addCar(s.id, 0); }
{ const s = must(g.buildTransport('express', 205, 0, 29), 'express2').o; if (s) for (let i = 0; i < 5; i++) g.addCar(s.id, 0); }
must(g.buildTransport('service', 130, 1, 30), 'service');
must(g.buildTransport('service', 270, 14, 43), 'service2');
// floors 2-6 retail/food with escalators
const row = (L, types) => { let x = X0; for (const t of types) { const w = FAC[t].w; if (x + w > X1) break; must(g.build(t, x, L), t + '@' + L); x += w; } };
row(1, ['fastfood', 'shop', 'shop', 'restaurant', 'fastfood', 'shop', 'shop', 'fastfood', 'shop']);
row(2, ['restaurant', 'shop', 'fastfood', 'clinic', 'shop', 'shop', 'security', 'shop']);
row(3, ['cinema', 'party', 'shop', 'fastfood', 'restaurant', 'shop']);
for (let L = 5; L <= 13; L++) row(L, Array(17).fill('office'));
for (let L = 15; L <= 27; L++) row(L, L % 3 ? Array(17).fill('office') : ['security', 'clinic', ...Array(12).fill('office')]);
for (let L = 30; L <= 36; L++) row(L, Array(10).fill('condo'));
for (let L = 37; L <= 42; L++) row(L, ['housekeeping', ...Array(8).fill('single'), ...Array(6).fill('twin'), 'suite', 'suite', 'suite']);
row(43, ['recycling', 'recycling', 'recycling', 'recycling', 'recycling', 'recycling']);
for (let x = X0 + 30; x < X0 + 30 + 4 * 20; x += 4) for (let L = -1; L >= -3; L--) must(g.build('parkspace', x, L), 'space');
for (let L = -1; L >= -3; L--) must(g.build('parkramp', X0 + 14, L), 'ramp');
row(-4, ['fastfood', 'shop', 'shop', 'fastfood', 'restaurant', 'shop', 'shop']);
must(g.build('transit', 150, -10), 'transit');
for (const t of [[0, 1], [1, 2], [2, 3]]) must(g.buildTransport('escalator', 262, t[0], t[1]), 'esc');
for (let L = -1; L >= -4; L--) must(g.buildTransport('stairs', 262, L, L + 1), 'stairs');
console.log('build failures', fails);
console.log('facilities', g.tower.facs.size, 'shafts', g.shafts().length, 'funds', g.funds);
let worst = 0;
for (let day = 0; day < 12; day++) {
  const t0 = Date.now();
  for (let i = 0; i < DAY_TICKS; i++) { const a = performance.now(); g.step(); worst = Math.max(worst, performance.now() - a); }
  if (day === 6) E.startFire(g);
  const occ = [...g.tower.facs.values()].filter(f => f.occupied || f.open).length;
  const hotel = g.hotelRooms(); const hs = {}; for (const r of hotel) hs[r.hstate] = (hs[r.hstate] || 0) + 1;
  console.log(`day ${g.dateDay} ${Date.now() - t0}ms people=${g.people.size} pop=${g.pop.total}/${g.pop.perm} occ=${occ} funds=${(g.funds / 1e6).toFixed(1)}M rooms=${JSON.stringify(hs)} demands=${g.demands.filter(d => !d.met).map(d => d.key)} fire=${!!g.fire} vip=${g.flags.vipOk}`);
}
console.log('worst tick ms', worst.toFixed(1));
const json = JSON.stringify(g.serialize());
console.log('save size KB', (json.length / 1024).toFixed(0));
const h = Game.load(JSON.parse(json));
for (let i = 0; i < DAY_TICKS; i++) h.step();
console.log('reloaded ok, pop', h.pop.total);
