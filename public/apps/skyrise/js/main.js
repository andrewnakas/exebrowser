// Skyrise — boot, main loop, save/load.
import { Game } from './game.js';
import { Renderer, GROUND_Y } from './render.js';
import { Sound } from './audio.js';
import { UI } from './ui.js';
import { FAC } from './data.js';
import { clockMinutes, dayTick } from './clock.js';
import { U, FH } from './art.js';

const TICK_MS = 70;
const KEY_SAVE = 'skyrise.save.v1', KEY_AUTO = 'skyrise.auto.v1', KEY_OPT = 'skyrise.options.v1';

function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); return true; } catch (e) { return v === undefined ? null : false; } }

const app = {
  game: null, renderer: null, sound: new Sound(), ui: null, speed: 1, lastSaveOk: true,
  setSpeed(s, silent) { this.speed = s; if (!silent && this.ui && this.ui.pausedBy === 'overlay' && s > 0) { this.ui.pausedBy = null; this.ui.setOverlay('none'); } if (s === 0) this.sound.setRain(false); },
  togglePause() { if (this.speed > 0) { this.prevSpeed = this.speed; this.setSpeed(0); } else this.setSpeed(this.prevSpeed || 1); },
  attach(g) {
    this.game = g;
    g.on((t, d) => this.ui && this.ui.onGameEvent(t, d));
    if (this.ui) { this.ui.buildToolbar(); this.ui.toolOptions(); }
    // look at the tower
    const T = g.tower;
    const cx = T.span.minX < T.span.maxX ? (T.span.minX + T.span.maxX) / 2 * U : 200 * U;
    this.renderer.centerOn(cx, GROUND_Y - Math.min(6, Math.max(2, T.span.maxL / 2)) * FH);
  },
  newGame() { this.attach(new Game((Math.random() * 1e9) | 0)); this.setSpeed(1); this.ui.setTool('lobby'); },
  save(slot) {
    try { const ok = store(slot === 'auto' ? KEY_AUTO : KEY_SAVE, JSON.stringify(this.game.serialize())); this.lastSaveOk = !!ok; return ok; } catch (e) { this.lastSaveOk = false; return false; }
  },
  autosave() { this.save('auto'); },
  load(slot) {
    const raw = slot === 'auto' ? (store(KEY_AUTO) || store(KEY_SAVE)) : (store(KEY_SAVE) || store(KEY_AUTO));
    if (!raw) return false;
    try { this.attach(Game.load(JSON.parse(raw))); this.setSpeed(1); return true; } catch (e) { console.warn('load failed', e); return false; }
  },
  startPreview(sid) {
    const was = this.speed > 0 ? this.speed : (this.ui.resumeModal || 1);
    this.setSpeed(0, true);
    let clone;
    try { clone = this.game.cloneForPreview(); } catch (e) { console.warn(e); this.ui.hint('Preview is not available right now.', true); return; }
    this.preview = { game: clone, sid, ticks: 0, max: 520, resume: was };
    this.renderer.focus = sid;
    const s = clone.tower.trans.get(sid);
    if (s) this.renderer.centerOn(s.cx * U, (103 + 8 - (s.bottom + s.top) / 2) * FH);
    const b = document.getElementById('previewBar');
    b.classList.remove('hidden');
  },
  endPreview() {
    if (!this.preview) return;
    const r = this.preview.resume;
    this.preview = null; this.renderer.focus = null;
    document.getElementById('previewBar').classList.add('hidden');
    this.setSpeed(r || 1);
  },
  saveOptions() { store(KEY_OPT, JSON.stringify({ people: this.renderer.flags.people, detail: this.renderer.flags.detail, snd: this.sound.on })); },
  layout() {
    const st = document.getElementById('stage');
    const r = st.getBoundingClientRect();
    this.renderer.resize(Math.max(50, r.width), Math.max(50, r.height), Math.min(2, window.devicePixelRatio || 1));
  },
};

