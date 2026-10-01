// /dos-emulator/ — run the visitor's own DOS program in the same DOSBox the
// hosted games use. Nothing is uploaded: the files are read here, packed into
// a js-dos bundle (the files + .jsdos/dosbox.conf, which is all a hosted game
// bundle is) and handed to dos-embed.js through window.DosEmbed.
//
// Why this exists: the Windows loader could only tell people with a DOS .exe
// "Wine will not start this" — a dead end on the site's main page, for a
// program the site already has an emulator for.
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const els = {
    drop: $("dos-byo-drop"),
    exeInput: $("dos-byo-exe"),
    folderInput: $("dos-byo-folder"),
    zipInput: $("dos-byo-zip"),
    pickExe: $("dos-byo-pick-exe"),
    pickFolder: $("dos-byo-pick-folder"),
    pickZip: $("dos-byo-pick-zip"),
    info: $("dos-byo-info"),
    entryWrap: $("dos-byo-entry-wrap"),
    entry: $("dos-byo-entry"),
    speed: $("dos-byo-speed"),
    notice: $("dos-byo-notice"),
    run: $("dos-byo-run"),
  };
  if (!els.drop || !els.run) return;

  function T(key, fallback, vars) {
    let s = (window.__I18N && window.__I18N[key]) || fallback;
    if (vars) for (const k in vars) s = s.split("{" + k + "}").join(vars[k]);
    return s;
  }

  function track(name, params) {
    if (typeof window.gtag === "function") {
      window.gtag("event", name, Object.assign({ app_slug: "dos-emulator", runtime: "dosbox" }, params || {}));
    }
  }

  const state = { files: [], source: null, entry: null, booted: false };
  const PROMPT = "\u0000prompt"; // entry value for "just give me C:\>"

  // ─── reading what they gave us ─────────────────────────────────────────

  function cleanPath(p) {
    return String(p).replace(/\\/g, "/").split("/")
      .filter((seg) => seg && seg !== "." && seg !== "..").join("/");
  }

  function stripCommonTop(files) {
    const tops = files.map((f) => (f.path.includes("/") ? f.path.split("/")[0] : ""));
    if (!tops.length || !tops[0] || !tops.every((t) => t === tops[0])) return files;
    return files.map((f) => ({ path: f.path.slice(tops[0].length + 1), bytes: f.bytes }));
  }

  async function readFiles(fileList, source) {
    const out = [];
    for (const f of Array.from(fileList || [])) {
      const path = cleanPath(f.webkitRelativePath || f.name);
      if (!path) continue;
      out.push({ path, bytes: new Uint8Array(await f.arrayBuffer()) });
    }
    stage(stripCommonTop(out), source);
  }

  let jszipLoading = null;
  function loadJSZip() {
    if (window.JSZip) return Promise.resolve();
    // The same JSZip 2.x the Windows loader preloads; it is already cached
    // for anyone who has used that page.
    jszipLoading = jszipLoading || new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "/boxedwine/build/default/jszip.min.js";
      s.onload = resolve;
      s.onerror = () => reject(new Error("Could not load the zip library."));
      document.head.appendChild(s);
    });
    return jszipLoading;
  }

  async function readZip(file) {
    if (!file) return;
    try {
      await loadJSZip();
      const zip = new window.JSZip(await file.arrayBuffer());
      const out = [];
      for (const name of Object.keys(zip.files)) {
        const obj = zip.files[name];
        const path = cleanPath(name);
        if (obj.dir || !path || /^__MACOSX\//.test(path)) continue;
        out.push({ path, bytes: obj.asUint8Array() });
      }
      stage(stripCommonTop(out), "zip");
    } catch (err) {
      showNotice("bad", T("dosZipBad", "That zip could not be read"), err.message);
    }
  }

  // ─── what kind of program is it? ──────────────────────────────────────
  // A DOS .exe and a Windows .exe both start with MZ. Only a file whose
  // header actually points at a PE or NE signature is Windows — and only when
  // e_lfarlc says the new-style header exists at all, because in a plain DOS
  // binary the e_lfanew bytes are relocation data that can point anywhere
  // (see pe-inspect.js). LE/LX is DOS/4GW, which is DOS: DOOM is one.
  function programKind(path, bytes) {
    if (/\.com$/i.test(path)) return "com";
    if (/\.bat$/i.test(path)) return "bat";
    if (bytes.length < 64 || bytes[0] !== 0x4d || bytes[1] !== 0x5a) return "not_exe";
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (dv.getUint16(0x18, true) >= 0x40) {
      const off = dv.getUint32(0x3c, true);
      if (off > 0 && off + 4 <= bytes.length) {
        const sig = String.fromCharCode(bytes[off], bytes[off + 1]);
        if (sig === "PE" && bytes[off + 2] === 0 && bytes[off + 3] === 0) return "windows";
        if (sig === "NE") return "windows16";
      }
    }
    return "dos";
  }

  // The program people mean is rarely SETUP or INSTALL, and is usually the
  // biggest executable in the folder.
  function candidates() {
    const setupish = /(^|\/)(setup|install|instal|uninst|config|setsound|sound|readme)[^/]*$/i;
    return state.files
      .filter((f) => /\.(exe|com|bat)$/i.test(f.path))
      .map((f) => ({
        f,
        score: (/\.bat$/i.test(f.path) ? 1 : 0) + (setupish.test(f.path) ? 2 : 0),
      }))
      .sort((a, b) => a.score - b.score || b.f.bytes.length - a.f.bytes.length)
      .map((c) => c.f);
  }

  function stage(files, source) {
    state.files = files;
    state.source = source;
    state.entry = null;
    showNotice(null);
    const total = files.reduce((n, f) => n + f.bytes.length, 0);
    const list = candidates();
    els.entry.replaceChildren();
    for (const f of list) {
      const o = document.createElement("option");
      o.value = f.path;
      o.textContent = f.path;
      els.entry.append(o);
    }
    const p = document.createElement("option");
    p.value = PROMPT;
    p.textContent = T("dosPromptOnly", "Just the C:\\> prompt — I'll type the command");
    els.entry.append(p);
    els.entryWrap.hidden = files.length < 2 && list.length < 2;
    els.info.textContent = T("dosStaged", "{n} file(s), {size}", { n: files.length, size: formatBytes(total) });
    if (!files.length) {
      els.run.disabled = true;
      return;
    }
    els.run.disabled = false;
    setEntry(list.length ? list[0].path : PROMPT);
    track("dos_byo_stage", { entry_source: source, files: files.length, size_bucket: sizeBucket(total) });
  }

  function setEntry(path) {
    state.entry = path;
    state.kind = null;
    els.entry.value = path;
    showNotice(null);
    if (path === PROMPT) return;
    const f = state.files.find((x) => x.path === path);
    const kind = programKind(path, f.bytes);
    state.kind = kind;
    if (kind === "windows" || kind === "windows16") {
      showNotice("bad",
        T("dosIsWindows", "This is a Windows program, not a DOS one"),
        T("dosIsWindowsBody", "DOSBox will only print \"This program cannot be run in DOS mode.\" The Windows loader is the place for it."),
        { href: "/load-exe/#handoff", text: T("dosOpenWindows", "Open it in the Windows loader →"), action: "open_windows" });
      track("preflight_shown", { preflight: kind, format: kind === "windows" ? "pe" : "ne" });
    } else if (kind === "not_exe") {
      showNotice("bad",
        T("dosNotExe", "This is not a DOS program"),
        T("dosNotExeBody", "It does not start with the MZ marker every .exe has. It may be a renamed archive, or a download that did not finish."));
    }
  }

  // ─── notices ───────────────────────────────────────────────────────────

  function showNotice(kind, head, body, link) {
    const box = els.notice;
    box.replaceChildren();
    box.hidden = !kind;
    if (!kind) return;
    box.classList.toggle("preflight-bad", kind === "bad");
    const h = document.createElement("strong");
    h.textContent = head;
    const p = document.createElement("p");
    p.textContent = body;
    box.append(h, p);
    if (link) {
      const a = document.createElement("a");
      a.href = link.href;
      a.textContent = link.text;
      a.addEventListener("click", async (e) => {
        e.preventDefault();
        track("preflight_action", { action: link.action });
        await window.ExeHandoff?.put(state.files, state.entry);
        location.href = link.href;
      });
      const wrap = document.createElement("p");
      wrap.className = "preflight-actions";
      wrap.append(a);
      box.append(wrap);
    }
  }

  // ─── building the bundle ───────────────────────────────────────────────
  // DOS sees 8.3 names. DOSBox maps longer ones to PROGRA~1-style aliases,
  // which nobody can be expected to type, so the path to the program and the
  // program itself are renamed to something DOS can say. Everything else
  // keeps its name: a game asks for its data files by the names they shipped
  // with, and those are 8.3 already.
  function dosName(name, taken) {
    const dot = name.lastIndexOf(".");
    const clean = (s) => s.toUpperCase().replace(/[^A-Z0-9_\-!#$%&'()@^`{}~]/g, "");
    let base = clean(dot > 0 ? name.slice(0, dot) : name) || "PROG";
    const ext = dot > 0 ? clean(name.slice(dot + 1)).slice(0, 3) : "";
    let out = base.slice(0, 8) + (ext ? "." + ext : "");
    for (let i = 1; taken && taken.has(out) && i < 100; i++) {
      out = base.slice(0, 8 - String(i).length - 1) + "~" + i + (ext ? "." + ext : "");
    }
    return out;
  }
  const is83 = (s) => /^[A-Za-z0-9_\-!#$%&'()@^`{}~]{1,8}(\.[A-Za-z0-9_\-!#$%&'()@^`{}~]{1,3})?$/.test(s);

  function planPaths() {
    const rename = new Map(); // original path -> path in the bundle
    if (state.entry === PROMPT) return { rename, dir: "", exe: "" };
    const parts = state.entry.split("/");
    const fixed = parts.map((seg) => (is83(seg) ? seg : dosName(seg)));
    // Re-root every file under a renamed directory, so the program still
    // finds the files that sat beside it.
    for (const f of state.files) {
      let p = f.path;
      for (let i = 0; i < parts.length - 1; i++) {
        const from = parts.slice(0, i + 1).join("/");
        const to = fixed.slice(0, i + 1).join("/");
        if (p === from || p.startsWith(from + "/")) p = to + p.slice(from.length);
      }
      if (f.path === state.entry) p = fixed.join("/");
      if (p !== f.path) rename.set(f.path, p);
    }
    return {
      rename,
      dir: fixed.slice(0, -1).join("\\").toUpperCase(),
      exe: fixed[fixed.length - 1].toUpperCase(),
    };
  }

  function dosboxConf(plan) {
    // A fixed speed, like every hosted game here (3,500–20,000). DOSBox's
    // "auto" gives real-mode programs only 3,000 cycles, which is too slow
    // for most of what people bring.
    const cycles = els.speed ? els.speed.value : "8000";
    const lines = [
      "[sdl]", "autolock=false", "",
      "[dosbox]", "memsize=16", "",
      "[cpu]", "core=auto", "cputype=auto", "cycles=" + cycles, "",
      "[mixer]", "nosound=false", "rate=44100", "blocksize=1024", "prebuffer=20", "",
      "[sblaster]", "sbtype=sb16", "sbbase=220", "irq=7", "dma=1", "hdma=5", "mixer=true", "oplmode=auto", "oplrate=44100", "",
      "[speaker]", "pcspeaker=true", "pcrate=44100", "",
      "[autoexec]", "SET BLASTER=A220 I7 D1 H5 T6", "mount c .", "c:",
    ];
    if (plan.dir) lines.push("cd \\" + plan.dir);
    if (plan.exe) lines.push(/\.BAT$/.test(plan.exe) ? "call " + plan.exe : plan.exe);
    return lines.join("\r\n") + "\r\n";
  }

  async function buildBundle() {
    await loadJSZip();
    const plan = planPaths();
    const zip = new window.JSZip();
    for (const f of state.files) zip.file(plan.rename.get(f.path) || f.path, f.bytes);
    zip.file(".jsdos/dosbox.conf", dosboxConf(plan));
    // Stored, not deflated: it is unpacked again a moment later in the same
    // tab, so compressing it would only spend the time twice.
    return zip.generate({ type: "uint8array", compression: "STORE" });
  }

  // ─── did it draw? ──────────────────────────────────────────────────────
  // The DOS prompt is a picture too, so "anything on screen" cannot be the
  // success signal the way it is for Wine. A DOS game that gets going almost
  // always leaves 80x25 text for a graphics mode; one that fails stays at
  // C:\>. Many games start on a text screen that waits for a key (Keen 4's
  // "Ready - Press a Key"), so this waits as long as the visitor does:
  // "graphics" the moment the mode changes, "text" only if they leave — or
  // ten visible minutes pass — without it ever changing. ttff_ms is then the
  // time they gave it.
  function watchScreen(t0, meta) {
    const canvas = $("dos-canvas");
    let visibleMs = 0, last = performance.now(), sawGraphics = false, done = false;
    const textMode = (w, h) => (w === 720 || w === 640) && (h === 400 || h === 350);
    const finish = (outcome) => {
      if (done) return;
      done = true;
      clearInterval(timer);
      removeEventListener("pagehide", onHide);
      track("byo_result", Object.assign({ outcome, ttff_ms: Math.round(performance.now() - t0) }, meta));
    };
    const onHide = () => finish(sawGraphics ? "graphics" : "text");
    const timer = setInterval(() => {
      const now = performance.now();
      if (document.visibilityState === "visible") visibleMs += now - last;
      last = now;
      // Under 320 wide is the canvas's 300x150 default: DOSBox has not
      // drawn yet.
      if (!canvas || canvas.width < 320) return;
      if (!textMode(canvas.width, canvas.height)) {
        sawGraphics = true;
        finish("graphics");
      } else if (visibleMs > 600000) {
        finish("text");
      }
    }, 500);
    addEventListener("pagehide", onHide);
  }

  // ─── run ───────────────────────────────────────────────────────────────

  async function run() {
    if (!state.files.length || state.booted) return;
    els.run.disabled = true;
    const t0 = performance.now();
    try {
      const bundle = await buildBundle();
      const label = state.entry === PROMPT ? "DOS" : state.entry.split("/").pop();
      const key = state.entry === PROMPT ? "prompt" : state.entry.toLowerCase();
      const embed = await engine();
      embed.stage(bundle, label, "byo-dos-" + shortHash(key));
      state.booted = true;
      if (state.kind && /windows|not_exe/.test(state.kind)) track("preflight_action", { action: "run_anyway" });
      const total = state.files.reduce((n, f) => n + f.bytes.length, 0);
      watchScreen(t0, {
        format: state.entry === PROMPT ? "prompt" : (state.kind || "dos"),
        entry_source: state.source,
        size_bucket: sizeBucket(total),
        variant: els.speed ? els.speed.value : "8000",
      });
      $("dos-embed")?.scrollIntoView({ behavior: "smooth", block: "start" });
      await embed.play();
    } catch (err) {
      showNotice("bad", T("dosBuildFailed", "Could not start it"), err.message);
      track("boot_error", { error_message: String(err.message).slice(0, 120) });
      els.run.disabled = false;
    }
  }

  function engine() {
    if (window.DosEmbed) return Promise.resolve(window.DosEmbed);
    return new Promise((resolve) => {
      document.addEventListener("dosembed:ready", () => resolve(window.DosEmbed), { once: true });
    });
  }

  // ─── helpers ───────────────────────────────────────────────────────────

  function formatBytes(n) {
    if (n < 1024) return n + " B";
    if (n < 1048576) return (n / 1024).toFixed(1) + " KB";
    return (n / 1048576).toFixed(1) + " MB";
  }
  function sizeBucket(n) {
    if (n < 102400) return "under_100kb";
    if (n < 1048576) return "under_1mb";
    if (n < 10485760) return "under_10mb";
    if (n < 104857600) return "under_100mb";
    return "over_100mb";
  }
  // Same hash app.js uses for its byo-<hash> saves.
  function shortHash(s) {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i) & 0xff;
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h.toString(36);
  }

  // ─── wiring ────────────────────────────────────────────────────────────

  const click = (btn, input) => btn && btn.addEventListener("click", (e) => { e.stopPropagation(); input.click(); });
  click(els.pickExe, els.exeInput);
  click(els.pickFolder, els.folderInput);
  click(els.pickZip, els.zipInput);
  els.drop.addEventListener("click", () => els.exeInput.click());
  els.drop.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); els.exeInput.click(); }
  });
  els.exeInput.addEventListener("change", (e) => readFiles(e.target.files, "exe"));
  els.folderInput.addEventListener("change", (e) => readFiles(e.target.files, "folder"));
  els.zipInput.addEventListener("change", (e) => readZip(e.target.files[0]));
  els.drop.addEventListener("dragover", (e) => { e.preventDefault(); els.drop.classList.add("hover"); });
  els.drop.addEventListener("dragleave", () => els.drop.classList.remove("hover"));
  els.drop.addEventListener("drop", (e) => {
    e.preventDefault();
    els.drop.classList.remove("hover");
    const files = Array.from(e.dataTransfer.files || []);
    if (files.length === 1 && /\.zip$/i.test(files[0].name)) readZip(files[0]);
    else readFiles(files, files.length === 1 ? "exe" : "files");
  });
  els.entry.addEventListener("change", (e) => setEntry(e.target.value));
  els.run.addEventListener("click", run);

  // Sent here from the Windows loader with the files already chosen.
  if (location.hash === "#handoff" && window.ExeHandoff) {
    try { history.replaceState(null, "", location.pathname + location.search); } catch (_) { /* cosmetic */ }
    window.ExeHandoff.take().then((h) => {
      if (!h || !h.files || !h.files.length) return;
      stage(h.files, "handoff");
      if (h.entry && h.files.some((f) => f.path === h.entry)) setEntry(h.entry);
      els.drop.scrollIntoView({ behavior: "smooth", block: "center" });
    }).catch(() => {});
  }
})();
