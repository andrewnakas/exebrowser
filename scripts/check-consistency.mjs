#!/usr/bin/env node
// Consistency checks across the site. Run after `gen-app-pages.mjs`:
//
//   node scripts/check-consistency.mjs
//
// These catch the class of bug that keeps recurring here: a page says
// something that *was* true when written and quietly stopped being true when
// a game was added, a payload was rebuilt, or a verdict changed. Nothing here
// inspects prose quality — only claims that can be checked mechanically
// against app-pages.json and the files on disk.
//
// Exits non-zero if anything fails, so it can gate a deploy.

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

const ROOT = resolve(process.cwd(), "public");
const pages = JSON.parse(readFileSync(resolve(process.cwd(), "scripts", "app-pages.json"), "utf8"));
const isPlayable = (p) => !!(p.appUrl || p.iframeUrl);

const problems = [];
const warn = (msg) => problems.push(msg);

// ── 1. Hosted payloads actually exist and are under the Pages size cap ─────
const MAX_BYTES = 25 * 1024 * 1024; // Cloudflare Pages per-file limit
for (const p of pages) {
  if (!p.appUrl || !p.appUrl.endsWith(".zip")) continue;
  const path = join(ROOT, p.appUrl.replace(/^\//, ""));
  if (!existsSync(path)) {
    warn(`${p.slug}: appUrl points at ${p.appUrl} but that file is missing`);
    continue;
  }
  const size = statSync(path).size;
  if (size > MAX_BYTES) {
    warn(`${p.slug}: payload is ${(size / 1048576).toFixed(1)} MB, over the 25 MB Pages limit`);
  }
}

// ── 2. Screenshots declared in data exist on disk ──────────────────────────
for (const p of pages) {
  if (!p.screenshot) continue;
  const file = typeof p.screenshot === "string" ? p.screenshot : "screenshot.png";
  if (!existsSync(join(ROOT, "run", p.slug, file))) {
    warn(`${p.slug}: screenshot declared but /run/${p.slug}/${file} is missing`);
  }
}

// ── 3. Every internal link resolves ────────────────────────────────────────
// A dead link is worse on this site than most, because visitors follow them
// expecting a game. This used to check only href="/run/<slug>/", which meant
// every other link shape on the site was unchecked — and the localisation work
// found real 404 generators hiding in exactly those shapes. Resolve them all.

// Runtime payload trees: machine-generated asset dirs with thousands of files
// and no prose. Nothing in them is a page a visitor navigates to.
const SKIP_DIRS = new Set(["64", "boxedwine", "apps", "dosbox", "dosbox-snap", "data", "embed"]);

function htmlFiles(dir, rel = "") {
  const out = [];
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) {
      if (rel === "" && SKIP_DIRS.has(name)) continue;
      out.push(...htmlFiles(abs, rel ? `${rel}/${name}` : name));
    } else if (name.endsWith(".html")) {
      out.push({ abs, label: rel ? `${rel}/${name}` : name });
    }
  }
  return out;
}