function boot() {
  app.renderer = new Renderer(document.getElementById('view'));
  app.renderer.sound = app.sound;
  try { const o = JSON.parse(store(KEY_OPT) || 'null'); if (o) { app.renderer.flags.people = o.people !== false; app.renderer.flags.detail = o.detail !== false; Object.assign(app.sound.on, o.snd || {}); } } catch (e) { }
  app.layout();
  app.game = new Game(1);
  app.ui = new UI(app);
  app.attach(app.game);
  window.addEventListener('resize', () => app.layout());
  document.getElementById('previewEnd').onclick = () => app.endPreview();
  const hasSave = !!store(KEY_AUTO) || !!store(KEY_SAVE);
  if (window.innerWidth < 640) { document.getElementById('mini').classList.add('collapsed'); document.getElementById('miniToggle').textContent = '▸'; app.renderer.zoomAt(app.renderer.vw / 2, app.renderer.vh / 2, 0.6); app.attach(app.game); }
  app.ui.welcome(hasSave);
  // loop
  let last = performance.now(), acc = 0, anim = 0, alpha = 0, ambT = 0, ambCue = 0;
  const mini = document.getElementById('minimap');
  const mc = mini.getContext('2d');
  let miniT = 0;
  function frame(now) {
    const dt = Math.min(250, now - last); last = now;
    let g = app.game;
    if (app.preview) {
      const P = app.preview;
      g = P.game;
      if (P.ticks < P.max) { const n = Math.min(6, P.max - P.ticks); for (let i = 0; i < n; i++) g.step(); P.ticks += n; anim += 6; alpha = 1; }
      const s = g.tower.trans.get(P.sid);
      document.getElementById('previewInfo').textContent = 'Preview ' + Math.round(P.ticks / P.max * 100) + '% · ' + (s ? s.totalWaiting() + ' waiting at this shaft' : '') + ' · ' + clockStr(g);
    } else if (app.speed > 0 && !g.gameOver) {
      acc += dt * app.speed;
      let n = Math.floor(acc / TICK_MS);
      if (n > 400) { n = 400; acc = 0; }
      acc -= n * TICK_MS;
      const t0 = performance.now();
      for (let i = 0; i < n; i++) { g.step(); if (performance.now() - t0 > 30) { acc = 0; break; } }
      anim += dt * app.speed / TICK_MS;
      alpha = Math.min(1, acc / TICK_MS);
      app.sound.setRain(g.weather.rain);
    }
    app.renderer.draw(g, alpha, anim);
    app.ui.updateBar();
    if (now - miniT > 250) {
      miniT = now;
      const r = mini.getBoundingClientRect();
      if (r.width) { if (mini.width !== Math.round(r.width)) { mini.width = Math.round(r.width); mini.height = Math.round(r.height); } app.renderer.drawMini(mc, g, mini.width, mini.height, app.renderer.overlay); }
    }
    // ambience: one quiet cue every half second, chosen among what is on screen weighted by area
    if (app.speed > 0 && now - ambT > 500) { ambT = now; ambience(g); }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  window.skyrise = app; // handy for debugging and tests
}

function clockStr(g) { const m = Math.floor(clockMinutes(dayTick(g.t))); return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); }
function ambience(g) {
  if (!app.sound.ready || !app.sound.on.ambience) return;
  const R = app.renderer;
  const v0 = R.toWorld(0, 0), v1 = R.toWorld(R.vw, R.vh);
  const m = clockMinutes(dayTick(g.t));
  const pool = [];
  let total = 0;
  const kindOf = (f) => {
    if (f.type === 'office' && f.occupied && (f.here || []).length) return 'office';
    if (f.type === 'fastfood' && g.isOpenNow(f)) return 'fastfood';
    if (f.type === 'restaurant' && g.isOpenNow(f)) return 'restaurant';
    if (f.type === 'party' && f.partying) return 'party';
    if (f.type === 'cinema' && f.showing) return 'cinema';
    if (f.type === 'condo' && f.occupied && (f.here || []).length) return 'condo';
    if (FAC[f.type] && FAC[f.type].hotel && f.hstate === 'occupied') return 'hotel';
    if (f.type === 'parkramp') return 'parking';
    return null;
  };
  for (const f of g.tower.facs.values()) {
    const x0 = f.x * U, x1 = (f.x + f.w) * U;
    if (x1 < v0.x || x0 > v1.x) continue;
    const k = kindOf(f);
    if (!k) continue;
    const a = f.w * f.h;
    total += a; pool.push([k, a]);
  }
  // time-of-day and weather cues compete too
  const tod = m >= 330 && m < 480 ? 'birds' : (m >= 1260 || m < 300) ? 'crickets' : 'traffic';
  pool.push([tod, 40]); total += 40;
  if (g.weather.rain) { pool.push(['wind', 20]); total += 20; }
  let r = Math.random() * total;
  for (const [k, a] of pool) { r -= a; if (r <= 0) { if (Math.random() < 0.6) app.sound.ambient(k); break; } }
}

boot();
