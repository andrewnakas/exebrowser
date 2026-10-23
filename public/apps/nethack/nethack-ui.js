// A browser window port for NetHack 3.6.7, written for ExeBrowser.
//
// The game itself is the official NetHack source compiled to WebAssembly
// (vendor/nethack.wasm, from the @neth4ck/wasm-367 package; NetHack General
// Public License). NetHack talks to its "window port" through callbacks — draw this
// glyph, show this menu, read a key — and this file answers them: an 80-column
// map, a message line, the two status lines, menus and prompts as overlays,
// keyboard plus an on-screen pad for touch screens.
//
// Saves: /save is an IndexedDB-backed folder, synced after NetHack writes a
// save (S, then y). The save stays in this browser; the next visit with the
// same name continues it. Like NetHack itself there is no autosave, but the
// copy in IndexedDB is only replaced by a newer save, so closing the tab
// mid-game takes you back to your last save rather than losing the character.
import createModule from "./vendor/nethack.js";

const el = (id) => document.getElementById(id);
const COLS = 80, MAPROWS = 21;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// NetHack 3.6.7's extended command table, in order: get_ext_cmd returns an
// index into it. (migratemons is compiled out of this build.)
const EXT = ["#", "?", "adjust", "annotate", "apply", "attributes", "autopickup", "call", "cast", "chat",
  "close", "conduct", "dip", "down", "drop", "droptype", "eat", "engrave", "enhance", "exploremode", "fire",
  "force", "glance", "help", "herecmdmenu", "history", "inventory", "inventtype", "invoke", "jump", "kick",
  "known", "knownclass", "levelchange", "lightsources", "look", "loot", "monster", "name", "offer",
  "open", "options", "overview", "panic", "pay", "pickup", "polyself", "pray", "prevmsg", "puton", "quaff",
  "quit", "quiver", "read", "redraw", "remove", "ride", "rub", "save", "search", "seeall", "seeamulet",
  "seearmor", "seegold", "seenv", "seerings", "seespells", "seetools", "seetrap", "seeweapon", "shell", "sit",
  "stats", "suspend", "swap", "takeoff", "takeoffall", "teleport", "terrain", "therecmdmenu", "throw",
  "timeout", "tip", "travel", "turn", "twoweapon", "untrap", "up", "vanquished", "version", "versionshort",
  "vision", "wait", "wear", "whatdoes", "whatis", "wield", "wipe", "wizbury", "wizdetect", "wizgenesis",
  "wizidentify", "wizintrinsic", "wizlevelport", "wizmakemap", "wizmap", "wizrumorcheck", "wizsmell",
  "wizwhere", "wizwish", "wmode", "zap"];
const EXT_COMMON = ["pray", "offer", "enhance", "loot", "force", "dip", "chat", "jump", "sit", "turn",
  "untrap", "ride", "rub", "tip", "wipe", "invoke", "monster", "name", "conduct", "terrain", "overview",
  "twoweapon", "annotate", "adjust"];

// ---- Screen -------------------------------------------------------------------

const term = el("term");
const grid = [];
const rowEls = [];
for (let r = 0; r < MAPROWS + 2; r++) {
  grid.push({ ch: Array(COLS).fill(" "), c: Array(COLS).fill(7), f: Array(COLS).fill(0) });
  const d = document.createElement("div");
  d.className = "row";
  term.appendChild(d);
  rowEls.push(d);
}
const dirty = new Set();
let cursor = { x: -1, y: -1 };
let raf = 0;
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function paint() {
  raf = 0;
  for (const r of dirty) {
    const g = grid[r];
    let html = "", run = "", cls = null;
    for (let x = 0; x < COLS; x++) {
      const isCur = r === cursor.y + 0 && x === cursor.x && r < MAPROWS;
      const k = `c${g.c[x]}` + (g.f[x] & 8 ? " pet" : "") + (g.f[x] & 4 ? " inv" : "") + (isCur ? " cur" : "");
      if (k !== cls) {
        if (run) html += `<span class="${cls}">${esc(run)}</span>`;
        run = ""; cls = k;
      }
      run += g.ch[x];
    }
    if (run) html += `<span class="${cls}">${esc(run)}</span>`;
    rowEls[r].innerHTML = html;
  }
  dirty.clear();
}
const touch = (r) => { dirty.add(r); if (!raf) raf = requestAnimationFrame(paint); };

