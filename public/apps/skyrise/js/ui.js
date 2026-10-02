// Skyrise — DOM user interface: toolbar, pointer input, info bar, panels and dialogs.
import { FAC, TRANSPORT, floorLabel, PRICE_NAMES, stressTier, evalTier, INCOME_CATS, INCOME_LABELS, MAINT_CATS, MAINT_LABELS, FILMS, FILM_COST, DAY_NAMES, STAR_LANDMARK, isExpressStop, LIMITS } from './data.js';
import { clockString, dayTick, PERIOD_NAMES } from './clock.js';
import { U, FH } from './art.js';
import { levelAt, yOf } from './render.js';
import { personName, accessPoint } from './people.js';
import * as E from './events.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString();

// ---------------------------------------------------------------- icons (hand-made pictograms)
const I = {
  inspect: '<circle cx="11" cy="9" r="6" fill="none" stroke="#cfe3ff" stroke-width="2.2"/><path d="M15 13l6 6" stroke="#cfe3ff" stroke-width="3" stroke-linecap="round"/>',
  bulldoze: '<rect x="3" y="9" width="13" height="7" rx="1" fill="#f6c445"/><rect x="6" y="5" width="6" height="5" fill="#f6c445"/><path d="M16 8l6 2v7h-6" fill="#9aa6bf"/><circle cx="6" cy="18" r="2.2" fill="#333"/><circle cx="13" cy="18" r="2.2" fill="#333"/>',
  adjust: '<path d="M10 20V7a2 2 0 014 0v6l3-1a2 2 0 012 2l-1 6z" fill="#f1c9a5" stroke="#8a6a50"/><path d="M5 4l2 3M3 9h3" stroke="#f6c445" stroke-width="1.5"/>',
  lobby: '<rect x="2" y="6" width="22" height="13" fill="#efe6d6"/><rect x="4" y="8" width="5" height="9" fill="#9cc9ea"/><rect x="11" y="8" width="5" height="9" fill="#9cc9ea"/><rect x="18" y="8" width="4" height="9" fill="#9cc9ea"/><rect x="2" y="18" width="22" height="2" fill="#596273"/>',
  floor: '<rect x="2" y="16" width="22" height="3" fill="#7a8494"/><rect x="4" y="5" width="2" height="11" fill="#9aa6bf"/><rect x="12" y="5" width="2" height="11" fill="#9aa6bf"/><rect x="20" y="5" width="2" height="11" fill="#9aa6bf"/>',
  stairs: '<path d="M3 19h4v-4h4v-4h4V7h4V3h4" fill="none" stroke="#c49a6c" stroke-width="2.5"/>',
  escalator: '<path d="M3 18l17-13" stroke="#9aa6bf" stroke-width="5" stroke-linecap="round"/><path d="M3 13l17-13" stroke="#333" stroke-width="1.5" transform="translate(0 3)"/>',
  elevator: '<rect x="7" y="2" width="12" height="18" rx="1" fill="#28324a" stroke="#5a7fb0" stroke-width="2"/><rect x="9" y="8" width="8" height="8" fill="#d6e2f2"/><path d="M13 3l-2 2h4z" fill="#cfe3ff"/>',
  express: '<rect x="5" y="2" width="16" height="18" rx="1" fill="#28324a" stroke="#c9a95c" stroke-width="2"/><rect x="7" y="8" width="12" height="8" fill="#e9d8a6"/><path d="M13 3l-3 3h6z" fill="#f6c445"/>',
  service: '<rect x="7" y="2" width="12" height="18" rx="1" fill="#28324a" stroke="#6a8a6a" stroke-width="2"/><rect x="9" y="8" width="8" height="8" fill="#b9d1b0"/><rect x="11" y="10" width="4" height="4" fill="#6b8fa3"/>',
  office: '<rect x="2" y="4" width="22" height="16" fill="#e9eef3"/><rect x="4" y="6" width="5" height="4" fill="#2a9d8f"/><rect x="11" y="6" width="5" height="4" fill="#2a9d8f"/><rect x="18" y="6" width="4" height="4" fill="#2a9d8f"/><rect x="4" y="14" width="18" height="2" fill="#8b6d4f"/>',
  condo: '<path d="M2 11l11-8 11 8v9H2z" fill="#f3ebe2"/><rect x="5" y="13" width="6" height="4" fill="#e76f51"/><rect x="15" y="12" width="5" height="8" fill="#a07a55"/>',
  fastfood: '<rect x="2" y="5" width="22" height="15" fill="#fff4dc"/><rect x="2" y="5" width="22" height="4" fill="#e76f51"/><rect x="4" y="14" width="9" height="6" fill="#c0392b"/><circle cx="19" cy="15" r="3" fill="#f6c445"/>',
  restaurant: '<rect x="2" y="5" width="22" height="15" fill="#5b2333"/><rect x="5" y="14" width="16" height="2" fill="#f4efe6"/><path d="M8 8v5M18 8v5" stroke="#c9a95c" stroke-width="1.5"/><circle cx="13" cy="11" r="1.5" fill="#ffd56b"/>',
  shop: '<rect x="3" y="7" width="20" height="13" fill="#fbfaf7"/><path d="M3 7l2-4h16l2 4z" fill="#e98bc4"/><rect x="6" y="10" width="3" height="6" fill="#2a9d8f"/><rect x="11" y="10" width="3" height="6" fill="#e76f51"/><rect x="16" y="10" width="3" height="6" fill="#7b5ea7"/>',
  single: '<rect x="4" y="12" width="18" height="5" fill="#fff"/><rect x="4" y="10" width="5" height="3" fill="#cde"/><rect x="3" y="8" width="2" height="11" fill="#7b5ea7"/><rect x="9" y="11" width="13" height="3" fill="#b8a3e0"/>',
  twin: '<rect x="2" y="12" width="10" height="5" fill="#fff"/><rect x="14" y="12" width="10" height="5" fill="#fff"/><rect x="5" y="11" width="7" height="3" fill="#9c86d1"/><rect x="17" y="11" width="7" height="3" fill="#9c86d1"/>',
  suite: '<rect x="2" y="12" width="12" height="5" fill="#fff"/><rect x="5" y="11" width="9" height="3" fill="#7b5ea7"/><rect x="16" y="10" width="7" height="7" fill="#c9a95c"/><path d="M13 3l1.5 3 3 .4-2.2 2 .6 3-2.9-1.5-2.9 1.5.6-3-2.2-2 3-.4z" fill="#f6c445"/>',
  housekeeping: '<rect x="4" y="9" width="12" height="9" fill="#6b8fa3"/><rect x="4" y="6" width="12" height="3" fill="#fff"/><circle cx="6" cy="19" r="1.6" fill="#333"/><circle cx="14" cy="19" r="1.6" fill="#333"/><path d="M19 4v14" stroke="#c49a6c" stroke-width="2"/><path d="M17 18h4l-1 3h-2z" fill="#f6c445"/>',
  security: '<path d="M13 2l9 3v6c0 5-4 8-9 10C8 19 4 16 4 11V5z" fill="#2c4a7a"/><path d="M13 7v8M9 11h8" stroke="#f6c445" stroke-width="2"/>',
  clinic: '<rect x="3" y="4" width="20" height="16" rx="2" fill="#f4f8fb"/><path d="M13 7v10M8 12h10" stroke="#e5484d" stroke-width="3.5"/>',
  recycling: '<path d="M13 3l4 6h-8zM5 18l2-7 5 4zM21 18l-7 0 3-5z" fill="#3f8f4f"/>',
  party: '<circle cx="8" cy="8" r="4" fill="#e5484d"/><circle cx="17" cy="7" r="4" fill="#4aa3df"/><path d="M8 12l1 8M17 11l-1 9" stroke="#ccc"/><rect x="3" y="17" width="20" height="3" fill="#c9a95c"/>',
  cinema: '<rect x="2" y="4" width="22" height="12" fill="#1f1b2e" stroke="#c9a95c"/><rect x="4" y="6" width="18" height="8" fill="#e8e4f2"/><rect x="4" y="17" width="4" height="3" fill="#7a2333"/><rect x="11" y="17" width="4" height="3" fill="#7a2333"/><rect x="18" y="17" width="4" height="3" fill="#7a2333"/>',
  parkspace: '<rect x="2" y="15" width="22" height="3" fill="#555"/><rect x="4" y="9" width="18" height="6" rx="2" fill="#c0392b"/><rect x="8" y="6" width="10" height="4" fill="#c0392b"/><circle cx="8" cy="16" r="2" fill="#222"/><circle cx="18" cy="16" r="2" fill="#222"/>',
  parkramp: '<path d="M2 20L24 4v4L8 20z" fill="#9aa6bf"/><path d="M8 16l3-2M14 12l3-2" stroke="#f6c445" stroke-width="1.5"/>',
  transit: '<rect x="3" y="5" width="20" height="12" rx="3" fill="#e5484d"/><rect x="5" y="7" width="7" height="5" fill="#cde8f6"/><rect x="14" y="7" width="7" height="5" fill="#cde8f6"/><path d="M5 20l3-3M21 20l-3-3" stroke="#bbb" stroke-width="2"/>',
  landmark: '<path d="M3 20V12l5-4 5-6 5 6 5 4v8z" fill="#e9e4d8"/><circle cx="13" cy="12" r="3" fill="#ffd1e0" stroke="#c9a95c"/><rect x="12.4" y="0" width="1.2" height="5" fill="#c9a95c"/>',
};
const icon = (id) => `<svg viewBox="0 0 26 22" aria-hidden="true">${I[id] || ''}</svg>`;

