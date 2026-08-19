#!/usr/bin/env node
// Stamps head/nav links onto the pages the generators can't reach.
//
//   node scripts/inject-page-links.mjs
//
// ── Why this exists ────────────────────────────────────────────────────────
// Roughly a third of the site's HTML is hand-maintained: public/index.html, the
// blog, /guide/ /about/ /privacy/ /terms/ /saves/, and the eighteen catalogue
// entries flagged `skipGenerate` (Space Cadet, Solitaire, Micropolis, OpenTTD
// and every -open title). Those eighteen include most of the best-known games
// on the site. Anything that has to appear on *every* page — the feed link, the
// homepage's hreflang — therefore cannot come from render() alone.
//
// This writes into generated files, which the rest of the build treats as
// forbidden. It is deliberate and it is why the script must run LAST, after
// both generators; run it earlier and gen-app-pages.mjs simply overwrites its
// work. Every insertion is guarded by a presence check, so running it twice is
// a no-op rather than a duplicate.

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { hreflangHtml, langSwitcherHtml, LOCALES } from "./i18n/locales.mjs";

const ROOT = resolve(process.cwd(), "public");

// Runtime payload trees — machine-generated assets, not pages.
const SKIP_DIRS = new Set(["64", "boxedwine", "apps", "dosbox", "dosbox-snap", "data"]);

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

const FEED_LINK =
  `<link rel="alternate" type="application/rss+xml" title="ExeBrowser — new games and posts" href="/feed.xml" />`;
// Present in every page's head, generated or not, and the last <link> before
// the stylesheet — a stable anchor that doesn't depend on which template built
// the page.
const FAVICON_ANCHOR = `<link rel="alternate icon" href="/favicon.ico" />`;

// The playable entries whose page HTML is hand-maintained (skipGenerate in
// app-pages.json). Kept as a literal list rather than re-reading the catalogue,
// so adding a game cannot silently change which pages get rewritten here.
const PLAY_TRACKED = new Set([
  "space-cadet-open", "solitaire-open", "minesweeper-open", "freecell-open",
  "spider-open", "jezzball-open", "hearts-open", "rodents-open",
  "blockdrop-open", "snake-open", "pipes-open", "beneath-a-steel-sky",
  "lure-of-the-temptress", "soltys", "flight-of-the-amazon-queen",
  "openttd", "micropolis",
]);
const PLAY_SCRIPT = '<script src="/play-events.js?v=1"></script>';

let playAdded = 0;
let feedAdded = 0;
let feedSkipped = 0;
let hreflangAdded = 0;
const missingAnchor = [];

for (const { abs, label } of htmlFiles(ROOT)) {
  let html = readFileSync(abs, "utf8");
  const before = html;

  // ── 1. Feed discovery link ───────────────────────────────────────────────
  if (html.includes("application/rss+xml")) {
    feedSkipped++;
  } else if (html.includes(FAVICON_ANCHOR)) {
    html = html.replace(FAVICON_ANCHOR, `${FAVICON_ANCHOR}\n${FEED_LINK}`);
    feedAdded++;
  } else {
    missingAnchor.push(label);
  }

  // ── 2. hreflang + language switcher on the English homepage ──────────────
  // The localised homepages have pointed at "/" since they were built, but "/"
  // never pointed back, so the alternates were one-way and Google discards
  // those. This is the reciprocal half.
  if (label === "index.html" && !html.includes('rel="alternate" hreflang=')) {
    const canonical = `<link rel="canonical" href="https://exebrowser.com/" />`;
    if (html.includes(canonical)) {
      html = html.replace(canonical, canonical + hreflangHtml("/", null));
      hreflangAdded++;
    } else {
      missingAnchor.push(`${label} (canonical anchor for hreflang)`);
    }
    const navEnd = `    <a href="/contact/">Contact</a>\n  </nav>`;
    if (html.includes(navEnd)) {
      html = html.replace(navEnd, navEnd + langSwitcherHtml(LOCALES.en, "/", null));
    }
  }

  // ── 3. Play analytics on the hand-maintained game pages ─────────────────
  // dos-embed.js and embed.js instrument every generated /run/ page. The
  // playable pages flagged skipGenerate go through neither, so they were
  // emitting no play_click, boot_success or playtime_heartbeat at all. That is
  // 17 of 43 playable titles, which made the activation funnel blind to about
  // 40% of the catalogue.
  if (PLAY_TRACKED.has(label.replace(/^run\//, "").replace(/\/index\.html$/, ""))
      && !html.includes("/play-events.js")) {
    if (html.includes("</body>")) {
      html = html.replace("</body>", `${PLAY_SCRIPT}\n</body>`);
      playAdded++;
    } else {
      missingAnchor.push(`${label} (no </body> for play-events.js)`);
    }
  }

  if (html !== before) writeFileSync(abs, html, "utf8");
}

console.log(
  `injected: feed link into ${feedAdded} page(s) (${feedSkipped} already had it), ` +
  `hreflang into ${hreflangAdded} page(s), play-events into ${playAdded} page(s)`
);
if (missingAnchor.length) {
  // Not fatal — a page without the favicon line is almost certainly not a real
  // content page — but say so, because a silently skipped page is how the
  // "every page has X" claim quietly stops being true.
  console.warn(`  no anchor found in ${missingAnchor.length}: ${missingAnchor.join(", ")}`);
}
