#!/usr/bin/env node
// Generates /run/<slug>/index.html instant-play app pages for ExeBrowser.
//
// Each page LEADS with the live runtime (embed.js + app.js) so a visitor can
// click "▶ Play" and run the app in-page — matching the "play X online, no
// download" sites we compete with — then follows with the written guide for
// depth + AdSense. The shared template also emits structured data (Breadcrumb +
// VideoGame|SoftwareApplication + FAQPage) for rich results.
//
// This file is the SINGLE SOURCE OF TRUTH for every /run/<slug>/ page. Editing
// a page means editing its entry in the `pages` array below and re-running:
//   node scripts/gen-app-pages.mjs
//
// Then check nothing has drifted out of sync (missing payloads, dead /run/
// links, blog verdicts that no longer match their pages, hosted games whose
// copy still says they can't be played here):
//   node scripts/check-consistency.mjs
//
// ── Per-page data contract ────────────────────────────────────────────────
//   slug         URL slug (folder under /run/)
//   title        <title> — lead with the transactional query ("Play X Online…")
//   description  meta description (110–160 chars, keyword-rich)
//   keywords     comma list (legacy, low weight, kept for parity)
//   ogTitle, ogDescription   social card text
//   crumb        breadcrumb + last-segment label (e.g. "Play DOOM")
//   appName      short label the Play button uses (e.g. "DOOM")
//   appType      "game" → VideoGame schema | "app" → SoftwareApplication schema
//   genre        (game only) array of genre strings
//   author       publisher/author org name (for schema), optional
//   variant      Wine variant to lock in: default | gecko | win3x | r18
//   entry        preferred entry EXE basename (e.g. "DOOM95.EXE"), optional
//   appUrl       hosted, LICENSE-CLEAN app zip path (e.g. "/apps/doom/doom.zip").
//                OMIT for anything we can't redistribute → page falls back to the
//                in-page uploader (still no trip to the home page).
//   verdict      { kind: "good"|"partial"|"bad", text: "Works well" }
//   intro        lead paragraph HTML (above the player)
//   sections     array of { h: "Heading", html: "<p>…</p>" } rendered below the player
//   faq          array of { q, a } — rendered as <details> AND as FAQPage JSON-LD
//   related      array of { href, title, desc } link cards
//   download     optional { heading, html } rendered in a .download-box
//   licenseNote  optional warn-box HTML for licensing caveats
//   dosRuntime   true → page uses the DOSBox embed (dos-embed.js) instead of
//                Wine. REQUIRED for DOS-era games: Boxedwine vm86-faults on DOS
//                exes. The zip needs .jsdos/dosbox.conf (autoexec picks the
//                entry EXE — the `entry` field is ignored for DOS pages).
//   iframeUrl    external playable iframe (e.g. freeciv) — replaces both runtimes
//   hostable     informational only; the honest "is playable" signal is a
//                non-empty appUrl/iframeUrl (isPlayable() below)
//   skipGenerate true → entry appears in the /run/ hub + sitemap but its page
//                HTML is HAND-MAINTAINED (e.g. space-cadet-open, dragon-keep) —
//                the generator won't overwrite it
//   mobileControls  { type, hint, buttons:[{label, dosKey|key, area?, cls?}] }
//                touch overlay. type MUST contain "dos" on DOS pages so buttons
//                emit GLFW dosKey codes via window.__dosEmitKey (not KeyboardEvents)
//   screenshot   true → /run/<slug>/screenshot.png (string = custom filename);
//                drives og:image, JSON-LD image, and the <figure> under the embed
//   updated      "YYYY-MM-DD" — sitemap <lastmod> + "Guide updated" line
//   licenseReason  prose note (why hosting is legal); NOTICE.md in the app dir
//                is the canonical provenance record
//   pointerLock  true → clicking the screen captures the mouse via the Pointer
//                Lock API and motion is fed to the game as raw deltas. Needed
//                by any game that draws its own cursor (Scorched Earth), since
//                absolute positioning desynchronises the two cursors.
//   fullyFree    prose reason this title is free in full (engine AND assets,
//                no shareware split). Drives the FREE badge, the "Free &
//                complete" filter chip, and a note under the game.
//   clickKey     GLFW key code a left-click also sends (e.g. 341 = Ctrl/fire).
//                For DOS games that ship with the mouse disabled and give no
//                in-game way to enable it, so a click still does the obvious
//                thing. clickKeyRight does the same for right-click.
//   addedDate    "YYYY-MM-DD" the title went live — drives the NEW badge on the
//                hub + homepage grids for NEW_DAYS (14) days. Distinct from
//                `updated`, which is about the page copy, not the title.
//   rank         integer, lower sorts earlier. Hand-assigned running order for
//                the "Play now" grids on / and /run/, so the best-known titles
//                lead. Unranked entries sort after every ranked one, keeping
//                their previous relative order. Explicit because the old
//                screenshot/NEW-badge sort decayed into raw JSON order once
//                every addedDate aged out of the 14-day window.
//   categories   array from the closed set used by the filter chips: Shooters,
//                Platformers, Action, Puzzle & strategy, Racing & sports,
//                Pinball, Apps & tools. ("Free & complete" is derived from
//                `fullyFree`, not written here.) Chip order lives in two
//                places — this file and gen-home-grid.mjs — and must match.
//   h1           the on-page <h1>, when it should differ from `title` (which is
//                the <title>/SEO string and is usually far longer).

import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { LANGS, LOCALES, languagesFor, translatedEntry, translatedSlugs, prefixOf, hasTranslation } from "./i18n/locales.mjs";

const ROOT = resolve(process.cwd(), "public");

// Read intrinsic pixel dimensions from a PNG or JPEG header so <img> gets
// correct width/height (no layout shift). Returns null if unreadable.
function imageSize(absPath) {
  try {
    const b = readFileSync(absPath);
    // PNG: 8-byte signature, then IHDR chunk with width/height at bytes 16..24.
    if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
      return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
    }
    // JPEG: scan for a Start-Of-Frame marker (0xFFC0..0xFFCF, excluding C4/C8/CC).
    if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
      let i = 2;
      while (i < b.length) {
        if (b[i] !== 0xff) { i++; continue; }
        const marker = b[i + 1];
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
        }
        i += 2 + b.readUInt16BE(i + 2); // skip this segment
      }
    }
  } catch {}
  return null;
}
const SITE = "https://exebrowser.com";

// Newsletter provider endpoint (Buttondown, Mailchimp, Listmonk — any host that
// accepts a plain POSTed form). Empty means the signup block is not rendered at
// all: an email box that silently drops addresses is worse than none, and this
// is the only place to change to turn the feature on across every page.
const NEWSLETTER_ACTION = "";

const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// A page may only promise instant play when we actually host a payload.
const isPlayable = (p) => !!(p.appUrl || p.iframeUrl);

// A captured screenshot of the app running in-browser. `screenshot: true` uses
// the conventional /run/<slug>/screenshot.png; a string overrides the filename.
// Returns null when no screenshot is set (pages fall back to the site og.png).
const screenshotFile = (p) =>
  p.screenshot ? (typeof p.screenshot === "string" ? p.screenshot : "screenshot.png") : null;
const screenshotUrl = (p) => {
  const f = screenshotFile(p);
  return f ? `${SITE}/run/${p.slug}/${f}` : null;
};
const ogImage = (p) => screenshotUrl(p) || `${SITE}/og.png`;
// A <figure> showing the screenshot, placed under the embed on pages that have one.
const figureHtml = (p) => {
  const f = screenshotFile(p);
  if (!f) return "";
  const alt = esc(`${p.appName || p.crumb} running in a browser tab via ExeBrowser`);
  const cap = esc(`${p.appName || p.crumb} running in the browser — no install, no upload.`);
  const dim = imageSize(resolve(ROOT, "run", p.slug, f)) || { w: 1200, h: 750 };
  return `
    <figure class="app-shot">
      <img src="/run/${p.slug}/${f}" width="${dim.w}" height="${dim.h}" loading="lazy" alt="${alt}" />
      <figcaption>${cap}</figcaption>
    </figure>`;
};