function setCell(x, y, ch, color, flags) {
  if (y < 0 || y >= MAPROWS || x < 0 || x >= COLS) return;
  const g = grid[y];
  g.ch[x] = ch; g.c[x] = color; g.f[x] = flags;
  touch(y);
}
function clearMap() {
  for (let y = 0; y < MAPROWS; y++) { grid[y].ch.fill(" "); grid[y].c.fill(7); grid[y].f.fill(0); touch(y); }
}
function moveCursor(x, y) {
  const old = cursor.y;
  cursor = { x, y };
  if (old >= 0) touch(old);
  if (y >= 0) touch(y);
}
function writeLine(r, text) {
  const g = grid[r];
  const s = text.padEnd(COLS).slice(0, COLS);
  for (let x = 0; x < COLS; x++) { g.ch[x] = s[x]; g.c[x] = 7; g.f[x] = 0; }
  touch(r);
}

function fit() {
  const w = el("wrap").clientWidth - 8;
  const h = el("wrap").clientHeight - 8;
  const byW = w / (COLS * 0.6), byH = h / ((MAPROWS + 2 + 2) * 1.18);
  const fs = Math.max(7, Math.min(18, byW, byH));
  document.documentElement.style.setProperty("--fs", fs.toFixed(2) + "px");
}
addEventListener("resize", fit);

// ---- Messages -----------------------------------------------------------------

const history = [];
let fresh = [];
function addMessage(s) {
  if (!s) return;
  history.push(s);
  if (history.length > 200) history.shift();
  fresh.push(s);
  renderMsgs();
}
function renderMsgs() {
  const box = el("msgs");
  const lines = fresh.slice(-3);
  box.innerHTML = lines.length ? lines.map((l) => esc(l)).join("\n")
    : history.slice(-1).map((l) => `<span class="old">${esc(l)}</span>`).join("");
}
function ageMessages() { fresh = []; renderMsgs(); }

// ---- Status -----------------------------------------------------------------

const st = {};
const COND = [["Stone", 0x1], ["Slime", 0x2], ["Strngl", 0x4], ["FoodPois", 0x8], ["TermIll", 0x10],
  ["Blind", 0x20], ["Deaf", 0x40], ["Stun", 0x80], ["Conf", 0x100], ["Hallu", 0x200], ["Lev", 0x400],
  ["Fly", 0x800], ["Ride", 0x1000]];
let condMask = 0;
function renderStatus() {
  const v = (k) => (st[k] ?? "").toString().trim();
  const gold = v("BL_GOLD").replace(/^\\G[0-9a-fA-F]+:?/, "");
  const l1 = `${v("BL_TITLE")}  St:${v("BL_STR")} Dx:${v("BL_DX")} Co:${v("BL_CO")} In:${v("BL_IN")} Wi:${v("BL_WI")} Ch:${v("BL_CH")}  ${v("BL_ALIGN")}`;
  const conds = COND.filter(([, m]) => condMask & m).map(([n]) => n).join(" ");
  const xp = v("BL_XP") + (v("BL_EXP") ? "/" + v("BL_EXP") : "");
  const l2 = `${v("BL_LEVELDESC")} $:${gold} HP:${v("BL_HP")}(${v("BL_HPMAX")}) Pw:${v("BL_ENE")}(${v("BL_ENEMAX")}) AC:${v("BL_AC")} Xp:${xp}` +
    (v("BL_TIME") ? ` T:${v("BL_TIME")}` : "") + ` ${v("BL_HUNGER")} ${v("BL_CAP")} ${conds}`;
  writeLine(MAPROWS, l1);
  writeLine(MAPROWS + 1, l2.replace(/\s+/g, " "));
  const hp = +v("BL_HP"), max = +v("BL_HPMAX");
  if (max && hp <= max / 3) { for (let x = 0; x < COLS; x++) grid[MAPROWS + 1].c[x] = hp <= max / 7 ? 1 : 11; }
}

