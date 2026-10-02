// Parkhaven - application bootstrap: game loop, saving and loading, events to sound and effects.
import { Game } from './sim.js';
import { Renderer } from './gfx/renderer.js';
import { UI, money } from './ui.js';
import { Input } from './input.js';
import { Audio } from './audio.js';
import { MONTH_NAMES } from './data.js';

const KEY = 'parkhaven.v3.';
function lsGet(k) { try { return localStorage.getItem(KEY + k); } catch (e) { return null; } }
function lsSet(k, v) { try { localStorage.setItem(KEY + k, v); return true; } catch (e) { return false; } }

class App {
  constructor() {
    this.speed = 1; this.lastSpeed = 1; this.edgePan = false;
    this.audio = new Audio();
    this.ui = new UI(this);
    const o = (() => { try { return JSON.parse(lsGet('options') || '{}'); } catch (e) { return {}; } })();
    if (o.sfx != null) this.audio.sfx = o.sfx;
    if (o.music != null) this.audio.music = o.music;
    this.edgePan = !!o.edgePan;
  }
  start() {
    const canvas = document.getElementById('gl');
    const overlay = document.getElementById('ov');
    try { this.renderer = new Renderer(canvas, overlay); }
    catch (e) {
      document.getElementById('fatal').style.display = 'flex';
      document.getElementById('fatal').querySelector('p').textContent = 'Parkhaven needs WebGL 2, which this browser or device does not provide. ' + (e.message || '');
      return;
    }
    this.renderer.resize();
    window.addEventListener('resize', () => this.renderer.resize());
    this.ui.init();
    this.input = new Input(this, overlay);
    // start on a sandbox world behind the menu so the title screen has a park to look at
    const auto = lsGet('auto');
    let loaded = false;
    if (auto) { try { this.setGame(Game.load(JSON.parse(auto))); loaded = true; } catch (e) { loaded = false; } }
    if (!loaded) this.setGame(Game.create('willowmere'));
    this.ui.newGameModal(true);
    this.setSpeed(1);
    this.last = performance.now();
    this.acc = 0;
    requestAnimationFrame((t) => this.frame(t));
    window.parkhaven = this; // handy for debugging and automated tests
  }
  setGame(g) {
    this.game = g;
    g.speed = this.speed;
    this.renderer.setGame(g);
    const gate = g.w.gate;
    Object.assign(this.renderer.cam, { x: gate.x + 0.5, y: gate.y - 6, zoom: Math.min(48, Math.max(26, window.innerWidth / 26)) });
    for (const [k] of this.ui.wins) this.ui.close(k);
    this.ui.setTool('inspect');
    this.ui.lastNotice = g.noticeSeq - 1;
    this.ui.updateHud();
  }
  newGame(id) {
    this.setGame(Game.create(id));
    this.ui.toast('Lay some paths and build your first ride!');
    if (window.innerWidth >= 720) this.ui.helpWindow();
  }
  setSpeed(s) {
    if (s) this.lastSpeed = s;
    this.speed = s;
    if (this.game) this.game.speed = s;
    this.ui.updateHud();
  }
  setVolumes(s, m) { this.audio.setVolumes(s, m); this.saveOptions(); }
  saveOptions() { lsSet('options', JSON.stringify({ sfx: this.audio.sfx, music: this.audio.music, edgePan: this.edgePan })); }

  slotInfo() {
    const out = [];
    for (const id of ['auto', '1', '2', '3']) {
      const meta = lsGet('meta.' + id);
      out.push({ id, label: id === 'auto' ? 'Autosave' : `Slot ${id}`, info: meta || '' });
    }
    return out;
  }
  saveSlot(id) {
    try {
      const data = JSON.stringify(this.game.save());
      const g = this.game;
      const meta = `${g.parkName}, ${g.day} ${MONTH_NAMES[g.month]} Y${g.year}, ${money(g.cash, 0)}`;
      if (!lsSet(id, data)) { this.ui.toast('Could not save: browser storage is full or blocked.', true); return false; }
      lsSet('meta.' + id, meta);
      if (id !== 'auto') this.ui.toast('Park saved.');
      return true;
    } catch (e) { this.ui.toast('Could not save the park.', true); return false; }
  }
  loadSlot(id) {
    const raw = lsGet(id);
    if (!raw) { this.ui.toast('That slot is empty.', true); return; }
    try { this.setGame(Game.load(JSON.parse(raw))); this.ui.toast('Park loaded.'); this.ui.closeModal(); }
    catch (e) { this.ui.toast('That save could not be loaded.', true); }
  }

  frame(t) {
    const dt = Math.min(0.1, (t - this.last) / 1000);
    this.last = t;
    const g = this.game;
    const modalOpen = document.getElementById('modal').style.display === 'flex';
    if (this.speed > 0 && g && !modalOpen) {
      this.acc += dt * 40 * this.speed;
      let n = Math.floor(this.acc);
      this.acc -= n;
      const budget = performance.now() + 22;
      for (let i = 0; i < n; i++) {
        g.step();
        if ((i & 7) === 7 && performance.now() > budget) { this.acc = 0; break; }
      }
    }
    this.handleEvents();
    this.input.frame(dt);
    this.ui.frame();
    this.renderer.draw(dt, this.ui.uiState());
    if (!this.hudT || t - this.hudT > 200) { this.hudT = t; this.ui.updateHud(); this.ambient(); }
    this.audio.tick();
    requestAnimationFrame((tt) => this.frame(tt));
  }

  ambient() {
    const g = this.game;
    this.audio.setRain(this.speed ? g.weather.cur.level : 0);
    const c = this.renderer.cam;
    let near = 0;
    for (const r of g.rides) {
      if (!r.music || r.status !== 'open') continue;
      const d = Math.hypot(r.x + 1.5 - c.x, r.y + 1.5 - c.y);
      near = Math.max(near, Math.max(0, 1 - d / 14) * Math.min(1, c.zoom / 30));
    }
    this.audio.setMusic(this.speed ? near : 0);
  }

  handleEvents() {
    const g = this.game;
    const ev = g.events;
    if (!ev.length) return;
    g.events = [];
    const R = this.renderer;
    const visible = (x, y) => { const [sx, sy] = R.project(x, y, 0); return sx > -50 && sy > -50 && sx < R.W + 50 && sy < R.H + 50; };
    for (const e of ev) {
      switch (e.type) {
        case 'money': if (visible(e.x, e.y)) { R.addFloater(e.x, e.y, e.z, `+${money(e.amount)}`); if (R.cam.zoom > 22) this.audio.play('money'); } break;
        case 'notice': if (e.notice.kind === 'bad' || e.notice.kind === 'warn') this.audio.play('bad'); else this.audio.play('notice'); break;
        case 'thunder': R.flash = 0.8; this.audio.play('thunder'); break;
        case 'vomit': if (visible(e.x, e.y)) this.audio.play('vomit'); break;
        case 'flush': if (visible(e.x, e.y)) this.audio.play('flush'); break;
        case 'laugh': if (visible(e.x, e.y)) this.audio.play('laugh'); break;
        case 'fixing': if (visible(e.x, e.y)) this.audio.play('fix'); break;
        case 'month': this.saveSlot('auto'); break;
        case 'won': this.audio.play('fanfare'); this.ui.endModal(true); break;
        case 'lost': this.ui.endModal(false, e.why); break;
        default: break;
      }
    }
  }
}

const app = new App();
window.addEventListener('DOMContentLoaded', () => app.start());