const RUNTIME_LABELS = {
  default: "Wine 1.7.55 (Win32) + WebAssembly",
  gecko: "Wine 1.7.55 + Gecko (Win32) + WebAssembly",
  win3x: "Wine 3.1 (Win 3.x, 16-bit) + WebAssembly",
  r18: "Boxedwine 18R2 + WebAssembly",
};
const runtimeLabel = (p) => {
  if (p.iframeUrl || p.slug === "space-cadet-open") return "WebAssembly (native port)";
  if (p.dosRuntime) return "DOSBox + WebAssembly";
  return RUNTIME_LABELS[p.variant || "default"] || RUNTIME_LABELS.default;
};
const monthYear = (iso, L = EN) => {
  const [y, m] = String(iso).split("-").map(Number);
  if (!(m >= 1 && m <= 12)) return String(iso);
  // Intl gives the month name in the visitor's language for free, and gets the
  // ordering right too — German wants "August 2026", Spanish "agosto de 2026".
  try {
    return new Intl.DateTimeFormat(L.htmlLang, { month: "long", year: "numeric", timeZone: "UTC" })
      .format(new Date(Date.UTC(y, m - 1, 1)));
  } catch {
    const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
    return `${MONTHS[m - 1]} ${y}`;
  }
};
// For JSON-LD string values: strip tags, collapse whitespace, JSON-encode.
const jsonText = (s) => JSON.stringify(String(s).replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim());

function breadcrumbLd(p) {
  return `<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "${SITE}/" },
    { "@type": "ListItem", "position": 2, "name": "App guides", "item": "${SITE}/run/" },
    { "@type": "ListItem", "position": 3, "name": ${jsonText(p.crumb)}, "item": "${SITE}/run/${p.slug}/" }
  ]
}
</script>`;
}

function appLd(p) {
  const url = `${SITE}/run/${p.slug}/`;
  if (p.appType === "game") {
    const genre = (p.genre || []).map((g) => JSON.stringify(g)).join(", ");
    return `<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "VideoGame",
  "name": ${jsonText(p.appName)},
  "url": "${url}",
  "image": "${ogImage(p)}",
  "description": ${jsonText(p.description)},
  "applicationCategory": "Game",
  "genre": [${genre}],
  "gamePlatform": ["Web browser", "Windows"],
  "operatingSystem": "Web Browser"${p.author ? `,
  "publisher": { "@type": "Organization", "name": ${JSON.stringify(p.author)} }` : ""}${p.updated ? `,
  "dateModified": ${JSON.stringify(p.updated)}` : ""}${isPlayable(p) ? `,
  "offers": { "@type": "Offer", "price": "0", "priceCurrency": "USD" }` : ""}
}
</script>`;
  }
  return `<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  "name": ${jsonText(p.appName)},
  "url": "${url}",
  "image": "${ogImage(p)}",
  "description": ${jsonText(p.description)},
  "applicationCategory": "Utility",
  "operatingSystem": "Web Browser"${p.author ? `,
  "author": { "@type": "Organization", "name": ${JSON.stringify(p.author)} }` : ""}${p.updated ? `,
  "dateModified": ${JSON.stringify(p.updated)}` : ""}${isPlayable(p) ? `,
  "offers": { "@type": "Offer", "price": "0", "priceCurrency": "USD" }` : ""}
}
</script>`;
}

function faqLd(p) {
  if (!p.faq || !p.faq.length) return "";
  const items = p.faq
    .map(
      (f) => `    {
      "@type": "Question",
      "name": ${jsonText(f.q)},
      "acceptedAnswer": { "@type": "Answer", "text": ${jsonText(f.a)} }
    }`
    )
    .join(",\n");
  return `<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
${items}
  ]
}
</script>`;
}

function embedBlock(p) {
  if (p.iframeUrl) {
    return `
    <div class="iframe-embed-wrap" style="position:relative;width:100%;padding-bottom:62.5%;background:#000;border-radius:4px;overflow:hidden;">
      <iframe src="${esc(p.iframeUrl)}"
              style="position:absolute;top:0;left:0;width:100%;height:100%;border:0;"
              allowfullscreen
              loading="lazy"
              title="${esc(p.appName)}"></iframe>
    </div>`;
  }
  if (p.dosRuntime) {
    const attrs = [
      p.appUrl ? `data-app-url="${esc(p.appUrl)}"` : "",
      `data-app-name="${esc(p.appName)}"`,
      // The embed can derive this from the URL, but saying it outright means
      // the storage key is a property of the page rather than of its path.
      `data-slug="${esc(p.slug)}"`,
      // Games whose own mouse support is off/absent map a click to a key so
      // clicking still shoots. Omit for games that read the mouse natively.
      p.clickKey ? `data-click-key="${p.clickKey}"` : "",
      p.pointerLock ? `data-pointer-lock="true"` : "",
      p.clickKeyRight ? `data-click-key-right="${p.clickKeyRight}"` : "",
      `data-autoboot="false"`,
    ]
      .filter(Boolean)
      .join("\n         ");
    return `
    <div id="dos-embed"
         ${attrs}></div>`;
  }
  const attrs = [
    `data-variant="${esc(p.variant || "default")}"`,
    p.entry ? `data-entry="${esc(p.entry)}"` : "",
    p.appUrl ? `data-app-url="${esc(p.appUrl)}"` : "",
    `data-app-name="${esc(p.appName)}"`,
    `data-autoboot="false"`,
  ]
    .filter(Boolean)
    .join("\n         ");
  // When there's no hosted payload, leave a clear note in the source so future
  // edits know one-click play needs a license-clean zip dropped at appUrl.
  const note = p.appUrl
    ? ""
    : `\n    <!-- No hosted payload: the Play button reveals the in-page uploader.
         To enable true one-click play, host a license-clean zip and add
         data-app-url (and data-entry) to the div below. -->`;
  return `${note}
    <div id="exe-embed"
         ${attrs}></div>`;
}

// The controls a player needs, directly under the game rather than buried in
// prose further down the page. Rendered for every device: the touch pad above
// only appears on small screens, and desktop players previously had to hunt
// through the article to find out which key fires.
// Say plainly when a title is free in full, since most "free" retro games
// online are a shareware episode with the rest behind a purchase.
function freeNoteHtml(p) {
  if (!p.fullyFree) return "";
  return `
    <p class="free-note"><span class="badge-free">FREE</span> <strong>This is the complete game, free.</strong> ${esc(p.fullyFree)}</p>`;
}

function controlsPanelHtml(p, L = EN) {
  const rows = p.controls;
  if (!rows || !rows.length) return "";
  const anyMouse = rows.some((r) => r.mouse && r.mouse !== "—");
  const body = rows
    .map(
      (r) => `        <tr><th scope="row">${esc(r.action)}</th><td>${kbd(r.keyboard)}</td>${
        anyMouse ? `<td>${r.mouse && r.mouse !== "—" ? kbd(r.mouse) : '<span class="muted">—</span>'}</td>` : ""
      }</tr>`
    )
    .join("\n");
  return `
    <details class="controls-panel" open>
      <summary><strong>${esc(L.t("controls.summary"))}</strong> — ${esc(L.t("controls.summaryTail"))}</summary>
      <div class="table-wrap">
        <table class="controls-table">
          <thead><tr><th scope="col">${esc(L.t("controls.action"))}</th><th scope="col">${esc(L.t("controls.keyboard"))}</th>${
            anyMouse ? `<th scope="col">${esc(L.t("controls.mouse"))}</th>` : ""
          }</tr></thead>
          <tbody>
${body}
          </tbody>
        </table>
      </div>
    </details>`;
}