// ---- Input --------------------------------------------------------------------

const queue = [];
let waiter = null;
function push(ev) {
  if (waiter) { const w = waiter; waiter = null; w(ev); } else queue.push(ev);
}
const nextEvent = () => (queue.length ? Promise.resolve(queue.shift()) : new Promise((r) => { waiter = r; }));
async function nextKey() {
  for (;;) { const e = await nextEvent(); if (typeof e === "number") return e; }
}
const pushKeys = (s) => { for (const ch of s) push(ch.charCodeAt(0)); };

const ARROWS = { ArrowLeft: "h", ArrowRight: "l", ArrowUp: "k", ArrowDown: "j", Home: "y", PageUp: "u", End: "b", PageDown: "n" };
const NUMPAD = { Numpad1: "b", Numpad2: "j", Numpad3: "n", Numpad4: "h", Numpad5: ".", Numpad6: "l", Numpad7: "y", Numpad8: "k", Numpad9: "u" };
function keyCode(e) {
  if (ARROWS[e.key]) { const k = ARROWS[e.key]; return (e.shiftKey ? k.toUpperCase() : k).charCodeAt(0); }
  if (NUMPAD[e.code] && !e.ctrlKey && !e.altKey) return NUMPAD[e.code].charCodeAt(0);
  if (e.key === "Escape") return 27;
  if (e.key === "Enter") return 13;
  if (e.key === "Backspace") return 8;
  if (e.key === "Tab") return 9;
  if ((e.altKey || e.metaKey) && /^Key[A-Z]$/.test(e.code)) {
    const ch = e.code.slice(3).toLowerCase();
    return 0x80 | (e.shiftKey ? ch.toUpperCase() : ch).charCodeAt(0);
  }
  if (e.ctrlKey && /^Key[A-Z]$/.test(e.code)) return e.code.charCodeAt(3) & 0x1f;
  if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) return e.key.charCodeAt(0);
  return null;
}
addEventListener("keydown", (e) => {
  if (!started || inputActive) return;
  if (e.target === el("kbd") && e.key.length === 1) return;    // the input event handles it
  const k = keyCode(e);
  if (k == null) return;
  e.preventDefault();
  push(k);
});
el("kbd").addEventListener("input", (e) => {
  const v = e.target.value;
  e.target.value = "";
  if (!inputActive) pushKeys(v);
});
for (const b of document.querySelectorAll("#pad button[data-k]")) {
  b.addEventListener("click", (e) => {
    e.preventDefault();
    const k = b.dataset.k.replace("\\x1b", "\x1b").replace("\\r", "\r");
    pushKeys(k);
  });
}
el("kbdbtn").addEventListener("click", () => el("kbd").focus());
if (matchMedia("(pointer: coarse)").matches) document.body.classList.add("touch");

term.addEventListener("click", (e) => {
  const rect = term.getBoundingClientRect();
  const cw = rect.width / COLS, ch = rect.height / (MAPROWS + 2);
  const x = Math.floor((e.clientX - rect.left) / cw), y = Math.floor((e.clientY - rect.top) / ch);
  if (y < MAPROWS && x > 0) push({ mouse: true, x, y });
});

// ---- Overlays ---------------------------------------------------------------------

const overlay = el("overlay") || (() => {
  const o = document.createElement("div");
  o.id = "overlay";
  o.innerHTML = '<div id="panel" role="dialog"></div>';
  document.body.appendChild(o);
  return o;
})();
const panel = el("panel");
let inputActive = false;
function openPanel(html) { panel.innerHTML = html; overlay.classList.add("open"); panel.scrollTop = 0; }
function closePanel() { overlay.classList.remove("open"); panel.innerHTML = ""; }
overlay.addEventListener("click", (e) => { if (e.target === overlay) push(27); });