const LABEL = (id) => FAC[id] ? FAC[id].label : TRANSPORT[id] ? TRANSPORT[id].label : ({ inspect: 'Inspect', bulldoze: 'Bulldoze', adjust: 'Adjust lifts', floor: 'Floor' })[id] || id;
const COST = (id) => FAC[id] ? (id === 'lobby' ? '$5,000/unit' : money(FAC[id].cost)) : TRANSPORT[id] ? money(TRANSPORT[id].cost) : id === 'floor' ? '$500/unit' : 'free';
const STAR = (id) => FAC[id] ? FAC[id].star : TRANSPORT[id] ? TRANSPORT[id].star : 1;
const DESC = {
  inspect: 'Click anyone or anything for details.', bulldoze: 'Remove transport or a facility. Free.', adjust: 'Drag a lift shaft\'s top or bottom to resize it; click a floor to switch its stop on or off.',
  lobby: 'Ground floor first. Sky lobbies on 15, 30, 45, 60, 75, 90. Drag to widen.', floor: 'Bare floor. Drag to extend.', stairs: 'Joins two floors. People climb at most 4 flights.',
  escalator: 'For lobby, shop, food and entertainment floors. No waiting.', elevator: 'Up to 30 floors. Drag to set its span; click a shaft to add a car.',
  express: 'Stops only at lobby floors and basements. Drag to set its span.', service: 'For staff only. Must stop at recycling plants.',
  office: '6 workers, quarterly rent.', condo: 'Sold once; refunded if the owners leave.', fastfood: 'Lunch and snack trade, 10:00–21:00.', restaurant: 'Dinner trade, 17:00–23:00.', shop: 'Quarterly rent from the shopkeeper.',
  single: 'One guest a night.', twin: 'Two guests a night.', suite: 'Needs a free parking bay. VIPs only stay in suites.', housekeeping: 'Six cleaners for the hotel rooms.',
  security: 'Fights fires, searches for bombs. Two needed for 3 stars.', clinic: 'Keeps a big workforce healthy.', recycling: 'Big towers need them; a service lift must stop here.',
  party: 'Banquets each afternoon once the tower has 10 hotel rooms.', cinema: 'Draws crowds who shop nearby.', parkspace: 'Underground. Drag a row next to a ramp.', parkramp: 'Underground column from B1 down.',
  transit: 'Lowest basements. Brings shoppers by train.', landmark: 'Crowns floor 100.',
};
const MODE = { lobby: 'h', floor: 'h', parkspace: 'h', elevator: 'v', express: 'v', service: 'v', parkramp: 'col', stairs: 's', escalator: 's', bulldoze: 'b', adjust: 'a', inspect: 'i' };

const TOOLS = [
  ['inspect'], ['bulldoze'], ['adjust'],
  ['Build', 'lobby', 'floor', 'stairs'], ['escalator'],
  ['Lifts', 'elevator', 'express', 'service'],
  ['office'], ['condo'],
  ['Hotel', 'single', 'twin', 'suite', 'housekeeping'],
  ['Food', 'fastfood', 'restaurant'], ['shop'],
  ['Fun', 'party', 'cinema'],
  ['Services', 'security', 'clinic', 'recycling'],
  ['Parking', 'parkspace', 'parkramp'],
  ['transit'], ['landmark'],
];

export class UI {
  constructor(app) {
    this.app = app; // {game, renderer, sound, setSpeed, speed, save, load, newGame}
    this.tool = 'inspect';
    this.groupSel = {};
    this.lobbyH = 1;
    this.replace = false;
    this.anchor = null;
    this.drag = null;
    this.pointers = new Map();
    this.space = false;
    this.msgs = [];
    this.tickerIdx = 0;
    this.modalOpen = false;
    this.pausedBy = null;
    this.panelRefresh = null;
    this.buildToolbar();
    this.bindInput();
    this.bindBar();
    setInterval(() => this.rotateTicker(), 4000);
  }
  get g() { return this.app.game; }
  get r() { return this.app.renderer; }

  // ------------------------------------------------------------ messages
  onGameEvent(type, d) {
    if (type === 'msg') { this.msgs.unshift({ text: d.text, t: Date.now() }); this.msgs.length = Math.min(this.msgs.length, 30); this.showTicker(d.text); }
    else if (type === 'sound') this.app.sound.play(d.name);
    else if (type === 'dialog') this.dialog(d);
    else if (type === 'star') this.buildToolbar();
    else if (type === 'day') this.app.autosave();
    else if (type === 'holiday') this.showTicker('Seasonal lanterns are rising over the city tonight.');
  }
  showTicker(text, cls) { const t = $('#ticker'); t.innerHTML = `<span class="${cls || ''}">${esc(text)}</span>`; this.tickerHold = Date.now(); }
  rotateTicker() {
    if (Date.now() - (this.tickerHold || 0) < 6000) return;
    const unmet = this.g.demands.filter(d => !d.met);
    if (unmet.length) { this.tickerIdx = (this.tickerIdx + 1) % unmet.length; $('#ticker').innerHTML = `<span class="dem">● ${esc(unmet[this.tickerIdx].text)}</span>`; }
    else if (this.msgs.length) $('#ticker').textContent = this.msgs[0].text;
    else $('#ticker').textContent = this.g.hasGroundLobby() ? 'All quiet. Build up, wire up the lifts, keep people happy.' : 'Start by dragging a lobby along the ground floor.';
  }

  // ------------------------------------------------------------ toolbar
  buildToolbar() {
    const tb = $('#toolbar');
    tb.innerHTML = '';
    for (const t of TOOLS) {
      const isGroup = t.length > 1;
      const id = isGroup ? (this.groupSel[t[0]] || t[1]) : t[0];
      const b = document.createElement('button');
      b.className = 'tool';
      const locked = STAR(id) > this.g.star;
      if (locked && !isGroup) b.classList.add('locked');
      if (this.tool === id || (isGroup && t.slice(1).includes(this.tool))) b.classList.add('on');
      b.innerHTML = icon(id) + `<span class="l">${esc(isGroup ? t[0] : LABEL(id))}</span>` + (locked && !isGroup ? `<span class="lock">★${STAR(id)}</span>` : '') + (isGroup ? '<span class="grp">▴</span>' : '');
      b.title = isGroup ? t[0] : `${LABEL(id)} (${COST(id)}${STAR(id) > 1 ? ', needs ' + STAR(id) + '★' : ''})\n${DESC[id] || ''}`;
      b.onclick = (e) => { e.stopPropagation(); if (isGroup) this.openFlyout(t, b); else this.setTool(id); };
      tb.appendChild(b);
    }
  }
  openFlyout(t, btn) {
    const fo = $('#flyout');
    if (!fo.classList.contains('hidden') && fo.dataset.g === t[0]) { fo.classList.add('hidden'); return; }
    fo.dataset.g = t[0];
    fo.innerHTML = '';
    for (const id of t.slice(1)) {
      const b = document.createElement('button');
      const locked = STAR(id) > this.g.star;
      b.disabled = locked;
      if (this.tool === id) b.classList.add('on');
      b.innerHTML = icon(id) + `<span><b>${esc(LABEL(id))}</b> <small>${COST(id)}${locked ? ' · unlocks at ' + STAR(id) + '★' : ''} · ${esc(DESC[id] || '')}</small></span>`;
      b.onclick = (e) => { e.stopPropagation(); this.groupSel[t[0]] = id; this.setTool(id); fo.classList.add('hidden'); };
      fo.appendChild(b);
    }
    fo.classList.remove('hidden');
    const r = btn.getBoundingClientRect();
    const fr = fo.getBoundingClientRect();
    fo.style.left = Math.max(8, Math.min(window.innerWidth - fr.width - 8, r.left)) + 'px';
    fo.style.top = Math.max(8, r.top - fr.height - 6) + 'px';
  }
  setTool(id) {
    if (STAR(id) > this.g.star) { this.hint(LABEL(id) + ' unlocks at ' + STAR(id) + ' stars.', true); return; }
    this.tool = id; this.anchor = null; this.drag = null; this.r.ghost = null;
    this.buildToolbar();
    this.toolOptions();
    this.hint(LABEL(id) + ': ' + (DESC[id] || ''), false, 3500);
  }
  toolOptions() {
    const o = $('#toolopts');
    o.innerHTML = '';
    const id = this.tool;
    const parts = [];
    if (id === 'lobby' && !this.g.hasGroundLobby()) {
      parts.push('<span>Ground lobby height:</span>' + [1, 2, 3].map(h => `<button data-lh="${h}" class="${this.lobbyH === h ? 'on' : ''}">${h} floor${h > 1 ? 's' : ''}</button>`).join(''));
    }
    if (FAC[id] && id !== 'lobby') parts.push(`<label class="toggle"><input type="checkbox" id="replTog" ${this.replace ? 'checked' : ''}> Replace what is there (or hold Shift)</label>`);
    if (this.anchor) parts.push('<button id="cancelAnchor">Cancel</button>');
    if (!parts.length) { o.classList.remove('show'); return; }
    o.innerHTML = parts.join('');
    o.classList.add('show');
    o.querySelectorAll('[data-lh]').forEach(b => b.onclick = () => { this.lobbyH = +b.dataset.lh; this.toolOptions(); });
    const rt = o.querySelector('#replTog'); if (rt) rt.onchange = () => { this.replace = rt.checked; };
    const ca = o.querySelector('#cancelAnchor'); if (ca) ca.onclick = () => { this.anchor = null; this.r.ghost = null; this.toolOptions(); };
    this.app.layout();
  }
  hint(text, bad, ms = 2500) {
    const h = $('#hint');
    h.textContent = text; h.className = bad ? 'bad' : ''; h.style.display = 'block';
    clearTimeout(this._ht); this._ht = setTimeout(() => { h.style.display = 'none'; }, ms);
    if (bad) this.app.sound.play('refuse');
  }