// Mark up the key names inside a control description, leaving the connecting
// words ("hold", "or", "then") as plain text. Anything that isn't a recognised
// key — "in-game Setup menu" — passes through untouched.
const KEY_WORDS = /\b(Arrow keys|number keys(?: \d–\d)?|Left-click|Right-click|Ctrl|Alt|Shift|Space|Esc|Tab|Enter|F1|F2|F3|W A S D|Y|Z|[0-9]|\/ \(forward slash\))\b/g;
function kbd(text) {
  const s = String(text);
  if (!s || s === "—") return esc(s);
  let out = "";
  let last = 0;
  for (const m of s.matchAll(KEY_WORDS)) {
    out += esc(s.slice(last, m.index)) + `<kbd>${esc(m[0])}</kbd>`;
    last = m.index + m[0].length;
  }
  return out + esc(s.slice(last));
}

function mobileControlsHtml(p) {
  const mc = p.mobileControls;
  if (!mc) return "";

  const isDos = mc.type.includes("dos");
  let btns = mc.buttons || [];

  // Every DOS game puts something behind Enter — starting a game, confirming a
  // menu, naming a save. Without a button for it the only way through a menu on
  // a phone is to tap the canvas and hope the game's click-to-key mapping
  // happens to be the right one, which is what visitors were reduced to doing.
  // Added here rather than in each of the twenty entries so a new game can't
  // ship without it.
  if (isDos && !btns.some((b) => Number(b.dosKey) === 257)) {
    btns = btns.concat([{ label: "ENTER", dosKey: 257 }]);
  }

  // Separate d-pad buttons (have area) from action buttons (no area)
  const dpad = btns.filter(b => b.area);
  const actions = btns.filter(b => !b.area);

  const dpadHtml = dpad.map(b =>
    `<button type="button" class="mgp-btn mgp-${b.area}" data-${isDos ? "doskey" : "key"}="${isDos ? b.dosKey : esc(b.key)}" data-code="${esc(b.code||"")}" data-keycode="${b.keyCode||0}" aria-label="${esc(b.label)}">${esc(b.label)}</button>`
  ).join("\n          ");

  const actionsHtml = actions.map(b =>
    `<button type="button" class="mgp-btn ${b.cls||""}" data-${isDos ? "doskey" : "key"}="${isDos ? b.dosKey : esc(b.key)}" data-code="${esc(b.code||"")}" data-keycode="${b.keyCode||0}" aria-label="${esc(b.label)}">${esc(b.label)}</button>`
  ).join("\n          ");

  // Wire-up script: DOS games fire into dos-embed canvas via dosKey scan codes;
  // Wine games fire KeyboardEvents into the Boxedwine canvas element.
  const wireScript = isDos ? `
<script>
(function(){
  function wire(){
    var canvas = document.getElementById("dos-canvas");
    if(!canvas){ setTimeout(wire,300); return; }
    document.querySelectorAll(".mgp-btn").forEach(function(btn){
      var sc = parseInt(btn.dataset.doskey, 10);
      if(!sc) return;
      function dn(e){ e.preventDefault(); window.__dosEmitKey && window.__dosEmitKey(sc,true); btn.classList.add("pressed"); }
      function up(e){ e.preventDefault(); window.__dosEmitKey && window.__dosEmitKey(sc,false); btn.classList.remove("pressed"); }
      btn.addEventListener("touchstart", dn, {passive:false});
      btn.addEventListener("touchend",   up, {passive:false});
      btn.addEventListener("touchcancel",up, {passive:false});
      btn.addEventListener("mousedown",  dn);
      btn.addEventListener("mouseup",    up);
      btn.addEventListener("mouseleave", up);
    });
  }
  wire();
})();
</script>` : `
<script>
(function(){
  function wire(){
    var canvas = document.getElementById("canvas");
    if(!canvas){ setTimeout(wire,300); return; }
    function fire(type, key, code, keyCode){
      canvas.dispatchEvent(new KeyboardEvent(type,{key:key,code:code,keyCode:keyCode,which:keyCode,bubbles:true,cancelable:true}));
    }
    // A tap's press and release can land inside one emulated frame, which the
    // game polls straight past — the button looks dead. Hold every press for a
    // minimum, and queue a repeat press behind the pending release so rapid
    // tapping can't cut the previous press short.
    var MIN_HOLD = 90;
    document.querySelectorAll(".mgp-btn").forEach(function(btn){
      var key=btn.dataset.key, code=btn.dataset.code, kc=parseInt(btn.dataset.keycode,10);
      var downAt = 0, releasing = null;
      function dn(e){
        e.preventDefault();
        if (releasing) { return; }
        downAt = Date.now(); fire("keydown",key,code,kc); btn.classList.add("pressed");
      }
      function up(e){
        e.preventDefault();
        if (!downAt || releasing) return;
        var held = Date.now() - downAt; downAt = 0;
        var done = function(){ fire("keyup",key,code,kc); btn.classList.remove("pressed"); releasing = null; };
        if (held >= MIN_HOLD) { done(); }
        else { releasing = setTimeout(done, MIN_HOLD - held); }
      }
      btn.addEventListener("touchstart", dn, {passive:false});
      btn.addEventListener("touchend",   up, {passive:false});
      btn.addEventListener("touchcancel",up, {passive:false});
      btn.addEventListener("mousedown",  dn);
      btn.addEventListener("mouseup",    up);
      btn.addEventListener("mouseleave", up);
    });
  }
  wire();
})();
</script>`;

  // DOS menus and high-score entry need real typing, which a d-pad can't do.
  // A collapsed key palette covers the keys those screens actually ask for.
  const keyPad = isDos ? `
  <details class="mgp-keys">
    <summary>⌨ Keyboard — for menus &amp; name entry</summary>
    <div class="mgp-keygrid" id="mgp-keygrid"></div>
  </details>
<script>
(function(){
  // GLFW key codes, matching the map in dos-embed.js.
  var ROWS = [
    [["1",49],["2",50],["3",51],["4",52],["5",53],["6",54],["7",55],["8",56],["9",57],["0",48]],
    [["Q",81],["W",87],["E",69],["R",82],["T",84],["Y",89],["U",85],["I",73],["O",79],["P",80]],
    [["A",65],["S",83],["D",68],["F",70],["G",71],["H",72],["J",74],["K",75],["L",76]],
    [["Z",90],["X",88],["C",67],["V",86],["B",66],["N",78],["M",77]],
    [["SPACE",32],["ENTER",257],["ESC",256],["⌫",259],["Y",89],["N",78]]
  ];
  var grid = document.getElementById("mgp-keygrid");
  if(!grid) return;
  ROWS.forEach(function(row){
    var r = document.createElement("div");
    r.className = "mgp-keyrow";
    row.forEach(function(pair){
      var b = document.createElement("button");
      b.type = "button";
      b.className = "mgp-key" + (pair[0].length > 1 ? " mgp-key-wide" : "");
      b.textContent = pair[0];
      function dn(e){ e.preventDefault(); window.__dosEmitKey && window.__dosEmitKey(pair[1], true); b.classList.add("pressed"); }
      function up(e){ e.preventDefault(); window.__dosEmitKey && window.__dosEmitKey(pair[1], false); b.classList.remove("pressed"); }
      b.addEventListener("touchstart", dn, {passive:false});
      b.addEventListener("touchend", up, {passive:false});
      b.addEventListener("touchcancel", up, {passive:false});
      b.addEventListener("mousedown", dn);
      b.addEventListener("mouseup", up);
      b.addEventListener("mouseleave", up);
      r.appendChild(b);
    });
    grid.appendChild(r);
  });
})();
</script>` : "";

  return `
  <div class="mgp" id="mobile-gamepad" aria-label="Mobile game controls">
    <div class="mgp-row">
      <div class="mgp-dpad">
        ${dpadHtml}
      </div>
      <div class="mgp-actions">
        ${actionsHtml}
      </div>
    </div>
  </div>
  <p class="mgp-hint">${esc(mc.hint)}</p>${keyPad}${wireScript}`;
}

