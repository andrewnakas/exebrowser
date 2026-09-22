#!/usr/bin/env node
// Localised versions of the hand-maintained utility pages.
//
//   node scripts/gen-static-pages.mjs
//
// ── Why this exists ────────────────────────────────────────────────────────
// gen-app-pages.mjs localises the catalogue, because every /run/<slug>/ page is
// rendered from app-pages.json and a translation is a field-level overlay on a
// structured entry. The utility surface has no such structure: /load-exe/,
// /guide/, /open-exe-file/ and the blog are hand-written HTML with no slug, so
// six languages have a translated DOOM page and none has a translated page
// about .exe files — which is the half of the site that actually converts.
//
// This renders those pages for the languages that have real prose for them, out
// of scripts/i18n/static.<lang>.json, keyed by path.
//
// ── The rule, unchanged ────────────────────────────────────────────────────
// A localised page exists only where a real translation exists. There is no
// English fallback wearing an /es/ URL. A path missing from static.es.json is
// simply not written, nothing links to it, and hreflang does not mention it.
//
// Run it as step 1b, after gen-app-pages.mjs (which owns the sitemap and reads
// the same files to list these URLs) and before inject-page-links.mjs.

import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { SITE, esc } from "./catalogue.mjs";
import {
  LANGS, LOCALES, staticEntry, staticPaths, hreflangHtml, langSwitcherHtml,
} from "./i18n/locales.mjs";
import { STATIC_PAGES, staticLinkFor } from "./i18n/static-pages.mjs";

const ROOT = resolve(process.cwd(), "public");

const STYLE = "/style.css?v=41";
const ADSENSE = `<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-3593636324187853" crossorigin="anonymous"></script>`;
const GA = `<script async src="https://www.googletagmanager.com/gtag/js?id=G-C8C4TZC5F1" crossorigin="anonymous"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  if (!navigator.webdriver) gtag('config', 'G-C8C4TZC5F1');
</script>`;

// Byte-identical to the English hand-maintained pages, because
// inject-page-links.mjs anchors on this exact line and silently skips a page
// that does not carry it.
const FAVICON_BLOCK = `<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
<link rel="alternate icon" href="/favicon.ico" />
    <link rel="manifest" href="/manifest.webmanifest" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
    <meta name="theme-color" content="#0e0d0b" />
<link rel="alternate" type="application/rss+xml" title="ExeBrowser — new games and posts" href="/feed.xml" />`;

const siteNav = (L) => `<nav class="site-nav" aria-label="Primary">
    <a href="${L.path("/")}">${esc(L.t("nav.home"))}</a>
    <a href="${staticLinkFor(L, "/load-exe/")}">${esc(L.t("nav.loadExe"))}</a>
    <a href="${L.path("/run/")}">${esc(L.t("nav.guides"))}</a>
    <a href="${staticLinkFor(L, "/exe-inspector/")}">${esc(L.t("nav.exeViewer"))}</a>
    <a href="/blog/">${esc(L.t("nav.blog"))}</a>
    <a href="${staticLinkFor(L, "/guide/")}">${esc(L.t("nav.guide"))}</a>
    <a href="/about/">${esc(L.t("nav.about"))}</a>
    <a href="/contact/">${esc(L.t("nav.contact"))}</a>
  </nav>`;

const footer = (L) => `<footer>
  <p>${L.t("footer.builtOn")}</p>
  <nav class="footer-nav" aria-label="Footer">
    <a href="${L.path("/")}">${esc(L.t("nav.home"))}</a>
    <a href="${staticLinkFor(L, "/load-exe/")}">${esc(L.t("nav.loadExe"))}</a>
    <a href="${L.path("/run/")}">${esc(L.t("nav.guides"))}</a>
    <a href="${staticLinkFor(L, "/exe-inspector/")}">${esc(L.t("nav.exeViewer"))}</a>
    <a href="/blog/">${esc(L.t("nav.blog"))}</a>
    <a href="${staticLinkFor(L, "/guide/")}">${esc(L.t("footer.compat"))}</a>
    <a href="/about/">${esc(L.t("nav.about"))}</a>
    <a href="/contact/">${esc(L.t("nav.contact"))}</a>
    <a href="/saves/">${esc(L.t("footer.saves"))}</a>
    <a href="/privacy/">${esc(L.t("footer.privacy"))}</a>
    <a href="/terms/">${esc(L.t("footer.terms"))}</a>
  </nav>
  <p>${esc(L.t("footer.copyright"))}</p>
</footer>`;