// _redirects rules make a URL valid without a file behind it — that is how
// withdrawn titles (2048-open, epic-pinball) keep resolving. Parse the sources
// so retiring a game doesn't light up the checker.
const redirectSources = [];
if (existsSync(join(ROOT, "_redirects"))) {
  for (const line of readFileSync(join(ROOT, "_redirects"), "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const src = t.split(/\s+/)[0];
    if (src) redirectSources.push(src);
  }
}
const isRedirected = (href) =>
  redirectSources.some((src) =>
    src.endsWith("/*") ? href.startsWith(src.slice(0, -1)) : src === href);

// A directory href (…/) must have an index.html; anything else must be a file.
function resolves(href) {
  const path = href.split(/[?#]/)[0];
  const target = path.endsWith("/")
    ? join(ROOT, path.slice(1), "index.html")
    : join(ROOT, path.slice(1));
  return existsSync(target);
}

const linkedPages = htmlFiles(ROOT);
for (const { abs, label } of linkedPages) {
  const html = readFileSync(abs, "utf8");
  const seen = new Set();
  for (const m of html.matchAll(/(?:href|src)="(\/[^"]*)"/g)) {
    const href = m[1];
    if (seen.has(href)) continue;
    seen.add(href);
    if (href.startsWith("//")) continue; // protocol-relative, external
    if (resolves(href) || isRedirected(href)) continue;
    warn(`${label}: links to ${href} which does not resolve`);
  }
}

// ── 4. Blog compat-table verdicts match the live pages ─────────────────────
// This is the check that would have caught Scorched Earth being listed as
// "Won't run here" months after we started hosting it.
const compat = join(ROOT, "blog", "we-tested-53-windows-apps-in-the-browser", "index.html");
if (existsSync(compat)) {
  const html = readFileSync(compat, "utf8");
  const bySlug = Object.fromEntries(pages.map((p) => [p.slug, p]));
  const unescape = (s) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  for (const m of html.matchAll(
    /<tr><td><a href="\/run\/([a-z0-9-]+)\/">[^<]+<\/a><\/td><td>[^<]*<\/td><td>[^<]*<\/td><td>([^<]*)<\/td><\/tr>/g
  )) {
    const [, slug, note] = m;
    const p = bySlug[slug];
    if (!p) { warn(`compat table: row for unknown slug ${slug}`); continue; }
    if (unescape(note).trim() !== p.verdict.text.trim()) {
      warn(`compat table: ${slug} says "${unescape(note).slice(0, 40)}…" but its page says "${p.verdict.text.slice(0, 40)}…"`);
    }
  }
}

// ── 5. Playable pages don't describe themselves as unavailable ─────────────
// A hosted game whose copy still says "you can't run this here" is the exact
// contradiction that made the One Must Fall page misleading.
const CANT_RUN = /won['’]t run here|can['’]t run (it )?here|not playable here|we don['’]t host/i;
for (const p of pages) {
  if (!isPlayable(p)) continue;
  const blob = [p.intro, ...(p.sections || []).map((s) => s.html)].join(" ");
  if (CANT_RUN.test(blob)) {
    warn(`${p.slug}: is hosted, but its copy still says it can't be run here`);
  }
}

// ── 6. Guides for games we host elsewhere should link to the playable page ──
for (const p of pages) {
  if (isPlayable(p)) continue;
  const name = (p.appName || "").toLowerCase();
  if (!name) continue;
  for (const q of pages) {
    if (!isPlayable(q) || q.slug === p.slug) continue;
    const qn = (q.appName || "").toLowerCase();
    if (!qn) continue;
    const same = qn.startsWith(name) || name.startsWith(qn);
    if (!same) continue;
    const linked = JSON.stringify(p.related || []).includes(`/run/${q.slug}/`) ||
                   (p.intro || "").includes(`/run/${q.slug}/`);
    if (!linked) {
      warn(`${p.slug}: guide for "${p.appName}" but we host "${q.appName}" at /run/${q.slug}/ — not linked`);
    }
  }
}

// ── 7. hreflang alternates resolve, and are reciprocal ─────────────────────
// Google silently discards a one-way alternate, so a half-wired language is
// indistinguishable from no language at all — and this repo has already
// shipped hreflang pointing at pages that didn't exist. Both halves matter:
// the target must be on disk, and it must point back.
const hrefLangOf = (html) =>
  [...html.matchAll(/<link rel="alternate" hreflang="([^"]+)" href="https:\/\/exebrowser\.com([^"]*)"/g)]
    .map((m) => ({ lang: m[1], path: m[2] }));

for (const { abs, label } of linkedPages) {
  const html = readFileSync(abs, "utf8");
  const alts = hrefLangOf(html);
  if (!alts.length) continue;
  // The page's own URL, derived from its location on disk.
  const selfPath = "/" + label.replace(/index\.html$/, "");
  for (const { lang, path } of alts) {
    if (lang === "x-default") continue;
    const targetFile = join(ROOT, path.slice(1), "index.html");
    if (!existsSync(targetFile)) {
      warn(`${label}: hreflang="${lang}" points at ${path} which does not exist`);
      continue;
    }
    // x-default is excluded: it points at the English page by definition, so
    // counting it as a reciprocal link would make every alternate to "/" look
    // wired up even when the real one is missing.
    const back = hrefLangOf(readFileSync(targetFile, "utf8")).filter((b) => b.lang !== "x-default");
    if (!back.some((b) => b.path === selfPath)) {
      warn(`${label}: hreflang="${lang}" → ${path}, but ${path} has no alternate back to ${selfPath}`);
    }
  }
}

// ── 8. Sitemap covers every indexable page, and lists nothing missing ───────
// Both directions. Forgetting to add a new blog post was a documented manual
// step until the sitemap started deriving them; this makes the whole class
// mechanical instead, and also catches a withdrawn page lingering as a <loc>.
const sitemapFile = join(ROOT, "sitemap.xml");
if (existsSync(sitemapFile)) {
  const xml = readFileSync(sitemapFile, "utf8");
  const locs = new Set(
    [...xml.matchAll(/<loc>https:\/\/exebrowser\.com([^<]*)<\/loc>/g)].map((m) => m[1])
  );
  for (const loc of locs) {
    if (!existsSync(join(ROOT, loc.slice(1), "index.html"))) {
      warn(`sitemap: lists ${loc} but no page exists there`);
    }
  }
  for (const { abs, label } of linkedPages) {
    if (label === "404.html") continue; // deliberately not indexable
    const html = readFileSync(abs, "utf8");
    if (/<meta name="robots" content="[^"]*noindex/.test(html)) continue;
    const path = "/" + label.replace(/index\.html$/, "");
    if (!locs.has(path)) warn(`sitemap: ${path} is indexable but is not listed`);
  }
}

// ── 9. Category pages carry real prose, and their picks are real members ────
// The doorway-page failure mode, made mechanical. A /play/ page whose only
// content is the same cards the filter already shows is thin content wearing a
// URL, and this site cannot afford another strike for that. So: a word floor on
// the ORIGINAL prose (the cards don't count), a minimum number of editor's
// picks, and every pick has to actually be in the category it's picked for.
const MIN_WORDS = 250;
const MIN_PICKS = 3;
const catFile = resolve(process.cwd(), "scripts", "play-categories.json");
if (existsSync(catFile)) {
  const cats = JSON.parse(readFileSync(catFile, "utf8"));
  const bySlugAll = Object.fromEntries(pages.map((p) => [p.slug, p]));
  const words = (s) => String(s).replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length;

  for (const cat of cats.categories || []) {
    const prose =
      words(cat.intro) +
      (cat.sections || []).reduce((n, s) => n + words(s.h) + words(s.html), 0) +
      (cat.picks || []).reduce((n, p) => n + words(p.note), 0) +
      (cat.faq || []).reduce((n, f) => n + words(f.q) + words(f.a), 0);
    if (prose < MIN_WORDS) {
      warn(`play/${cat.slug}: only ${prose} words of original prose (need ${MIN_WORDS})`);
    }
    if ((cat.picks || []).length < MIN_PICKS) {
      warn(`play/${cat.slug}: ${(cat.picks || []).length} picks (need ${MIN_PICKS})`);
    }
    const members = cat.match === "slugs"
      ? (cat.slugs || [])
      : pages.filter((p) => isPlayable(p) && (p.categories || []).includes(cat.name)).map((p) => p.slug);
    for (const pick of cat.picks || []) {
      const p = bySlugAll[pick.slug];
      if (!p) { warn(`play/${cat.slug}: pick "${pick.slug}" is not a catalogue slug`); continue; }
      if (!isPlayable(p)) warn(`play/${cat.slug}: pick "${pick.slug}" is not playable`);
      if (!members.includes(pick.slug)) {
        warn(`play/${cat.slug}: pick "${pick.slug}" is not a member of this category`);
      }
    }
  }
}

// ── 10. No localised category URLs exist ───────────────────────────────────
// /play/ is English-only. hreflangHtml(path, null) would happily advertise
// /es/play/…, and linking into a language a page doesn't exist in is a 404
// generator this repo has shipped before.
for (const { abs, label } of linkedPages) {
  const html = readFileSync(abs, "utf8");
  const m = html.match(/["'](\/(?:es|pt-BR|de)\/play\/[^"']*)["']/);
  if (m) warn(`${label}: links to ${m[1]} — /play/ pages are English-only`);
}

// ── 11. TRANSLATION INTEGRITY ──────────────────────────────────────────────
// Mechanical checks only. These cannot tell you whether a translation reads
// well — that needs a native speaker, and the ones on this site have not had
// one. What they can catch is the class of error that silently breaks a page:
// a dropped {name} placeholder, a mangled <a> tag, or a string left in the
// wrong language entirely. A Russian word once shipped inside the French file.
const uiFile = resolve(process.cwd(), "scripts", "i18n", "ui.json");
if (existsSync(uiFile)) {
  const ui = JSON.parse(readFileSync(uiFile, "utf8"));
  const en = ui.en || {};
  const KEEP_EN = new Set(["html.lang", "lang.name", "lang.notice", "home.restInEnglish"]);
  // Optional per-locale keys that deliberately have no English counterpart.
  const OPTIONAL = new Set(["hreflang.code"]);
  const ph = (v) => [...String(v).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
  const tags = (v) => (String(v).match(/<\/?[a-z]+/gi) || []).map((t) => t.toLowerCase()).sort().join(",");
  // Scripts that have no business appearing in a given locale.
  const SCRIPTS = [
    [/[\u0400-\u04FF]/, "Cyrillic", () => true],
    [/[\u4E00-\u9FFF]/, "CJK", (c) => !["zh-CN", "ja"].includes(c)],
    [/[\u3040-\u30FF]/, "kana", (c) => c !== "ja"],
  ];

  for (const [code, strings] of Object.entries(ui)) {
    if (code === "_readme" || code === "en") continue;
    for (const k of Object.keys(en)) {
      const v = strings[k];
      if (v === undefined) {
        if (!OPTIONAL.has(k)) warn(`i18n ${code}: missing key ${k}`);
        continue;
      }
      if (ph(en[k]) !== ph(v)) warn(`i18n ${code}: placeholder mismatch in ${k}`);
      if (en[k] !== "" && tags(en[k]) !== tags(v)) warn(`i18n ${code}: HTML tag mismatch in ${k}`);
      for (const [re, name, applies] of SCRIPTS) {
        if (applies(code) && re.test(String(v))) warn(`i18n ${code}: ${name} characters in ${k}`);
      }
    }
    // A page that exists in a language must have chrome in that language.
    const pagesFile = resolve(process.cwd(), "scripts", "i18n", `pages.${code}.json`);
    if (existsSync(pagesFile)) {
      const tr = JSON.parse(readFileSync(pagesFile, "utf8"));
      delete tr._readme;
      delete tr._cards;
      delete tr._controls;
      for (const [slug, e] of Object.entries(tr)) {
        for (const f of ["title", "description", "h1"]) {
          if (!e[f]) warn(`i18n ${code}/${slug}: missing ${f}`);
        }
        if (e.title && e.title.length > 80) warn(`i18n ${code}/${slug}: title ${e.title.length}c (truncates)`);

        // A field the translation omits falls back to the English entry, and
        // that fallback is silent. It put an English FAQ on the Spanish Tyrian
        // page, an English download box on all twelve localised pages, and
        // English related-card copy everywhere — roughly half the visible text
        // on the Japanese and Chinese pages. Every prose field the English
        // entry fills has to be answered here or the page is bilingual.
        const en = pages.find((q) => q.slug === slug);
        if (en) {
          const PROSE = ["title", "description", "keywords", "ogTitle", "ogDescription",
            "crumb", "h1", "verdict", "intro", "sections", "faq", "download",
            "licenseNote", "licenseReason", "fullyFree"];
          const missing = PROSE.filter((k) => en[k] !== undefined && en[k] !== "" && e[k] === undefined);
          // mobileControls carries key codes, but its `hint` is a sentence; the
          // translation restates just that, as `mobileHint`.
          if (en.mobileControls && en.mobileControls.hint && !e.mobileHint) missing.push("mobileHint");
          if (missing.length) {
            warn(`i18n ${code}/${slug}: falls back to English for ${missing.join(", ")}`);
          }
        }
      }
    }
  }
}

// ── 12. Related cards point at the page they describe ──────────────────────
// Twelve cards had an href left pointing at the page they sat on while the
// title named a different game — "Freedoom" on the Wolfenstein page linking
// back to Wolfenstein. A self-link passes every link check ever written: the
// target resolves, it is just the wrong target. On a site whose whole SEO
// problem is that Google has recorded ten internal links, a card that spends
// its link on itself is the most expensive kind of typo.
{
  const bySlug = Object.fromEntries(pages.map((p) => [p.slug, p]));
  // A card may deliberately mark the current page — "(you're here)".
  const MARKS_SELF = /\(you're here\)|\(this page\)|this page|you're here/i;
  for (const p of pages) {
    const seen = new Map();
    for (const r of p.related || []) {
      if (r.href === `/run/${p.slug}/` && !MARKS_SELF.test(`${r.title} ${r.desc}`)) {
        warn(`related: ${p.slug} card "${r.title}" links to itself`);
      }
      // A card whose title names another catalogue entry should link there.
      // Several entries share an appName — "Notepad" is both /run/notepad/ and
      // the Notepad++ guide, "Hearts" is the guide and the playable -open build
      // — so this collects every page that could answer to the title and only
      // complains when the href matches none of them.
      const target = bySlug[String(r.href).replace(/^\/run\/|\/$/g, "")];
      // "+" survives normalisation on purpose: strip it and Notepad++ collides
      // with Notepad, and every card titled "Notepad" gets reported.
      const norm = (v) => String(v).toLowerCase().replace(/[^a-z0-9+]/g, "");
      const named = pages.filter(
        (q) => q.appName && q.slug !== p.slug && norm(r.title) === norm(q.appName)
      );
      // A title matching the target's own slug settles it — /run/notepad/ is
      // titled "Notepad & utilities" but a card calling it "Notepad" is right.
      const titlesTarget = target && norm(r.title) === norm(target.slug);
      if (named.length && target && !titlesTarget && !named.some((q) => q.slug === target.slug)) {
        warn(`related: ${p.slug} card "${r.title}" points at /run/${target.slug}/`);
      }
      const key = `${r.href}`;
      if (seen.has(key)) warn(`related: ${p.slug} links ${r.href} twice ("${seen.get(key)}" and "${r.title}")`);
      else seen.set(key, r.title);
    }
  }
}

// ── 13. Plain-text fields don't carry pre-escaped entities ─────────────────
// These fields go through esc() on render, so an entity written into the data
// is escaped a second time and reaches the page as a literal "&amp;". It was
// live on freedoom's og:title, which social cards and search results show
// verbatim. Fields that legitimately hold HTML — intro, sections[].html,
// download.html, licenseNote — are inserted raw and are not checked.
{
  const ENT = /&(?:amp|lt|gt|quot|#39|apos);/;
  const PLAIN = ["title", "description", "keywords", "ogTitle", "ogDescription",
    "crumb", "h1", "appName", "author", "fullyFree", "licenseReason", "mobileHint"];
  const scan = (obj, label) => {
    const hit = (v, path) => {
      if (typeof v === "string" && ENT.test(v)) warn(`escaping: ${label} ${path} has a pre-escaped entity — store the raw character`);
    };
    for (const f of PLAIN) hit(obj[f], f);
    (obj.sections || []).forEach((x, i) => hit(x.h, `sections[${i}].h`));
    (obj.faq || []).forEach((x, i) => { hit(x.q, `faq[${i}].q`); hit(x.a, `faq[${i}].a`); });
    if (obj.download) hit(obj.download.heading, "download.heading");
    (obj.related || []).forEach((r, i) => { hit(r.title, `related[${i}].title`); hit(r.desc, `related[${i}].desc`); });
    if (obj.verdict) hit(obj.verdict.text, "verdict.text");
    if (obj.mobileControls) hit(obj.mobileControls.hint, "mobileControls.hint");
  };
  for (const p of pages) scan(p, p.slug);
  // The hand-maintained pages have no data entry to scan, so catch the symptom
  // in the built HTML too: three -open pages had "All games &amp;amp; apps"
  // typed straight into the file.
  for (const { abs, label } of linkedPages) {
    const html = readFileSync(abs, "utf8");
    if (/&amp;(?:amp|lt|gt|quot);/.test(html)) warn(`escaping: ${label} renders a double-escaped entity`);
  }
  for (const code of ["es", "pt-BR", "de", "ja", "fr", "zh-CN"]) {
    const f = resolve(process.cwd(), "scripts", "i18n", `pages.${code}.json`);
    if (!existsSync(f)) continue;
    const d = JSON.parse(readFileSync(f, "utf8"));
    for (const [slug, e] of Object.entries(d)) {
      if (slug.startsWith("_") || typeof e !== "object") continue;
      scan(e, `${code}/${slug}`);
    }
  }
}

// ── 14. No heading appears twice on the same page ──────────────────────────
// Rule 12's sibling. Freedoom carried two sections both headed "How it works
// & what to expect" saying contradictory things, and they weren't adjacent, so
// nothing caught them. Reads the built HTML rather than the data, which also
// covers headings the generator itself emits.
{
  for (const { abs, label } of linkedPages) {
    const body = readFileSync(abs, "utf8").split("<main")[1];
    if (!body) continue;
    const hs = [...body.split("</main>")[0].matchAll(/<h([23])[^>]*>([\s\S]*?)<\/h\1>/g)]
      .map((m) => m[2].replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim())
      .filter(Boolean);
    const seen = new Set();
    for (const h of hs) {
      if (seen.has(h)) { warn(`headings: ${label} repeats "${h.slice(0, 50)}"`); break; }
      seen.add(h);
    }
  }
}

// ── report ────────────────────────────────────────────────────────────────
if (problems.length === 0) {
  console.log(`✓ consistency: ${pages.length} pages, ${pages.filter(isPlayable).length} playable — no issues`);
  process.exit(0);
}
console.error(`✗ consistency: ${problems.length} issue(s)`);
for (const p of problems) console.error("  - " + p);
process.exit(1);