function sectionsHtml(sections) {
  // The page hardcodes an <h2>How it works & what to expect</h2> wrapper. Some
  // authored definitions repeat that exact heading as their first section, which
  // would render a duplicate <h3>. Drop a leading section whose heading matches.
  const norm = (s) => String(s).replace(/&amp;/g, "&").replace(/\s+/g, " ").trim().toLowerCase();
  const list = (sections || []).slice();
  if (list.length && norm(list[0].h) === "how it works & what to expect") {
    // Keep its body (often the spec table) but drop the redundant heading.
    return `\n    ${list[0].html}` + list.slice(1).map((s) => `\n    <h3>${esc(s.h)}</h3>\n    ${s.html}`).join("");
  }
  return list.map((s) => `\n    <h3>${esc(s.h)}</h3>\n    ${s.html}`).join("");
}

function faqHtml(p, L = EN) {
  if (!p.faq || !p.faq.length) return "";
  const items = p.faq
    .map((f) => `    <details>\n      <summary>${esc(f.q)}</summary>\n      <p>${f.a}</p>\n    </details>`)
    .join("\n");
  return `\n  <section class="card">\n    <h2>${esc(L.t("faq.heading"))}</h2>\n${items}\n  </section>`;
}


// Authored links in `related` are written as plain /run/<slug>/ (or, if someone
// hand-wrote one, /es/run/<slug>/). Either way they get resolved here to the
// right URL for this locale, so a translator can't accidentally link a page
// into a language it doesn't exist in.
function resolveHref(L, href) {
  const m = String(href || "").match(/^\/(?:[a-zA-Z-]+\/)?run\/([^/]+)\/$/);
  if (!m) return href;
  return linkFor(L, m[1]);
}
function relatedHtml(related, L = EN) {
  const cards = (related || [])
    .map(
      (r) =>
        `      <li><a class="link-card" href="${resolveHref(L, r.href)}"><span class="lc-title">${esc(
          r.title
        )}</span><span class="lc-desc">${esc(r.desc)}</span></a></li>`
    )
    .join("\n");
  return `\n  <section class="card">\n    <h2>${esc(L.t("related.heading"))}</h2>\n    <ul class="card-grid">\n${cards}\n    </ul>\n  </section>`;
}

// A poster strip of other playable titles, appended to every page that has a
// game on it. Analytics showed the problem this solves: the DOOM page holds
// people for nearly two minutes but averages 1.36 views per visitor — they
// play one game and leave, because nothing on the page shows them a second
// one. Hand-authored `related` lists were also drifting toward guides for
// software we don't host, which spends a click and goes nowhere.
function alsoPlayHtml(current, allPages, L = EN) {
  const pool = allPages
    .filter((p) => isPlayable(p) && p.slug !== current.slug && p.appType === "game")
    .sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity));
  if (pool.length < 3) return "";

  // Four marquee titles plus two rotated ones. Showing the same top six on
  // every page meant everything outside that six got no inbound links at all —
  // JezzBall had three for the whole site. The rotation is keyed off the page's
  // own slug so it's stable between builds (no diff churn) while still spreading
  // link equity across the catalogue.
  const head = pool.slice(0, 4);
  const tail = pool.slice(4);
  const others = head.slice();
  if (tail.length) {
    let seed = 0;
    for (const ch of current.slug) seed = (seed * 31 + ch.charCodeAt(0)) % 100000;
    for (let i = 0; i < 2 && i < tail.length; i++) {
      others.push(tail[(seed + i * 7) % tail.length]);
    }
  }
  const cards = others
    .map((p) => {
      const shot = screenshotFile(p);
      const art = shot
        ? `<img class="pc-shot" src="/run/${p.slug}/${shot}" width="320" height="240" loading="lazy" alt="${esc(p.appName)} running in the browser" />`
        : `<span class="pc-shot pc-placeholder" aria-hidden="true">${esc((p.appName || "?").trim().charAt(0))}</span>`;
      return `        <li class="pc-item"><a class="poster-card" href="${linkFor(L, p.slug)}">
          ${art}
          <span class="pc-body"><span class="pc-title">${esc(p.appName)}</span><span class="pc-play">▶ Play free</span></span>
        </a></li>`;
    })
    .join("\n");
  return `\n  <section class="card">\n    <h2>${esc(L.t("alsoPlay.heading"))}</h2>\n    <ul class="poster-grid">\n${cards}\n    </ul>\n    <p class="muted small" style="margin:.75rem 0 0;"><a href="${L.path("/run/")}">See all ${allPages.filter(isPlayable).length} titles you can play here →</a></p>\n  </section>`;
}

// A one-line "what to play next" rail, sitting directly under the game rather
// than in the full card further down the page. The poster grid below the FAQ is
// the thorough version; most people stop scrolling long before it, and a player
// who has just finished a game is exactly the person who wants another one.
// Same rotation as alsoPlayHtml so link equity still spreads across the catalogue.
function nextUpHtml(current, allPages, L = EN) {
  const pool = allPages
    .filter((p) => isPlayable(p) && p.slug !== current.slug && p.appType === "game")
    .sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity));
  if (pool.length < 3) return "";

  let seed = 0;
  for (const ch of current.slug) seed = (seed * 31 + ch.charCodeAt(0)) % 100000;
  const picks = [];
  for (let i = 0; picks.length < 4 && i < pool.length; i++) {
    const cand = pool[(seed + i * 13) % pool.length];
    if (!picks.includes(cand)) picks.push(cand);
  }

  const links = picks
    .map((p) => `<a href="${linkFor(L, p.slug)}">${esc(p.appName)}</a>`)
    .join("\n      ");
  return `\n    <p class="next-up"><span class="next-up-label">${esc(L.t("nextUp.heading"))}:</span>\n      ${links}\n      <a class="next-up-all" href="${L.path("/run/")}">all ${allPages.filter(isPlayable).length} games →</a>\n    </p>`;
}

// The site has no way to reach a visitor again — no account, no login, and
// 98.6% of users are first-timers. One email field is the whole mechanism.
// Rendered only when NEWSLETTER_ACTION is set, so it can't collect addresses
// before there is somewhere for them to go.
function newsletterHtml() {
  if (!NEWSLETTER_ACTION) return "";
  return `\n  <section class="card newsletter">
    <h2>One new retro game in your inbox each week</h2>
    <p class="muted small" style="margin-top:0;">We add a game most weeks — free, legal, playable in the browser. No spam, unsubscribe in one click.</p>
    <form class="newsletter-form" action="${esc(NEWSLETTER_ACTION)}" method="post" target="_blank" data-newsletter>
      <label class="visually-hidden" for="nl-email">Email address</label>
      <input id="nl-email" type="email" name="email" required placeholder="you@example.com" autocomplete="email" />
      <button type="submit" class="button primary">Subscribe</button>
    </form>
  </section>`;
}

function downloadHtml(p) {
  if (!p.download || !p.download.heading) return "";
  // The template emits download.heading as the box's <h3>, so drop a leading
  // duplicate <h3>…</h3> if the authored html repeats one.
  const html = p.download.html.replace(/^\s*<h3[^>]*>.*?<\/h3>\s*/i, "");
  return `\n  <section class="card">\n    <div class="download-box">\n      <h3 style="margin-top:0;">${esc(
    p.download.heading
  )}</h3>\n      ${html}\n    </div>\n  </section>`;
}

function licenseHtml(p) {
  if (!p.licenseNote) return "";
  return `\n    <div class="warn-box">\n      ${p.licenseNote}\n    </div>`;
}

// ── localisation ───────────────────────────────────────────────────────────
// English keeps the bare paths; other languages get a prefix. hreflang is
// emitted for every language a slug actually exists in, plus x-default →
// English, which is what tells a search engine these are the same page in
// different languages rather than duplicates of each other.
const EN = LOCALES.en;