  // ------------------------------------------------------------ input
  cell(sx, sy) {
    const w = this.r.toWorld(sx, sy);
    return { ux: w.x / U, L: levelAt(w.y), wx: w.x, wy: w.y };
  }
  bindInput() {
    const cv = $('#view');
    cv.addEventListener('contextmenu', e => e.preventDefault());
    cv.addEventListener('pointerdown', e => this.down(e));
    cv.addEventListener('pointermove', e => this.move(e));
    cv.addEventListener('pointerup', e => this.up(e));
    cv.addEventListener('pointercancel', e => { this.pointers.delete(e.pointerId); this.drag = null; });
    cv.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse' && !this.drag) this.r.ghost = this.anchor ? this.r.ghost : null; });
    cv.addEventListener('wheel', e => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) { this.r.zoomAt(e.offsetX, e.offsetY, this.r.cam.z * (e.deltaY < 0 ? 1.15 : 1 / 1.15)); return; }
      const k = e.deltaMode === 1 ? 30 : 1;
      let dx = e.deltaX * k, dy = e.deltaY * k;
      if (e.shiftKey && !dx) { dx = dy; dy = 0; }
      this.r.cam.x += dx / this.r.cam.z; this.r.cam.y += dy / this.r.cam.z; this.r.clampCam();
    }, { passive: false });
    window.addEventListener('keydown', e => {
      if (e.target.tagName === 'INPUT') return;
      if (e.key === ' ') { e.preventDefault(); this.space = true; if (!e.repeat) this.app.togglePause(); }
      else if (e.key === 'Shift') this.shift = true;
      else if (e.key >= '1' && e.key <= '4') this.app.setSpeed([1, 2, 4, 8][+e.key - 1]);
      else if (e.key === 'Escape') { if (this.modalOpen) this.closePanel(); else { this.anchor = null; this.r.ghost = null; this.setTool('inspect'); } }
      else if (e.key === '+' || e.key === '=') this.r.zoomAt(this.r.vw / 2, this.r.vh / 2, this.r.cam.z * 1.25);
      else if (e.key === '-') this.r.zoomAt(this.r.vw / 2, this.r.vh / 2, this.r.cam.z / 1.25);
      else if (e.key.startsWith('Arrow')) { const s = 60 / this.r.cam.z; if (e.key === 'ArrowLeft') this.r.cam.x -= s; if (e.key === 'ArrowRight') this.r.cam.x += s; if (e.key === 'ArrowUp') this.r.cam.y -= s; if (e.key === 'ArrowDown') this.r.cam.y += s; this.r.clampCam(); }
    });
    window.addEventListener('keyup', e => { if (e.key === ' ') this.space = false; if (e.key === 'Shift') this.shift = false; });
    document.addEventListener('pointerdown', (e) => { const fo = $('#flyout'); if (!fo.contains(e.target)) fo.classList.add('hidden'); }, true);
    $('#zoom').addEventListener('click', e => { const z = e.target.dataset.z; if (!z) return; this.r.zoomAt(this.r.vw / 2, this.r.vh / 2, this.r.cam.z * (z === 'in' ? 1.4 : 1 / 1.4)); });
    // minimap
    const mm = $('#minimap');
    const jump = (e) => {
      const rc = mm.getBoundingClientRect();
      const fx = (e.clientX - rc.left) / rc.width, fy = (e.clientY - rc.top) / rc.height;
      const L = 103 - fy * (103 + 10 + 1);
      this.r.centerOn(fx * 400 * U, yOf(L));
    };
    mm.addEventListener('pointerdown', e => { e.preventDefault(); mm.setPointerCapture(e.pointerId); jump(e); this._mmDrag = true; });
    mm.addEventListener('pointermove', e => { if (this._mmDrag) jump(e); });
    mm.addEventListener('pointerup', () => { this._mmDrag = false; });
    $('#overlays').addEventListener('click', e => { const ov = e.target.dataset.ov; if (!ov) return; this.setOverlay(ov); });
    $('#miniToggle').onclick = () => { $('#mini').classList.toggle('collapsed'); $('#miniToggle').textContent = $('#mini').classList.contains('collapsed') ? '▸' : '▾'; };
  }
  setOverlay(ov) {
    this.r.overlay = ov;
    document.querySelectorAll('#overlays button').forEach(b => b.classList.toggle('on', b.dataset.ov === ov));
    if (ov !== 'none') { if (this.pausedBy !== 'overlay' && this.app.speed > 0) { this.resumeSpeed = this.app.speed; this.pausedBy = 'overlay'; } this.app.setSpeed(0, true); }
    else if (this.pausedBy === 'overlay') { this.pausedBy = null; this.app.setSpeed(this.resumeSpeed || 1); }
  }

  down(e) {
    const cv = $('#view');
    cv.setPointerCapture(e.pointerId);
    this.app.sound.ensure();
    this.pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY, sx: e.offsetX, sy: e.offsetY, type: e.pointerType });
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: this.r.cam.z, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
      this.drag = { mode: 'pinch' };
      return;
    }
    const pan = e.button === 1 || e.button === 2 || this.space || !!this.app.preview;
    this.drag = { mode: pan ? 'pan' : 'pending', sx: e.offsetX, sy: e.offsetY, lx: e.offsetX, ly: e.offsetY, touch: e.pointerType !== 'mouse', shift: e.shiftKey };
  }
  move(e) {
    const p = this.pointers.get(e.pointerId);
    if (p) { p.x = e.offsetX; p.y = e.offsetY; }
    const d = this.drag;
    if (d && d.mode === 'pinch' && this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      this.r.zoomAt(cx, cy, this.pinch.z * dist / this.pinch.d);
      this.r.cam.x -= (cx - this.pinch.cx) / this.r.cam.z; this.r.cam.y -= (cy - this.pinch.cy) / this.r.cam.z;
      this.pinch.cx = cx; this.pinch.cy = cy; this.r.clampCam();
      return;
    }
    if (!d) { if (e.pointerType === 'mouse') this.hover(e.offsetX, e.offsetY, e.shiftKey); return; }
    if (d.mode === 'pending') {
      const moved = Math.hypot(e.offsetX - d.sx, e.offsetY - d.sy);
      if (moved > 6) {
        const m = MODE[this.tool] || 'f';
        if (!d.touch && (m === 'h' || m === 'v' || m === 'col' || m === 'b' || m === 'a')) {
          d.mode = 'tool';
          d.start = this.cell(d.sx, d.sy);
          if (m === 'a') d.adjust = this.adjustTarget(d.start);
          if (m === 'a' && !d.adjust) d.mode = 'pan';
        } else d.mode = 'pan';
      }
    }
    if (d.mode === 'pan') {
      this.r.cam.x -= (e.offsetX - d.lx) / this.r.cam.z; this.r.cam.y -= (e.offsetY - d.ly) / this.r.cam.z; this.r.clampCam();
    } else if (d.mode === 'tool') {
      const cur = this.cell(e.offsetX, e.offsetY);
      if (this.tool === 'bulldoze') this.bulldozeAt(cur);
      else this.r.ghost = this.ghostFor(d.start, cur, e.shiftKey || this.replace, d.adjust);
    }
    d.lx = e.offsetX; d.ly = e.offsetY;
  }
  up(e) {
    this.pointers.delete(e.pointerId);
    const d = this.drag;
    if (!d) return;
    if (d.mode === 'pinch') { if (this.pointers.size === 0) this.drag = null; return; }
    this.drag = null;
    const cur = this.cell(e.offsetX, e.offsetY);
    if (d.mode === 'pending') this.tap(cur, d.touch, e.shiftKey || this.replace);
    else if (d.mode === 'tool') this.commit(d.start, cur, e.shiftKey || this.replace, d.adjust);
    if (e.pointerType === 'mouse') this.hover(e.offsetX, e.offsetY, e.shiftKey);
  }
  hover(sx, sy, shift) {
    if (this.tool === 'inspect' || this.tool === 'bulldoze') { this.r.ghost = null; return; }
    const cur = this.cell(sx, sy);
    this.r.ghost = this.ghostFor(this.anchor || cur, cur, shift || this.replace);
  }

  // which shaft end (or floor) does the adjust tool grab?
  adjustTarget(c) {
    const T = this.g.tower;
    const x = Math.floor(c.ux);
    for (const s of this.g.shafts()) {
      if (x < s.x || x >= s.x + s.w) continue;
      if (c.L === s.top || c.L === s.top + 1) return { s, end: 'top' };
      if (c.L === s.bottom || c.L === s.bottom - 1) return { s, end: 'bottom' };
      if (c.L > s.bottom && c.L < s.top) return { s, end: null };
    }
    return null;
  }

  // ghost rectangles for the current tool
  ghostFor(a, b, repl, adj) {
    const g = this.g, id = this.tool;
    const m = MODE[id] || 'f';
    const rects = [];
    let ok = true, reason = '', cost = 0;
    if (m === 'a') {
      if (!adj || !adj.end) return null;
      const s = adj.s;
      let nb = s.bottom, nt = s.top;
      if (adj.end === 'top') nt = Math.max(s.bottom + 1, b.L); else nb = Math.min(s.top - 1, b.L);
      const r = g.tower.checkTransport(s.kind, s.x, nb, nt, s.id);
      rects.push({ x: s.x, L: nb, w: s.w, h: nt - nb + 1 });
      return { rects, ok: r.ok, reason: r.reason };
    }
    if (FAC[id]) {
      const d = FAC[id];
      const L = b.L;
      if (m === 'h') {
        const x0 = Math.round(a.ux - d.w / 2), x1 = Math.round(b.ux - d.w / 2);
        const n = Math.floor(Math.abs(x1 - x0) / d.w);
        const dir = x1 >= x0 ? 1 : -1;
        const La = a.L === undefined ? L : a.L;
        for (let i = 0; i <= n; i++) {
          const x = x0 + dir * i * d.w;
          const r = g.checkBuild(id, x, La, { replace: repl, lobbyHeight: this.lobbyH });
          const h = id === 'lobby' && La === 0 ? (g.tower.lobbyHeight || this.lobbyH) : d.h;
          rects.push({ x, L: La, w: d.w, h });
          if (r.ok) cost += r.cost; else if (ok) { ok = i > 0; reason = r.reason; if (i === 0) ok = false; }
        }
      } else if (m === 'col') {
        const x0 = Math.round(a.ux - d.w / 2);
        const L0 = a.L, L1 = b.L;
        const st = L1 >= L0 ? 1 : -1;
        for (let L2 = L0; L2 !== L1 + st; L2 += st) {
          rects.push({ x: x0, L: L2, w: d.w, h: 1 });
        }
        const r = g.checkBuild(id, x0, Math.max(L0, L1) === L0 ? L0 : L1, { replace: repl });
        ok = r.ok || rects.length > 1; reason = r.reason; cost = d.cost * rects.length;
      } else {
        const x = repl ? Math.round(b.ux - d.w / 2) : this.snapX(id, Math.round(b.ux - d.w / 2), L);
        const r = g.checkBuild(id, x, L, { replace: repl, lobbyHeight: this.lobbyH });
        rects.push({ x, L, w: d.w, h: d.h });
        ok = r.ok; reason = r.reason || ''; cost = r.cost || 0;
        if (ok && d.sensitive && g.tower.facAt) {
          // noise warning while placing
          const fake = { x, L, w: d.w, h: 1, type: id };
          if (g.tower.isNoisy(fake)) reason = 'Noisy neighbours here will annoy the occupants.';
        }
      }
    } else if (id === 'floor') {
      const x0 = Math.floor(Math.min(a.ux, b.ux)), x1 = Math.floor(Math.max(a.ux, b.ux));
      const r = g.tower.checkFloor(x0, x1, a.L);
      rects.push({ x: x0, L: a.L, w: x1 - x0 + 1, h: 1 });
      ok = r.ok; reason = r.reason || ''; cost = r.slabCost || 0;
    } else if (TRANSPORT[id]) {
      const d = TRANSPORT[id];
      const x = Math.round(b.ux - d.w / 2);
      if (m === 's') {
        const r = g.checkTransport(id, x, b.L, b.L + 1);
        rects.push({ x, L: b.L, w: d.w, h: 2 });
        ok = r.ok; reason = r.reason || ''; cost = r.cost || 0;
      } else {
        const ax = Math.round(a.ux - d.w / 2);
        const lo = Math.min(a.L, b.L), hi = Math.max(a.L, b.L);
        const onShaft = this.shaftAt(b, id);
        if (lo === hi && onShaft) { return { rects: [], ok: true, reason: 'Click to add a car here (' + money(d.carCost) + ').' }; }
        const r = g.checkTransport(id, ax, lo, Math.max(hi, lo + 1));
        rects.push({ x: ax, L: lo, w: d.w, h: Math.max(hi, lo + 1) - lo + 1 });
        ok = r.ok; reason = r.reason || (lo === hi ? 'Drag up or down to choose the floors.' : ''); cost = r.cost || 0;
      }
    }
    const gh = { rects, ok, reason, cost, anchor: this.anchor ? { x: this.anchor.ux, L: this.anchor.L } : null };
    const h = $('#hint');
    if (rects.length) { h.style.display = 'block'; h.className = ok ? '' : 'bad'; h.textContent = (ok ? LABEL(id) + (cost ? ' · ' + money(cost) : '') : '') + (reason ? (ok ? ' · ' : '') + reason : ''); clearTimeout(this._ht); this._ht = setTimeout(() => { h.style.display = 'none'; }, 1500); }
    return gh;
  }
  // nudge a footprint up to 3 units so it sits flush against existing floor or rooms
  snapX(id, x, L) {
    const T = this.g.tower, d = FAC[id];
    if (!d || L === 0) return x;
    const ok = (xx) => this.g.tower.checkFacility(id, xx, L, {}).ok;
    const touches = (xx) => T.hasSlab(L, xx - 1) || T.hasSlab(L, xx + d.w);
    const inside = (xx) => { for (let i = xx; i < xx + d.w; i++) if (!T.hasSlab(L, i)) return false; return true; };
    if (ok(x) && (inside(x) || touches(x))) return x;
    let best = x, bd = ok(x) ? 4 : 99;
    for (let dx = -3; dx <= 3; dx++) {
      const xx = x + dx;
      if (!ok(xx)) continue;
      const sc = Math.abs(dx) + (inside(xx) ? 0 : touches(xx) ? 0.5 : 4);
      if (sc < bd) { bd = sc; best = xx; }
    }
    return best;
  }
  shaftAt(c, kind) {
    const x = Math.floor(c.ux);
    for (const s of this.g.shafts()) if (x >= s.x && x < s.x + s.w && c.L >= s.bottom && c.L <= s.top && (!kind || s.kind === kind)) return s;
    return null;
  }

  tap(c, touch, repl) {
    if (this.app.preview) return;
    const id = this.tool, m = MODE[id] || 'f';
    if (id === 'inspect') { this.inspect(c); return; }
    if (id === 'bulldoze') { this.bulldozeAt(c, true); return; }
    if (m === 'a') {
      const at = this.adjustTarget(c);
      if (this.anchor && this.anchor.adjust) { this.commit(this.anchor, c, false, this.anchor.adjust); this.anchor = null; this.r.ghost = null; this.toolOptions(); return; }
      if (!at) { this.hint('Click a lift shaft.', true); return; }
      if (at.end) { this.anchor = Object.assign({}, c, { adjust: at }); this.hint('Now click the floor the shaft should reach.'); this.toolOptions(); return; }
      this.g.toggleService(at.s.id, c.L);
      this.hint('Floor ' + floorLabel(c.L) + (at.s.off.has(c.L) ? ' is now skipped.' : ' is served again.'));
      return;
    }
    if (m === 'v') {
      const s = this.shaftAt(c, id);
      if (s && !this.anchor) { const r = this.g.addCar(s.id, c.L); if (!r.ok) this.hint(r.reason, true); else this.hint('Added a car (' + s.cars.length + ' in this shaft).'); return; }
      if (!this.anchor) { this.anchor = c; this.hint('Now click the other end of the shaft.'); this.toolOptions(); return; }
      this.commit(this.anchor, c, repl); this.anchor = null; this.toolOptions(); return;
    }
    if ((m === 'h' || m === 'col') && touch) {
      if (!this.anchor) { this.anchor = c; this.r.ghost = this.ghostFor(c, c, repl); this.hint('Tap again here to build one, or tap where the run should end.'); this.toolOptions(); return; }
      const a = this.anchor; this.anchor = null; this.toolOptions();
      this.commit(a, c, repl); return;
    }
    this.commit(c, c, repl);
  }
  commit(a, b, repl, adj) {
    const g = this.g, id = this.tool, m = MODE[id] || 'f';
    let res = null;
    if (m === 'a') {
      if (!adj || !adj.end) return;
      const s = adj.s;
      let nb = s.bottom, nt = s.top;
      if (adj.end === 'top') nt = Math.max(s.bottom + 1, b.L); else nb = Math.min(s.top - 1, b.L);
      res = g.resizeShaft(s.id, nb, nt);
    } else if (FAC[id]) {
      const d = FAC[id];
      if (m === 'h') {
        const x0 = Math.round(a.ux - d.w / 2), x1 = Math.round(b.ux - d.w / 2);
        const n = Math.floor(Math.abs(x1 - x0) / d.w), dir = x1 >= x0 ? 1 : -1;
        let built = 0, last = null;
        for (let i = 0; i <= n; i++) { const r = g.build(id, x0 + dir * i * d.w, a.L, { replace: repl, lobbyHeight: this.lobbyH }); if (r.ok) built++; else last = r; }
        res = built ? { ok: true } : last;
        if (id === 'lobby') this.toolOptions();
      } else if (m === 'col') {
        const x0 = Math.round(a.ux - d.w / 2);
        const st = b.L >= a.L ? -1 : 1; // build from the top down
        const top = Math.max(a.L, b.L), bot = Math.min(a.L, b.L);
        let built = 0, last = null;
        for (let L = top; L >= bot; L--) { const r = g.build(id, x0, L, { replace: repl }); if (r.ok) built++; else last = r; }
        res = built ? { ok: true } : last;
      } else res = g.build(id, repl ? Math.round(b.ux - d.w / 2) : this.snapX(id, Math.round(b.ux - d.w / 2), b.L), b.L, { replace: repl });
    } else if (id === 'floor') {
      res = g.buildFloor(Math.floor(Math.min(a.ux, b.ux)), Math.floor(Math.max(a.ux, b.ux)), a.L);
    } else if (TRANSPORT[id]) {
      const d = TRANSPORT[id];
      if (m === 's') res = g.buildTransport(id, Math.round(b.ux - d.w / 2), b.L, b.L + 1);
      else {
        const lo = Math.min(a.L, b.L), hi = Math.max(a.L, b.L);
        if (lo === hi) { this.hint('Drag up or down to choose the floors the shaft covers.', true); return; }
        res = g.buildTransport(id, Math.round(a.ux - d.w / 2), lo, hi);
      }
    }
    this.r.ghost = null;
    if (res && !res.ok) this.hint(res.reason || 'Cannot build there.', true);
  }
  bulldozeAt(c, single) {
    const x = Math.floor(c.ux);
    const key = c.L + ':' + x;
    if (!single && this._lastDoz === key) return;
    this._lastDoz = key;
    const T = this.g.tower;
    const f = T.facAt(c.L, x);
    if (single && f && f.type === 'condo' && f.occupied) {
      this.confirm('Demolish this apartment?', 'The owners will be refunded ' + money(f.salePrice || 0) + '.', () => this.g.bulldoze(c.L, x));
      return;
    }
    const r = this.g.bulldoze(c.L, x);
    if (!r.ok && single) this.hint(r.reason, true);
  }

  // ------------------------------------------------------------ inspect
  inspect(c) {
    const g = this.g, T = g.tower;
    const x = c.ux;
    // people walking
    let best = null, bd = 1.2;
    for (const p of g.movers) { if (Math.round(p.L) !== c.L) continue; const d = Math.abs(p.x - x); if (d < bd) { bd = d; best = p; } }
    // queued people
    if (!best) for (const s of g.shafts()) for (const q of s.queues.values()) {
      if (q.L !== c.L) continue;
      q.people.slice(0, 10).forEach((p, i) => { const px = q.d > 0 ? (s.x * U - 5 - i * 6) / U : ((s.x + s.w) * U + 5 + i * 6) / U; const d = Math.abs(px - x); if (d < bd) { bd = d; best = p; } });
    }
    if (best) { this.personPanel(best); return; }
    // cars
    for (const s of g.shafts()) {
      if (x < s.x || x >= s.x + s.w) continue;
      for (const car of s.cars) if (Math.abs(car.pos - c.L) < 0.6 && c.L >= s.bottom && c.L <= s.top) { if (car.pax.length || car.state !== 'idle') { this.carPanel(s, car); return; } }
      if (c.L >= s.bottom - 1 && c.L <= s.top + 1) { this.shaftPanel(s); return; }
    }
    const tr = T.transAt(c.L, Math.floor(x));
    if (tr && !tr.cars) { this.panel(`<h2>${esc(TRANSPORT[tr.kind].label)}</h2><div class="sub">Floors ${floorLabel(tr.L)}–${floorLabel(tr.L + 1)}</div><p>${tr.kind === 'stairs' ? 'People will climb up to four flights in a row. Free to run.' : 'People love escalators and never queue for them. Maintenance ' + money(5000) + ' per quarter.'}</p>`, true); return; }
    const f = T.facAt(c.L, Math.floor(x));
    if (f) { this.facPanel(f); return; }
    if (T.hasSlab(c.L, Math.floor(x))) this.hint('Bare floor on ' + (c.L === 0 ? 'the ground floor' : 'floor ' + floorLabel(c.L)) + '.');
  }

  // ------------------------------------------------------------ panels
  panel(html, pause = true, onClose) {
    const m = $('#modal'), p = $('#panel');
    p.innerHTML = html + (html.includes('class="actions"') ? '' : '<div class="actions"><button data-close class="primary">Close</button></div>');
    m.classList.remove('hidden');
    if (!this.modalOpen && pause) { if (this.app.speed > 0) { this.resumeModal = this.app.speed; this.app.setSpeed(0, true); } else this.resumeModal = null; }
    this.modalOpen = true;
    this.onClose = onClose;
    p.querySelectorAll('[data-close]').forEach(b => b.onclick = () => this.closePanel());
    m.onclick = (e) => { if (e.target === m) this.closePanel(); };
    return p;
  }
  closePanel() {
    $('#modal').classList.add('hidden');
    this.panelRefresh = null;
    if (this.modalOpen && this.resumeModal) this.app.setSpeed(this.resumeModal);
    this.modalOpen = false; this.resumeModal = null;
    this.r.highlight = null;
    const cb = this.onClose; this.onClose = null; if (cb) cb();
  }
  confirm(title, text, yes) {
    const p = this.panel(`<h2>${esc(title)}</h2><p>${esc(text)}</p><div class="actions"><button data-close>Cancel</button><button class="primary" id="yes">OK</button></div>`);
    p.querySelector('#yes').onclick = () => { this.closePanel(); yes(); };
  }
  evalBar(f) {
    const v = Math.max(0, Math.min(300, f.eval ?? 200));
    const tier = evalTier(v);
    const col = ['var(--bad)', 'var(--warn)', 'var(--good)'][tier];
    return `<div class="row"><span class="chip ${['bad', 'warn', 'good'][tier]}">${['Poor', 'Good', 'Excellent'][tier]}</span><div class="bar3"><i style="width:${v / 3}%;background:${col}"></i></div></div>`;
  }
  status(f) {
    const g = this.g, d = FAC[f.type];
    if (!g.ready(f) && f.type !== 'ruin') return f.burning ? 'On fire!' : 'Under construction';
    if (f.type === 'ruin') return 'Burnt out. Bulldoze to clear.';
    if (d.hotel) return { vacant: 'Vacant, clean', booked: 'Booked for tonight', occupied: 'Guests staying', dirty: 'Needs cleaning (' + f.dirtyNights + ' night' + (f.dirtyNights === 1 ? '' : 's') + ' dirty)', cleaning: 'Being cleaned', infested: 'Infested with pests: demolish and rebuild' }[f.hstate] || f.hstate;
    if (d.commercial) return f.open ? (g.isOpenNow(f) ? 'Open' : 'Closed for the night') : 'Vacant: waiting for an operator';
    if (f.type === 'office' || f.type === 'condo') return f.occupied ? 'Occupied' : 'Vacant';
    return 'Working';
  }
  facPanel(f) {
    const g = this.g, d = FAC[f.type];
    const render = () => {
      const occ = g.residents(f);
      const here = (f.here || []).map(id => g.people.get(id)).filter(Boolean);
      let h = `<h2>${esc(f.name || d.label)}</h2><div class="sub">${esc(d.label)} · floor ${floorLabel(f.L)}${f.h > 1 ? '–' + floorLabel(f.L + f.h - 1) : ''} · ${esc(this.status(f))}${f.reach === false ? ' · <b style="color:var(--bad)">no route from the lobby</b>' : ''}</div>`;
      if (d.tenant || d.hotel || d.commercial) h += '<h3>Evaluation</h3>' + this.evalBar(f);
      if (d.prices) {
        const locked = f.type === 'condo' && f.occupied;
        h += `<h3>Price (${d.per === 'sale' ? 'one-time sale' : 'per ' + d.per})</h3><div class="row">` + d.prices.map((pr, i) => `<button data-pr="${i}" class="${f.price === i ? 'on' : ''}" ${locked ? 'disabled' : ''}>${PRICE_NAMES[i]}<br><small>${money(pr)}</small></button>`).join('') + '</div>' + (locked ? '<div class="sub">The sale price is fixed while the owners live here.</div>' : '');
      }
      if (f.type === 'cinema') {
        const film = FILMS[f.film || 0];
        h += `<h3>Now showing</h3><div><b>${esc(film.title)}</b> <span class="chip">${film.kind === 'new' ? 'new release' : 'classic'}</span> · running ${f.filmAge || 0} day(s) · last audience ${f.lastAudience || 0}</div><div class="sub">${esc(cinemaComment(f))}</div><div class="row"><select id="film">${FILMS.map((m, i) => `<option value="${i}" ${i === f.film ? 'selected' : ''}>${esc(m.title)} (${m.kind}, ${money(FILM_COST[m.kind])})</option>`).join('')}</select><button id="book">Book film</button></div>`;
      }
      if (d.commercial) h += `<div class="sub">Customers today: ${f.today || 0} · yesterday: ${f.yday || 0} · capacity ${d.cap}/day</div>`;
      const list = occ.length ? occ : here;
      if (list.length) {
        h += `<h3>${occ.length ? 'Occupants' : 'Inside now'} (${list.length})</h3><div class="plist">` + list.slice(0, 60).map(p => `<div><a href="#" data-pid="${p.id}">${esc(personName(p))}</a><span><span class="dot" style="background:${['#9fb1c9', '#f2a541', '#e5484d'][stressTier(p.stress)]}"></span>${['calm', 'tense', 'stressed'][stressTier(p.stress)]} · ${esc(activity(g, p))}</span></div>`).join('') + '</div>';
      }
      if (FAC[f.type].removable !== false || true) h += `<h3>Name</h3><div class="row"><input type="text" id="nm" maxlength="15" value="${esc(f.name || '')}" placeholder="${esc(d.label)}"><button id="nmSave">Save name</button></div>`;
      return h;
    };
    const wire = () => {
      const p = $('#panel');
      p.querySelectorAll('[data-pr]').forEach(b => b.onclick = () => { g.setPrice(f, +b.dataset.pr); refresh(); });
      p.querySelectorAll('[data-pid]').forEach(a => a.onclick = (e) => { e.preventDefault(); const pp = g.people.get(+a.dataset.pid); if (pp) this.personPanel(pp); });
      const nb = p.querySelector('#nmSave'); if (nb) nb.onclick = () => { const r = g.rename('fac', f.id, p.querySelector('#nm').value); if (!r.ok && r.reason) this.hint(r.reason, true); else this.hint('Saved.'); };
      const bk = p.querySelector('#book'); if (bk) bk.onclick = () => { const r = g.setFilm(f, +p.querySelector('#film').value); if (!r.ok) this.hint(r.reason, true); refresh(); };
    };
    const refresh = () => { this.panel(render()); wire(); };
    refresh();
    this.r.highlight = { x: f.x + f.w / 2, L: f.L };
  }
  personPanel(p) {
    const g = this.g;
    const home = p.home && g.tower.facs.get(p.home);
    const kinds = { worker: 'Office worker', sales: 'Sales rep', resident: 'Resident', child: 'Child', guest: 'Hotel guest', vip: 'VIP guest', visitor: 'Visitor', keeper: 'Housekeeper', guard: 'Security guard' };
    const tier = stressTier(p.stress);
    const h = `<h2>${esc(personName(p))}</h2><div class="sub">${kinds[p.kind] || p.kind}${home ? ' · ' + esc(home.name || FAC[home.type].label) + ' on floor ' + floorLabel(home.L) : ''}</div>
      <h3>Stress</h3><div class="row"><span class="chip ${['good', 'warn', 'bad'][tier]}">${['Calm', 'Tense', 'Stressed'][tier]}</span><div class="bar3"><i style="width:${p.stress / 3}%;background:${['var(--good)', 'var(--warn)', 'var(--bad)'][tier]}"></i></div></div>
      <h3>Doing</h3><div>${esc(activity(g, p))}</div>
      ${p.transient ? '' : `<h3>Name</h3><div class="row"><input type="text" id="nm" maxlength="15" value="${esc(p.name || '')}" placeholder="${esc(personName(p))}"><button id="nmSave">Save name</button></div><div class="sub">Named people (up to 20) can be found from the menu.</div>`}`;
    const pnl = this.panel(h);
    const nb = pnl.querySelector('#nmSave'); if (nb) nb.onclick = () => { const r = g.rename('person', p.id, pnl.querySelector('#nm').value); if (!r.ok && r.reason) this.hint(r.reason, true); else this.hint('Saved.'); };
    this.r.highlight = { x: p.x, L: Math.round(p.L) };
  }
  carPanel(s, car) {
    const dests = [...new Set(car.pax.map(p => p._dest))].sort((a, b) => a - b).map(floorLabel).join(', ') || 'none';
    const h = `<h2>${esc(TRANSPORT[s.kind].label)} car</h2><div class="sub">Shaft ${floorLabel(s.bottom)}–${floorLabel(s.top)}</div>
      <table><tr><td>Load</td><td class="n">${car.pax.length} / ${s.cap}</td></tr><tr><td>Direction</td><td class="n">${car.dir > 0 ? 'up' : car.dir < 0 ? 'down' : 'parked'}</td></tr><tr><td>At</td><td class="n">floor ${floorLabel(Math.round(car.pos))}</td></tr><tr><td>Riders going to</td><td class="n">${dests}</td></tr><tr><td>State</td><td class="n">${car.state}</td></tr></table>
      <div class="actions"><button id="ctl">Shaft controls</button><button class="primary" data-close>Close</button></div>`;
    const p = this.panel(h);
    p.querySelector('#ctl').onclick = () => this.shaftPanel(s);
  }
  shaftPanel(s) {
    const g = this.g, T = g.tower;
    const render = () => {
      const def = TRANSPORT[s.kind];
      const exp = s.kind === 'express';
      let h = `<h2>${esc(s.name || def.label)}</h2><div class="sub">Floors ${floorLabel(s.bottom)}–${floorLabel(s.top)} · ${s.cars.length} car${s.cars.length > 1 ? 's' : ''} of ${def.cap} · ${s.totalWaiting()} waiting</div>`;
      h += `<div class="row"><button id="addCar" ${s.cars.length >= 8 ? 'disabled' : ''}>Add a car (${money(def.carCost)})</button><button id="rmCar" ${s.cars.length <= 1 ? 'disabled' : ''}>Remove a car</button><label class="toggle"><input type="checkbox" id="hide" ${s.hidden ? 'checked' : ''}> Hide shaft</label><button id="pv" title="Fast-forward a copy of the tower and watch only this shaft">Preview the next hours</button></div>`;
      h += `<h3>Response distance</h3><div class="row"><button id="rdm">−</button><b>${s.responseDistance}</b> floors<button id="rdp">+</button><span class="sub">How far a moving car may be from a call and still take it.</span></div>`;
      h += `<h3>Departure delay</h3><div class="row"><input type="range" id="dly" min="0" max="40" step="2" value="${s.delay}"><span id="dlyv">${(s.delay * 0.07).toFixed(1)} s</span><span class="sub">Longer holds fill cars at busy floors.</span></div>`;
      const opt = (w, i) => { const m = s.modes[w][i]; return `<select data-w="${w}" data-i="${i}"><option value="local" ${m === 'local' ? 'selected' : ''}>Local</option><option value="top" ${m === 'top' ? 'selected' : ''}>Express up</option><option value="bottom" ${m === 'bottom' ? 'selected' : ''}>Express down</option></select>`; };
      h += `<h3>Schedule</h3><table class="sched"><tr><th></th><th>Weekdays</th><th>Weekend</th></tr>` + PERIOD_NAMES.map((n, i) => `<tr><td style="text-align:left">${esc(n)}</td><td>${opt(0, i)}</td><td>${opt(1, i)}</td></tr>`).join('') + '</table><div class="sub">Express up: cars wait at the bottom and run up without answering up-calls on the way. Express down is the mirror.</div>';
      if (!exp) h += `<h3>Home floors</h3><div class="row">` + s.cars.map((c, i) => `<label>Car ${i + 1} <select data-home="${i}">${range(s.bottom, s.top).map(L => `<option value="${L}" ${c.home === L ? 'selected' : ''}>${floorLabel(L)}</option>`).join('')}</select></label>`).join('') + '</div>';
      const carAt = new Set(s.cars.map(c => Math.round(c.pos)));
      h += `<h3>Floor service ${exp ? '(fixed for express lifts)' : '(click to switch a stop off or on)'}</h3><div class="floors">` + range(s.bottom, s.top).reverse().map(L => {
        const off = s.off.has(L) || (exp && !isExpressStop(L));
        const q = s.qlen(L, 1) + s.qlen(L, -1);
        return `<button data-fl="${L}" class="${off ? 'off' : ''} ${carAt.has(L) ? 'car' : ''}" ${exp ? 'disabled' : ''} title="${q} waiting">${floorLabel(L)}${q ? '·' + q : ''}</button>`;
      }).join('') + '</div>';
      h += `<h3>Name</h3><div class="row"><input type="text" id="nm" maxlength="15" value="${esc(s.name || '')}"><button id="nmSave">Save name</button></div>`;
      return h;
    };
    const wire = () => {
      const p = $('#panel');
      p.querySelector('#addCar').onclick = () => { const r = g.addCar(s.id, s.bottom); if (!r.ok) this.hint(r.reason, true); refresh(); };
      p.querySelector('#rmCar').onclick = () => { if (s.cars.length > 1) { const c = s.cars[s.cars.length - 1]; if (c.pax.length) { this.hint('That car has riders; try again when it is empty.', true); return; } s.cars.pop(); for (const q of s.queues.values()) if (q.assigned >= s.cars.length) q.assigned = -1; } refresh(); };
      p.querySelector('#hide').onchange = (e) => { s.hidden = e.target.checked; };
      p.querySelector('#pv').onclick = () => { this.resumeModal = null; this.closePanel(); this.app.startPreview(s.id); };
      p.querySelector('#rdm').onclick = () => { s.responseDistance = Math.max(1, s.responseDistance - 1); refresh(); };
      p.querySelector('#rdp').onclick = () => { s.responseDistance = Math.min(30, s.responseDistance + 1); refresh(); };
      const dl = p.querySelector('#dly'); dl.oninput = () => { s.delay = +dl.value; p.querySelector('#dlyv').textContent = (s.delay * 0.07).toFixed(1) + ' s'; };
      p.querySelectorAll('select[data-w]').forEach(sel => sel.onchange = () => { s.modes[+sel.dataset.w][+sel.dataset.i] = sel.value; });
      p.querySelectorAll('select[data-home]').forEach(sel => sel.onchange = () => { s.cars[+sel.dataset.home].home = +sel.value; });
      p.querySelectorAll('[data-fl]').forEach(b => b.onclick = () => { g.toggleService(s.id, +b.dataset.fl); refresh(); });
      p.querySelector('#nmSave').onclick = () => { s.name = p.querySelector('#nm').value.slice(0, 15); this.hint('Saved.'); };
    };
    const refresh = () => { const sc = $('#panel').scrollTop; this.panel(render()); wire(); $('#panel').scrollTop = sc; };
    refresh();
  }
  financePanel() {
    const g = this.g, F = g.finance;
    let inc = 0, mt = 0;
    let h = `<h2>Finances</h2><div class="sub">This quarter so far (Q${g.quarter}, year ${g.year})</div><h3>Income</h3><table>`;
    for (const k of INCOME_CATS) { inc += F.income[k]; h += `<tr><td>${INCOME_LABELS[k]}</td><td class="n">${money(F.income[k])}</td></tr>`; }
    h += `<tr><td><b>Total income</b></td><td class="n"><b>${money(inc)}</b></td></tr></table><h3>Maintenance</h3><table>`;
    for (const k of MAINT_CATS) { mt += F.maint[k]; h += `<tr><td>${MAINT_LABELS[k]}</td><td class="n">${money(-F.maint[k])}</td></tr>`; }
    h += `<tr><td><b>Total maintenance</b></td><td class="n"><b>${money(-mt)}</b></td></tr></table><h3>Other</h3><table>
      <tr><td>Construction</td><td class="n">${money(-F.construction)}</td></tr>
      <tr><td>Other income and costs (running costs, films, rescues, finds)</td><td class="n">${money(F.other)}</td></tr>
      <tr><td><b>Balance now</b></td><td class="n"><b>${money(g.funds)}</b></td></tr></table>`;
    if (g.prevFinance) { let pi = 0; for (const k of INCOME_CATS) pi += g.prevFinance.income[k]; h += `<div class="sub">Last quarter's income was ${money(pi)}.</div>`; }
    this.panel(h);
  }
  starPanel() {
    const g = this.g;
    const blk = g.starBlockers();
    const pop = g.pop;
    let h = `<h2>${g.star >= STAR_LANDMARK ? 'Landmark Tower' : g.star + '-star tower'}</h2><div class="big">${starsStr(g.star)}</div>`;
    h += `<table><tr><td>Population</td><td class="n">${pop.total.toLocaleString()}</td></tr><tr><td>Permanent (workers, residents, staff, shoppers)</td><td class="n">${pop.perm.toLocaleString()}</td></tr><tr><td>Hotel guests</td><td class="n">${pop.hotel.toLocaleString()}</td></tr></table>`;
    if (g.star < STAR_LANDMARK) h += `<h3>The next ${g.star === 5 ? 'honour' : 'star'} needs</h3>` + (blk.length ? '<ul>' + blk.map(b => `<li>${esc(b)}</li>`).join('') + '</ul>' : '<p>Everything is in place. It will be awarded at the next check.</p>');
    if (g.demands.length) h += '<h3>Tenant demands</h3>' + g.demands.map(d => `<div><span class="dot" style="background:${d.met ? 'var(--good)' : 'var(--bad)'}"></span>${esc(d.text)}</div>`).join('');
    this.panel(h);
  }
  menuPanel() {
    const a = this.app;
    const h = `<h2>Skyrise</h2><div class="sub">Autosaves every game day.</div>
      <div class="row"><button id="mSave">Save</button><button id="mLoad">Load</button><button id="mNew">New tower</button></div>
      <div class="row"><button id="mFin">Finances</button><button id="mFindP">Find person</button><button id="mFindF">Find place</button><button id="mStar">Star rating</button></div>
      <h3>Options</h3>
      <label class="toggle"><input type="checkbox" id="oPeople" ${a.renderer.flags.people ? 'checked' : ''}> Show people</label>
      <label class="toggle"><input type="checkbox" id="oDetail" ${a.renderer.flags.detail ? 'checked' : ''}> Detail animation (machinery)</label>
      <label class="toggle"><input type="checkbox" id="oSE" ${a.sound.on.elevators ? 'checked' : ''}> Lift sounds</label>
      <label class="toggle"><input type="checkbox" id="oSA" ${a.sound.on.ambience ? 'checked' : ''}> Background sounds</label>
      <label class="toggle"><input type="checkbox" id="oSV" ${a.sound.on.events ? 'checked' : ''}> Event and interface sounds</label>
      <h3>How to play</h3>
      <p class="sub">Drag a lobby along the ground. Add offices and apartments above it (floors are built for you), then link floors with stairs or a lift: choose the lift tool and drag from the lobby up. Click a shaft with the same lift tool to add cars. Drag with the right mouse button, two fingers, or the inspect tool to look around; scroll or pinch to move and zoom. People who wait too long get stressed, and stressed tenants leave.</p>
      <p class="sub">Skyrise is an original game. <a href="NOTICE.md" target="_blank" rel="noopener" style="color:var(--blue)">Notice and licence</a>.</p>`;
    const p = this.panel(h);
    p.querySelector('#mSave').onclick = () => { this.closePanel(); this.hint(a.save() ? 'Saved.' : 'Could not save (storage unavailable).', !a.lastSaveOk); };
    p.querySelector('#mLoad').onclick = () => { this.closePanel(); if (!a.load()) this.hint('No saved tower found.', true); };
    p.querySelector('#mNew').onclick = () => this.confirm('Start a new tower?', 'Your current tower will be replaced (the last save stays available).', () => a.newGame());
    p.querySelector('#mFin').onclick = () => this.financePanel();
    p.querySelector('#mStar').onclick = () => this.starPanel();
    p.querySelector('#mFindP').onclick = () => this.findPanel('person');
    p.querySelector('#mFindF').onclick = () => this.findPanel('fac');
    p.querySelector('#oPeople').onchange = (e) => { a.renderer.flags.people = e.target.checked; a.saveOptions(); };
    p.querySelector('#oDetail').onchange = (e) => { a.renderer.flags.detail = e.target.checked; a.saveOptions(); };
    p.querySelector('#oSE').onchange = (e) => { a.sound.on.elevators = e.target.checked; a.saveOptions(); };
    p.querySelector('#oSA').onchange = (e) => { a.sound.on.ambience = e.target.checked; a.saveOptions(); };
    p.querySelector('#oSV').onchange = (e) => { a.sound.on.events = e.target.checked; a.saveOptions(); };
  }
  findPanel(kind) {
    const g = this.g;
    const ids = kind === 'person' ? g.named.people : g.named.facs;
    const items = ids.map(id => kind === 'person' ? g.people.get(id) : (g.tower.facs.get(id) || g.tower.trans.get(id))).filter(Boolean);
    let h = `<h2>Find ${kind === 'person' ? 'a person' : 'a place'}</h2><div class="sub">${kind === 'person' ? 'Name people from their info panel' : 'Name places from their info panel'} (up to 20).</div>`;
    h += items.length ? '<div class="plist">' + items.map(o => `<div><a href="#" data-id="${o.id}">${esc(o.name)}</a><span>${kind === 'person' ? esc(activity(g, o)) : 'floor ' + floorLabel(o.L ?? o.bottom)}</span></div>`).join('') + '</div>' : '<p>Nothing named yet.</p>';
    const p = this.panel(h);
    p.querySelectorAll('[data-id]').forEach(a => a.onclick = (e) => {
      e.preventDefault();
      const id = +a.dataset.id;
      const o = kind === 'person' ? g.people.get(id) : (g.tower.facs.get(id) || g.tower.trans.get(id));
      if (!o) return;
      this.closePanel();
      const x = kind === 'person' ? o.x : o.x + o.w / 2, L = kind === 'person' ? Math.round(o.L) : (o.L ?? o.bottom);
      this.r.centerOn(x * U, yOf(L));
      this.r.highlight = { x, L };
      setTimeout(() => { this.r.highlight = null; }, 5000);
    });
  }
  dialog(d) {
    const g = this.g;
    if (d.kind === 'bomb') {
      const p = this.panel(`<h2>Threat received</h2><p>${esc(d.text)}</p><div class="actions"><button id="refuse">Refuse and search</button><button class="primary" id="pay">Pay ${money(d.amount)}</button></div>`);
      p.querySelector('#pay').onclick = () => { E.payRansom(g); this.closePanel(); };
      p.querySelector('#refuse').onclick = () => { E.refuseRansom(g); this.closePanel(); };
      return;
    }
    if (d.kind === 'fire') {
      const p = this.panel(`<h2>Fire!</h2><p>${esc(d.text)}</p><div class="actions"><button data-close>Let security handle it</button><button class="primary" id="heli">Call the helicopter ($500,000)</button></div>`);
      p.querySelector('#heli').onclick = () => { const r = E.callHelicopter(g); this.closePanel(); if (!r.ok) this.hint('The helicopter is already on its way.'); };
      if (g.fire) { const L = [...g.fire.levels.keys()][0]; this.r.centerOn(g.fire.x * U, yOf(L)); }
      return;
    }
    const titles = { star: 'A new star!', final: 'Landmark Tower', vip: 'VIP', treasure: 'Buried treasure', bankrupt: 'Bankrupt', 'bomb-ok': 'Device found', boom: 'Explosion' };
    let extra = '';
    if (d.kind === 'star') { extra = `<div class="big">${starsStr(d.star)}</div><p class="sub">New tools are unlocked in the toolbar.</p>`; this.buildToolbar(); }
    if (d.kind === 'final') extra = `<div class="big">♛</div>`;
    const p = this.panel(`<h2>${esc(titles[d.kind] || 'Notice')}</h2>${extra}<p>${esc(d.text)}</p>` + (d.kind === 'bankrupt' ? '<div class="actions"><button id="ld">Load last save</button><button class="primary" id="nw">New tower</button></div>' : ''));
    if (d.kind === 'bankrupt') { p.querySelector('#ld').onclick = () => { this.closePanel(); this.app.load(); }; p.querySelector('#nw').onclick = () => { this.closePanel(); this.app.newGame(); }; }
  }
  welcome(hasSave) {
    const p = this.panel(`<h2>Skyrise</h2><p>Raise a tower from an empty lot: lay a lobby, stack offices, apartments and hotels, and keep the lifts moving. Happy tenants bring stars; stars unlock new buildings.</p>
      <div class="actions">${hasSave ? '<button id="wNew">New tower</button><button class="primary" id="wCont">Continue</button>' : '<button class="primary" id="wNew">Start building</button>'}</div>`);
    const n = p.querySelector('#wNew'); n.onclick = () => { this.closePanel(); this.app.newGame(); this.setTool('lobby'); };
    const c = p.querySelector('#wCont'); if (c) c.onclick = () => { this.closePanel(); this.app.load('auto'); };
  }

  // ------------------------------------------------------------ bar
  bindBar() {
    $('#speed').addEventListener('click', e => { const s = e.target.closest('[data-speed]'); if (!s) return; this.app.sound.ensure(); this.app.setSpeed(+s.dataset.speed); });
    $('#menuBtn').onclick = () => { this.app.sound.ensure(); this.menuPanel(); };
    $('#finBtn').onclick = () => this.financePanel();
    $('#starsBtn').onclick = () => this.starPanel();
  }
  updateBar() {
    const g = this.g;
    const dt = dayTick(g.t);
    $('#clock').textContent = clockString(dt);
    $('#date').textContent = `${DAY_NAMES[g.dayType]} · Q${g.quarter} · Year ${g.year}${g.weather.rain ? ' · rain' : ''}`;
    const f = $('#funds'); f.textContent = money(g.funds); f.classList.toggle('neg', g.funds < 0);
    $('#pop').textContent = 'Pop. ' + g.pop.total.toLocaleString();
    $('#stars').textContent = window.innerWidth < 640 ? (g.star >= STAR_LANDMARK ? '★ Landmark' : '★' + g.star) : starsStr(g.star);
    document.querySelectorAll('#speed button').forEach(b => b.classList.toggle('on', +b.dataset.speed === this.app.speed));
  }
}