async function showText(lines) {
  if (!lines.length) return;
  openPanel(lines.map((l) => esc(l)).join("\n") + '<span class="hint">Press any key or tap to continue.</span>');
  panel.onclick = () => push(13);
  await nextKey();
  panel.onclick = null;
  closePanel();
}

const LETTERS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
async function selectMenu(win, how) {
  const items = win.items || [];
  let next = 0;
  for (const it of items) {
    if (it.ident && !it.ch) it.ch = LETTERS[next++] || "";
  }
  const sel = new Set(items.filter((i) => i.ident && i.presel).map((i) => i));
  const draw = () => {
    let h = win.prompt ? `<span class="head">${esc(win.prompt)}</span>` : "";
    items.forEach((it, i) => {
      if (!it.ident) h += `<span class="head">${esc(it.str)}</span>`;
      else h += `<span class="item${sel.has(it) ? " sel" : ""}" data-i="${i}">${esc(it.ch)} ${how === "PICK_ANY" ? (sel.has(it) ? "+" : "-") : "-"} ${esc(it.str)}</span>`;
    });
    h += `<span class="hint">${how === "PICK_NONE" ? "Press any key to continue." :
      how === "PICK_ONE" ? "Choose a letter (or tap). Esc cancels." : "Toggle with letters or taps, Enter to confirm, Esc cancels."}</span>`;
    openPanel(h);
  };
  draw();
  panel.onclick = (e) => {
    const t = e.target.closest(".item");
    if (t) push(items[+t.dataset.i].ch.charCodeAt(0));
    else if (how === "PICK_NONE") push(13);
  };
  let result = 0;
  for (;;) {
    const k = await nextKey();
    if (how === "PICK_NONE") { result = 0; break; }
    if (k === 27) { result = -1; sel.clear(); break; }
    if (k === 13 || k === 10 || (k === 32 && how === "PICK_ANY")) { if (how === "PICK_ANY" || sel.size) break; result = 0; sel.clear(); break; }
    const ch = String.fromCharCode(k);
    const it = items.find((x) => x.ident && x.ch === ch);
    if (!it) continue;
    if (how === "PICK_ONE") { sel.clear(); sel.add(it); break; }
    if (sel.has(it)) sel.delete(it); else sel.add(it);
    draw();
  }
  panel.onclick = null;
  closePanel();
  if (result === -1) return { n: -1, list: [] };
  return { n: sel.size, list: [...sel] };
}

async function getLine(prompt, initial = "") {
  inputActive = true;
  openPanel(`<label>${esc(prompt)}</label><input id="gl" autocomplete="off" autocapitalize="off" spellcheck="false" /><span class="hint">Enter to accept, Esc to cancel.</span>`);
  const inp = el("gl");
  inp.value = initial;
  inp.focus();
  const text = await new Promise((resolve) => {
    inp.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); resolve(inp.value); }
      if (e.key === "Escape") { e.preventDefault(); resolve(null); }
    });
  });
  inputActive = false;
  closePanel();
  return text;
}

async function extCommand() {
  inputActive = true;
  openPanel(`<label>Extended command — type or pick one</label><input id="gl" list="extlist" autocomplete="off" autocapitalize="off" spellcheck="false" />` +
    `<datalist id="extlist">${EXT.filter((x) => !/^wiz|^#$|^\?$/.test(x)).map((x) => `<option value="${x}">`).join("")}</datalist>` +
    `<div style="margin-top:8px">${EXT_COMMON.map((c) => `<span class="item" data-c="${c}" style="display:inline-block">#${c}</span>`).join(" ")}</div>` +
    '<span class="hint">Enter to run, Esc to cancel.</span>');
  const inp = el("gl");
  inp.focus();
  const name = await new Promise((resolve) => {
    inp.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); resolve(inp.value.trim().toLowerCase()); }
      if (e.key === "Escape") { e.preventDefault(); resolve(null); }
    });
    panel.onclick = (e) => { const t = e.target.closest("[data-c]"); if (t) resolve(t.dataset.c); };
  });
  panel.onclick = null;
  inputActive = false;
  closePanel();
  if (!name) return -1;
  const exact = EXT.indexOf(name);
  if (exact >= 0) return exact;
  const pre = EXT.filter((x) => x.startsWith(name));
  if (pre.length === 1) return EXT.indexOf(pre[0]);
  addMessage(`Unknown extended command: ${name}`);
  return -1;
}