// Cross-links from a localised page. A game that has been translated gets the
// reader's own language; everything else points at the English page, which
// exists. Linking to /es/run/<slug>/ unconditionally is a 404 generator — most
// of the catalogue is untranslated at any given moment.
const linkFor = (L, slug) => (hasTranslation(L.code, slug) ? L.path(`/run/${slug}/`) : `/run/${slug}/`);

const langsWithContent = () => LANGS.filter((c) => c === "en" || translatedSlugs(c).length);

function hreflangHtml(pathAfterPrefix, slug) {
  const langs = slug ? languagesFor(slug) : langsWithContent();
  if (langs.length < 2) return "";
  const rows = langs.map(
    (c) => `<link rel="alternate" hreflang="${LOCALES[c].htmlLang}" href="${SITE}${prefixOf(c)}${pathAfterPrefix}" />`
  );
  rows.push(`<link rel="alternate" hreflang="x-default" href="${SITE}${pathAfterPrefix}" />`);
  return "\n" + rows.join("\n");
}

// Rendered in the header so a visitor who landed on the wrong language can
// leave. Only lists languages this page actually exists in.
function langSwitcherHtml(L, pathAfterPrefix, slug) {
  const langs = slug ? languagesFor(slug) : langsWithContent();
  if (langs.length < 2) return "";
  const links = langs.map((c) =>
    c === L.code
      ? `<span class="lang-current" aria-current="true">${esc(LOCALES[c].name)}</span>`
      : `<a href="${prefixOf(c)}${pathAfterPrefix}" hreflang="${LOCALES[c].htmlLang}">${esc(LOCALES[c].name)}</a>`
  );
  return `\n  <nav class="lang-switcher" aria-label="${esc(L.t("nav.language"))}">${links.join(" · ")}</nav>`;
}

const siteNavHtml = (L) => `<nav class="site-nav" aria-label="Primary">
    <a href="${L.path("/")}">${esc(L.t("nav.home"))}</a>
    <a href="${L.path("/run/")}">${esc(L.t("nav.guides"))}</a>
    <a href="/blog/">${esc(L.t("nav.blog"))}</a>
    <a href="/guide/">${esc(L.t("nav.guide"))}</a>
    <a href="/about/">${esc(L.t("nav.about"))}</a>
    <a href="/contact/">${esc(L.t("nav.contact"))}</a>
  </nav>`;

const footerHtml = (L) => `<footer>
  <p>${L.t("footer.builtOn")}</p>
  <nav class="footer-nav" aria-label="Footer">
    <a href="${L.path("/")}">${esc(L.t("nav.home"))}</a>
    <a href="${L.path("/run/")}">${esc(L.t("nav.guides"))}</a>
    <a href="/blog/">${esc(L.t("nav.blog"))}</a>
    <a href="/guide/">${esc(L.t("footer.compat"))}</a>
    <a href="/about/">${esc(L.t("nav.about"))}</a>
    <a href="/contact/">${esc(L.t("nav.contact"))}</a>
    <a href="/saves/">${esc(L.t("footer.saves"))}</a>
    <a href="/privacy/">${esc(L.t("footer.privacy"))}</a>
    <a href="/terms/">${esc(L.t("footer.terms"))}</a>
  </nav>
  <p>${esc(L.t("footer.copyright"))}</p>
</footer>`;


// The client scripts (dos-embed, recent, save-core) own a handful of visible
// strings — the play button, the resume card, the save line. They can't read
// ui.json, so the js.* keys ride along in a small inline object. English pages
// emit nothing: those scripts already default to English.
function clientStringsHtml(L) {
  if (L.isDefault) return "";
  const keys = ["js.play","js.resume","js.loading","js.startOver","js.savedAgo","js.filesRestored",
    "js.snapshotResume","js.progressSaved","js.resumedExactly","js.confirmDelete","js.justNow",
    "js.minutesAgo","js.anHourAgo","js.hoursAgo","js.yesterday","js.daysAgo",
    "js.saveHint","js.resetSaves","js.savesCleared","js.restoredFiles",
    "js.overlayNote","js.mouseHint","js.starting","js.cachedNote","js.loadingGame"];
  const obj = Object.fromEntries(keys.map((k) => [k.slice(3), L.t(k)]));
  return `\n<script>window.__I18N=${JSON.stringify(obj)};</script>`;
}

const render = (p, L = EN) => `<!DOCTYPE html>
<html lang="${L.htmlLang}">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${esc(p.title)}</title>
<meta name="description" content="${esc(p.description)}" />
<meta name="keywords" content="${esc(p.keywords)}" />
<link rel="canonical" href="${SITE}${L.prefix}/run/${p.slug}/" />${hreflangHtml(`/run/${p.slug}/`, p.slug)}
<meta property="og:type" content="article" />
<meta property="og:url" content="${SITE}${L.prefix}/run/${p.slug}/" />
<meta property="og:title" content="${esc(p.ogTitle)}" />
<meta property="og:description" content="${esc(p.ogDescription)}" />
<meta property="og:image" content="${ogImage(p)}" />
<meta name="twitter:card" content="summary_large_image" />
<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
<link rel="alternate icon" href="/favicon.ico" />
<link rel="stylesheet" href="/style.css?v=38" />
<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-3593636324187853" crossorigin="anonymous"></script>
<script async src="https://www.googletagmanager.com/gtag/js?id=G-C8C4TZC5F1" crossorigin="anonymous"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  // Headless automation (our own boot-test harness, crawlers driving Chrome) was
  // showing up in GA as 0%-engaged sessions with 50+ events. Don't report it.
  if (!navigator.webdriver) gtag('config', 'G-C8C4TZC5F1');
</script>
${breadcrumbLd(p)}
${appLd(p)}${p.faq && p.faq.length ? "\n" + faqLd(p) : ""}
</head>
<body>
<header>
  <div class="brand">
    <span class="logo" aria-hidden="true">▶_</span>
    <h1>ExeBrowser</h1>
  </div>
  <p class="tagline">${L.t("brand.tagline")}</p>
  ${siteNavHtml(L)}${langSwitcherHtml(L, `/run/${p.slug}/`, p.slug)}
</header>

<main class="prose">
  <p class="resume-bar" id="resume-bar" hidden></p>
  <nav class="breadcrumb" aria-label="Breadcrumb"><a href="${L.path("/")}">${esc(L.t("crumb.home"))}</a> › <a href="${L.path("/run/")}">${esc(L.t("crumb.guides"))}</a> › ${esc(p.crumb)}</nav>

  <section class="card">
    <h2>${esc(p.h1 || p.crumb)} <span class="verdict ${p.verdict.kind}">${esc(p.verdict.text)}</span></h2>${p.updated ? `
    <p class="muted small" style="margin-top:0.25rem;">${esc(L.t("page.updated"))} ${esc(monthYear(p.updated, L))} · ${esc(p.verdict.kind === "bad" ? L.t("page.testedWith") : L.t("page.runsVia"))} ${esc(runtimeLabel(p))}${isPlayable(p) || p.verdict.kind === "bad" ? "" : " · " + esc(L.t("page.requiresOwnCopy"))}</p>` : ""}
    ${p.intro}
${embedBlock(p)}${mobileControlsHtml(p)}${controlsPanelHtml(p, L)}${isPlayable(p) ? nextUpHtml(p, pages, L) : ""}${freeNoteHtml(p)}${figureHtml(p)}
    ${p.iframeUrl ? "" : `<p class="muted small" style="margin-top:1rem;">${p.dosRuntime ? L.t("embed.noteDos") : L.t("embed.noteWine")}</p>`}${licenseHtml(p)}
  </section>
${downloadHtml(p)}
  <section class="card">
    <h2>${esc((p.sections && p.sections[0] && p.sections[0].h) || "How it works & what to expect")}</h2>${sectionsHtml(p.sections)}
  </section>${faqHtml(p, L)}${isPlayable(p) ? alsoPlayHtml(p, pages, L) : ""}${newsletterHtml()}${relatedHtml(p.related, L)}
</main>

${footerHtml(L)}

${clientStringsHtml(L)}${p.iframeUrl
  ? `<script src="/save-core.js?v=1"></script>