// The client scripts can't read ui.json, so the js.* strings ride along inline.
// Same mechanism as gen-app-pages.mjs, and English still ships nothing.
import { readFileSync } from "node:fs";
const UI_EN = JSON.parse(readFileSync(resolve(process.cwd(), "scripts", "i18n", "ui.json"), "utf8")).en;
function clientStrings(L) {
  if (L.isDefault) return "";
  const keys = Object.keys(UI_EN).filter((k) => k.startsWith("js."));
  const obj = Object.fromEntries(keys.map((k) => [k.slice(3), L.t(k)]));
  return `\n<script>window.__I18N=${JSON.stringify(obj)};</script>`;
}

const breadcrumbLd = (L, cfg, e, url) => {
  const items = [
    { name: L.t("crumb.home"), item: `${SITE}${L.path("/")}` },
  ];
  if (cfg.parent) items.push({ name: esc(L.t(cfg.parent.labelKey)), item: `${SITE}${cfg.parent.href}` });
  items.push({ name: e.crumb, item: url });
  return `<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
${items.map((it, i) => `    { "@type": "ListItem", "position": ${i + 1}, "name": ${JSON.stringify(it.name)}, "item": ${JSON.stringify(it.item)} }`).join(",\n")}
  ]
}
</script>`;
};

const faqLd = (e) => {
  if (!e.faq || !e.faq.length) return "";
  return `\n<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
${e.faq.map((q) => `    {
      "@type": "Question",
      "name": ${JSON.stringify(q.q)},
      "acceptedAnswer": { "@type": "Answer", "text": ${JSON.stringify(stripTags(q.a))} }
    }`).join(",\n")}
  ]
}
</script>`;
};

const articleLd = (e, url, cfg) => `\n<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": ${JSON.stringify(stripTags(e.h1))},
  "description": ${JSON.stringify(e.description)},
  "author": { "@type": "Person", "name": "Andrew Nakas", "url": "${SITE}/about/" },
  "publisher": { "@type": "Organization", "name": "ExeBrowser" },
  "mainEntityOfPage": ${JSON.stringify(url)},
  "image": "${SITE}/og.png",
  "datePublished": "${cfg.published}",
  "dateModified": "${cfg.modified}"
}
</script>`;

