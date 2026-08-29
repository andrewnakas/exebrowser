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
import {
  LANGS, LOCALES, languagesFor, translatedEntry, translatedSlugs, prefixOf, hasTranslation,
  hreflangHtml, langSwitcherHtml, langsWithContent, cardCopy, controlText,
} from "./i18n/locales.mjs";
import { blogPosts } from "./blog-meta.mjs";
import {
  SITE, esc, xmlEsc, unesc, isPlayable, screenshotFile, isNew, NEW_BADGE, FREE_BADGE,
  posterCard, sortPlayable, categoryCounts, categoryChips, jsonText, maxDate, toRfc822,
  itemListLd,
} from "./catalogue.mjs";

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
// Newsletter provider endpoint (Buttondown, Mailchimp, Listmonk — any host that
// accepts a plain POSTed form). Empty means the signup block is not rendered at
// all: an email box that silently drops addresses is worse than none, and this
// is the only place to change to turn the feature on across every page.
const NEWSLETTER_ACTION = "";

const screenshotUrl = (p) => {
  const f = screenshotFile(p);
  return f ? `${SITE}/run/${p.slug}/${f}` : null;
};
const ogImage = (p) => screenshotUrl(p) || `${SITE}/og.png`;
// A translated UI string with {placeholders} filled in. ui.json carries the
// braces so a translator can move a substitution to wherever the sentence needs
// it — Japanese and Chinese put the count before the noun, French after.
const tf = (L, key, vars = {}) =>
  String(L.t(key)).replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? String(vars[k]) : m));