<script src="/recent.js?v=3"></script>`
  : p.dosRuntime
    ? `<!-- save-core.js first: the embed asks it whether to offer a resume before it renders. -->
<script src="/save-core.js?v=1"></script>
<script src="/recent.js?v=3"></script>
<script src="/dos-embed.js?v=33"></script>`
    : `<!-- embed.js must run first: it builds the runtime DOM that app.js binds to. -->
<script src="/save-core.js?v=1"></script>
<script src="/recent.js?v=3"></script>
<script src="/embed.js?v=6"></script>
<script src="/app.js?v=19"></script>`}
<script>window.renderResumeBar && renderResumeBar("resume-bar");</script>${NEWSLETTER_ACTION ? '\n<script src="/newsletter.js?v=1"></script>' : ""}
</body>
</html>
`;

// ── page definitions ───────────────────────────────────────────────────────
// Populated from data/app-pages.json (authored by the page-build workflow) so
// this generator stays the template and the content stays data.
const DATA = resolve(process.cwd(), "scripts", "app-pages.json");
const pages = existsSync(DATA) ? JSON.parse(readFileSync(DATA, "utf8")) : [];

if (!pages.length) {
  console.error("No page data found at scripts/app-pages.json — nothing to generate.");
  process.exit(1);
}

// ── write files + sitemap fragment ─────────────────────────────────────────
for (const p of pages) {
  if (p.skipGenerate) { console.log("skipped (skipGenerate)", p.slug); continue; }
  const out = resolve(ROOT, "run", p.slug, "index.html");
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, render(p), "utf8");
  console.log("wrote", out);

  // Localised siblings, but only where a real translation exists. A slug with
  // no entry in pages.<lang>.json produces no localised URL at all — see the
  // note in i18n/locales.mjs about why there is deliberately no English
  // fallback wearing a /es/ path.
  for (const code of LANGS) {
    if (code === "en") continue;
    const translated = translatedEntry(code, p);
    if (!translated) continue;
    const lout = resolve(ROOT, code, "run", p.slug, "index.html");
    mkdirSync(dirname(lout), { recursive: true });
    writeFileSync(lout, render(translated, LOCALES[code]), "utf8");
    console.log("wrote", lout);
  }
}

// ── regenerate the /run/ index so all pages are linked (crawlable) ─────────
// Honest grouping: pages that boot one-click (hosted payload) are presented as
// playable; everything else is presented as a compatibility guide so the hub
// never promises play-online for software we don't host.
function indexCard(p) {
  const verdictKind = (p.verdict && p.verdict.kind) ? p.verdict.kind : "good";
  const play = isPlayable(p) ? ` <span class="verdict ${verdictKind}" style="margin-left:.3rem;">▶ Play now</span>` : "";
  return `      <li><a class="link-card" href="/run/${p.slug}/"><span class="lc-title">${esc(
    p.appName
  )}${play}${isNew(p) ? NEW_BADGE : ""}</span><span class="lc-desc">${esc(p.verdict.text)}</span></a></li>`;
}

// A game counts as "new" for two weeks after its addedDate, which drives the
// badge on the hub and homepage. Dates are plain YYYY-MM-DD in app-pages.json.
const NEW_DAYS = 14;
const NEW_BADGE = ` <span class="badge-new">NEW</span>`;
// Titles whose engine *and* assets are freely licensed — no shareware episode,
// no bring-your-own-copy. Worth calling out: it's the difference between "try
// the first three levels" and "this is the whole game, free".
const FREE_BADGE = ` <span class="badge-free" title="Free and complete — no shareware episode, nothing held back">FREE</span>`;
function isNew(p) {
  if (!p.addedDate) return false;
  const added = Date.parse(p.addedDate + "T00:00:00Z");
  if (Number.isNaN(added)) return false;
  return (Date.now() - added) / 86400000 < NEW_DAYS;
}

// Poster-style card for the visual grids: real screenshot when we have one,
// otherwise a lettered placeholder tile so the grid never looks broken.
function posterCard(p) {
  const shot = screenshotFile(p);
  const art = shot
    ? `<img class="pc-shot" src="/run/${p.slug}/${shot}" width="320" height="240" loading="lazy" alt="${esc(p.appName)} running in the browser" />`
    : `<span class="pc-shot pc-placeholder" aria-hidden="true">${esc((p.appName || "?").trim().charAt(0))}</span>`;
  // Categories and a search haystack ride on the <li> so filtering is a pure
  // client-side attribute match — no data duplicated into a JS blob, and the
  // grid stays fully populated for crawlers with JS off.
  const cats = ((p.categories || []).concat(p.fullyFree ? ["Free & complete"] : [])).join("|");
  const hay = [p.appName, p.author, ...(p.genre || []), ...(p.categories || []),
    p.fullyFree ? "free complete open source freeware" : ""]
    .filter(Boolean).join(" ").toLowerCase();
  return `        <li class="pc-item" data-cats="${esc(cats)}" data-search="${esc(hay)}"><a class="poster-card" href="/run/${p.slug}/">
          ${art}
          <span class="pc-body"><span class="pc-title">${esc(p.appName)}${isNew(p) ? NEW_BADGE : ""}${p.fullyFree ? FREE_BADGE : ""}</span><span class="pc-play">▶ Play free</span></span>
        </a></li>`;
}

// Filter chips + search box shown above a poster grid. Progressive enhancement:
// the markup is inert until filter.js wires it, so a no-JS visitor just sees
// the full grid.
function gridFilterHtml(pages) {
  const counts = new Map();
  for (const p of pages) {
    for (const c of p.categories || []) counts.set(c, (counts.get(c) || 0) + 1);
    if (p.fullyFree) counts.set("Free & complete", (counts.get("Free & complete") || 0) + 1);
  }
  if (counts.size < 3) return "";
  const order = ["Free & complete", "Windows classics", "Shooters", "Platformers", "Action", "Puzzle & strategy", "Racing & sports", "Pinball", "Apps & tools"];
  const chips = order
    .filter((c) => counts.has(c))
    .map((c) => `<button type="button" class="chip" data-cat="${esc(c)}">${esc(c)} <span class="chip-n">${counts.get(c)}</span></button>`)
    .join("\n        ");
  return `
    <div class="grid-filter" data-grid-filter>
      <label class="gf-search">
        <span class="visually-hidden">Search games</span>
        <input type="search" placeholder="Search ${pages.length} titles…" autocomplete="off" data-grid-search />
      </label>
      <div class="gf-chips">
        <button type="button" class="chip is-on" data-cat="">All <span class="chip-n">${pages.length}</span></button>
        ${chips}
      </div>
      <p class="gf-empty" hidden>No titles match — <button type="button" class="link" data-grid-reset>show everything</button>.</p>
    </div>`;
}
// Same shelf order as the homepage grid (gen-home-grid.mjs): hand-assigned
// `rank` first so the best-known titles lead, then real art, then newest. The
// two listings must agree — a visitor who sees DOOM first on the homepage
// should see it first here too.
const rankOf = (p) => (typeof p.rank === "number" ? p.rank : Infinity);
const playNow = pages.filter((p) => isPlayable(p)).sort((a, b) => {
  const r = rankOf(a) - rankOf(b);
  if (r) return r;
  const s = (screenshotFile(b) ? 1 : 0) - (screenshotFile(a) ? 1 : 0);
  if (s) return s;
  return (isNew(b) ? 1 : 0) - (isNew(a) ? 1 : 0);
});
const games = pages.filter((p) => !isPlayable(p) && p.appType === "game");
const apps = pages.filter((p) => !isPlayable(p) && p.appType === "app");
const indexHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<!-- The title deliberately carries NO page count. It used to interpolate
     pages.length, so every game we added silently retitled this URL — analytics
     shows it ranking as five different pages (53, 54, 63, 67, 68 App Guides),
     each rename throwing away whatever authority the previous title had earned.
     A stable, query-led title accumulates instead of resetting. Counts still
     appear in the description, where churn is harmless. -->