function starsStr(n) { return n >= STAR_LANDMARK ? '★★★★★ ♛' : '★'.repeat(n) + '☆'.repeat(5 - n); }
function range(a, b) { const r = []; for (let i = a; i <= b; i++) r.push(i); return r; }
function cinemaComment(f) {
  const n = f.lastAudience || 0;
  if (n > 120) return '"Queues around the block! The popcorn ran out."';
  if (n > 70) return '"A good crowd, and the second half had people gasping."';
  if (n > 30) return '"Half a house. Some walked out humming the theme."';
  if (n > 0) return '"Plenty of legroom tonight. Maybe it is time for something fresh?"';
  return '"Nobody has seen anything here yet."';
}
export function activity(g, p) {
  const T = g.tower;
  const f = p.at && T.facs.get(p.at);
  const dest = p.goalFac && T.facs.get(p.goalFac);
  const where = (x) => x ? (x.name || FAC[x.type].label) + ' (floor ' + floorLabel(x.L) + ')' : 'the street';
  switch (p.state) {
    case 'off': return 'Away from the tower';
    case 'in': return p.cleaning ? 'Cleaning ' + where(f) : 'In ' + where(f);
    case 'walk': return 'Walking to ' + where(dest);
    case 'flight': return 'On the stairs, heading to ' + where(dest);
    case 'queue': return 'Waiting for a lift on floor ' + floorLabel(p.L) + ' (' + p.wait + ' ticks), heading to ' + where(dest);
    case 'ride': return 'Riding a lift to floor ' + floorLabel(p._dest) + ', heading to ' + where(dest);
  }
  return p.state;
}