// A <figure> showing the screenshot, placed under the embed on pages that have one.
const figureHtml = (p, L = EN) => {
  const f = screenshotFile(p);
  if (!f) return "";
  const app = p.appName || p.crumb;
  const alt = esc(tf(L, "figure.alt", { app }));
  const cap = esc(tf(L, "figure.caption", { app }));
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
function freeNoteHtml(p, L = EN) {
  if (!p.fullyFree) return "";
  return `
    <p class="free-note"><span class="badge-free">${esc(L.t("free.badge"))}</span> <strong>${esc(L.t("free.heading"))}</strong> ${esc(p.fullyFree)}</p>`;
}

function controlsPanelHtml(p, L = EN) {
  const rows = p.controls;
  if (!rows || !rows.length) return "";
  const anyMouse = rows.some((r) => r.mouse && r.mouse !== "—");
  // Every cell goes through the locale's control glossary. The catalogue keeps
  // one English copy of "Move / turn"; the glossary is where each language says
  // it once, rather than once per page that happens to list that row.
  const tx = (v) => controlText(L.code, v);
  const body = rows
    .map(
      (r) => `        <tr><th scope="row">${esc(tx(r.action))}</th><td>${kbd(tx(r.keyboard))}</td>${
        anyMouse ? `<td>${r.mouse && r.mouse !== "—" ? kbd(tx(r.mouse)) : '<span class="muted">—</span>'}</td>` : ""
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
  // A translated cell can mark its own keys up. KEY_WORDS only knows English
  // key names, so "矢印キー" would otherwise render as unstyled text; letting
  // the glossary write <kbd> directly is simpler than teaching the regex six
  // languages. The strings come from our own JSON, not from user input.
  if (s.includes("<kbd>")) return s;
  let out = "";
  let last = 0;
  for (const m of s.matchAll(KEY_WORDS)) {
    out += esc(s.slice(last, m.index)) + `<kbd>${esc(m[0])}</kbd>`;
    last = m.index + m[0].length;
  }
  return out + esc(s.slice(last));
}

function mobileControlsHtml(p, L = EN) {
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
    <summary>${esc(L.t("keypad.summary"))}</summary>
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
  <p class="mgp-hint">${esc(p.mobileHint || mc.hint)}</p>${keyPad}${wireScript}`;
}

function sectionsHtml(sections, promotedFirst = false) {
  // `promotedFirst` says the caller has already rendered sections[0].h as the
  // card's <h2>, so repeating it as an <h3> would print the same heading twice
  // in a row. This used to test the heading text against the literal English
  // "how it works & what to expect", which meant it only ever fired on the 60-odd
  // English pages that happened to use that exact phrase: the other 20 English
  // pages printed the duplicate, and so did every localised page, since a
  // Japanese heading never matches an English string.
  const list = (sections || []).slice();
  if (promotedFirst && list.length) {
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
  // A card whose copy this language hasn't translated is dropped rather than
  // shown in English. That is the same rule the page-level pipeline follows,
  // and it is why a localised page can legitimately show fewer related links
  // than the English one — a short honest list beats a bilingual long one.
  const localised = (related || [])
    .map((r) => (L.isDefault ? r : (() => {
      const c = cardCopy(L.code, r.href);
      return c ? { ...r, ...c } : null;
    })()))
    .filter(Boolean);
  if (!localised.length) return "";
  const cards = localised
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
    // Walk until two DISTINCT extras are found. The old version took exactly
    // two samples, so when the seed landed on a title already in `head` the
    // page rendered the same game twice — snake-open showed Minesweeper twice
    // and pipes-open showed Block Drop twice. A duplicate card wastes one of
    // the six inbound links this section exists to spread around.
    let added = 0;
    for (let i = 0; added < 2 && i < tail.length; i++) {
      const cand = tail[(seed + i * 7) % tail.length];
      if (others.includes(cand)) continue;
      others.push(cand);
      added++;
    }
  }
  const cards = others
    .map((p) => {
      const shot = screenshotFile(p);
      const art = shot
        ? `<img class="pc-shot" src="/run/${p.slug}/${shot}" width="320" height="240" loading="lazy" alt="${esc(tf(L, "poster.alt", { app: p.appName }))}" />`
        : `<span class="pc-shot pc-placeholder" aria-hidden="true">${esc((p.appName || "?").trim().charAt(0))}</span>`;
      return `        <li class="pc-item"><a class="poster-card" href="${linkFor(L, p.slug)}">
          ${art}
          <span class="pc-body"><span class="pc-title">${esc(p.appName)}</span><span class="pc-play">${esc(L.t("poster.playFree"))}</span></span>
        </a></li>`;
    })
    .join("\n");
  return `\n  <section class="card">\n    <h2>${esc(L.t("alsoPlay.heading"))}</h2>\n    <ul class="poster-grid">\n${cards}\n    </ul>\n    <p class="muted small" style="margin:.75rem 0 0;"><a href="${L.path("/run/")}">${esc(tf(L, "alsoPlay.seeAll", { n: allPages.filter(isPlayable).length }))}</a></p>\n  </section>`;
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
  return `\n    <p class="next-up"><span class="next-up-label">${esc(L.t("nextUp.heading"))}:</span>\n      ${links}\n      <a class="next-up-all" href="${L.path("/run/")}">${esc(tf(L, "nextUp.all", { n: allPages.filter(isPlayable).length }))}</a>\n    </p>`;
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

const siteNavHtml = (L) => `<nav class="site-nav" aria-label="Primary">
    <a href="${L.path("/")}">${esc(L.t("nav.home"))}</a>
    <a href="/load-exe/">${esc(L.t("nav.loadExe"))}</a>
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
    <a href="/load-exe/">${esc(L.t("nav.loadExe"))}</a>
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
const UI_EN = JSON.parse(
  readFileSync(resolve(process.cwd(), "scripts", "i18n", "ui.json"), "utf8")
).en;
function clientStringsHtml(L) {
  if (L.isDefault) return "";
  // Every js.* key in ui.json, not a hand-listed subset: the list version meant
  // adding a string in two places and silently shipping English if you forgot
  // the second, which is exactly what happened to the fullscreen and sound
  // buttons.
  const keys = Object.keys(UI_EN).filter((k) => k.startsWith("js."));
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
<link rel="alternate" type="application/rss+xml" title="ExeBrowser — new games and posts" href="/feed.xml" />
<link rel="stylesheet" href="/style.css?v=40" />
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
${embedBlock(p)}${mobileControlsHtml(p, L)}${controlsPanelHtml(p, L)}${isPlayable(p) ? nextUpHtml(p, pages, L) : ""}${freeNoteHtml(p, L)}${figureHtml(p, L)}
    ${p.iframeUrl ? "" : `<p class="muted small" style="margin-top:1rem;">${p.dosRuntime ? L.t("embed.noteDos") : L.t("embed.noteWine")}</p>`}${licenseHtml(p)}
  </section>
${downloadHtml(p)}
  <section class="card">
    <h2>${esc((p.sections && p.sections[0] && p.sections[0].h) || "How it works & what to expect")}</h2>${sectionsHtml(p.sections, true)}
  </section>${faqHtml(p, L)}${isPlayable(p) ? alsoPlayHtml(p, pages, L) : ""}${newsletterHtml()}${relatedHtml(p.related, L)}
</main>

${footerHtml(L)}

${clientStringsHtml(L)}${p.iframeUrl
  ? `<script src="/save-core.js?v=3"></script>
<script src="/recent.js?v=4"></script>`
  : p.dosRuntime
    ? `<!-- save-core.js first: the embed asks it whether to offer a resume before it renders. -->
<script src="/save-core.js?v=3"></script>
<script src="/recent.js?v=4"></script>
<script src="/dos-embed.js?v=34"></script>`
    : `<!-- embed.js must run first: it builds the runtime DOM that app.js binds to. -->
<script src="/save-core.js?v=3"></script>
<script src="/recent.js?v=4"></script>
<script src="/embed.js?v=8"></script>
<script src="/app.js?v=20"></script>`}
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

// Filter chips + search box shown above a poster grid. Progressive enhancement:
// the markup is inert until filter.js wires it, so a no-JS visitor just sees
// the full grid.
function gridFilterHtml(pages) {
  const counts = categoryCounts(pages);
  if (counts.size < 3) return "";
  const chips = categoryChips(counts);
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
${browseLineHtml()}    </div>`;
}

// The chips stay <button>s — instant client-side filtering beats a page load,
// and their data-cat values ("Free & complete") were never URLs. But a button
// is invisible to a crawler, so the categories that DO have a page also get a
// plain link here. Two affordances, one for people and one for crawlers, and
// the crawler's one only ever lists pages that exist.
function browseLineHtml() {
  if (!liveCats.length) return "";
  const links = liveCats.map((c) => `<a href="/play/${c.slug}/">${esc(c.h1.replace(/,.*$/, ""))}</a>`).join(" · ");
  return `      <p class="gf-browse">Browse by category: ${links}</p>\n`;
}
// Same shelf order as the homepage grid (gen-home-grid.mjs): hand-assigned
// `rank` first so the best-known titles lead, then real art, then newest. The
// two listings must agree — a visitor who sees DOOM first on the homepage
// should see it first here too.
const playNow = sortPlayable(pages);

// ── which categories earn a page ───────────────────────────────────────────
// Resolved here, well before anything is rendered, because the hub's filter
// block links to these and the sitemap lists them — both of which run before
// the pages themselves are written.
//
// The obvious implementation is a page per filter chip. It is also the wrong
// one: it would emit a "Pinball" page containing one game and a "Racing &
// sports" page containing two, which is the definition of a doorway page on a
// site already rejected once for thin content. A page needs BOTH enough
// members AND real authored copy in play-categories.json, so the chips
// deliberately outnumber the pages.
const CATS = JSON.parse(readFileSync(resolve(process.cwd(), "scripts", "play-categories.json"), "utf8"));
delete CATS._readme;
const MIN_FOR_PAGE = 4;

const bySlug = Object.fromEntries(pages.map((p) => [p.slug, p]));
function categoryMembers(cat) {
  if (cat.match === "slugs") {
    return (cat.slugs || []).map((s) => bySlug[s]).filter((p) => p && isPlayable(p));
  }
  return sortPlayable(pages.filter((p) => (p.categories || []).includes(cat.name)));
}

const liveCats = [];
for (const cat of CATS.categories) {
  const members = categoryMembers(cat);
  if (members.length < MIN_FOR_PAGE) {
    console.log(`skipped /play/${cat.slug}/ — only ${members.length} titles (min ${MIN_FOR_PAGE})`);
    continue;
  }
  liveCats.push({ ...cat, members });
}
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
<link rel="canonical" href="${SITE}/run/" />${hreflangHtml("/run/", null)}
<meta property="og:type" content="website" />
<meta property="og:url" content="${SITE}/run/" />
<meta property="og:title" content="Run Windows Apps &amp; Games in Your Browser — App Guides" />
<meta property="og:description" content="Per-app guides for running ${pages.length} Windows programs in your browser with Wine + WebAssembly." />
<meta property="og:image" content="${SITE}/og.png" />
<meta name="twitter:card" content="summary_large_image" />
<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
<link rel="alternate icon" href="/favicon.ico" />
<link rel="alternate" type="application/rss+xml" title="ExeBrowser — new games and posts" href="/feed.xml" />
<link rel="stylesheet" href="/style.css?v=40" />
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
${itemListLd(playNow, { name: "Classic Windows and DOS games playable free in your browser", url: `${SITE}/run/` })}
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
    <a href="/load-exe/">Run your EXE</a>
    <a href="/run/" aria-current="page">App guides</a>
    <a href="/blog/">Blog</a>
    <a href="/guide/">Guide</a>
    <a href="/about/">About</a>
    <a href="/contact/">Contact</a>
  </nav>${langSwitcherHtml(EN, "/run/", null)}
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
    <p style="margin-top:1.25rem;">On a school or work laptop that won't let you install anything? <a href="/unblocked/">Everything here runs without installing a thing</a>. Got an <code>.exe</code> of your own? <a href="/load-exe/">Load it and run it here</a> — or read <a href="/open-exe-file/">what an .exe file actually is</a> first.</p>
    <p style="margin-top:1.25rem;">Don't see your app? The general <a href="/guide/">compatibility guide</a> explains which categories run well and which struggle. Most classic 32-bit Windows software from 1995–2008 is worth a try.</p>
  </section>
  <section class="card">
    <h2>Browse by category</h2>
    <p style="margin-top:0;">Grouped by what a game actually is, each with notes on where to start.</p>
    <ul class="card-grid">
${liveCats.map((c) => `      <li><a class="link-card" href="/play/${c.slug}/"><span class="lc-title">${esc(c.h1)}</span><span class="lc-desc">${esc(c.description)}</span></a></li>`).join("\n")}
    </ul>
  </section>${newsletterHtml()}
</main>

<footer>
  <p>Built on <a href="https://github.com/danoon2/Boxedwine" target="_blank" rel="noopener">Boxedwine</a> · <a href="https://www.winehq.org/" target="_blank" rel="noopener">Wine</a> · WebAssembly. Wine is a trademark of CodeWeavers. ExeBrowser is not affiliated with WineHQ, CodeWeavers, or Microsoft.</p>
  <nav class="footer-nav" aria-label="Footer">
    <a href="/">Home</a>
    <a href="/load-exe/">Run your EXE</a>
    <a href="/run/">App guides</a>
    <a href="/blog/">Blog</a>
    <a href="/guide/">Compatibility Guide</a>
    <a href="/about/">About</a>
    <a href="/contact/">Contact</a>
    <a href="/saves/">Saved games</a>
    <a href="/embed/">Embed our games</a>
    <a href="/privacy/">Privacy Policy</a>
    <a href="/terms/">Terms of Use</a>
  </nav>
  <p>© 2026 ExeBrowser. Content licensed openly; runtime under GPL-2.0 / LGPL-2.1.</p>
</footer>
<script src="/save-core.js?v=3"></script>
<script src="/recent.js?v=4"></script>
<script src="/filter.js?v=2"></script>
<script>
  window.renderContinue && renderContinue("continue-playing", "continue-grid");
  window.renderResumeBar && renderResumeBar("resume-bar");
</script>${NEWSLETTER_ACTION ? '\n<script src="/newsletter.js?v=1"></script>' : ""}
</body>
</html>
`;
writeFileSync(resolve(ROOT, "run", "index.html"), indexHtml, "utf8");
console.log("wrote", resolve(ROOT, "run", "index.html"), `(${games.length} games + ${apps.length} apps)`);


// ── 404 ────────────────────────────────────────────────────────────────────
// This file has to exist, and its absence was a real bug rather than a missing
// nicety. Cloudflare Pages documents that a project with no top-level 404.html
// is assumed to be a single-page app, so it answers *every* unmatched path with
// the root document — and a 200. Measured on production: /nope/, /run/not-a-
// game/ and /nope.js all returned HTTP 200 carrying the homepage. That is an
// unbounded surface of duplicate soft-404s aimed at a site whose crawl budget
// is already the binding constraint, and it is the same thin-content shape the
// AdSense rejection was about. Shipping this page turns all of it into 404.
//
// Deliberately: noindex/follow (the links out are still worth following), and
// NO canonical — a self-canonical on an error page says nothing, and pointing
// it at "/" would assert that the 404 *is* the homepage, which is the bug.
const notFoundHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Page not found — ExeBrowser</title>
<meta name="description" content="That page isn't here. Browse ${playNow.length} classic Windows and DOS games you can play free in your browser, no download and no sign-up." />
<meta name="robots" content="noindex, follow" />
<meta property="og:type" content="website" />
<meta property="og:title" content="Page not found — ExeBrowser" />
<meta property="og:image" content="${SITE}/og.png" />
<meta name="twitter:card" content="summary_large_image" />
<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
<link rel="alternate icon" href="/favicon.ico" />
<link rel="alternate" type="application/rss+xml" title="ExeBrowser — new games and posts" href="/feed.xml" />
<link rel="stylesheet" href="/style.css?v=40" />
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
  <p class="tagline">Run Windows <code>.exe</code> files in your browser. No install. No upload. Just WebAssembly + Wine.</p>
  <nav class="site-nav" aria-label="Primary">
    <a href="/">Home</a>
    <a href="/load-exe/">Run your EXE</a>
    <a href="/run/">App guides</a>
    <a href="/blog/">Blog</a>
    <a href="/guide/">Guide</a>
    <a href="/about/">About</a>
    <a href="/contact/">Contact</a>
  </nav>
</header>

<main class="prose">
  <nav class="breadcrumb" aria-label="Breadcrumb"><a href="/">Home</a> › Page not found</nav>
  <section class="card">
    <h2>That page isn't here — but ${playNow.length} games are</h2>
    <p>Two things usually bring people to this page. Either the address has a typo in it, or you followed a link to a title we've since taken down: a few games were pulled after testing showed they didn't actually work (Epic Pinball and Jazz Jackrabbit never rendered a single frame), and one was pulled on licensing grounds when its own startup screen turned out to say it wasn't redistributable. We'd rather remove a game than leave a page promising something it can't do.</p>
    <p>Everything below is hosted here, free, and boots in this tab. Search it, or head for the <a href="/run/">full catalogue</a> — that page also lists the compatibility guides for software we can't host but that you can load your own copy of.</p>
${gridFilterHtml(playNow)}
    <ul class="poster-grid">
${playNow.map(posterCard).join("\n")}
    </ul>
    <p style="margin-top:1.25rem;">Still stuck? The <a href="/guide/">compatibility guide</a> covers what runs and what doesn't, the <a href="/blog/">blog</a> has the longer write-ups, and if something is broken we'd like to know — <a href="/contact/">tell us</a>.</p>
  </section>
</main>

<footer>
  <p>Built on <a href="https://github.com/danoon2/Boxedwine" target="_blank" rel="noopener">Boxedwine</a> · <a href="https://www.winehq.org/" target="_blank" rel="noopener">Wine</a> · WebAssembly. Wine is a trademark of CodeWeavers. ExeBrowser is not affiliated with WineHQ, CodeWeavers, or Microsoft.</p>
  <nav class="footer-nav" aria-label="Footer">
    <a href="/">Home</a>
    <a href="/load-exe/">Run your EXE</a>
    <a href="/run/">App guides</a>
    <a href="/blog/">Blog</a>
    <a href="/guide/">Compatibility Guide</a>
    <a href="/about/">About</a>
    <a href="/contact/">Contact</a>
    <a href="/saves/">Saved games</a>
    <a href="/embed/">Embed our games</a>
    <a href="/privacy/">Privacy Policy</a>
    <a href="/terms/">Terms of Use</a>
  </nav>
  <p>© 2026 ExeBrowser. Content licensed openly; runtime under GPL-2.0 / LGPL-2.1.</p>
</footer>
<script src="/filter.js?v=2"></script>
</body>
</html>
`;
writeFileSync(resolve(ROOT, "404.html"), notFoundHtml, "utf8");
console.log("wrote", resolve(ROOT, "404.html"));


// ── /play/<slug>/ category pages ───────────────────────────────────────────
// The nine filter chips were, until now, the only expression of category on the
// site: client-side buttons with no URL behind them. That is nine high-intent
// query shapes ("classic windows games online", "play dos platformers") with no
// page to rank, and — the reason this matters more here than on most sites —
// no crawlable internal link structure. Search Console records TEN internal
// links for this entire site, because Google reaches the hub and the homepage
// and stops. These pages are new crawlable surface that links onward.
//
// The obvious implementation is a page per chip. It is also the wrong one: it
// would emit a "Pinball" page containing one game and a "Racing & sports" page
// containing two, which is the definition of a doorway page on a site already
// rejected once for thin content. So a page needs BOTH enough members AND real
// authored copy in play-categories.json, and the chips deliberately outnumber
// the pages.
// Only categories that actually have a page may be linked. Built from the
// filtered set above so a skipped category can't leak into the navigation.
const catNavHtml = (currentSlug) =>
  liveCats
    .map((c) =>
      c.slug === currentSlug
        ? `<span aria-current="page">${esc(c.h1.replace(/,.*$/, ""))}</span>`
        : `<a href="/play/${c.slug}/">${esc(c.h1.replace(/,.*$/, ""))}</a>`)
    .join(" · ");

function categoryBreadcrumbLd(cat) {
  return `<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "${SITE}/" },
    { "@type": "ListItem", "position": 2, "name": "Browse by category", "item": "${SITE}/play/" },
    { "@type": "ListItem", "position": 3, "name": ${jsonText(cat.h1)}, "item": "${SITE}/play/${cat.slug}/" }
  ]
}
</script>`;
}

function renderCategory(cat) {
  const { members } = cat;
  const picks = (cat.picks || [])
    .map((pick) => {
      const p = bySlug[pick.slug];
      if (!p) throw new Error(`/play/${cat.slug}/: pick "${pick.slug}" is not a catalogue slug`);
      return `      <li><a href="/run/${p.slug}/"><strong>${esc(p.appName)}</strong></a> — ${pick.note}</li>`;
    })
    .join("\n");

  // Deliberately NO hreflang here. hreflangHtml(path, null) falls through to
  // langsWithContent(), which would advertise /es/play/…, /pt-BR/play/… and
  // /de/play/… — none of which exist. These pages are English-only until
  // someone actually translates them.
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${esc(cat.title)}</title>
<meta name="description" content="${esc(cat.description)}" />
<meta name="keywords" content="${esc(cat.keywords)}" />
<link rel="canonical" href="${SITE}/play/${cat.slug}/" />
<meta property="og:type" content="website" />
<meta property="og:url" content="${SITE}/play/${cat.slug}/" />
<meta property="og:title" content="${esc(cat.h1)}" />
<meta property="og:description" content="${esc(cat.description)}" />
<meta property="og:image" content="${ogImage(members[0])}" />
<meta name="twitter:card" content="summary_large_image" />
<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
<link rel="alternate icon" href="/favicon.ico" />
<link rel="alternate" type="application/rss+xml" title="ExeBrowser — new games and posts" href="/feed.xml" />
<link rel="stylesheet" href="/style.css?v=40" />
<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-3593636324187853" crossorigin="anonymous"></script>
<script async src="https://www.googletagmanager.com/gtag/js?id=G-C8C4TZC5F1" crossorigin="anonymous"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  if (!navigator.webdriver) gtag('config', 'G-C8C4TZC5F1');
</script>
${categoryBreadcrumbLd(cat)}
${itemListLd(members, { name: cat.h1, url: `${SITE}/play/${cat.slug}/` })}
${faqLd(cat)}
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
    <a href="/load-exe/">Run your EXE</a>
    <a href="/run/">App guides</a>
    <a href="/blog/">Blog</a>
    <a href="/guide/">Guide</a>
    <a href="/about/">About</a>
    <a href="/contact/">Contact</a>
  </nav>
</header>

<main class="prose">
  <p class="resume-bar" id="resume-bar" hidden></p>
  <nav class="breadcrumb" aria-label="Breadcrumb"><a href="/">Home</a> › <a href="/play/">Browse by category</a> › ${esc(cat.h1)}</nav>
  <section class="card">
    <h2>${esc(cat.h1)}</h2>
    ${cat.intro}
    <ul class="poster-grid">
${members.map(posterCard).join("\n")}
    </ul>
    <h3>Where to start</h3>
    <ul class="picks">
${picks}
    </ul>${sectionsHtml(cat.sections)}
    <p class="muted small" style="margin:1.5rem 0 0;">Other categories: ${catNavHtml(cat.slug)} · <a href="/run/">every game and guide</a></p>
  </section>${faqHtml(cat)}
</main>

<footer>
  <p>Built on <a href="https://github.com/danoon2/Boxedwine" target="_blank" rel="noopener">Boxedwine</a> · <a href="https://www.winehq.org/" target="_blank" rel="noopener">Wine</a> · WebAssembly. Wine is a trademark of CodeWeavers. ExeBrowser is not affiliated with WineHQ, CodeWeavers, or Microsoft.</p>
  <nav class="footer-nav" aria-label="Footer">
    <a href="/">Home</a>
    <a href="/load-exe/">Run your EXE</a>
    <a href="/run/">App guides</a>
    <a href="/blog/">Blog</a>
    <a href="/guide/">Compatibility Guide</a>
    <a href="/about/">About</a>
    <a href="/contact/">Contact</a>
    <a href="/saves/">Saved games</a>
    <a href="/embed/">Embed our games</a>
    <a href="/privacy/">Privacy Policy</a>
    <a href="/terms/">Terms of Use</a>
  </nav>
  <p>© 2026 ExeBrowser. Content licensed openly; runtime under GPL-2.0 / LGPL-2.1.</p>
</footer>
<script src="/save-core.js?v=3"></script>
<script src="/recent.js?v=4"></script>
<script>
  window.renderResumeBar && renderResumeBar("resume-bar");
</script>
</body>
</html>
`;
}

for (const cat of liveCats) {
  const dir = resolve(ROOT, "play", cat.slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, "index.html"), renderCategory(cat), "utf8");
  console.log(`wrote /play/${cat.slug}/ (${cat.members.length} titles)`);
}

// /play/ itself, so the breadcrumb's second position resolves and the set has
// a hub of its own rather than being four orphans.
const catIndexHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${esc(CATS._index.title)}</title>
<meta name="description" content="${esc(CATS._index.description)}" />
<meta name="keywords" content="${esc(CATS._index.keywords)}" />
<link rel="canonical" href="${SITE}/play/" />
<meta property="og:type" content="website" />
<meta property="og:url" content="${SITE}/play/" />
<meta property="og:title" content="${esc(CATS._index.h1)}" />
<meta property="og:description" content="${esc(CATS._index.description)}" />
<meta property="og:image" content="${SITE}/og.png" />
<meta name="twitter:card" content="summary_large_image" />
<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
<link rel="alternate icon" href="/favicon.ico" />
<link rel="alternate" type="application/rss+xml" title="ExeBrowser — new games and posts" href="/feed.xml" />
<link rel="stylesheet" href="/style.css?v=40" />
<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-3593636324187853" crossorigin="anonymous"></script>
<script async src="https://www.googletagmanager.com/gtag/js?id=G-C8C4TZC5F1" crossorigin="anonymous"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  if (!navigator.webdriver) gtag('config', 'G-C8C4TZC5F1');
</script>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "${SITE}/" },
    { "@type": "ListItem", "position": 2, "name": "Browse by category", "item": "${SITE}/play/" }
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
    <a href="/load-exe/">Run your EXE</a>
    <a href="/run/">App guides</a>
    <a href="/blog/">Blog</a>
    <a href="/guide/">Guide</a>
    <a href="/about/">About</a>
    <a href="/contact/">Contact</a>
  </nav>
</header>

<main class="prose">
  <p class="resume-bar" id="resume-bar" hidden></p>
  <nav class="breadcrumb" aria-label="Breadcrumb"><a href="/">Home</a> › Browse by category</nav>
  <section class="card">
    <h2>${esc(CATS._index.h1)}</h2>
    ${CATS._index.intro}
    <ul class="card-grid">
${liveCats.map((c) => `      <li><a class="link-card" href="/play/${c.slug}/"><span class="lc-title">${esc(c.h1)}</span><span class="lc-desc">${esc(c.description)}</span></a></li>`).join("\n")}
    </ul>
    <p class="muted small" style="margin:1.25rem 0 0;">Not every filter has a page of its own — a category with one or two titles in it makes a thin page, so those stay as filters on the <a href="/run/">full catalogue</a> instead.</p>
  </section>
</main>

<footer>
  <p>Built on <a href="https://github.com/danoon2/Boxedwine" target="_blank" rel="noopener">Boxedwine</a> · <a href="https://www.winehq.org/" target="_blank" rel="noopener">Wine</a> · WebAssembly. Wine is a trademark of CodeWeavers. ExeBrowser is not affiliated with WineHQ, CodeWeavers, or Microsoft.</p>
  <nav class="footer-nav" aria-label="Footer">
    <a href="/">Home</a>
    <a href="/load-exe/">Run your EXE</a>
    <a href="/run/">App guides</a>
    <a href="/blog/">Blog</a>
    <a href="/guide/">Compatibility Guide</a>
    <a href="/about/">About</a>
    <a href="/contact/">Contact</a>
    <a href="/saves/">Saved games</a>
    <a href="/embed/">Embed our games</a>
    <a href="/privacy/">Privacy Policy</a>
    <a href="/terms/">Terms of Use</a>
  </nav>
  <p>© 2026 ExeBrowser. Content licensed openly; runtime under GPL-2.0 / LGPL-2.1.</p>
</footer>
<script src="/save-core.js?v=3"></script>
<script src="/recent.js?v=4"></script>
<script>
  window.renderResumeBar && renderResumeBar("resume-bar");
</script>
</body>
</html>
`;
mkdirSync(resolve(ROOT, "play"), { recursive: true });
writeFileSync(resolve(ROOT, "play", "index.html"), catIndexHtml, "utf8");
console.log(`wrote /play/ (${liveCats.length} categories)`);


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
<link rel="alternate" type="application/rss+xml" title="ExeBrowser — new games and posts" href="/feed.xml" />
<link rel="stylesheet" href="/style.css?v=40" />
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
  <section class="card">
    <h2>${esc(L.t(isHome ? "home.aboutHeading" : "hub.aboutHeading"))}</h2>
    ${L.t(isHome ? "home.about" : "hub.about")}
  </section>
</main>

${footerHtml(L)}
<script src="/save-core.js?v=3"></script>
<script src="/recent.js?v=4"></script>
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
//
// lastmod has to be true or it is worse than absent — a sitemap claiming
// nothing has changed since July is an instruction not to come back, and this
// site's whole problem is pages Google has discovered but never fetched. Three
// sources, in order of trustworthiness:
//   · run pages      — their own `updated` field
//   · blog + /blog/  — datePublished/dateModified read out of the posts' own
//                      JSON-LD by blog-meta.mjs, so adding a post can no longer
//                      mean forgetting to add it here
//   · / and /run/    — the newest date in the catalogue, because the visible
//                      content of both pages *is* the catalogue shelf
// The remaining hand-dated pages are ones whose prose genuinely only changes
// when someone edits it; check 9 below catches any page missing from this list.
const posts = blogPosts(ROOT);
const catalogueMod = maxDate([
  ...pages.map((p) => p.updated),
  ...pages.map((p) => p.addedDate),
]);
const blogMod = maxDate(posts.map((p) => p.modified));
const STATIC_URLS = [
  { loc: "/", freq: "weekly", pri: "1.0", mod: catalogueMod },
  { loc: "/run/", freq: "weekly", pri: "0.9", mod: catalogueMod },
  { loc: "/blog/", freq: "weekly", pri: "0.8", mod: blogMod },
  ...posts.map((p) => ({ loc: p.path, freq: "monthly", pri: "0.7", mod: p.modified })),
  { loc: "/play/", freq: "weekly", pri: "0.8", mod: catalogueMod },
  // The query family Bing shows converting 5-10x better than bare game
  // names ("doom unblocked" 26.5% CTR vs "doom" 3.25%).
  { loc: "/unblocked/", freq: "weekly", pri: "0.8", mod: catalogueMod },
  // The front door to the embed offer. Every accepted embed is an external
  // link back, and external links are the one thing holding this site's
  // crawl budget down — so this page is worth more than its traffic.
  { loc: "/embed/", freq: "weekly", pri: "0.8", mod: catalogueMod },
  // "open exe file" gets 237 Bing impressions at 1.27% CTR because the only
  // thing ranking for it is the homepage, which is a games shelf. This is
  // the page that actually answers it.
  { loc: "/open-exe-file/", freq: "monthly", pri: "0.9", mod: "2026-08-25" },
  // The loader had no URL of its own — it was a section three screens down the
  // home page, which is a games shelf. "run exe online" and its family have
  // nowhere to land without this.
  { loc: "/load-exe/", freq: "monthly", pri: "0.9", mod: "2026-08-27" },
  // A category page's content is its cards as much as its prose, so its lastmod
  // has to move when a member does — not only when someone edits the intro.
  ...liveCats.map((c) => ({
    loc: `/play/${c.slug}/`,
    freq: "weekly",
    pri: "0.8",
    mod: maxDate([c.updated, ...c.members.map((m) => m.updated), ...c.members.map((m) => m.addedDate)]),
  })),
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

// ── feed.xml ───────────────────────────────────────────────────────────────
// RSS 2.0 rather than Atom, because the <link rel="alternate"> type we advertise
// should be the one readers actually expect, and RSS has the wider support.
// Two kinds of item, one timeline: blog posts, and games as they go live. The
// second is the interesting half — "a new playable classic every week or two"
// is a thing worth subscribing to, and until now there was no way to follow it.
//
// Deliberately NOT in sitemap.xml: a sitemap lists pages you want indexed, and
// a feed indexed *as a page* is just a worse copy of the blog index.
const FEED_MAX = 30;
const postItems = posts.map((p) => ({
  title: p.title,
  link: `${SITE}${p.path}`,
  description: p.description,
  date: p.published,
}));
const gameItems = pages
  .filter((p) => isPlayable(p) && p.addedDate)
  .map((p) => ({
    title: `New game: ${p.appName}`,
    link: `${SITE}/run/${p.slug}/`,
    description: p.oneLiner || p.ogDescription || p.description,
    date: p.addedDate,
  }))
  .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

// Take the newest of each *before* merging, rather than slicing the combined
// list. A flat top-30 by date is all games — 32 titles were added after the
// most recent post — so the blog would never appear in its own site's feed.
// Reserving the posts keeps this a timeline of the site rather than a changelog
// of the catalogue.
const feedItems = [...postItems, ...gameItems.slice(0, Math.max(0, FEED_MAX - postItems.length))]
  .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

// lastBuildDate is the newest item, not the wall clock: a build timestamp would
// make every regeneration a diff even when nothing changed, which is the same
// churn argument that keeps the page count out of the /run/ title.
const feed = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>ExeBrowser — new games and posts</title>
    <link>${SITE}/</link>
    <description>Classic DOS and Windows games you can play free in your browser, plus write-ups on how the runtimes work.</description>
    <language>en</language>
    <lastBuildDate>${toRfc822(feedItems[0].date)}</lastBuildDate>
    <atom:link href="${SITE}/feed.xml" rel="self" type="application/rss+xml" />
${feedItems.map((it) => `    <item>
      <title>${xmlEsc(it.title)}</title>
      <link>${xmlEsc(it.link)}</link>
      <guid isPermaLink="true">${xmlEsc(it.link)}</guid>
      <description>${xmlEsc(it.description)}</description>
      <pubDate>${toRfc822(it.date)}</pubDate>
    </item>`).join("\n")}
  </channel>
</rss>
`;
writeFileSync(resolve(ROOT, "feed.xml"), feed, "utf8");

// ── llms.txt ───────────────────────────────────────────────────────────────
// ChatGPT is already the third-largest referrer here, ahead of every social
// network, and those visits engage. Assistants recommending the site do better
// with a plain list of what can actually be played than with a crawl of all 82
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

## Common questions

An assistant asked about this site is almost always answering one of these, so
they are answered here directly rather than left to be inferred from the list.

**Where can I play DOOM / Wolfenstein 3D / Commander Keen / Tyrian online free?**
Every title in the "Playable now" list above runs at ${SITE}/run/<slug>/. One
click and it plays in the tab. No download, no install, no account, no upload,
no plugin, and no separate emulator to set up.

**Are these games unblocked?** They are ordinary web pages served over HTTPS
from a single domain, so there is nothing to install and no game server, client
or extra port involved — which is what usually makes a game unavailable on a
managed laptop. Whether any particular network permits this domain is that
network's decision, not something the site controls. ${SITE}/unblocked/ lists
every title that plays this way.

**Does it work on a Chromebook, or a locked-down school or work laptop?** Yes,
wherever the browser can reach the site. Everything executes client-side in
WebAssembly; no admin rights are needed because nothing is installed.

**Is it free, and is it legal?** Free, with no account and no payment. Hosted
titles are open source, freeware, or shareware episodes whose licence permits
free redistribution. Commercial games are compatibility guides only — you supply
your own copy, and it never leaves your machine.

**Does progress save?** Yes, in the browser. DOS titles keep their in-game saves
and many also store an exact mid-game resume point. Saves live in this browser
only; they are not synced to an account and clearing site data removes them.

**What will not work?** 64-bit Windows binaries (the CPU emulator is 32-bit),
anything needing real hardware, networking or a GPU, and modern games generally.
The compatibility guides say honestly which of these fail and how.

## About

- [Homepage](${SITE}/): the full catalogue as a browsable shelf, searchable and
  filterable by category, plus a loader for running your own .exe
- [Load your own EXE](${SITE}/load-exe/): drop a Windows .exe, folder or zip and run it
  in the browser — nothing is uploaded, nothing is installed
- [All games and guides](${SITE}/run/)
- [Compatibility guide](${SITE}/guide/): which categories of Windows software run well
- [Blog](${SITE}/blog/): how the runtimes work, licensing, and preservation write-ups
- [Feed](${SITE}/feed.xml): new games and posts as they go live
- Runtimes: DOSBox (DOS titles) and Boxedwine — Wine plus a 32-bit x86 CPU
  emulator — in WebAssembly. 32-bit only; 64-bit Windows binaries will not load.
`;
writeFileSync(resolve(ROOT, "llms.txt"), llms, "utf8");

// Count the <loc> elements actually emitted rather than re-deriving the total:
// the old sum ignored every localised URL and under-reported by eleven.
const sitemapCount = (sitemap.match(/<loc>/g) || []).length;
console.log(`\nGenerated ${pages.length} pages + sitemap.xml (${sitemapCount} URLs) + feed.xml (${feedItems.length} items) + llms.txt (${playable.length} playable).`);