const stripTags = (s) => String(s || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

function bodyForPage(L, e) {
  const cards = [];
  cards.push(`  <section class="card">
    <h2>${esc(e.h1)}</h2>
${e.intro || ""}
  </section>`);
  for (const s of e.sections || []) {
    cards.push(`  <section class="card">
    <h2>${esc(s.h)}</h2>
${s.html}
  </section>`);
  }
  if (e.faq && e.faq.length) {
    cards.push(`  <section class="card">
    <h2>${esc(e.faqHeading || L.t("faq.heading"))}</h2>
${e.faq.map((q) => `    <details><summary>${esc(q.q)}</summary>${q.a}</details>`).join("\n")}
  </section>`);
  }
  if (e.outro) cards.push(`  <section class="card">\n${e.outro}\n  </section>`);
  return cards.join("\n\n");
}

function bodyForArticle(L, e, cfg) {
  const parts = [`  <section class="card">
    <h2>${esc(e.h1)}</h2>
    <p class="updated">${e.byline}</p>
`];
  for (const s of e.sections || []) {
    parts.push(`    <h3>${esc(s.h)}</h3>\n${s.html}`);
  }
  if (e.outro) parts.push(e.outro);
  parts.push(`  </section>`);
  return parts.join("\n\n");
}

// NOTE: window.__I18N has to be emitted BEFORE the scripts that read it.
// embed.js and app.js are IIFEs that run on parse, so a translation block
// placed after them is set too late and every T() silently returns its English
// fallback. The page then validates perfectly, looks right in the HTML, and is
// an English application inside a Spanish frame — exactly the failure the
// localisation work was meant to end. gen-app-pages.mjs has always emitted it
// first; this file did not, and the only way to see it was to load the page.
function render(L, path, cfg, e) {
  const url = `${SITE}${L.prefix}${path}`;
  const isArticle = cfg.kind === "article";
  const crumbTrail = cfg.parent
    ? `<a href="${L.path("/")}">${esc(L.t("crumb.home"))}</a> › <a href="${cfg.parent.href}">${esc(L.t(cfg.parent.labelKey))}</a> › ${esc(e.crumb)}`
    : `<a href="${L.path("/")}">${esc(L.t("crumb.home"))}</a> › ${esc(e.crumb)}`;

  return `<!DOCTYPE html>
<html lang="${L.htmlLang}">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${esc(e.title)}</title>
<meta name="description" content="${esc(e.description)}" />
<meta name="keywords" content="${esc(e.keywords)}" />
<link rel="canonical" href="${url}" />${hreflangHtml(path, null, "static")}
<meta property="og:type" content="${isArticle ? "article" : "website"}" />
<meta property="og:url" content="${url}" />
<meta property="og:title" content="${esc(e.ogTitle)}" />
<meta property="og:description" content="${esc(e.ogDescription)}" />
<meta property="og:image" content="${SITE}/og.png" />
<meta name="twitter:card" content="summary_large_image" />
${FAVICON_BLOCK}
<link rel="stylesheet" href="${STYLE}" />
${ADSENSE}
${GA}
${breadcrumbLd(L, cfg, e, url)}${isArticle ? articleLd(e, url, cfg) : ""}${faqLd(e)}
</head>
<body>
<header>
  <div class="brand">
    <span class="logo" aria-hidden="true">▶_</span>
    <h1>ExeBrowser</h1>
  </div>
  <p class="tagline">${L.t("brand.tagline")}</p>
  ${siteNav(L)}${langSwitcherHtml(L, path, null, "static")}
</header>

<main class="prose">
${cfg.resumeBar ? '  <p class="resume-bar" id="resume-bar" hidden></p>\n' : ""}  <nav class="breadcrumb" aria-label="Breadcrumb">${crumbTrail}</nav>

${isArticle ? bodyForArticle(L, e, cfg) : bodyForPage(L, e)}
</main>

${footer(L)}
${clientStrings(L)}
${(cfg.scripts || []).map((s) => `<script src="${s}"></script>`).join("\n")}${cfg.resumeBar ? '\n<script>window.renderResumeBar && renderResumeBar("resume-bar");</script>' : ""}
<script src="/pwa.js?v=1"></script>
</body>
</html>
`;
}

// ── Write ─────────────────────────────────────────────────────────────────
let written = 0;
const byLang = {};
for (const code of LANGS) {
  if (code === "en") continue;
  const L = LOCALES[code];
  for (const path of staticPaths(code)) {
    const cfg = STATIC_PAGES[path];
    if (!cfg) {
      console.error(`static.${code}.json has "${path}", which is not a localisable page. Add it to scripts/i18n/static-pages.mjs or remove it.`);
      process.exit(1);
    }
    const e = staticEntry(code, path);
    const missing = ["title", "description", "keywords", "ogTitle", "ogDescription", "crumb", "h1", "sections"]
      .filter((k) => !e[k] || (Array.isArray(e[k]) && !e[k].length));
    if (missing.length) {
      console.error(`static.${code}.json "${path}" is missing: ${missing.join(", ")}. A half-translated page is the thing this pipeline exists to prevent.`);
      process.exit(1);
    }
    const dir = resolve(ROOT, code, ...path.split("/").filter(Boolean));
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, "index.html"), render(L, path, cfg, e), "utf8");
    (byLang[code] ||= []).push(path);
    written++;
  }
}

for (const [code, paths] of Object.entries(byLang)) {
  console.log(`${code}: ${paths.join(" ")}`);
}
console.log(`Wrote ${written} localised utility page(s).`);