async function yesNo(query, resp, def) {
  const choices = resp ? resp.replace(/\x1b.*/, "") : "";
  addMessage(query + (choices ? ` [${choices}]` : "") + (def ? ` (${String.fromCharCode(def)})` : ""));
  for (;;) {
    const k = await nextKey();
    if (!resp) { ageMessages(); return k; }
    const ch = String.fromCharCode(k);
    if (k === 27) { ageMessages(); return (resp.includes("q") ? "q" : resp.includes("n") ? "n" : String.fromCharCode(def || 27)).charCodeAt(0); }
    if ((k === 13 || k === 32) && def) { ageMessages(); return def; }
    if (resp.includes(ch)) { ageMessages(); return k; }
    // Digits are allowed for counts in some prompts ("#" in resp).
    if (resp.includes("#") && /[0-9]/.test(ch)) { ageMessages(); return k; }
  }
}

// ---- Window port ---------------------------------------------------------------------

let M = null;
let started = false;
let nextWin = 1;
const wins = new Map();
let gameOver = false;

function mapGlyph(glyph, x, y) {
  try {
    const g = globalThis.nethackGlobal.helpers.mapglyphHelper(glyph, x, y, 0);
    return { ch: String.fromCharCode(g.ch & 0xff || 32), color: g.color ?? 7, special: g.special || 0 };
  } catch {
    return { ch: "?", color: 7, special: 0 };
  }
}

// The build hands every callback raw C values. Turn window ids, window types,
// menu modes and status fields into names, and read the status value: a C
// string for most fields, a bitmask for BL_CONDITION. (The @neth4ck shim does
// this too, but dereferences the 3.6 status pointer once too often, which is
// why we decode here instead.)
function decode(name, a) {
  const G = globalThis.nethackGlobal;
  const win = (id) => {
    const g = G.globals;
    return id === g.WIN_MAP ? "WIN_MAP" : id === g.WIN_MESSAGE ? "WIN_MESSAGE"
      : id === g.WIN_STATUS ? "WIN_STATUS" : id === g.WIN_INVEN ? "WIN_INVEN" : id;
  };
  switch (name) {
    case "shim_create_nhwindow": a[0] = G.constants.WIN_TYPE[a[0]]; break;
    case "shim_select_menu": a[0] = win(a[0]); a[1] = G.constants.MENU_SELECT[a[1]]; break;
    case "shim_add_menu": case "shim_putstr": case "shim_clear_nhwindow": case "shim_destroy_nhwindow":
    case "shim_curs": case "shim_start_menu": case "shim_end_menu": case "shim_print_glyph":
    case "shim_display_nhwindow":
      a[0] = win(a[0]); break;
    case "shim_status_update": {
      const fld = G.constants.STATUS_FIELD[a[0]];
      const ptr = a[1];
      a[0] = fld;
      a[1] = !ptr ? "" : fld === "BL_CONDITION" ? M.getValue(ptr, "i32")
        : fld === "BL_FLUSH" || fld === "BL_RESET" ? "" : M.UTF8ToString(ptr);
      break;
    }
  }
  return a;
}

