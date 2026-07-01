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

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const ROOT = resolve(process.cwd(), "public");
const SITE = "https://exebrowser.com";

const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
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
  "image": "${SITE}/og.png",
  "description": ${jsonText(p.description)},
  "applicationCategory": "Game",
  "genre": [${genre}],
  "gamePlatform": ["Web browser", "Windows"],
  "operatingSystem": "Web Browser"${p.author ? `,
  "publisher": { "@type": "Organization", "name": ${JSON.stringify(p.author)} }` : ""},
  "offers": { "@type": "Offer", "price": "0", "priceCurrency": "USD" }
}
</script>`;
  }
  return `<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  "name": ${jsonText(p.appName)},
  "url": "${url}",
  "image": "${SITE}/og.png",
  "description": ${jsonText(p.description)},
  "applicationCategory": "Utility",
  "operatingSystem": "Web Browser"${p.author ? `,
  "author": { "@type": "Organization", "name": ${JSON.stringify(p.author)} }` : ""},
  "offers": { "@type": "Offer", "price": "0", "priceCurrency": "USD" }
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

function mobileControlsHtml(p) {
  const mc = p.mobileControls;
  if (!mc) return "";

  const isDos = mc.type.includes("dos");
  const btns = mc.buttons || [];

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
    document.querySelectorAll(".mgp-btn").forEach(function(btn){
      var key=btn.dataset.key, code=btn.dataset.code, kc=parseInt(btn.dataset.keycode,10);
      function dn(e){ e.preventDefault(); fire("keydown",key,code,kc); btn.classList.add("pressed"); }
      function up(e){ e.preventDefault(); fire("keyup",key,code,kc); btn.classList.remove("pressed"); }
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
  <p class="mgp-hint">${esc(mc.hint)}</p>${wireScript}`;
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

function faqHtml(p) {
  if (!p.faq || !p.faq.length) return "";
  const items = p.faq
    .map((f) => `    <details>\n      <summary>${esc(f.q)}</summary>\n      <p>${f.a}</p>\n    </details>`)
    .join("\n");
  return `\n  <section class="card">\n    <h2>Frequently asked questions</h2>\n${items}\n  </section>`;
}

function relatedHtml(related) {
  const cards = (related || [])
    .map(
      (r) =>
        `      <li><a class="link-card" href="${r.href}"><span class="lc-title">${esc(
          r.title
        )}</span><span class="lc-desc">${esc(r.desc)}</span></a></li>`
    )
    .join("\n");
  return `\n  <section class="card">\n    <h2>More you can run in your browser</h2>\n    <ul class="card-grid">\n${cards}\n    </ul>\n  </section>`;
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

const render = (p) => `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${esc(p.title)}</title>
<meta name="description" content="${esc(p.description)}" />
<meta name="keywords" content="${esc(p.keywords)}" />
<link rel="canonical" href="${SITE}/run/${p.slug}/" />
<meta property="og:type" content="article" />
<meta property="og:url" content="${SITE}/run/${p.slug}/" />
<meta property="og:title" content="${esc(p.ogTitle)}" />
<meta property="og:description" content="${esc(p.ogDescription)}" />
<meta property="og:image" content="${SITE}/og.png" />
<meta name="twitter:card" content="summary_large_image" />
<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
<link rel="alternate icon" href="/favicon.ico" />
<link rel="stylesheet" href="/style.css?v=20" />
<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-3593636324187853" crossorigin="anonymous"></script>
<script async src="https://www.googletagmanager.com/gtag/js?id=G-C8C4TZC5F1" crossorigin="anonymous"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'G-C8C4TZC5F1');
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
  <p class="tagline">Run Windows <code>.exe</code> files in your browser. No install. No upload. Just WebAssembly + Wine.</p>
  <nav class="site-nav" aria-label="Primary">
    <a href="/">Home</a>
    <a href="/run/">App guides</a>
    <a href="/blog/">Blog</a>
    <a href="/guide/">Guide</a>
    <a href="/about/">About</a>
    <a href="/contact/">Contact</a>
  </nav>
</header>

<main class="prose">
  <nav class="breadcrumb" aria-label="Breadcrumb"><a href="/">Home</a> › <a href="/run/">App guides</a> › ${esc(p.crumb)}</nav>

  <section class="card">
    <h2>${esc(p.h1 || p.crumb)} <span class="verdict ${p.verdict.kind}">${esc(p.verdict.text)}</span></h2>
    ${p.intro}
${embedBlock(p)}${mobileControlsHtml(p)}
    ${p.iframeUrl ? "" : `<p class="muted small" style="margin-top:1rem;">${p.dosRuntime ? "Runs in your browser tab with DOSBox + WebAssembly — nothing is uploaded. Click the screen to capture input; press <kbd>Ctrl+F10</kbd> to release mouse." : "Runs in your browser tab with WebAssembly + Wine — nothing is uploaded. Click the screen to capture input; press <kbd>Esc</kbd> to release the mouse."}</p>`}${licenseHtml(p)}
  </section>
${downloadHtml(p)}
  <section class="card">
    <h2>How it works &amp; what to expect</h2>${sectionsHtml(p.sections)}
  </section>${faqHtml(p)}${relatedHtml(p.related)}
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
    <a href="/privacy/">Privacy Policy</a>
    <a href="/terms/">Terms of Use</a>
  </nav>
  <p>© 2026 ExeBrowser. Content licensed openly; runtime under GPL-2.0 / LGPL-2.1.</p>
</footer>

${p.iframeUrl
  ? ``
  : p.dosRuntime
    ? `<script src="/dos-embed.js?v=3"></script>`
    : `<!-- embed.js must run first: it builds the runtime DOM that app.js binds to. -->
<script src="/embed.js?v=1"></script>
<script src="/app.js?v=16"></script>`}
</body>
</html>
`;

// ── page definitions ───────────────────────────────────────────────────────
// Populated from data/app-pages.json (authored by the page-build workflow) so
// this generator stays the template and the content stays data.
import { readFileSync, existsSync } from "node:fs";
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
}

// ── regenerate the /run/ index so all pages are linked (crawlable) ─────────
function indexCard(p) {
  const verdictKind = (p.verdict && p.verdict.kind) ? p.verdict.kind : "good";
  const play = (p.hostable && p.appUrl && !p.skipGenerate) ? ` <span class="verdict ${verdictKind}" style="margin-left:.3rem;">▶ Play now</span>` : "";
  return `      <li><a class="link-card" href="/run/${p.slug}/"><span class="lc-title">${esc(
    p.appName
  )}${play}</span><span class="lc-desc">${esc(p.verdict.text)}</span></a></li>`;
}
const games = pages.filter((p) => p.appType === "game");
const apps = pages.filter((p) => p.appType === "app");
const indexHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Run Windows Apps &amp; Games in Your Browser — ${pages.length} App Guides — ExeBrowser</title>
<meta name="description" content="Play and run ${pages.length} classic Windows programs in your browser with Wine + WebAssembly — DOOM, 3D Pinball, Solitaire, 7-Zip, and more. No install. Many run with one click; the rest take your own copy." />
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
<link rel="stylesheet" href="/style.css?v=20" />
<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-3593636324187853" crossorigin="anonymous"></script>
<script async src="https://www.googletagmanager.com/gtag/js?id=G-C8C4TZC5F1" crossorigin="anonymous"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'G-C8C4TZC5F1');
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
  <nav class="breadcrumb" aria-label="Breadcrumb"><a href="/">Home</a> › App guides</nav>
  <section class="card">
    <h2>Run specific Windows apps &amp; games in your browser</h2>
    <p>Click into any guide to run that program right on the page — many boot with a single <strong>▶ Play now</strong> click (free, license-clean software we host for you); the rest show you exactly how to load your own copy. Every guide is honest about whether it works, which Wine variant to use, and what to expect.</p>
    <h3 style="margin-top:0;">Games</h3>
    <ul class="card-grid">
${games.map(indexCard).join("\n")}
    </ul>
    <h3>Apps &amp; utilities</h3>
    <ul class="card-grid">
${apps.map(indexCard).join("\n")}
    </ul>
    <p style="margin-top:1.25rem;">Don't see your app? The general <a href="/guide/">compatibility guide</a> explains which categories run well and which struggle. Most classic 32-bit Windows software from 1995–2008 is worth a try.</p>
  </section>
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
    <a href="/privacy/">Privacy Policy</a>
    <a href="/terms/">Terms of Use</a>
  </nav>
  <p>© 2026 ExeBrowser. Content licensed openly; runtime under GPL-2.0 / LGPL-2.1.</p>
</footer>
</body>
</html>
`;
writeFileSync(resolve(ROOT, "run", "index.html"), indexHtml, "utf8");
console.log("wrote", resolve(ROOT, "run", "index.html"), `(${games.length} games + ${apps.length} apps)`);

// Emit the COMPLETE sitemap.xml: static URLs + every generated /run page. Making
// the sitemap a generated artifact keeps it from drifting as pages are added.
const STATIC_URLS = [
  { loc: "/", freq: "weekly", pri: "1.0" },
  { loc: "/run/", freq: "weekly", pri: "0.9" },
  { loc: "/blog/", freq: "weekly", pri: "0.8" },
  { loc: "/blog/run-windows-software-on-a-chromebook/", freq: "monthly", pri: "0.8" },
  { loc: "/blog/wine-vs-emulator-explained/", freq: "monthly", pri: "0.7" },
  { loc: "/blog/run-old-software-without-a-vm/", freq: "monthly", pri: "0.7" },
  { loc: "/guide/", freq: "monthly", pri: "0.9" },
  { loc: "/about/", freq: "monthly", pri: "0.6" },
  { loc: "/contact/", freq: "yearly", pri: "0.5" },
  { loc: "/privacy/", freq: "yearly", pri: "0.4" },
  { loc: "/terms/", freq: "yearly", pri: "0.4" },
];
const urlEl = (loc, freq, pri) =>
  `  <url>\n    <loc>${SITE}${loc}</loc>\n    <changefreq>${freq}</changefreq>\n    <priority>${pri}</priority>\n  </url>`;
const runUrls = pages.map((p) => urlEl(`/run/${p.slug}/`, "monthly", "0.7"));
const staticUrls = STATIC_URLS.map((u) => urlEl(u.loc, u.freq, u.pri));
// Order: home, /run/, then all run pages, then the rest of the static set.
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${staticUrls[0]}
${staticUrls[1]}
${runUrls.join("\n")}
${staticUrls.slice(2).join("\n")}
</urlset>
`;
writeFileSync(resolve(ROOT, "sitemap.xml"), sitemap, "utf8");

console.log(`\nGenerated ${pages.length} pages + sitemap.xml (${pages.length + STATIC_URLS.length} URLs).`);
