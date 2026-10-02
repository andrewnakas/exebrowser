// Skyrise browser test: drives the real UI with mouse input in headless Chrome.
// Needs puppeteer-core installed OUTSIDE the repo, e.g. in a scratch directory:
//   mkdir /tmp/pt && cd /tmp/pt && npm i puppeteer-core && cp <this file> . && \
//   (cd <repo>/public && python3 -m http.server 8765 &) && \
//   CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" node browser-ui.mjs
// Checks: building via the toolbar, running fast, pause freezes state and the frame,
// inspect + lift panel + preview, overlays pause, save/load, and zero console errors.
import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new' });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });
const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()); });
await page.goto('http://localhost:8765/apps/skyrise/', { waitUntil: 'networkidle0' });
await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
await page.reload({ waitUntil: 'networkidle0' });
await page.click('#wNew');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
// screen coords of a world cell (unit x, level L) relative to the page
const at = (ux, L) => page.evaluate((ux, L) => { const a = window.skyrise, R = a.renderer; const cv = document.getElementById('view').getBoundingClientRect(); const s = R.toScreen(ux * 8, (103 + 8 - L) * 36 + 18); return { x: s.x + cv.left, y: s.y + cv.top }; }, ux, L);
const drag = async (a, b) => { await page.mouse.move(a.x, a.y); await page.mouse.down(); for (let i = 1; i <= 8; i++) await page.mouse.move(a.x + (b.x - a.x) * i / 8, a.y + (b.y - a.y) * i / 8); await page.mouse.up(); await sleep(50); };
const click = async (p) => { await page.mouse.click(p.x, p.y); await sleep(50); };
await page.evaluate(() => window.skyrise.setSpeed(0));
// 1. lobby by dragging along the ground (tool is preselected)
await drag(await at(182, 0), await at(222, 0));
// 2. offices by clicking (Office button)
const toolBtn = async (label) => { const bs = await page.$$('#toolbar .tool'); for (const b of bs) { const t = await b.evaluate(e => e.textContent); if (t.includes(label)) { await b.click(); await sleep(60); return b; } } throw new Error('no tool ' + label); };
await toolBtn('Office');
for (const L of [1, 2, 3]) for (const x of [184.5, 193.5, 211.5, 220.5]) await click(await at(x, L));
// 3. a lift via the Lifts flyout, dragged from the lobby to floor 5
await toolBtn('Lifts');
const fly = await page.$$('#flyout button'); await fly[0].click(); await sleep(60);
await drag(await at(202, 0), await at(202, 4));
// 4. click the shaft to add a car
await click(await at(202, 2));
// 5. stairs from the build group
await toolBtn('Build'); const fly2 = await page.$$('#flyout button'); await fly2[2].click(); await sleep(60);
await click(await at(196, 0));
// 5b. bare floor across each storey so every office joins the lift's walkway
await toolBtn('Build'); const fly3 = await page.$$('#flyout button'); await fly3[1].click(); await sleep(60);
for (const L of [1, 2, 3, 4]) await drag(await at(180.5, L), await at(222.5, L));
const st = await page.evaluate(() => { const g = window.skyrise.game; return { facs: [...g.tower.facs.values()].map(f => f.type).reduce((a, t) => (a[t] = (a[t] || 0) + 1, a), {}), shafts: g.shafts().map(s => [s.bottom, s.top, s.cars.length]), funds: g.funds }; });
console.log('built via UI:', JSON.stringify(st));
await page.screenshot({ path: (process.env.OUT || '.') + '/10-ui-built.png' });
// 6. run very fast for a few seconds
await page.click('#speed button[data-speed="8"]');
await sleep(9000);
const run = await page.evaluate(() => { const g = window.skyrise.game; return { t: g.t, clock: document.getElementById('clock').textContent, pop: g.pop.total, movers: g.movers.size, waiting: g.shafts().reduce((a, s) => a + s.totalWaiting(), 0), occupied: [...g.tower.facs.values()].filter(f => f.occupied).length }; });
console.log('after running:', JSON.stringify(run));
// 7. pause freezes everything
await page.click('#speed button[data-speed="0"]');
await sleep(200);
const snap = () => page.evaluate(() => { const g = window.skyrise.game; return JSON.stringify([g.t, g.shafts().map(s => s.cars.map(c => [c.pos, c.prev])), [...g.movers].map(p => [p.id, p.x, p.L]), g.weather]); });
const s1 = await snap(); const img1 = await page.screenshot({ encoding: 'base64' });
await sleep(1500);
const s2 = await snap(); const img2 = await page.screenshot({ encoding: 'base64' });
console.log('pause: state frozen =', s1 === s2, ', frame identical =', img1 === img2);
// 8. inspect a car / open the lift panel / preview
await toolBtn('Inspect');
await click(await at(202, 3));
await sleep(100);
const panelTitle = await page.evaluate(() => document.querySelector('#panel h2') && document.querySelector('#panel h2').textContent);
console.log('inspect opened:', panelTitle);
const pv = await page.$('#pv');
if (pv) { await pv.click(); await sleep(1500); await page.screenshot({ path: (process.env.OUT || '.') + '/11-preview.png' }); await page.click('#previewEnd'); await sleep(100); }
else { const ctl = await page.$('#ctl'); if (ctl) { await ctl.click(); await sleep(100); await (await page.$('#pv')).click(); await sleep(1500); await page.screenshot({ path: (process.env.OUT || '.') + '/11-preview.png' }); await page.click('#previewEnd'); } }
console.log('after preview speed', await page.evaluate(() => window.skyrise.speed), 'preview off', await page.evaluate(() => !window.skyrise.preview));
// 9. overlays
await page.click('#overlays button[data-ov="eval"]'); await sleep(200);
await page.screenshot({ path: (process.env.OUT || '.') + '/12-overlay.png' });
console.log('overlay pauses:', await page.evaluate(() => window.skyrise.speed === 0));
await page.click('#overlays button[data-ov="none"]');
// 10. save / load via the menu
await page.click('#menuBtn'); await sleep(100); await page.click('#mSave'); await sleep(100);
const saved = await page.evaluate(() => { try { return (localStorage.getItem('skyrise.save.v1') || '').length; } catch (e) { return -1; } });
await page.click('#menuBtn'); await sleep(100); await page.click('#mLoad'); await sleep(200);
console.log('save bytes', saved, 'reloaded facs', await page.evaluate(() => window.skyrise.game.tower.facs.size));
await page.click('#finBtn'); await sleep(100); await page.screenshot({ path: (process.env.OUT || '.') + '/13-finance.png' });
console.log('ERRORS', errors);
await browser.close();
if (errors.length) process.exit(1);