async function windowPort(name, ...a) {
  switch (name) {
    case "shim_init_nhwindows": case "shim_status_init": case "shim_status_enablefield":
    case "shim_player_selection": case "shim_askname": case "shim_get_nh_event":
    case "shim_suspend_nhwindows": case "shim_resume_nhwindows": case "shim_mark_synch":
    case "shim_wait_synch": case "shim_cliparound": case "shim_update_inventory":
    case "shim_number_pad": case "shim_start_screen": case "shim_end_screen":
    case "shim_preference_update": case "shim_nhbell": case "shim_update_positionbar":
    case "shim_change_color": case "shim_change_background":
      return;
    case "shim_create_nhwindow": {
      const id = nextWin++;
      wins.set(id, { type: a[0], lines: [], items: [], prompt: "" });
      return id;
    }
    case "shim_clear_nhwindow": {
      if (a[0] === "WIN_MESSAGE") ageMessages();
      else if (a[0] === "WIN_MAP") clearMap();
      else { const w = wins.get(a[0]); if (w) w.lines = []; }
      return;
    }
    case "shim_display_nhwindow": {
      const w = typeof a[0] === "number" ? wins.get(a[0]) : null;
      if (w && w.lines.length) { await showText(w.lines); w.lines = []; }
      return;
    }
    case "shim_destroy_nhwindow": wins.delete(a[0]); return;
    case "shim_curs": if (a[0] === "WIN_MAP") moveCursor(a[1], a[2]); return;
    case "shim_putstr": {
      const [w, , str] = a;
      if (w === "WIN_MESSAGE") addMessage(str);
      else if (w === "WIN_STATUS" || w === "WIN_MAP") return;
      else (wins.get(w) || { lines: [] }).lines.push(str);
      return;
    }
    case "shim_raw_print": case "shim_raw_print_bold": addMessage(a[0]); return;
    case "shim_display_file": {
      let text = null;
      try { text = M.FS.readFile("/" + a[0], { encoding: "utf8" }); } catch { /* most help files live in the data archive */ }
      if (text) await showText(text.split("\n"));
      else if (a[1]) addMessage(`(The ${a[0]} file isn't available in this build.)`);
      return;
    }
    case "shim_start_menu": { const w = wins.get(a[0]) || { lines: [] }; w.items = []; w.prompt = ""; wins.set(a[0], w); return; }
    case "shim_add_menu": {
      const [w, , identPtr, ch, , attr, str, presel] = a;
      const ident = identPtr ? M.getValue(identPtr, "i32") : 0;
      const win = wins.get(w);
      if (win) win.items.push({ ident, ch: ch ? String.fromCharCode(ch) : "", attr, str, presel });
      return;
    }
    case "shim_end_menu": { const w = wins.get(a[0]); if (w) w.prompt = a[1] || ""; return; }
    case "shim_select_menu": {
      const [w, how, listPtr] = a;
      const win = wins.get(w) || { items: [] };
      const { n, list } = await selectMenu(win, how);
      if (n > 0 && listPtr) {
        const buf = M._malloc(8 * n);
        list.forEach((it, i) => { M.setValue(buf + 8 * i, it.ident, "i32"); M.setValue(buf + 8 * i + 4, -1, "i32"); });
        M.setValue(listPtr, buf, "*");
      }
      return n;
    }
    case "shim_message_menu": addMessage(a[2]); return a[0] || 0;
    case "shim_print_glyph": {
      const [, x, y, glyph] = a;
      const g = mapGlyph(glyph, x, y);
      setCell(x, y, g.ch, g.color, g.special);
      return;
    }
    case "shim_nhgetch": paint(); return nextKey();
    case "shim_nh_poskey": {
      paint();
      const ev = await nextEvent();
      if (typeof ev === "number") return ev;
      const [xp, yp, mp] = a;
      M.setValue(xp, ev.x, "i32"); M.setValue(yp, ev.y, "i32"); M.setValue(mp, 1, "i32");
      return 0;
    }
    case "shim_yn_function": paint(); return yesNo(a[0], a[1], a[2]);
    case "shim_getlin": {
      const text = await getLine(a[0]);
      globalThis.nethackGlobal.helpers.setPointerValue("shim_getlin", a[1], "s", text == null ? "\x1b" : text);
      return;
    }
    case "shim_get_ext_cmd": return extCommand();
    case "shim_doprev_message": await showText(history.slice(-40)); return 0;
    case "shim_getmsghistory": return "";
    case "shim_putmsghistory": if (a[0]) history.push(a[0]); return;
    case "shim_delay_output": await sleep(25); return;
    case "shim_status_update": {
      const [fld, val] = a;
      if (fld === "BL_FLUSH" || fld === "BL_RESET") { renderStatus(); return; }
      if (fld === "BL_CONDITION") { condMask = val || 0; return; }
      st[fld] = val;
      return;
    }
    case "shim_outrip": return;
    case "shim_exit_nhwindows": {
      if (a[0]) addMessage(a[0]);
      await finish();
      return;
    }
  }
  return 0;
}