<title>Play Classic Windows &amp; DOS Games Online Free — No Download — ExeBrowser</title>
<meta name="description" content="${playNow.length} free classic Windows programs you can play in your browser with one click, plus ${games.length + apps.length} honest Wine + WebAssembly compatibility guides for running your own copies — DOOM, 3D Pinball, Solitaire, 7-Zip, and more." />
<meta name="keywords" content="run windows apps in browser, play windows games online, run exe online, wine app compatibility, classic windows games browser" />
<link rel="canonical" href="${SITE}/run/" />
<meta property="og:type" content="website" />
<meta property="og:url" content="${SITE}/run/" />
<meta property="og:title" content="Run Windows Apps &amp; Games in Your Browser — App Guides" />
<meta property="og:description" content="Per-app guides for running ${pages.length} Windows programs in your browser with Wine + WebAssembly." />
<meta property="og:image" content="${SITE}/og.png" />
<meta name="twitter:card" content="summary_large_image" />
<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
<link rel="alternate icon" href="/favicon.ico" />
<link rel="stylesheet" href="/style.css?v=38" />
<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-3593636324187853" crossorigin="anonymous"></script>
<script async src="https://www.googletagmanager.com/gtag/js?id=G-C8C4TZC5F1" crossorigin="anonymous"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  // Headless automation (our own boot-test harness, crawlers driving Chrome) was
  // showing up in GA as 0%-engaged sessions with 50+ events. Don't report it.
  if (!navigator.webdriver) gtag('config', 'G-C8C4TZC5F1');
</script>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "${SITE}/" },
    { "@type": "ListItem", "position": 2, "name": "App guides", "item": "${SITE}/run/" }
  ]
}
</script>
</head>
<body>
<header>
  <div class="brand">
    <span class="logo" aria-hidden="true">▶_</span>
    <h1>ExeBrowser</h1>
  </div>
  <p class="tagline">Run Windows <code>.exe</code> files in your browser. No install. No upload. Just WebAssembly + Wine.</p>
  <nav class="site-nav" aria-label="Primary">
    <a href="/">Home</a>
    <a href="/run/" aria-current="page">App guides</a>
    <a href="/blog/">Blog</a>
    <a href="/guide/">Guide</a>
    <a href="/about/">About</a>
    <a href="/contact/">Contact</a>
  </nav>
</header>

<main class="prose">
  <p class="resume-bar" id="resume-bar" hidden></p>
  <nav class="breadcrumb" aria-label="Breadcrumb"><a href="/">Home</a> › App guides</nav>
  <section class="card">
    <h2>Run specific Windows apps &amp; games in your browser</h2>
    <p>Two kinds of pages live here, and we keep them honest. <strong>▶ Play now</strong> entries are free, license-clean software we host — one click boots it in your tab. Everything else is a <strong>compatibility guide</strong>: we can't redistribute that software, so the guide tells you whether your own copy runs, which Wine variant to pick, and how to load it right on the page.</p>
    <div id="continue-playing" hidden>
      <h3 style="margin-top:0;">Continue playing</h3>
      <ul class="poster-grid" id="continue-grid"></ul>
    </div>
    <h3 style="margin-top:0;">▶ Play now — free, hosted here</h3>
${gridFilterHtml(playNow)}
    <ul class="poster-grid">
${playNow.map(posterCard).join("\n")}
    </ul>
    <h3>Game compatibility guides — bring your own copy</h3>
    <ul class="card-grid">
${games.map(indexCard).join("\n")}
    </ul>
    <h3>App &amp; utility compatibility guides — bring your own copy</h3>
    <ul class="card-grid">
${apps.map(indexCard).join("\n")}
    </ul>
    <p style="margin-top:1.25rem;">Don't see your app? The general <a href="/guide/">compatibility guide</a> explains which categories run well and which struggle. Most classic 32-bit Windows software from 1995–2008 is worth a try.</p>
  </section>${newsletterHtml()}
</main>

<footer>
  <p>Built on <a href="https://github.com/danoon2/Boxedwine" target="_blank" rel="noopener">Boxedwine</a> · <a href="https://www.winehq.org/" target="_blank" rel="noopener">Wine</a> · WebAssembly. Wine is a trademark of CodeWeavers. ExeBrowser is not affiliated with WineHQ, CodeWeavers, or Microsoft.</p>
  <nav class="footer-nav" aria-label="Footer">
    <a href="/">Home</a>
    <a href="/run/">App guides</a>
    <a href="/blog/">Blog</a>
    <a href="/guide/">Compatibility Guide</a>
    <a href="/about/">About</a>
    <a href="/contact/">Contact</a>
    <a href="/saves/">Saved games</a>
    <a href="/privacy/">Privacy Policy</a>
    <a href="/terms/">Terms of Use</a>
  </nav>
  <p>© 2026 ExeBrowser. Content licensed openly; runtime under GPL-2.0 / LGPL-2.1.</p>
</footer>
<script src="/save-core.js?v=1"></script>
<script src="/recent.js?v=3"></script>
<script src="/filter.js?v=1"></script>
<script>
  window.renderContinue && renderContinue("continue-playing", "continue-grid");
  window.renderResumeBar && renderResumeBar("resume-bar");
</script>${NEWSLETTER_ACTION ? '\n<script src="/newsletter.js?v=1"></script>' : ""}
</body>
</html>
`;
writeFileSync(resolve(ROOT, "run", "index.html"), indexHtml, "utf8");
console.log("wrote", resolve(ROOT, "run", "index.html"), `(${games.length} games + ${apps.length} apps)`);


// ── localised hub + home ───────────────────────────────────────────────────
// Purpose-built rather than a translation of the English hub. With a handful of
// titles translated, a faithful copy of the 41-card English page would be
// mostly empty chrome; this lists what genuinely exists in the language and
// then says plainly that the rest of the catalogue is in English, with a link.
// Useful to a Spanish reader, and honest to a crawler.
function localisedListing(L, isHome) {
  const items = translatedSlugs(L.code)
    .map((slug) => pages.find((x) => x.slug === slug))
    .filter(Boolean)
    .sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity));

  const cards = items
    .map((p) => {
      const t = translatedEntry(L.code, p) || p;
      const shot = screenshotFile(p);
      const art = shot
        ? `<img class="pc-shot" src="/run/${p.slug}/${shot}" width="320" height="240" loading="lazy" alt="${esc(p.appName)}" />`
        : `<span class="pc-shot pc-placeholder" aria-hidden="true">${esc((p.appName || "?").trim().charAt(0))}</span>`;
      return `        <li class="pc-item"><a class="poster-card" href="${linkFor(L, p.slug)}">
          ${art}
          <span class="pc-body"><span class="pc-title">${esc(p.appName)}</span><span class="pc-play">${esc(t.crumb || p.crumb)}</span></span>
        </a></li>`;
    })
    .join("\n");

  const path = isHome ? "/" : "/run/";
  const titleKey = isHome ? "home.title" : "hub.metaTitle";
  const descKey = isHome ? "home.description" : "hub.description";
  return `<!DOCTYPE html>
