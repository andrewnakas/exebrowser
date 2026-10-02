// Parkhaven - DOM user interface: HUD, toolbar, windows, tools and the track builder.
import {
  FLAT_RIDES, TRACK_RIDES, STALLS, ITEMS, ADDONS, SCENERY, STAFF, FIN, FIN_NAMES, RESEARCH_FUNDING,
  RESEARCH_LIST, RESEARCH_CATS, RESEARCH_CAT_NAMES, CAMPAIGNS, THOUGHTS, WEATHER, MONTH_NAMES, BREAKDOWNS,
} from './data.js';
import * as Rides from './rides.js';
import * as Build from './build.js';
import * as StaffM from './staff.js';
import { guestStatus, moodOf } from './guests.js';
import { PIECES, choosePiece, pieceFootprint } from './track.js';
import { MB } from './gfx/gl.js';
import * as M from './gfx/models.js';
import { ratingLabel } from './ratings.js';
import { SCENARIOS } from './scenario.js';
import { DX, DY } from './world.js';

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const money = (c, dp = 2) => `${c < 0 ? '-' : ''}${(Math.abs(c) / 100).toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp })} cr`;
const rt = (v) => (v == null ? '-' : (v / 100).toFixed(2));
const pct = (n) => `${Math.round(n)}%`;
const avg = (a) => (a && a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

const ICONS = {
  inspect: '<path d="M5 3l12 9-5 1 3 6-2 1-3-6-4 4z"/>',
  path: '<path d="M4 20L9 4h6l5 16H4zm7-14v3m0 3v3m0 3v2" fill="none" stroke="currentColor" stroke-width="2"/>',
  queue: '<path d="M4 6h14v4H6v4h12v4H4" fill="none" stroke="currentColor" stroke-width="2.4"/>',
  rides: '<circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 4v16M4 12h16M6.3 6.3l11.4 11.4M17.7 6.3L6.3 17.7" stroke="currentColor" stroke-width="1.4"/>',
  scenery: '<path d="M12 2l6 9h-3l4 6H5l4-6H6z"/><rect x="11" y="17" width="2" height="5"/>',
  land: '<path d="M2 19l6-8 4 5 3-4 7 7z"/>',
  bulldoze: '<path d="M3 15h11l3-5h3v8H3z"/><circle cx="7" cy="19" r="2"/><circle cx="16" cy="19" r="2"/>',
  staff: '<circle cx="12" cy="7" r="4"/><path d="M4 21c0-5 4-8 8-8s8 3 8 8z"/>',
  guests: '<circle cx="8" cy="8" r="3"/><circle cx="16" cy="8" r="3"/><path d="M2 20c0-4 3-6 6-6s6 2 6 6zm10 0c0-3 1-5 4-6 3 0 6 2 6 6z"/>',
  park: '<path d="M3 21V9l9-6 9 6v12h-6v-7H9v7z"/>',
  money: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M15 8.5c-1-1-5-1.5-5.5.8C9 12 15 11 14.6 14c-.4 2.5-4.6 2-5.8 1M12 5.5v13" fill="none" stroke="currentColor" stroke-width="1.8"/>',
  research: '<path d="M9 3h6v2h-1v5l5 9c.5 1-.2 2-1.2 2H6.2c-1 0-1.7-1-1.2-2l5-9V5H9z"/>',
  menu: '<path d="M4 6h16v2H4zm0 5h16v2H4zm0 5h16v2H4z"/>',
};
const ROT_L = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M5 12a7 7 0 1 0 2.1-5"/><path d="M4 4v4h4"/></svg>';
const ROT_R = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M19 12a7 7 0 1 1-2.1-5"/><path d="M20 4v4h-4"/></svg>';
const icon = (k) => `<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">${ICONS[k] || ''}</svg>`;

export class UI {
  constructor(app) {
    this.app = app;
    this.tool = 'inspect'; this.arg = null; this.rot = 0;
    this.wins = new Map();
    this.builder = null;
    this.hoverTile = null;
    this.drag = null;
    this.selectedGuest = null; this.selectedStaff = null;
    this.follow = null;
    this.lastNotice = 0;
    this.narrow = window.innerWidth < 720;
    this.zTop = 10;
  }
  get game() { return this.app.game; }
  get r() { return this.app.renderer; }

  // ================================================================== layout
  init() {
    const hud = $('#hud');
    hud.innerHTML = `
      <div class="hcell" id="h-cash" title="Cash"></div>
      <div class="hcell" id="h-date" title="Date"></div>
      <div class="hcell" id="h-rating" title="Park rating"><span class="lbl">Rating</span> <b id="h-rv"></b><span class="bar"><i id="h-rb"></i></span></div>
      <div class="hcell" id="h-guests" title="Guests in the park"></div>
      <div class="hcell" id="h-weather" title="Weather"></div>
      <div class="speeds" role="group" aria-label="Game speed">
        <button data-speed="0" title="Pause (Space)">&#10073;&#10073;</button>
        <button data-speed="1" title="Normal speed (1)">1&times;</button>
        <button data-speed="2" title="Fast (2)">2&times;</button>
        <button data-speed="4" title="Faster (3)">4&times;</button>
        <button data-speed="8" title="Fastest (4)">8&times;</button>
      </div>
      <div class="cam"><button data-cam="rl" title="Rotate view (Q)">${ROT_L}</button><button data-cam="rr" title="Rotate view (E)">${ROT_R}</button></div>
      <button class="hbtn" id="h-notices" title="Notices">&#128276;<span id="h-unread"></span></button>`;
    hud.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      this.app.audio.play('click');
      if (b.dataset.speed != null) this.app.setSpeed(+b.dataset.speed);
      else if (b.dataset.cam) this.rotate(b.dataset.cam === 'rl' ? -1 : 1);
      else if (b.id === 'h-notices') this.noticesWindow();
    });
    const tools = [
      ['inspect', 'Look', 'inspect'], ['path', 'Path', 'path'], ['queue', 'Queue', 'queue'], ['rides', 'Rides', 'rides'],
      ['scenery', 'Scenery', 'scenery'], ['land', 'Land', 'land'], ['bulldoze', 'Clear', 'bulldoze'], ['staff', 'Staff', 'staff'],
      ['guests', 'Guests', 'guests'], ['park', 'Park', 'park'], ['money', 'Money', 'money'], ['research', 'Research', 'research'], ['menu', 'Menu', 'menu'],
    ];
    const tb = $('#toolbar');
    tb.innerHTML = tools.map(([k, label, ic]) => `<button data-tb="${k}" title="${label}">${icon(ic)}<span>${label}</span></button>`).join('');
    tb.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      this.app.audio.unlock(); this.app.audio.play('click');
      const k = b.dataset.tb;
      if (k === 'inspect') this.setTool('inspect');
      else if (k === 'path') this.setTool('path');
      else if (k === 'queue') this.setTool('queue');
      else if (k === 'rides') this.buildWindow();
      else if (k === 'scenery') this.sceneryWindow();
      else if (k === 'land') this.landWindow();
      else if (k === 'bulldoze') this.setTool('bulldoze');
      else if (k === 'staff') this.staffWindow();
      else if (k === 'guests') this.guestsWindow();
      else if (k === 'park') this.parkWindow();
      else if (k === 'money') this.financeWindow();
      else if (k === 'research') this.researchWindow();
      else if (k === 'menu') this.menuWindow();
    });
    $('#ticker').addEventListener('click', () => {
      const n = this.game.notices[0];
      if (n && n.subject && n.subject.kind === 'ride' && this.game.ride(n.subject.id)) { this.openRide(n.subject.id); this.centerOnRide(this.game.ride(n.subject.id)); }
      else this.noticesWindow();
    });
    const wl = $('#windows');
    wl.addEventListener('click', (e) => this.onWinClick(e));
    wl.addEventListener('change', (e) => this.onWinChange(e));
    wl.addEventListener('input', (e) => this.onWinInput(e));
    window.addEventListener('resize', () => { this.narrow = window.innerWidth < 720; });
    setInterval(() => this.refresh(), 500);
    this.setTool('inspect');
  }

  // ================================================================== HUD
  updateHud() {
    const g = this.game;
    if (!g) return;
    const cash = $('#h-cash');
    cash.textContent = money(g.cash, 0);
    cash.classList.toggle('neg', g.cash < 0);
    $('#h-date').textContent = `${g.day} ${MONTH_NAMES[g.month]} Y${g.year}`;
    $('#h-rv').textContent = g.rating;
    $('#h-rb').style.width = `${Math.round(g.rating / 10)}%`;
    $('#h-rb').style.background = g.rating < 200 ? '#e0523f' : g.rating < 500 ? '#e9b949' : '#4caf6a';
    $('#h-guests').innerHTML = `${icon('guests')}<b>${g.guestsInPark || 0}</b>`;
    const W = WEATHER[g.weather.cur.type];
    const wi = ['&#9728;&#65039;', '&#9925;', '&#9729;&#65039;', '&#127782;&#65039;', '&#127783;&#65039;', '&#9928;&#65039;'][g.weather.cur.type];
    $('#h-weather').innerHTML = `<span class="wi">${wi}</span> ${g.weather.cur.temp}&deg;C<span class="wname"> ${W.name}</span>`;
    for (const b of document.querySelectorAll('[data-speed]')) b.classList.toggle('on', +b.dataset.speed === this.app.speed);
    const n = g.notices[0];
    const tk = $('#ticker');
    if (n) {
      tk.textContent = n.text; tk.className = 'k-' + n.kind; tk.style.display = '';
    } else tk.style.display = 'none';
    const unread = g.noticeSeq - this.lastNotice;
    $('#h-unread').textContent = unread > 0 ? Math.min(99, unread) : '';
  }

  toast(msg, bad = false) {
    const t = $('#toast');
    t.textContent = msg; t.className = bad ? 'show bad' : 'show';
    clearTimeout(this.toastT);
    this.toastT = setTimeout(() => { t.className = ''; }, 2200);
    if (bad) this.app.audio.play('error');
  }

  // ================================================================== tools
  setTool(tool, arg = null) {
    if (this.builder && tool !== 'track' && tool !== 'entrance' && tool !== 'exit') this.closeBuilder();
    this.tool = tool; this.arg = arg;
    this.r && this.r.setGhost(null);
    this.r && this.r.setOverlay(tool.startsWith('land') ? 'land' : this.viewOverlay || null);
    for (const b of document.querySelectorAll('[data-tb]')) b.classList.toggle('on', b.dataset.tb === tool || (tool.startsWith('land') && b.dataset.tb === 'land') || ((tool.startsWith('scen') || tool.startsWith('addon')) && b.dataset.tb === 'scenery'));
    this.hint();
  }

  hint(extra = '') {
    const h = $('#toolhint');
    const touch = matchMedia('(pointer: coarse)').matches;
    const tap = touch ? 'Tap' : 'Click';
    const map = {
      inspect: '',
      path: `${tap} tiles to lay footpath${touch ? '' : ' (drag for a straight run)'} - ${money(Build.PATH_COST, 0)} a tile`,
      queue: `${tap} tiles to lay a queue line. Start it at a ride entrance and lead it out to a footpath.`,
      bulldoze: `${tap} to remove paths, furniture and scenery. ${tap} a ride or stall to demolish it.`,
      placeFlat: `${tap} to place ${this.arg && FLAT_RIDES[this.arg] ? FLAT_RIDES[this.arg].name : ''}. R or the button rotates.`,
      placeStall: `${tap} a tile next to a footpath to place the stall.`,
      trackStart: `${tap} a tile to place the first station piece. R or the button turns it.`,
      entrance: `${tap} a tile beside the ride to place its ENTRANCE.`,
      exit: `${tap} a tile beside the ride to place its EXIT.`,
      'land:raise': `${tap} a tile to raise it one step (${money(2000, 0)}).`,
      'land:lower': `${tap} a tile to lower it one step.`,
      'land:buy': `${tap} or drag over yellow tiles to buy land (${money(this.game ? this.game.sc.landPrice : 0, 0)} each).`,
      'land:rights': `${tap} blue tiles to buy construction rights.`,
      moveStaff: `${tap} a footpath to drop the staff member there.`,
    };
    let text = map[this.tool] ?? '';
    if (this.tool.startsWith('scen:')) text = `${tap}${touch ? '' : ' or drag'} to plant ${SCENERY[this.arg]?.name} (${money(SCENERY[this.arg]?.cost || 0, 0)}).`;
    if (this.tool.startsWith('addon:')) text = `${tap} a footpath to add a ${ADDONS[this.arg]?.name.toLowerCase()} (${money(ADDONS[this.arg]?.cost || 0, 0)}).`;
    if (extra) text = extra;
    const rotBtn = ['placeFlat', 'trackStart'].includes(this.tool) ? ' <button data-hint="rot">Rotate</button>' : '';
    const cancel = this.tool !== 'inspect' ? ' <button data-hint="cancel">Done</button>' : '';
    h.innerHTML = text ? `<span>${esc(text)}</span>${rotBtn}${cancel}` : '';
    h.style.display = text ? '' : 'none';
    h.onclick = (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.hint === 'rot') { this.rot = (this.rot + 1) & 3; this.refreshGhost(); }
      else this.setTool('inspect');
    };
  }

  rotate(dir) {
    const c = this.r.cam;
    c.rot = (c.rot + dir + 4) & 3;
  }

  /** pointer hover from input (CSS px) */
  hover(sx, sy) {
    const p = this.r.pick(sx, sy);
    this.hoverTile = p ? { x: p.tx, y: p.ty, fx: p.x, fy: p.y } : null;
    this.hoverPx = [sx, sy];
    this.refreshGhost();
  }

  highlight() {
    const t = this.hoverTile;
    if (this.drag && this.drag.rect) {
      const d = this.drag.rect;
      return { x0: Math.min(d.x0, d.x1), y0: Math.min(d.y0, d.y1), x1: Math.max(d.x0, d.x1), y1: Math.max(d.y0, d.y1), color: [1, 1, 0.6] };
    }
    if (!t || this.tool === 'inspect' || this.tool === 'track') return null;
    if (this.tool === 'placeFlat') {
      const fp = Rides.flatFootprint(this.arg, t.x, t.y, this.rot);
      const ok = Rides.checkFlat(this.game, this.arg, t.x, t.y, this.rot).ok;
      return { x0: t.x, y0: t.y, x1: t.x + fp.W - 1, y1: t.y + fp.L - 1, color: ok ? [0.6, 1, 0.6] : [1, 0.45, 0.4] };
    }
    return { x0: t.x, y0: t.y, x1: t.x, y1: t.y, color: [1, 1, 1] };
  }

  refreshGhost() {
    const g = this.game, t = this.hoverTile;
    if (this.tool === 'track') return this.updateBuilder();
    if (!t) { this.r.setGhost(null); return; }
    if (this.tool === 'placeStall') {
      const dir = Rides.stallFacing(g, t.x, t.y, this.rot);
      const c = Rides.checkStall(g, this.arg, t.x, t.y);
      const mb = new MB(4096);
      M.stallModel(mb, { type: this.arg, x: t.x, y: t.y, z: g.w.groundMax(t.x, t.y), dir });
      this.r.setGhost(mb.data(), c.ok);
      this.hint(c.ok ? `${STALLS[this.arg].name}: ${money(c.cost, 0)}` : c.reason);
    } else if (this.tool === 'placeFlat') {
      const c = Rides.checkFlat(g, this.arg, t.x, t.y, this.rot);
      const mb = new MB(8192);
      M.flatStatic(mb, { type: this.arg, x: t.x, y: t.y, rot: this.rot, z: c.z ?? g.w.groundMax(t.x, t.y) }, g.w);
      this.r.setGhost(mb.data(), c.ok);
      this.hint(c.ok ? `${FLAT_RIDES[this.arg].name}: ${money(c.cost, 0)}` : c.reason);
    } else if (this.tool === 'trackStart') {
      const mb = new MB(8192);
      const z = g.w.groundMax(t.x, t.y);
      M.trackPieceModel(mb, this.arg, { pid: 'station', x: t.x, y: t.y, dir: this.rot, z }, TRACK_RIDES[this.arg].color, null, true);
      const own = g.w.owned(t.x, t.y) && !g.w.ptype[g.w.idx(t.x, t.y)] && !g.w.occAt(t.x, t.y).length;
      this.r.setGhost(mb.data(), own);
    } else if (this.tool === 'entrance' || this.tool === 'exit') {
      const r = g.ride(this.arg);
      if (!r) return;
      const c = Rides.checkEntrance(g, r, t.x, t.y);
      if (c.ok) {
        const mb = new MB(2048);
        M.entranceModel(mb, { x: t.x, y: t.y, z: c.z, dir: c.dir }, this.tool === 'exit');
        this.r.setGhost(mb.data(), true);
      } else this.r.setGhost(null);
    } else this.r.setGhost(null);
  }

  /** left click / tap in the world */
  click(sx, sy) {
    const g = this.game;
    this.app.audio.unlock();
    const p = this.r.pick(sx, sy);
    const t = p ? { x: p.tx, y: p.ty } : null;
    const T = this.tool;
    if (T === 'inspect') return this.inspectAt(sx, sy, t);
    if (!t) return;
    const res = (r, okSound = 'place') => {
      if (!r) return r;
      if (r.ok) { if (!r.same) this.app.audio.play(okSound); }
      else this.toast(r.reason || 'Cannot do that here', true);
      return r;
    };
    if (T === 'path' || T === 'queue') res(Build.placePath(g, t.x, t.y, T === 'queue'));
    else if (T === 'bulldoze') {
      const tg = Build.bulldozeTarget(g, t.x, t.y);
      if (tg && tg.kind === 'ride') this.demolishPrompt(tg.ride);
      else res(Build.bulldozeSmall(g, t.x, t.y));
    } else if (T.startsWith('scen:')) res(Build.placeScenery(g, t.x, t.y, this.arg));
    else if (T.startsWith('addon:')) res(Build.placeAddon(g, t.x, t.y, this.arg));
    else if (T === 'land:raise' || T === 'land:lower') res(Build.terraform(g, t.x, t.y, T === 'land:raise' ? 1 : -1));
    else if (T === 'land:buy' || T === 'land:rights') res(Build.buyLand(g, t.x, t.y, T === 'land:rights'));
    else if (T === 'placeStall') {
      const r = res(Rides.placeStall(g, this.arg, t.x, t.y, Rides.stallFacing(g, t.x, t.y, this.rot)));
      if (r && r.ok) { this.toast(`${r.ride.name} is open for business.`); this.openRide(r.ride.id); this.setTool('inspect'); }
    } else if (T === 'placeFlat') {
      const r = res(Rides.placeFlat(g, this.arg, t.x, t.y, this.rot));
      if (r && r.ok) { this.setTool('entrance', r.ride.id); }
    } else if (T === 'trackStart') {
      const r = Rides.startTrackRide(g, this.arg, t.x, t.y, this.rot);
      const pr = Rides.placePiece(g, r, 'station');
      if (!pr.ok) { g.rides = g.rides.filter((x) => x !== r); g.markConnDirty(); this.toast(pr.reason, true); return; }
      this.app.audio.play('place');
      this.openBuilder(r);
    } else if (T === 'entrance' || T === 'exit') {
      const r = g.ride(this.arg);
      if (!r) return this.setTool('inspect');
      const pr = res(Rides.placeEntrance(g, r, t.x, t.y, T === 'exit'));
      if (pr && pr.ok) {
        if (T === 'entrance' && !r.exit) this.setTool('exit', r.id);
        else if (T === 'exit' && !r.entrance) this.setTool('entrance', r.id);
        else {
          this.setTool('inspect'); this.openRide(r.id);
          this.toast('Connect the entrance and exit to a footpath, then open the ride.');
        }
      }
    } else if (T === 'moveStaff') {
      const s = g.staff.find((x) => x.id === this.arg);
      if (s && StaffM.placeStaff(g, s, t.x, t.y)) { this.app.audio.play('place'); this.setTool('inspect'); }
      else this.toast('Staff can only be placed on footpaths inside the park.', true);
    } else if (T === 'track') {
      // clicking in the world while building places the next piece
      this.placeNextPiece();
    }
  }

  /** desktop drag with a tool: returns true if the tool consumes the drag */
  dragBegin(sx, sy) {
    const T = this.tool;
    const p = this.r.pick(sx, sy);
    if (!p) return false;
    if (T === 'path' || T === 'queue') { this.drag = { kind: 'line', x0: p.tx, y0: p.ty, rect: { x0: p.tx, y0: p.ty, x1: p.tx, y1: p.ty } }; return true; }
    if (T.startsWith('scen:') || T === 'land:buy' || T === 'land:rights' || T === 'bulldoze' || T.startsWith('addon:')) {
      this.drag = { kind: 'rect', rect: { x0: p.tx, y0: p.ty, x1: p.tx, y1: p.ty } }; return true;
    }
    return false;
  }
  dragMove(sx, sy) {
    if (!this.drag) return;
    const p = this.r.pick(sx, sy);
    if (!p) return;
    const d = this.drag;
    if (d.kind === 'line') {
      const dx = p.tx - d.x0, dy = p.ty - d.y0;
      if (Math.abs(dx) >= Math.abs(dy)) d.rect = { x0: d.x0, y0: d.y0, x1: p.tx, y1: d.y0 };
      else d.rect = { x0: d.x0, y0: d.y0, x1: d.x0, y1: p.ty };
    } else d.rect.x1 = p.tx, d.rect.y1 = p.ty;
  }
  dragEnd() {
    const d = this.drag; this.drag = null;
    if (!d) return;
    const g = this.game, T = this.tool;
    const x0 = Math.min(d.rect.x0, d.rect.x1), x1 = Math.max(d.rect.x0, d.rect.x1);
    const y0 = Math.min(d.rect.y0, d.rect.y1), y1 = Math.max(d.rect.y0, d.rect.y1);
    let ok = 0, last = null, spent = 0;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      let r;
      if (T === 'path' || T === 'queue') r = Build.placePath(g, x, y, T === 'queue');
      else if (T.startsWith('scen:')) r = Build.placeScenery(g, x, y, this.arg);
      else if (T.startsWith('addon:')) r = Build.placeAddon(g, x, y, this.arg);
      else if (T === 'bulldoze') { const tg = Build.bulldozeTarget(g, x, y); if (tg && tg.kind !== 'ride') r = Build.bulldozeSmall(g, x, y); }
      else r = Build.buyLand(g, x, y, T === 'land:rights');
      if (r && r.ok) { ok++; spent += r.cost || 0; } else if (r) last = r;
    }
    if (ok) this.app.audio.play('place');
    if (!ok && last) this.toast(last.reason, true);
    else if (spent) this.app.renderer.addFloater(x1 + 0.5, y1 + 0.5, g.w.groundMax(x1, y1), `-${money(spent, 0)}`, '#ff9a8a');
  }

  inspectAt(sx, sy, t) {
    const g = this.game, R = this.r;
    let best = null, bd = 16;
    for (const s of g.staff) { const [px, py] = R.project(s.x, s.y, s.z / 4 + 0.3); const d = Math.hypot(px - sx, py - sy); if (d < bd) { bd = d; best = { k: 'staff', id: s.id }; } }
    for (const q of g.guests) {
      if (q.hidden || q.state === 'riding') continue;
      const [px, py] = R.project(q.x, q.y, q.z / 4 + 0.3); const d = Math.hypot(px - sx, py - sy);
      if (d < bd) { bd = d; best = { k: 'guest', id: q.id }; }
    }
    if (best) { this.app.audio.play('click'); return best.k === 'guest' ? this.guestWindow(best.id) : this.staffMemberWindow(best.id); }
    // tracked rides by their geometry
    let tr = null; bd = 14;
    for (const r of g.rides) {
      if (r.kind !== 'track') continue;
      for (const pc of r.track.pieces) {
        const [px, py] = R.project(pc.x + 0.5, pc.y + 0.5, pc.z / 4);
        const d = Math.hypot(px - sx, py - sy);
        if (d < bd) { bd = d; tr = r; }
      }
    }
    if (tr) return this.openRide(tr.id);
    if (!t) return;
    for (const e of g.w.occAt(t.x, t.y)) {
      if (e.k === 'gate') return this.parkWindow();
      const r = g.ride(e.id);
      if (r) return this.openRide(r.id);
    }
  }

  // ================================================================== windows
  open(id, title, render, opts = {}) {
    let w = this.wins.get(id);
    const host = $('#windows');
    if (this.narrow && !opts.keep) for (const [k] of this.wins) if (k !== id && k !== 'builder') this.close(k);
    if (!w) {
      const el = document.createElement('section');
      el.className = 'win' + (opts.wide ? ' wide' : '');
      el.dataset.win = id;
      el.innerHTML = `<header><h2></h2><button class="x" data-close="${id}" aria-label="Close">&times;</button></header><div class="body"></div>`;
      host.appendChild(el);
      w = { el, render, live: opts.live !== false };
      this.wins.set(id, w);
      const n = this.wins.size - 1;
      if (!this.narrow) { el.style.right = `${12 + (n % 4) * 26}px`; el.style.top = `${64 + (n % 4) * 26}px`; }
      this.makeDraggable(el);
      this.app.audio.play('click');
    }
    w.render = render; w.title = title;
    w.el.style.zIndex = ++this.zTop;
    $('h2', w.el).textContent = typeof title === 'function' ? title() : title;
    this.renderWin(w);
    return w;
  }
  close(id) {
    const w = this.wins.get(id);
    if (!w) return;
    w.el.remove();
    this.wins.delete(id);
    if (id === 'builder') this.closeBuilder(true);
    if (id.startsWith('guest:')) { this.selectedGuest = null; if (this.follow && this.follow.k === 'guest') this.follow = null; }
    if (id.startsWith('staff:')) this.selectedStaff = null;
  }
  renderWin(w) {
    const body = $('.body', w.el);
    const html = w.render();
    if (html == null) { this.close(w.el.dataset.win); return; }
    if (typeof w.title === 'function') $('h2', w.el).textContent = w.title();
    if (body._html !== html) { body.innerHTML = html; body._html = html; }
  }
  refresh() {
    if (!this.game) return;
    for (const [id, w] of this.wins) {
      if (!w.live) continue;
      const a = document.activeElement;
      if (a && w.el.contains(a) && (a.tagName === 'INPUT' || a.tagName === 'SELECT')) continue;
      this.renderWin(w);
      if (!this.wins.has(id)) continue;
    }
  }
  makeDraggable(el) {
    const hd = $('header', el);
    let sx, sy, ox, oy, drag = false;
    hd.addEventListener('pointerdown', (e) => {
      el.style.zIndex = ++this.zTop;
      if (this.narrow || e.target.closest('button')) return;
      drag = true; sx = e.clientX; sy = e.clientY;
      const r = el.getBoundingClientRect(); ox = r.left; oy = r.top;
      hd.setPointerCapture(e.pointerId);
    });
    hd.addEventListener('pointermove', (e) => {
      if (!drag) return;
      el.style.left = `${Math.max(0, Math.min(window.innerWidth - 80, ox + e.clientX - sx))}px`;
      el.style.top = `${Math.max(40, Math.min(window.innerHeight - 40, oy + e.clientY - sy))}px`;
      el.style.right = 'auto';
    });
    hd.addEventListener('pointerup', () => { drag = false; });
    el.addEventListener('pointerdown', () => { el.style.zIndex = ++this.zTop; });
  }

  onWinClick(e) {
    const c = e.target.closest('[data-close]');
    if (c) { this.close(c.dataset.close); return; }
    const b = e.target.closest('[data-act]');
    if (!b) return;
    this.app.audio.play('click');
    this.act(b.dataset.act, b.dataset.arg, b);
    // re-render the window the click came from straight away
    const win = b.closest('.win');
    if (win) { const w = this.wins.get(win.dataset.win); if (w) this.renderWin(w); }
  }
  onWinChange(e) {
    const el = e.target;
    if (!el.dataset.set) return;
    this.act(el.dataset.set, el.value, el);
    const win = el.closest('.win');
    el.blur();
    if (win) { const w = this.wins.get(win.dataset.win); if (w) this.renderWin(w); }
  }
  onWinInput(e) {
    const el = e.target;
    if (el.dataset.live) this.act(el.dataset.live, el.value, el);
  }

  // ================================================================== actions
  act(name, arg, el) {
    const g = this.game;
    const ride = () => g.ride(+el.closest('[data-ride]')?.dataset.ride);
    switch (name) {
      case 'status': { const r = ride(); const err = Rides.setStatus(g, r, arg); if (err) this.toast(err, true); break; }
      case 'price': { const r = ride(); r.price = Math.max(0, Math.min(2000, r.price + +arg)); break; }
      case 'itemPrice': { const r = ride(); const k = el.dataset.item; r.prices[k] = Math.max(0, Math.min(2000, (r.prices[k] || 0) + +arg)); break; }
      case 'fee': { const r = ride(); r.fee = Math.max(0, Math.min(200, (r.fee || 0) + +arg)); break; }
      case 'option': { const r = ride(); const d = FLAT_RIDES[r.type].option; r.option = Math.max(d.min, Math.min(d.max, r.option + +arg)); Rides.refreshRatings(g, r); break; }
      case 'rideTab': { this.rideTab = arg; break; }
      case 'rename': { const r = ride(); const n = prompt('New name', r.name); if (n && n.trim()) r.name = n.trim().slice(0, 32); break; }
      case 'demolish': this.demolishPrompt(ride()); break;
      case 'doDemolish': { const r = ride(); Rides.demolish(g, r); this.close('ride:' + r.id); this.close('confirm'); this.app.audio.play('place'); this.toast(`${r.name} demolished.`); break; }
      case 'placeEnt': this.setTool('entrance', ride().id); break;
      case 'placeExit': this.setTool('exit', ride().id); break;
      case 'editTrack': { const r = ride(); if (r.status !== 'closed') { this.toast('Close the ride before changing its track.', true); break; } this.openBuilder(r); break; }
      case 'center': this.centerOnRide(ride()); break;
      case 'inspectEvery': { const r = ride(); r.inspectEvery = +arg; break; }
      case 'callMech': { const r = ride(); Rides.callMechanic(g, r, r.broken ? 'fix' : 'inspect'); if (r.mechanic == null) this.toast('No mechanic is free. Hire one from the Staff window.', true); break; }
      case 'loadMode': { const r = ride(); r.loadMode = +arg; break; }
      case 'minWait': { const r = ride(); r.minWait = Math.max(0, Math.min(250, r.minWait + +arg)); break; }
      case 'maxWait': { const r = ride(); r.maxWait = Math.max(1, Math.min(250, r.maxWait + +arg)); break; }
      case 'cars': { const r = ride(); if (r.status !== 'closed') { this.toast('Close the ride first.', true); break; } if (r.type === 'coaster') r.cars += +arg; else r.vehCount = Math.max(1, Math.min(TRACK_RIDES[r.type].vehMax, r.vehCount + +arg)); Rides.resetVehicles(g, r); r.tested = false; r.ratings = null; break; }
      case 'liftSpeed': { const r = ride(); r.liftSpeed = Math.max(4, Math.min(6, r.liftSpeed + +arg)); break; }
      case 'laps': { const r = ride(); r.laps = Math.max(1, Math.min(10, r.laps + +arg)); break; }
      case 'brakeSpeed': { const r = ride(); r.brakeSpeed = Math.max(2, Math.min(20, r.brakeSpeed + +arg)); break; }
      case 'build': this.startBuild(arg); break;
      case 'buildTab': this.buildTab = arg; break;
      case 'tool': this.setTool(arg, el.dataset.targ != null ? +el.dataset.targ : null); if (this.narrow) for (const [k] of this.wins) this.close(k); break;
      case 'hire': { const s = StaffM.hireStaff(g, arg); this.toast(`${s.name} hired. Wages: ${money(STAFF[arg].wage, 0)} a month.`); break; }
      case 'fire': { const s = g.staff.find((x) => x.id === +arg); if (s) { StaffM.fireStaff(g, s); this.close('staff:' + s.id); } break; }
      case 'moveStaff': this.setTool('moveStaff', +arg); break;
      case 'duty': { const s = g.staff.find((x) => x.id === +el.dataset.staff); s.duties[arg] = !s.duties[arg]; break; }
      case 'openStaff': this.staffMemberWindow(+arg); break;
      case 'openGuest': this.guestWindow(+arg); break;
      case 'openRide': this.openRide(+arg); break;
      case 'follow': this.follow = this.follow && this.follow.id === +arg ? null : { k: el.dataset.k, id: +arg }; break;
      case 'park': g.parkOpen = arg === 'open'; if (g.parkOpen && !g.rides.some((r) => r.kind !== 'stall' && r.status === 'open')) this.toast('The park is open, but no rides are open yet!'); break;
      case 'entryFee': g.entryFee = Math.max(0, Math.min(10000, g.entryFee + +arg)); break;
      case 'loan': if (!g.borrow(+arg)) this.toast(+arg > 0 ? 'You cannot borrow any more.' : 'Not enough cash to repay.', true); break;
      case 'funding': g.research.funding = +arg; break;
      case 'prio': g.research.prio[arg] = !g.research.prio[arg]; break;
      case 'campaign': {
        const win = el.closest('.body');
        const key = $('#mk-type', win).value, weeks = +$('#mk-weeks', win).value;
        const subjEl = $('#mk-subj', win);
        const subj = subjEl ? (CAMPAIGNS.find((c) => c.key === key).subject === 'item' ? subjEl.value : +subjEl.value) : null;
        const err = g.startCampaign(key, weeks, subj);
        if (err) this.toast(err, true); else this.toast('Campaign started.');
        break;
      }
      case 'mkType': this.mkType = arg; break;
      case 'finTab': this.finTab = arg; break;
      case 'guestFilter': this.guestFilter = arg || null; break;
      case 'save': this.app.saveSlot(arg); break;
      case 'load': this.app.loadSlot(arg); break;
      case 'newGame': this.newGameModal(); break;
      case 'startScenario': this.app.newGame(arg); this.closeModal(); break;
      case 'continue': this.app.loadSlot('auto'); this.closeModal(); break;
      case 'closeModal': this.closeModal(); break;
      case 'vol': { const [s, m] = [+$('#o-sfx').value, +$('#o-mus').value]; this.app.setVolumes(s / 100, m / 100); break; }
      case 'overlay': this.viewOverlay = arg || null; this.r.setOverlay(this.viewOverlay); break;
      case 'edgePan': this.app.edgePan = !this.app.edgePan; this.app.saveOptions(); break;
      case 'help': this.helpWindow(); break;
      case 'about': this.aboutWindow(); break;
      case 'landTool': this.setTool(arg); break;
      case 'sel': this.builderSel(arg, el); break;
      case 'placePiece': this.placeNextPiece(); break;
      case 'removePiece': this.removePiece(); break;
      case 'builderDone': this.close('builder'); break;
      case 'closeWin': this.close(arg); break;
      case 'notifSubject': { const r = g.ride(+arg); if (r) { this.openRide(r.id); this.centerOnRide(r); } break; }
      default: break;
    }
    this.updateHud();
  }

  centerOnRide(r) {
    if (!r) return;
    const c = this.r.cam;
    if (r.kind === 'track') { const p = r.track.pieces[0] || r.track.start; c.x = p.x + 0.5; c.y = p.y + 0.5; }
    else { c.x = r.x + 1; c.y = r.y + 1; }
  }

  demolishPrompt(r) {
    if (!r) return;
    this.open('confirm', 'Demolish?', () => `<div data-ride="${r.id}"><p>Demolish <b>${esc(r.name)}</b>? You get back ${money(Rides.refundOf(r))}.</p>
      <div class="row"><button class="danger" data-act="doDemolish">Demolish</button><button data-act="closeWin" data-arg="confirm">Keep it</button></div></div>`, { live: false, keep: true });
  }

  // ------------------------------------------------------------------ ride window
  openRide(id) {
    const r = this.game.ride(id);
    if (!r) return;
    if (r.kind === 'stall') return this.open('ride:' + id, () => this.game.ride(id)?.name || '', () => this.stallBody(id));
    this.open('ride:' + id, () => this.game.ride(id)?.name || '', () => this.rideBody(id));
  }

  statusButtons(r) {
    const st = r.status;
    const b = (s, label) => `<button class="seg ${st === s ? 'on' : ''}" data-act="status" data-arg="${s}">${label}</button>`;
    return `<div class="segs">${b('closed', 'Closed')}${r.kind === 'flat' ? '' : b('testing', 'Test')}${b('open', 'Open')}</div>`;
  }

  rideBody(id) {
    const g = this.game, r = g.ride(id);
    if (!r) return null;
    const tab = this.rideTab || 'info';
    const tabs = [['info', 'Overview'], ['ops', 'Operation'], ['care', 'Upkeep'], ['stats', 'Customers']];
    const def = Rides.rideDef(r);
    let h = `<div data-ride="${r.id}">`;
    h += `<div class="row spread">${this.statusButtons(r)}<span><button class="sm" data-act="rename">Rename</button> <button class="sm" data-act="center">Find</button></span></div>`;
    const err = Rides.canOpen(g, r);
    let state = r.status === 'closed' ? 'Closed' : r.status === 'testing' ? 'Testing' : 'Open';
    if (r.broken) state = `Broken down (${BREAKDOWNS[r.broken].name.toLowerCase()})`;
    else if (r.kind === 'track' && r.testing) state = 'Running its test circuit...';
    h += `<p class="state ${r.broken ? 'bad' : ''}">${esc(state)}</p>`;
    if (err && r.status === 'closed') h += `<p class="warn">${esc(err)}</p>`;
    if (!r.entrance || !r.exit) h += `<div class="row">${!r.entrance ? '<button data-act="placeEnt">Place entrance</button>' : ''}${!r.exit ? '<button data-act="placeExit">Place exit</button>' : ''}</div>`;
    h += `<div class="tabs">${tabs.map(([k, l]) => `<button class="${tab === k ? 'on' : ''}" data-act="rideTab" data-arg="${k}">${l}</button>`).join('')}</div>`;
    if (tab === 'info') {
      const R = r.ratings;
      if (R) {
        h += `<table class="kv"><tr><th>Excitement</th><td>${rt(R[0])} <small>${ratingLabel(R[0])}</small></td></tr>
          <tr><th>Intensity</th><td>${rt(R[1])} <small>${ratingLabel(R[1])}</small></td></tr>
          <tr><th>Nausea</th><td>${rt(R[2])} <small>${ratingLabel(R[2])}</small></td></tr></table>`;
      } else h += `<p class="muted">No ratings yet${r.kind === 'track' ? ': run a test first' : ''}.</p>`;
      if (g.pricing !== 'gate') {
        h += `<div class="row spread"><span>Ticket price <b>${money(r.price)}</b></span><span><button class="sm" data-act="price" data-arg="-10">-</button><button class="sm" data-act="price" data-arg="10">+</button></span></div>`;
        if (r.value != null) h += `<p class="muted">Guests think it is worth about ${money(r.value)}${r.price > r.value * 2 ? ' - <b class="bad">far too expensive!</b>' : r.price > r.value ? ' - a bit pricey' : ''}.</p>`;
      } else h += `<p class="muted">Rides are free: guests pay at the gate.</p>`;
      if (r.kind === 'track' && r.measure) {
        const m = r.measure;
        h += `<details open><summary>Measurements</summary><table class="kv">
          <tr><th>Max speed</th><td>${m.Smax.toFixed(1)} m/s</td></tr><tr><th>Average speed</th><td>${m.Savg.toFixed(1)} m/s</td></tr>
          <tr><th>Ride time</th><td>${Math.round(m.T * 0.8)} s</td></tr><tr><th>Length</th><td>${Math.round(m.L / 4.25 * 3)} m</td></tr>
          <tr><th>Max vertical G</th><td>${rt(m.Gpos)} / ${rt(m.Gneg)}</td></tr><tr><th>Max lateral G</th><td>${rt(m.Glat)}</td></tr>
          <tr><th>Airtime</th><td>${(m.airtime / 40).toFixed(1)} s</td></tr><tr><th>Drops</th><td>${m.drops} (highest ${(m.H * 0.75).toFixed(1)} m)</td></tr>
          <tr><th>Inversions</th><td>${m.inversions}</td></tr></table></details>`;
      }
      if (r.kind === 'track') h += `<div class="row"><button data-act="editTrack">Edit track</button></div>`;
      h += `<div class="row"><button class="danger" data-act="demolish">Demolish</button></div>`;
    } else if (tab === 'ops') {
      if (r.kind === 'flat') {
        if (def.option) h += `<div class="row spread"><span>${def.option.name}: <b>${r.option}</b></span><span><button class="sm" data-act="option" data-arg="-1">-</button><button class="sm" data-act="option" data-arg="1">+</button></span></div><p class="muted">More gives more excitement, intensity and nausea.</p>`;
        else h += '<p class="muted">The ride runs one fixed cycle.</p>';
        h += `<p>Capacity ${def.cap} riders a cycle.</p>`;
      } else {
        const tdef = TRACK_RIDES[r.type];
        if (r.type === 'coaster') h += `<div class="row spread"><span>Cars per train: <b>${r.cars}</b> (${r.cars * tdef.seats} riders)</span><span><button class="sm" data-act="cars" data-arg="-1">-</button><button class="sm" data-act="cars" data-arg="1">+</button></span></div>`;
        else h += `<div class="row spread"><span>${r.type === 'karts' ? 'Karts' : 'Boats'}: <b>${r.vehCount}</b></span><span><button class="sm" data-act="cars" data-arg="-1">-</button><button class="sm" data-act="cars" data-arg="1">+</button></span></div>`;
        if (r.type === 'coaster') h += `<div class="row spread"><span>Lift hill speed: <b>${r.liftSpeed} m/s</b></span><span><button class="sm" data-act="liftSpeed" data-arg="-1">-</button><button class="sm" data-act="liftSpeed" data-arg="1">+</button></span></div>
          <div class="row spread"><span>Brake speed: <b>${r.brakeSpeed} m/s</b></span><span><button class="sm" data-act="brakeSpeed" data-arg="-1">-</button><button class="sm" data-act="brakeSpeed" data-arg="1">+</button></span></div>`;
        if (r.type === 'karts') h += `<div class="row spread"><span>Laps: <b>${r.laps}</b></span><span><button class="sm" data-act="laps" data-arg="-1">-</button><button class="sm" data-act="laps" data-arg="1">+</button></span></div>`;
        h += `<label class="row">Depart when <select data-set="loadMode">${['any load', 'quarter full', 'half full', 'three quarters full', 'full'].map((l, k) => `<option value="${k}" ${r.loadMode === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`;
        h += `<div class="row spread"><span>Minimum wait <b>${r.minWait} s</b></span><span><button class="sm" data-act="minWait" data-arg="-1">-</button><button class="sm" data-act="minWait" data-arg="1">+</button></span></div>`;
        h += `<div class="row spread"><span>Maximum wait <b>${r.maxWait} s</b></span><span><button class="sm" data-act="maxWait" data-arg="-5">-</button><button class="sm" data-act="maxWait" data-arg="5">+</button></span></div>`;
      }
    } else if (tab === 'care') {
      h += `<table class="kv"><tr><th>Reliability</th><td>${(r.rel / 256).toFixed(0)}%</td></tr><tr><th>Downtime</th><td>${r.downtime}%</td></tr>
        <tr><th>Last breakdown</th><td>${esc(r.lastBreak || 'never')}</td></tr><tr><th>Last repaired</th><td>${esc(r.lastFix || '-')}</td></tr>
        <tr><th>Running cost</th><td>${money(r.upkeep * 2)} / month</td></tr></table>`;
      h += `<label class="row">Inspect every <select data-set="inspectEvery">${[[10, '10 min'], [20, '20 min'], [30, '30 min'], [45, '45 min'], [60, '1 hour'], [120, '2 hours'], [0, 'never']].map(([v, l]) => `<option value="${v}" ${r.inspectEvery === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`;
      h += `<div class="row"><button data-act="callMech">Call a mechanic</button></div>`;
      if (r.mechanic != null) h += `<p class="muted">A mechanic is on the way.</p>`;
    } else {
      const cust = r.custBuckets.reduce((a, b) => a + b, 0);
      const onRide = r.kind === 'flat' ? r.riders.length : (r.vehicles || []).reduce((a, v) => a + v.riders.length, 0);
      h += `<table class="kv"><tr><th>On the ride</th><td>${onRide}</td></tr><tr><th>Queuing</th><td>${r.queue.length} / ${r.queueCap}</td></tr>
        <tr><th>Customers / hour</th><td>${cust * 12}</td></tr><tr><th>Popularity</th><td>${r.pop.length ? pct(avg(r.pop) * 100) : '-'}</td></tr>
        <tr><th>Satisfaction</th><td>${r.sat.length ? pct((r.sat.reduce((a, b) => a + b, 0) / 4 / r.sat.length) * 400 / 3) : '-'}</td></tr>
        <tr><th>Favourite of</th><td>${r.favCount || 0} guests</td></tr><tr><th>Total customers</th><td>${r.totalCustomers}</td></tr>
        <tr><th>Income</th><td>${money(r.income)}</td></tr><tr><th>Income / hour</th><td>${money(cust * 12 * (g.pricing === 'gate' ? 0 : r.price))}</td></tr>
        <tr><th>Profit / hour</th><td>${money(cust * 12 * (g.pricing === 'gate' ? 0 : r.price) - r.upkeep * 16)}</td></tr>
        <tr><th>Age</th><td>${g.absMonth - r.built} months</td></tr></table>`;
    }
    return h + '</div>';
  }

  stallBody(id) {
    const g = this.game, r = g.ride(id);
    if (!r) return null;
    const d = STALLS[r.type];
    let h = `<div data-ride="${r.id}"><div class="row spread"><div class="segs"><button class="seg ${r.status === 'closed' ? 'on' : ''}" data-act="status" data-arg="closed">Closed</button><button class="seg ${r.status === 'open' ? 'on' : ''}" data-act="status" data-arg="open">Open</button></div><button class="sm" data-act="rename">Rename</button></div>`;
    if (!r.access.length) h += '<p class="warn">This stall does not face a footpath.</p>';
    if (d.sells) {
      for (const k of d.sells) {
        h += `<div class="row spread"><span>${ITEMS[k].name} <b>${money(r.prices[k])}</b> <small class="muted">(costs you ${money(ITEMS[k].cost)})</small></span><span><button class="sm" data-act="itemPrice" data-item="${k}" data-arg="-10">-</button><button class="sm" data-act="itemPrice" data-item="${k}" data-arg="10">+</button></span></div>`;
      }
    } else if (d.facility === 'toilet') {
      h += `<div class="row spread"><span>Fee <b>${money(r.fee || 0)}</b></span><span><button class="sm" data-act="fee" data-arg="-10">-</button><button class="sm" data-act="fee" data-arg="10">+</button></span></div>`;
    } else h += `<p class="muted">${d.facility === 'firstaid' ? 'Sick guests come here to recover. Free of charge.' : 'Guests running low on cash can top up here.'}</p>`;
    h += `<table class="kv"><tr><th>Customers</th><td>${r.customers}</td></tr><tr><th>Items sold</th><td>${r.sold}</td></tr><tr><th>Profit</th><td>${money(r.profit)}</td></tr>
      <tr><th>Running cost</th><td>${money(r.upkeep * 2)} / month</td></tr><tr><th>Popularity</th><td>${r.pop && r.pop.length ? pct(avg(r.pop) * 100) : '-'}</td></tr></table>`;
    h += `<div class="row"><button class="danger" data-act="demolish">Demolish</button></div></div>`;
    return h;
  }

  // ------------------------------------------------------------------ guest window
  guestWindow(id) {
    this.selectedGuest = id;
    this.open('guest:' + id, () => this.game.guests.find((q) => q.id === id)?.name || 'Guest', () => {
      const g = this.game, q = g.guests.find((x) => x.id === id);
      if (!q) return null;
      const bar = (label, v, invert = false) => {
        const p = Math.round((v / 255) * 100);
        const good = invert ? 100 - p : p;
        return `<div class="need"><span>${label}</span><span class="bar"><i style="width:${p}%;background:${good < 25 ? '#e0523f' : good < 55 ? '#e9b949' : '#4caf6a'}"></i></span></div>`;
      };
      const th = q.thoughts.map((t) => `<li>${esc(this.thoughtText(t))}</li>`).join('') || '<li class="muted">Nothing on their mind.</li>';
      const items = [q.holding ? ITEMS[q.holding].name + ' (eating)' : null, ...Object.keys(q.items).map((k) => ITEMS[k].name)].filter(Boolean);
      const fav = g.ride(q.favourite);
      return `<p class="state">${esc(guestStatus(g, q))} &middot; feeling ${moodOf(q)}</p>
        ${bar('Happiness', q.happy)}${bar('Energy', (q.energy - 32) * 255 / 96)}${bar('Full', q.hunger)}${bar('Quenched', q.thirst)}${bar('Toilet', q.toilet, true)}${bar('Nausea', q.nausea, true)}
        <table class="kv"><tr><th>Cash</th><td>${money(q.cash)}</td></tr><tr><th>Spent</th><td>${money(q.spent)}</td></tr>
        <tr><th>Rides taken</th><td>${q.numRides}</td></tr><tr><th>Favourite</th><td>${fav ? esc(fav.name) : '-'}</td></tr>
        <tr><th>Likes intensity</th><td>${q.prefMin} - ${q.prefMax >= 15 ? 'any' : q.prefMax}</td></tr><tr><th>Carrying</th><td>${esc(items.join(', ') || 'nothing')}</td></tr></table>
        <h3>Thoughts</h3><ul class="thoughts">${th}</ul>
        <div class="row"><button data-act="follow" data-k="guest" data-arg="${q.id}">${this.follow && this.follow.id === q.id ? 'Stop following' : 'Follow'}</button></div>`;
    });
  }
  thoughtText(t) {
    const g = this.game;
    let s = THOUGHTS[t.t] || t.t;
    const r = t.s != null ? g.ride(t.s) : null;
    s = s.replace('{r}', r ? r.name : 'that ride').replace('{i}', t.i ? ITEMS[t.i]?.name.toLowerCase() || 'item' : 'snack');
    return s.replace(/\ba ([aeiou])/gi, 'an $1');
  }

  // ------------------------------------------------------------------ build window
  startBuild(type) {
    const g = this.game;
    if (FLAT_RIDES[type]) this.setTool('placeFlat', type);
    else if (STALLS[type]) this.setTool('placeStall', type);
    else if (TRACK_RIDES[type]) this.setTool('trackStart', type);
    if (this.narrow) this.close('build'); else this.close('build');
    void g;
  }
  buildWindow() {
    this.open('build', 'Build a ride or stall', () => {
      const g = this.game;
      const tab = this.buildTab || 'gentle';
      const cats = [['gentle', 'Gentle'], ['thrill', 'Thrill'], ['coaster', 'Coasters'], ['water', 'Water'], ['shops', 'Shops']];
      let h = `<div class="tabs">${cats.map(([k, l]) => `<button class="${tab === k ? 'on' : ''}" data-act="buildTab" data-arg="${k}">${l}</button>`).join('')}</div><div class="cards">`;
      const list = [];
      for (const [k, d] of Object.entries(FLAT_RIDES)) list.push([k, d.cat, d.name, d.cost + (d.perSection || 0) * (d.sections || 0), `${d.w}x${d.l} tiles, ${d.cap} riders. Ratings about ${rt(d.base[0] + (d.option ? d.bonus[0] * d.option.def : (d.perHu ? d.perHu[0] * d.sections * 4 : 0)))} / ${rt(d.base[1] + (d.option ? d.bonus[1] * d.option.def : (d.perHu ? d.perHu[1] * d.sections * 4 : 0)))} / ${rt(d.base[2] + (d.option ? d.bonus[2] * d.option.def : (d.perHu ? d.perHu[2] * d.sections * 4 : 0)))}.`]);
      for (const [k, d] of Object.entries(TRACK_RIDES)) list.push([k, d.cat, d.name, d.piecePrice, `Build it piece by piece. ${money(d.piecePrice, 0)} per straight piece.`]);
      for (const [k, d] of Object.entries(STALLS)) list.push([k, 'shops', d.name, d.cost, d.sells ? `Sells ${d.sells.map((s) => ITEMS[s].name.toLowerCase()).join(' and ')}.` : d.facility === 'toilet' ? 'Somewhere guests really need.' : d.facility === 'firstaid' ? 'Helps sick guests recover.' : 'Guests can withdraw more cash.']);
      for (const [k, cat, name, cost, desc] of list) {
        if (cat !== tab) continue;
        const avail = g.available.has(k);
        h += `<button class="card ${avail ? '' : 'locked'}" ${avail ? `data-act="build" data-arg="${k}"` : 'disabled'}><b>${esc(name)}</b><span>${avail ? money(cost, 0) : 'Being researched'}</span><small>${esc(desc)}</small></button>`;
      }
      return h + '</div>';
    }, { live: false });
  }

  sceneryWindow() {
    this.open('scenery', 'Scenery & furniture', () => {
      let h = '<h3>Path furniture</h3><div class="cards">';
      for (const [k, a] of Object.entries(ADDONS)) h += `<button class="card" data-act="tool" data-arg="addon:${k}" data-targ="${k}"><b>${a.name}</b><span>${money(a.cost, 0)}</span></button>`;
      h += '</div><h3>Scenery</h3><div class="cards">';
      for (const [k, s] of Object.entries(SCENERY)) h += `<button class="card" data-act="tool" data-arg="scen:${k}" data-targ="${k}"><b>${s.name}</b><span>${money(s.cost, 0)}</span></button>`;
      return h + '</div><p class="muted">Scenery near a ride raises its excitement, and guests love gardens and fountains.</p>';
    }, { live: false });
  }

  landWindow() {
    this.open('land', 'Land', () => {
      const g = this.game;
      return `<div class="cards">
        <button class="card" data-act="landTool" data-arg="land:buy"><b>Buy land</b><span>${money(g.sc.landPrice, 0)} a tile</span><small>Yellow tiles are for sale.</small></button>
        <button class="card" data-act="landTool" data-arg="land:rights"><b>Construction rights</b><span>${money(g.sc.rightsPrice, 0)} a tile</span><small>Lets you build above the ground on blue tiles.</small></button>
        <button class="card" data-act="landTool" data-arg="land:raise"><b>Raise land</b><span>${money(250, 2)} per corner step</span></button>
        <button class="card" data-act="landTool" data-arg="land:lower"><b>Lower land</b><span>${money(250, 2)} per corner step</span></button></div>
        <p class="muted">Land can only be reshaped where nothing is built on or right next to it.</p>`;
    }, { live: false });
  }

  // ------------------------------------------------------------------ staff
  staffWindow() {
    this.open('staff', 'Staff', () => {
      const g = this.game;
      let h = '<div class="cards">';
      for (const [k, s] of Object.entries(STAFF)) h += `<button class="card" data-act="hire" data-arg="${k}"><b>Hire ${s.name.toLowerCase()}</b><span>${money(s.wage, 0)} / month</span><small>${{ handyman: 'Sweeps litter and empties bins.', mechanic: 'Inspects and repairs rides.', security: 'Deters vandals.', entertainer: 'Cheers up guests and queues.' }[k]}</small></button>`;
      h += '</div><ul class="list">';
      for (const s of g.staff) h += `<li><button class="link" data-act="openStaff" data-arg="${s.id}">${esc(s.name)}</button> <small class="muted">${s.task ? (s.task.kind === 'fix' ? 'fixing a ride' : 'inspecting') : s.workT ? 'working' : 'patrolling'}</small></li>`;
      return h + (g.staff.length ? '' : '<li class="muted">Nobody hired yet.</li>') + '</ul>';
    });
  }
  staffMemberWindow(id) {
    this.selectedStaff = id;
    this.open('staff:' + id, () => this.game.staff.find((s) => s.id === id)?.name || 'Staff', () => {
      const s = this.game.staff.find((x) => x.id === id);
      if (!s) return null;
      const st = s.stats;
      let h = `<p>Wage ${money(STAFF[s.type].wage, 0)} a month.</p><table class="kv">`;
      if (s.type === 'handyman') h += `<tr><th>Litter swept</th><td>${st.swept || 0}</td></tr><tr><th>Bins emptied</th><td>${st.emptied || 0}</td></tr><tr><th>Things mended</th><td>${st.repaired || 0}</td></tr>`;
      if (s.type === 'mechanic') h += `<tr><th>Rides fixed</th><td>${st.fixed || 0}</td></tr><tr><th>Inspections</th><td>${st.inspected || 0}</td></tr>`;
      if (s.type === 'security') h += `<tr><th>Vandals stopped</th><td>${st.stopped || 0}</td></tr>`;
      if (s.type === 'entertainer') h += `<tr><th>Guests entertained</th><td>${st.entertained || 0}</td></tr>`;
      h += '</table>';
      for (const [k, v] of Object.entries(s.duties)) h += `<label class="row"><input type="checkbox" ${v ? 'checked' : ''} data-act="duty" data-arg="${k}" data-staff="${s.id}"> ${{ sweep: 'Sweep paths', bins: 'Empty bins', fix: 'Fix rides', inspect: 'Inspect rides' }[k]}</label>`;
      h += `<div class="row"><button data-act="moveStaff" data-arg="${s.id}">Move</button><button data-act="follow" data-k="staff" data-arg="${s.id}">${this.follow && this.follow.id === s.id ? 'Stop following' : 'Follow'}</button><button class="danger" data-act="fire" data-arg="${s.id}">Fire</button></div>`;
      return h;
    });
  }

  // ------------------------------------------------------------------ guests list
  guestsWindow() {
    this.open('guests', 'Guests', () => {
      const g = this.game;
      const counts = new Map();
      for (const q of g.guests) { if (!q.inPark) continue; const t = q.thoughts[0]; if (!t) continue; const k = this.thoughtText(t); counts.set(k, (counts.get(k) || 0) + 1); }
      const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
      let h = `<p>${g.guestsInPark} guests in the park. Average happiness ${pct(avg(g.guests.filter((q) => q.inPark).map((q) => q.happy)) / 2.55)}.</p><h3>What guests are thinking</h3><ul class="list">`;
      h += top.map(([t, n]) => `<li><b>${n}</b> &middot; ${esc(t)}</li>`).join('') || '<li class="muted">No thoughts yet.</li>';
      h += '</ul><h3>Guests</h3><ul class="list">';
      let n = 0;
      for (const q of g.guests) {
        if (!q.inPark) continue;
        if (++n > 60) break;
        h += `<li><button class="link" data-act="openGuest" data-arg="${q.id}">${esc(q.name)}</button> <small class="muted">${esc(guestStatus(g, q))}</small></li>`;
      }
      return h + '</ul>';
    });
  }

  // ------------------------------------------------------------------ park
  graph(arr, color, min = null, max = null) {
    if (!arr || arr.length < 2) return '<div class="graph muted">Not enough history yet.</div>';
    const lo = min ?? Math.min(...arr), hi = max ?? Math.max(...arr, lo + 1);
    const pts = arr.map((v, k) => `${(k / (arr.length - 1)) * 200},${50 - ((v - lo) / (hi - lo || 1)) * 46 - 2}`).join(' ');
    return `<svg class="graph" viewBox="0 0 200 50" preserveAspectRatio="none"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>`;
  }
  parkWindow() {
    this.open('park', () => this.game.parkName, () => {
      const g = this.game;
      let owned = 0; for (let i = 0; i < g.w.own.length; i++) if (g.w.own[i] === 1) owned++;
      let h = `<div class="segs"><button class="seg ${!g.parkOpen ? 'on' : ''}" data-act="park" data-arg="close">Park closed</button><button class="seg ${g.parkOpen ? 'on' : ''}" data-act="park" data-arg="open">Park open</button></div>`;
      if (g.pricing !== 'ride') h += `<div class="row spread"><span>Admission <b>${money(g.entryFee)}</b></span><span><button class="sm" data-act="entryFee" data-arg="-100">-</button><button class="sm" data-act="entryFee" data-arg="100">+</button></span></div>`;
      h += `<h3>Objective</h3><p>${esc(g.objectiveText())}</p><p class="muted">${esc(g.objectiveProgress())}</p>`;
      if (g.obj.status !== 'running' && g.sc.objective.type !== 'none') h += `<p class="${g.obj.status === 'won' ? 'good' : 'bad'}">${g.obj.status === 'won' ? 'Objective achieved!' : 'Scenario failed.'}</p>`;
      h += `<h3>Rating ${g.rating}</h3>${this.graph(g.hist.rating, '#4caf6a', 0, 999)}<h3>Guests ${g.guestsInPark}</h3>${this.graph(g.hist.guests, '#5b8fd8', 0)}`;
      h += `<table class="kv"><tr><th>Park value</th><td>${money(g.parkValue, 0)}</td></tr><tr><th>Company value</th><td>${money(g.companyValue, 0)}</td></tr>
        <tr><th>Park size</th><td>${owned} tiles</td></tr><tr><th>Suggested max guests</th><td>${g.cap}</td></tr><tr><th>Guests so far</th><td>${g.totalAdmissions || 0}</td></tr></table>`;
      return h;
    });
  }

  // ------------------------------------------------------------------ finance
  financeWindow() {
    this.open('money', 'Finances', () => {
      const g = this.game;
      const tab = this.finTab || 'sum';
      let h = `<div class="tabs"><button class="${tab === 'sum' ? 'on' : ''}" data-act="finTab" data-arg="sum">Summary</button><button class="${tab === 'mk' ? 'on' : ''}" data-act="finTab" data-arg="mk">Marketing</button></div>`;
      if (tab === 'sum') {
        h += `<div class="row spread"><span>Cash <b class="${g.cash < 0 ? 'bad' : ''}">${money(g.cash)}</b></span></div>
          <div class="row spread"><span>Loan <b>${money(g.loan, 0)}</b> of ${money(g.maxLoan, 0)} at ${g.rate}%</span><span><button class="sm" data-act="loan" data-arg="-100000">Repay 1,000</button><button class="sm" data-act="loan" data-arg="100000">Borrow 1,000</button></span></div>
          <p class="muted">Estimated profit this week: ${money(g.weekProfitEst, 0)}</p>`;
        const cols = Math.min(4, g.fin.length);
        h += `<div class="scrollx"><table class="fin"><tr><th></th>${Array.from({ length: cols }, (_, k) => `<th>${k === 0 ? 'This month' : MONTH_NAMES[(g.month - k + 80) % 8]}</th>`).join('')}</tr>`;
        for (let c = 0; c < 14; c++) h += `<tr><td>${FIN_NAMES[c]}</td>${Array.from({ length: cols }, (_, k) => { const v = g.fin[k][c]; return `<td class="${v < 0 ? 'bad' : v > 0 ? 'good' : ''}">${v ? money(v, 0) : '-'}</td>`; }).join('')}</tr>`;
        h += `<tr class="tot"><td>Total</td>${Array.from({ length: cols }, (_, k) => { const v = g.fin[k].reduce((a, b) => a + b, 0); return `<td class="${v < 0 ? 'bad' : 'good'}">${money(v, 0)}</td>`; }).join('')}</tr></table></div>`;
        h += `<h3>Cash</h3>${this.graph(g.hist.cash, '#e9b949')}<h3>Weekly profit</h3>${this.graph(g.hist.profit, '#4caf6a')}<h3>Park value</h3>${this.graph(g.hist.value, '#5b8fd8', 0)}`;
      } else {
        const sel = this.mkType || 'parkAd';
        const def = CAMPAIGNS.find((c) => c.key === sel);
        h += `<label class="row">Campaign <select id="mk-type" data-set="mkType">${CAMPAIGNS.map((c) => `<option value="${c.key}" ${c.key === sel ? 'selected' : ''}>${c.name}</option>`).join('')}</select></label>`;
        if (def.subject === 'ride') {
          const rides = g.rides.filter((r) => r.kind !== 'stall' && r.status === 'open');
          h += `<label class="row">Ride <select id="mk-subj">${rides.map((r) => `<option value="${r.id}">${esc(r.name)}</option>`).join('') || '<option value="">(no open rides)</option>'}</select></label>`;
        } else if (def.subject === 'item') {
          h += `<label class="row">Item <select id="mk-subj">${['F1', 'F2', 'D1'].map((k) => `<option value="${k}">${ITEMS[k].name}</option>`).join('')}</select></label>`;
        }
        h += `<label class="row">Weeks <select id="mk-weeks">${[2, 3, 4, 6, 8, 10, 12].map((w) => `<option value="${w}">${w} weeks (${money(def.weekly * w, 0)})</option>`).join('')}</select></label>
          <div class="row"><button data-act="campaign">Start campaign</button></div><h3>Running</h3><ul class="list">`;
        h += g.campaigns.map((c) => `<li>${esc(CAMPAIGNS.find((d) => d.key === c.key).name)}${c.subject != null && g.ride(c.subject) ? ' - ' + esc(g.ride(c.subject).name) : ''}: ${c.weeks} week(s) left</li>`).join('') || '<li class="muted">No campaigns.</li>';
        h += '</ul>';
      }
      return h;
    });
  }

  // ------------------------------------------------------------------ research
  researchWindow() {
    this.open('research', 'Research', () => {
      const g = this.game, R = g.research;
      let h = `<div class="segs wrap">${RESEARCH_FUNDING.map((f, k) => `<button class="seg ${R.funding === k ? 'on' : ''}" data-act="funding" data-arg="${k}">${f.name}<small>${money(f.monthly, 0)}/mo</small></button>`).join('')}</div>`;
      const eta = g.researchEta();
      const stageName = ['Choosing a project', 'Designing', 'Finishing the design'][R.stage] || '';
      const cur = R.current ? RESEARCH_LIST.find((x) => x.id === R.current) : null;
      h += `<p>${R.funding ? `${stageName}${cur ? (R.stage >= 2 ? `: <b>${esc(cur.name)}</b>` : `: a new ${RESEARCH_CAT_NAMES[cur.cat].toLowerCase().replace(/s$/, '')}`) : ''}` : 'Research is paused.'}</p>`;
      if (eta) { const months = eta / 16384; h += `<p class="muted">Expected in about ${months < 1 ? Math.max(1, Math.round(months * 30)) + ' days' : months.toFixed(1) + ' months'}.</p>`; }
      const prog = ((R.stage * 65536 + R.progress) / (3 * 65536)) * 100;
      h += `<div class="need"><span>Progress</span><span class="bar"><i style="width:${prog}%;background:#5b8fd8"></i></span></div><h3>Priorities</h3>`;
      for (const c of RESEARCH_CATS) h += `<label class="row"><input type="checkbox" ${R.prio[c] ? 'checked' : ''} data-act="prio" data-arg="${c}"> ${RESEARCH_CAT_NAMES[c]}</label>`;
      h += '<h3>Projects</h3><ul class="list">';
      for (const it of RESEARCH_LIST) h += `<li class="${g.available.has(it.id) ? 'good' : 'muted'}">${g.available.has(it.id) ? '&#10003;' : '&middot;'} ${esc(it.name)}</li>`;
      return h + '</ul>';
    });
  }

  // ------------------------------------------------------------------ notices, menu, modals
  noticesWindow() {
    this.lastNotice = this.game.noticeSeq;
    this.open('notices', 'Notices', () => {
      const g = this.game;
      this.lastNotice = g.noticeSeq;
      return `<ul class="list notices">${g.notices.map((n) => `<li class="k-${n.kind}"><small>${esc(n.date)}</small> ${n.subject && n.subject.kind === 'ride' ? `<button class="link" data-act="notifSubject" data-arg="${n.subject.id}">${esc(n.text)}</button>` : esc(n.text)}</li>`).join('')}</ul>`;
    });
  }
  menuWindow() {
    this.open('menu', 'Menu', () => {
      const slots = this.app.slotInfo();
      let h = '<h3>Save &amp; load</h3><ul class="list">';
      for (const s of slots) h += `<li class="row spread"><span><b>${s.label}</b> <small class="muted">${esc(s.info || 'empty')}</small></span><span>${s.id !== 'auto' ? `<button class="sm" data-act="save" data-arg="${s.id}">Save</button>` : ''}${s.info ? `<button class="sm" data-act="load" data-arg="${s.id}">Load</button>` : ''}</span></li>`;
      h += `</ul><p class="muted">The game also saves itself automatically at the start of every month.</p>
        <div class="row"><button data-act="newGame">New park</button><button data-act="help">How to play</button><button data-act="about">About</button></div>
        <h3>Sound</h3><label class="row">Effects <input id="o-sfx" type="range" min="0" max="100" value="${Math.round(this.app.audio.sfx * 100)}" data-live="vol"></label>
        <label class="row">Music <input id="o-mus" type="range" min="0" max="100" value="${Math.round(this.app.audio.music * 100)}" data-live="vol"></label>
        <label class="row"><input type="checkbox" ${this.app.edgePan ? 'checked' : ''} data-act="edgePan"> Scroll when the mouse touches the screen edge</label>
        <h3>View</h3><div class="segs">${[['', 'Normal'], ['land', 'Land ownership'], ['litter', 'Litter']].map(([k, l]) => `<button class="seg ${(this.viewOverlay || '') === k ? 'on' : ''}" data-act="overlay" data-arg="${k}">${l}</button>`).join('')}</div>`;
      return h;
    }, { live: false });
  }
  helpWindow() {
    this.open('help', 'How to play', () => `<ol class="help">
      <li>Lay <b>footpaths</b> from the park gate. Paths join up automatically.</li>
      <li>Open <b>Rides</b>, pick a ride and place it, then place its <b>entrance</b> and <b>exit</b> beside it.</li>
      <li>Connect the exit to a footpath, and the entrance to a footpath or, better, a <b>queue line</b> that leads out to a footpath.</li>
      <li>Open each ride from its window, add food, drink and restrooms, then open the park from the <b>Park</b> window.</li>
      <li>Hire handymen to keep paths clean and mechanics to keep rides running. Watch what guests think!</li>
      <li>Coasters: place a station, then add pieces with the builder until the track returns to the station. Test it, then open it.</li></ol>
      <h3>Controls</h3><ul class="list"><li>Drag with the right mouse button (or the Look tool) to move around; wheel to zoom; Q / E to rotate.</li>
      <li>Touch: drag with one finger to move, pinch to zoom, tap to use the current tool.</li>
      <li>Space pauses, 1-4 set the speed, Esc returns to the Look tool, R rotates what you are placing.</li></ul>`, { live: false });
  }
  aboutWindow() {
    this.open('about', 'About Parkhaven', () => `<p><b>Parkhaven</b> is an original theme-park management game written from a functional specification. All code, models, colours and text are its own; every sound is synthesised in your browser.</p><p>MIT licence, &copy; 2026 Andrew Nakas.</p>`, { live: false });
  }

  modal(html) {
    const m = $('#modal');
    m.innerHTML = `<div class="mbox">${html}</div>`;
    m.style.display = 'flex';
    m.onclick = (e) => { const b = e.target.closest('[data-act]'); if (b) { this.app.audio.unlock(); this.act(b.dataset.act, b.dataset.arg, b); } };
  }
  closeModal() { $('#modal').style.display = 'none'; }
  newGameModal(first = false) {
    const hasAuto = !!this.app.slotInfo().find((s) => s.id === 'auto' && s.info);
    let h = `<h1>Parkhaven</h1><p class="lead">Build a park people never want to leave.</p>`;
    if (first && hasAuto) h += `<div class="row"><button class="primary" data-act="continue">Continue your last park</button></div><h3>Or start a new park</h3>`;
    h += '<div class="scen">';
    for (const s of SCENARIOS) h += `<button class="card" data-act="startScenario" data-arg="${s.id}"><b>${esc(s.name)}</b><small>${esc(s.blurb)}</small></button>`;
    h += '</div>';
    if (!first) h += '<div class="row"><button data-act="closeModal">Cancel</button></div>';
    this.modal(h);
  }
  endModal(won, why) {
    const g = this.game;
    this.modal(`<h1>${won ? 'Objective achieved!' : 'Scenario failed'}</h1><p>${won ? `Your company is worth ${money(g.companyValue, 0)}.` : esc(why || '')}</p>
      <div class="row"><button class="primary" data-act="closeModal">${won ? 'Keep playing' : 'Continue as a sandbox'}</button><button data-act="newGame">New park</button></div>`);
  }

  // ================================================================== track builder
  openBuilder(r) {
    this.builder = { rideId: r.id, sel: { turn: 0, size: 's', slope: 0, bank: 0, special: null }, lift: false };
    this.tool = 'track';
    this.r.setOverlay(null);
    this.hint('');
    this.open('builder', () => `Build: ${this.game.ride(r.id)?.name || ''}`, () => this.builderBody(), { keep: true, live: false });
    this.updateBuilder();
  }
  closeBuilder(fromClose = false) {
    const b = this.builder;
    this.builder = null;
    this.r.setGhost(null);
    if (b) {
      const g = this.game, r = g.ride(b.rideId);
      if (r && r.track.pieces.length === 0) { Rides.demolish(g, r); }
      else if (r) { g.markConnDirty(); }
    }
    if (!fromClose && this.wins.has('builder')) { const w = this.wins.get('builder'); w.el.remove(); this.wins.delete('builder'); }
    if (this.tool === 'track') { this.tool = 'inspect'; this.hint(); }
  }
  allowedGroup(r) {
    const g = this.game;
    if (r.type !== 'coaster') return () => true;
    return (grp) => grp === 'base' || g.available.has('track:' + grp);
  }
  nextPiece() {
    const b = this.builder; if (!b) return null;
    const r = this.game.ride(b.rideId); if (!r) return null;
    if (r.track.closed) return { r, done: true };
    const ch = choosePiece(r.type, r.track.cursor, b.sel, this.allowedGroup(r));
    if (ch.error) return { r, error: ch.error };
    const c = Rides.checkPiece(this.game, r, ch.pid);
    return { r, pid: ch.pid, check: c };
  }
  updateBuilder() {
    const np = this.nextPiece();
    if (!np) return;
    const { r } = np;
    if (np.pid) {
      const mb = new MB(8192);
      M.trackPieceModel(mb, r.type, { pid: np.pid, ...r.track.cursor, lift: this.builder.lift && PIECES[np.pid].liftable }, TRACK_RIDES[r.type].color, null, true);
      this.r.setGhost(mb.data(), np.check.ok);
    } else this.r.setGhost(null);
    const w = this.wins.get('builder');
    if (w) this.renderWin(w);
  }
  builderBody() {
    const b = this.builder;
    if (!b) return null;
    const g = this.game, r = g.ride(b.rideId);
    if (!r) return null;
    const np = this.nextPiece();
    const s = b.sel;
    const btn = (key, val, label, title, on) => `<button class="tb ${on ? 'on' : ''}" data-act="sel" data-arg="${key}:${val}" title="${title}">${label}</button>`;
    let h = '';
    if (r.track.closed) {
      h += `<p class="good">The circuit is complete!</p>`;
      if (!r.entrance || !r.exit) h += `<p>Now place the entrance and exit beside a station piece.</p><div class="row" data-ride="${r.id}">${!r.entrance ? '<button class="primary" data-act="placeEnt">Place entrance</button>' : ''}${!r.exit ? '<button class="primary" data-act="placeExit">Place exit</button>' : ''}</div>`;
      else h += `<p>Open the ride window to test and open it.</p><div class="row"><button class="primary" data-act="openRide" data-arg="${r.id}">Ride window</button></div>`;
      h += `<div class="row"><button data-act="removePiece">Remove last piece</button><button data-act="builderDone">Close</button></div>`;
      return h;
    }
    const kart = r.type === 'karts';
    h += '<div class="tgrp"><span>Direction</span>';
    h += btn('turn', '-1s', kart ? '&#8630;' : '&#8630;', 'Small left curve', s.turn === -1 && s.size === 's');
    if (kart) h += btn('turn', '-1t', '&#10554;', 'Tight left', s.turn === -1 && s.size === 't');
    h += btn('turn', '-1l', '&#8598;', 'Large left curve', s.turn === -1 && s.size === 'l');
    h += btn('turn', '0', '&#8593;', 'Straight', s.turn === 0);
    h += btn('turn', '1l', '&#8599;', 'Large right curve', s.turn === 1 && s.size === 'l');
    if (kart) h += btn('turn', '1t', '&#10555;', 'Tight right', s.turn === 1 && s.size === 't');
    h += btn('turn', '1s', '&#8631;', 'Small right curve', s.turn === 1 && s.size === 's');
    h += '</div><div class="tgrp"><span>Slope</span>';
    if (r.type !== 'karts') h += btn('slope', '-2', '&#8650;', 'Steep down', s.slope === -2);
    h += btn('slope', '-1', '&#8600;', 'Down', s.slope === -1) + btn('slope', '0', '&#8594;', 'Level', s.slope === 0) + btn('slope', '1', '&#8599;', 'Up', s.slope === 1);
    if (r.type === 'coaster') h += btn('slope', '2', '&#8648;', 'Steep up', s.slope === 2);
    h += '</div>';
    if (r.type === 'coaster') {
      h += '<div class="tgrp"><span>Bank</span>' + btn('bank', '-1', 'L', 'Bank left', s.bank === -1) + btn('bank', '0', '&ndash;', 'No bank', s.bank === 0) + btn('bank', '1', 'R', 'Bank right', s.bank === 1) + '</div>';
      h += `<div class="tgrp"><span>Extras</span>${btn('special', 'station', 'Station', 'Station piece', s.special === 'station')}${btn('special', 'brakes', 'Brakes', 'Brakes', s.special === 'brakes')}${btn('special', 'loopL', 'Loop &#9664;', 'Vertical loop, exits left', s.special === 'loopL')}${btn('special', 'loopR', 'Loop &#9654;', 'Vertical loop, exits right', s.special === 'loopR')}${btn('lift', 'x', 'Lift hill', 'Chain lift on climbing pieces', b.lift)}</div>`;
    } else h += `<div class="tgrp"><span>Extras</span>${btn('special', 'station', 'Station', 'Station piece', s.special === 'station')}</div>`;
    let info = '';
    if (np.error) info = `<span class="bad">${esc(np.error)}</span>`;
    else if (np.check.ok) info = `Next: <b>${esc(PIECES[np.pid].name)}</b> &middot; ${money(np.check.cost)}`;
    else info = `<span class="bad">${esc(PIECES[np.pid].name)}: ${esc(np.check.reason)}</span>`;
    h += `<p class="binfo">${info}</p><div class="row"><button class="primary" data-act="placePiece" ${np.pid && np.check.ok ? '' : 'disabled'}>Build piece</button><button data-act="removePiece">Remove last</button><button data-act="builderDone">Close</button></div>`;
    h += `<p class="muted">Track so far: ${r.track.pieces.length} pieces, ${money(r.cost, 0)}. Bring the track back round to the start of the station to finish.</p>`;
    return h;
  }
  builderSel(arg, el) {
    const b = this.builder; if (!b) return;
    const [k, v] = arg.split(':');
    const s = b.sel;
    if (k === 'turn') { if (s.special !== 'station') s.special = null; s.turn = parseInt(v, 10); s.size = v.endsWith('l') ? 'l' : v.endsWith('t') ? 't' : 's'; if (s.turn === 0) s.size = 's'; }
    else if (k === 'slope') { s.special = null; s.slope = +v; if (s.slope !== 0) s.bank = 0; }
    else if (k === 'bank') { s.bank = +v; if (s.bank) { s.slope = 0; if (s.turn === 0) s.turn = s.bank; s.turn = s.bank; } }
    else if (k === 'special') {
      s.special = s.special === v ? null : v;
    } else if (k === 'lift') {
      if (!this.game.available.has('track:lift')) { this.toast('Lift hills are not researched yet.', true); return; }
      b.lift = !b.lift;
    }
    void el;
    this.updateBuilder();
  }
  placeNextPiece() {
    const np = this.nextPiece();
    if (!np || np.done) return;
    if (np.error) return this.toast(np.error, true);
    if (!np.check.ok) return this.toast(np.check.reason, true);
    const res = Rides.placePiece(this.game, np.r, np.pid, this.builder.lift);
    if (!res.ok) return this.toast(res.reason, true);
    this.app.audio.play('place');
    this.app.renderer.addFloater(np.r.track.cursor.x + 0.5, np.r.track.cursor.y + 0.5, np.r.track.cursor.z, `-${money(np.check.cost, 0)}`, '#ff9a8a');
    // after a one-off special piece, go back to plain track
    if (['loopL', 'loopR', 'brakes'].includes(this.builder.sel.special)) this.builder.sel.special = null;
    if (res.closed) {
      this.toast('Circuit complete! Now place the entrance and exit.');
      this.app.audio.play('fanfare');
    }
    this.updateBuilder();
  }
  removePiece() {
    const b = this.builder; if (!b) return;
    const r = this.game.ride(b.rideId);
    if (!r || r.track.pieces.length <= 1) { this.toast('Use Demolish in the ride window to remove the whole ride.', true); return; }
    Rides.removeLastPiece(this.game, r);
    this.updateBuilder();
  }

  // ================================================================== per-frame
  frame() {
    if (this.follow) {
      const g = this.game;
      const e = this.follow.k === 'guest' ? g.guests.find((q) => q.id === this.follow.id) : g.staff.find((s) => s.id === this.follow.id);
      if (e && !e.gone) { const c = this.r.cam; c.x += (e.x - c.x) * 0.15; c.y += (e.y - c.y) * 0.15; }
      else this.follow = null;
    }
  }
  uiState() {
    return { highlight: this.highlight(), selectedGuest: this.selectedGuest, selectedStaff: this.selectedStaff };
  }
}

export { DX, DY, pieceFootprint };