// ---- Saves (IndexedDB) ----------------------------------------------------------

function syncSaves(populate) {
  return new Promise((resolve) => {
    try { M.FS.syncfs(populate, () => resolve()); } catch { resolve(); }
  });
}

async function finish() {
  if (gameOver) return;
  gameOver = true;
  await syncSaves(false);
  paint();
  openPanel(`${esc(history.slice(-6).join("\n"))}<span class="hint">The game has ended. ` +
    `<a href="" style="color:#9cf">Play again</a> — a saved game continues automatically.</span>`);
}

// A save made by this browser, so the start screen can say so. Looks in
// IndexedDB directly (IDBFS's own database) without creating anything.
function hasSave(name) {
  return new Promise((resolve) => {
    let req;
    try { req = indexedDB.open("/save"); } catch { return resolve(false); }
    req.onupgradeneeded = (e) => e.target.transaction.abort();
    req.onerror = () => resolve(false);
    req.onsuccess = () => {
      const db = req.result;
      try {
        const tx = db.transaction("FILE_DATA", "readonly");
        const r = tx.objectStore("FILE_DATA").getKey("/save/0" + name);
        r.onsuccess = () => { resolve(r.result != null); db.close(); };
        r.onerror = () => { resolve(false); db.close(); };
      } catch { resolve(false); db.close(); }
    };
  });
}

// ---- Start ------------------------------------------------------------------------

const cleanName = () => (el("pname").value.replace(/[^A-Za-z0-9]/g, "").slice(0, 20) || "Adventurer");
try { const n = localStorage.getItem("exe_nethack_name"); if (n) el("pname").value = n; } catch { /* private mode */ }
async function refreshSaved() {
  const saved = await hasSave(cleanName());
  el("savednote").hidden = !saved;
  el("go").textContent = saved ? "Continue saved game" : "Start a new game";
}
el("pname").addEventListener("input", refreshSaved);
refreshSaved();

el("go").addEventListener("click", async () => {
  const name = cleanName();
  try { localStorage.setItem("exe_nethack_name", name); } catch { /* fine */ }
  const role = el("prole").value;
  el("start").remove();
  started = true;
  fit();
  el("msgs").textContent = "Loading NetHack…";
  const opts = [`name:${name}`, "hilite_pet", "showexp", "time", "color", "autopickup",
    'pickup_types:$?!/="+', "!autodig", "number_pad:0", "mouse_support"];
  if (role !== "random") opts.push(`role:${role}`);
  globalThis.nethackCallback = (name, ...args) => windowPort(name, ...decode(name, args));
  await createModule({
    locateFile: (f) => new URL("vendor/" + f, import.meta.url).href,
    preRun: [(mod) => {
      M = mod;   // callbacks start before createModule resolves
      mod.ENV.NETHACKOPTIONS = opts.join(",");
      try { mod.FS.mkdir("/save"); } catch { /* exists */ }
      mod.FS.mount(mod.IDBFS, {}, "/save");
      mod.addRunDependency("idbfs");
      mod.FS.syncfs(true, () => mod.removeRunDependency("idbfs"));
    }],
    onRuntimeInitialized() {
      M.ccall("shim_graphics_set_callback", null, ["string"], ["nethackCallback"], { async: true });
    },
  });
});