<html lang="${L.htmlLang}">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${esc(L.t(titleKey))}</title>
<meta name="description" content="${esc(L.t(descKey))}" />
<link rel="canonical" href="${SITE}${L.prefix}${path}" />${hreflangHtml(path, null)}
<meta property="og:type" content="website" />
<meta property="og:url" content="${SITE}${L.prefix}${path}" />
<meta property="og:title" content="${esc(L.t(titleKey))}" />
<meta property="og:description" content="${esc(L.t(descKey))}" />
<meta property="og:image" content="${SITE}/og.png" />
<meta name="twitter:card" content="summary_large_image" />
<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
<link rel="alternate icon" href="/favicon.ico" />
<link rel="stylesheet" href="/style.css?v=38" />
<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-3593636324187853" crossorigin="anonymous"></script>
<script async src="https://www.googletagmanager.com/gtag/js?id=G-C8C4TZC5F1" crossorigin="anonymous"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  if (!navigator.webdriver) gtag('config', 'G-C8C4TZC5F1');
</script>
</head>
<body>
<header>
  <div class="brand">
    <span class="logo" aria-hidden="true">▶_</span>
    <h1>ExeBrowser</h1>
  </div>
  <p class="tagline">${L.t("brand.tagline")}</p>
  ${siteNavHtml(L)}${langSwitcherHtml(L, path, null)}
</header>

<main class="prose">
  <p class="resume-bar" id="resume-bar" hidden></p>
  <section class="card">
    <h2>${esc(L.t(isHome ? "home.heading" : "hub.title"))}</h2>
    <p class="muted small" style="margin-top:0;">${esc(L.t("home.blurb"))}</p>
    <ul class="poster-grid">
${cards}
    </ul>
    <p class="muted small" style="margin-top:1rem;">${L.t("home.restInEnglish")}</p>
  </section>
</main>

${footerHtml(L)}
<script src="/save-core.js?v=1"></script>
<script src="/recent.js?v=3"></script>
<script>window.renderResumeBar && renderResumeBar("resume-bar");</script>
</body>
</html>
`;
}

for (const code of LANGS) {
  if (code === "en" || !translatedSlugs(code).length) continue;
  const L = LOCALES[code];
  for (const isHome of [true, false]) {
    const out = isHome ? resolve(ROOT, code, "index.html") : resolve(ROOT, code, "run", "index.html");
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, localisedListing(L, isHome), "utf8");
    console.log("wrote", out);
  }
}

// Emit the COMPLETE sitemap.xml: static URLs + every generated /run page. Making
// the sitemap a generated artifact keeps it from drifting as pages are added.
// lastmod: real content-change dates. Run pages carry their own `updated`
// field; static pages are dated here — bump these when the page content
// actually changes (new blog posts must also be added to this list).
const STATIC_URLS = [
  { loc: "/", freq: "weekly", pri: "1.0", mod: "2026-07-01" },
  { loc: "/run/", freq: "weekly", pri: "0.9", mod: "2026-07-01" },
  { loc: "/blog/", freq: "weekly", pri: "0.8", mod: "2026-07-01" },
  { loc: "/blog/run-windows-software-on-a-chromebook/", freq: "monthly", pri: "0.8", mod: "2026-07-01" },
  { loc: "/blog/wine-vs-emulator-explained/", freq: "monthly", pri: "0.7", mod: "2026-07-01" },
  { loc: "/blog/run-old-software-without-a-vm/", freq: "monthly", pri: "0.7", mod: "2026-07-01" },
  { loc: "/blog/we-tested-53-windows-apps-in-the-browser/", freq: "monthly", pri: "0.8", mod: "2026-07-01" },
  { loc: "/blog/extract-files-from-an-old-installer/", freq: "monthly", pri: "0.7", mod: "2026-07-01" },
  { loc: "/blog/run-16-bit-windows-3x-software/", freq: "monthly", pri: "0.7", mod: "2026-07-01" },
  { loc: "/blog/legally-get-classic-windows-games/", freq: "monthly", pri: "0.7", mod: "2026-07-01" },
  { loc: "/blog/open-cadet-open-source-space-cadet/", freq: "monthly", pri: "0.8", mod: "2026-07-01" },
  { loc: "/guide/", freq: "monthly", pri: "0.9", mod: "2026-07-01" },
  { loc: "/about/", freq: "monthly", pri: "0.6", mod: "2026-07-01" },
  { loc: "/contact/", freq: "yearly", pri: "0.5", mod: "2026-07-01" },
  { loc: "/privacy/", freq: "yearly", pri: "0.4", mod: "2026-06-08" },
  { loc: "/terms/", freq: "yearly", pri: "0.4", mod: "2026-06-08" },
];
const urlEl = (loc, freq, pri, mod) =>
  `  <url>\n    <loc>${SITE}${loc}</loc>${mod ? `\n    <lastmod>${mod}</lastmod>` : ""}\n    <changefreq>${freq}</changefreq>\n    <priority>${pri}</priority>\n  </url>`;
const runUrls = pages.map((p) => urlEl(`/run/${p.slug}/`, "monthly", "0.7", p.updated));
// Localised pages are separate URLs and need to be crawlable in their own
// right; hreflang in the page head is what ties them back to the English one.
const localisedRootUrls = LANGS.filter((c) => c !== "en" && translatedSlugs(c).length).flatMap((code) => [
  urlEl(`${prefixOf(code)}/`, "weekly", "0.8"),
  urlEl(`${prefixOf(code)}/run/`, "weekly", "0.7"),
]);
const localisedUrls = LANGS.filter((c) => c !== "en").flatMap((code) =>
  translatedSlugs(code)
    .filter((slug) => pages.some((p) => p.slug === slug))
    .map((slug) => urlEl(`${prefixOf(code)}/run/${slug}/`, "monthly", "0.6",
      (pages.find((p) => p.slug === slug) || {}).updated))
);
const staticUrls = STATIC_URLS.map((u) => urlEl(u.loc, u.freq, u.pri, u.mod));
// Order: home, /run/, then all run pages, then the rest of the static set.
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${staticUrls[0]}
${staticUrls[1]}
${runUrls.join("\n")}
${localisedRootUrls.length ? localisedRootUrls.join("\n") + "\n" : ""}${localisedUrls.length ? localisedUrls.join("\n") + "\n" : ""}${staticUrls.slice(2).join("\n")}
</urlset>
`;
writeFileSync(resolve(ROOT, "sitemap.xml"), sitemap, "utf8");

// ── llms.txt ───────────────────────────────────────────────────────────────
// ChatGPT is already the third-largest referrer here, ahead of every social
// network, and those visits engage. Assistants recommending the site do better
// with a plain list of what can actually be played than with a crawl of 79
// pages, most of which are "bring your own copy" guides. Generated from the
// same data as the pages so it can't drift into claiming a game we don't host.
const playable = pages.filter(isPlayable);
const guides = pages.filter((p) => !isPlayable(p));
const catalogue = (list) =>
  list
    .map((p) => `- [${p.appName}](${SITE}/run/${p.slug}/): ${p.oneLiner || p.ogDescription || p.description}`)
    .join("\n");

const llms = `# ExeBrowser

> Play classic DOS and Windows games free in your browser. No download, no
> install, no account, nothing uploaded. Games run client-side via DOSBox or
> Wine compiled to WebAssembly, and DOS save games persist in the browser.

${playable.length} titles are hosted and playable instantly. Everything hosted here is
open-source, freeware, or shareware whose licence permits free redistribution;
commercial titles are compatibility guides only, where you supply your own copy.

## Playable now (free, instant, no download)

${catalogue(playable)}

## Compatibility guides (bring your own copy)

${catalogue(guides)}

## About

- [Homepage](${SITE}/): plays DOOM directly, plus the full catalogue
- [All games and guides](${SITE}/run/)
- [Compatibility guide](${SITE}/guide/): which categories of Windows software run well
- [Blog](${SITE}/blog/): how the runtimes work, licensing, and preservation write-ups
- Runtimes: DOSBox (DOS titles) and Boxedwine — Wine plus a 32-bit x86 CPU
  emulator — in WebAssembly. 32-bit only; 64-bit Windows binaries will not load.
`;
writeFileSync(resolve(ROOT, "llms.txt"), llms, "utf8");

console.log(`\nGenerated ${pages.length} pages + sitemap.xml (${pages.length + STATIC_URLS.length} URLs) + llms.txt (${playable.length} playable).`);
