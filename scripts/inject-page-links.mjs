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
// `embed` is excluded deliberately: those pages are bare iframe wrappers with
// no site chrome, so none of the head/nav injections below apply to them.
const SKIP_DIRS = new Set(["64", "boxedwine", "apps", "dosbox", "dosbox-snap", "data"]);

function htmlFiles(dir, rel = "") {
  const out = [];
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) {
      if (rel === "" && SKIP_DIRS.has(name)) continue;
      // /embed/ holds one real page plus a wrapper per game. Recurse one level
      // so index.html is seen, and drop the wrappers below it.
      if (rel === "" && name === "embed") {
        out.push(...htmlFiles(abs, "embed").filter((f) => f.label === "embed/index.html"));
        continue;
      }
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

// Title/description for the playable pages the generator does not own, keyed by
// slug. Read from the catalogue so these pages cannot drift from it again.
const CATALOGUE = JSON.parse(
  readFileSync(resolve(process.cwd(), "scripts", "app-pages.json"), "utf8")
);
// Deliberately NOT gated on appUrl/iframeUrl. That gate meant a page had to be
// currently playable before its own title could be corrected from the
// catalogue, which quietly excluded /run/dragon-keep/ — offline, so no appUrl —
// and left it the last page on the site still carrying the old over-length
// title after the 1 Sep 2026 sweep. Whether a page is playable today has
// nothing to do with whether its <title> should match the source of truth.
const HAND_MAINTAINED = new Map(
  CATALOGUE.filter((p) => p.skipGenerate && p.title && p.description)
    .map((p) => [p.slug, p])
);
const esc = (v) =>
  String(v).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const metaSynced = new Set();

// Games written from scratch here, and therefore ours to let other people host.
const OWN_WORK = /ExeBrowser \(original implementation\)/i;
const EMBEDDABLE = new Map(
  CATALOGUE.filter((p) => OWN_WORK.test(p.author || "") && p.appUrl).map((p) => [p.slug, p])
);
let unblockedAdded = 0;
let embedFooterAdded = 0;
let embedAdded = 0;
let ogAdded = 0;

let playAdded = 0;
let feedAdded = 0;
let feedSkipped = 0;
let hreflangAdded = 0;
const missingAnchor = [];

// The /unblocked/ hub answers the highest-converting query shape the site has
// on record — "<game> unblocked" outperforms the bare game name several times
// over — and it is exactly the page a locked-down-network visitor wants next.
// The generator adds a card for it to every playable page it owns; these
// seventeen it does not own, and they include the four most-played titles.
const UNBLOCKED_CARD =
  `      <li><a class="link-card" href="/unblocked/"><span class="lc-title">Games that need nothing installed</span><span class="lc-desc">The full list of titles that run on a locked-down school or work network.</span></a></li>`;

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
  // Re-stamp rather than skip-if-present: this block used to bail whenever any
  // hreflang existed, so adding a language left the homepage advertising the
  // old set forever. check-consistency's reciprocity rule caught it the moment
  // ja/fr/zh-CN were registered.
  if (label === "index.html") {
    html = html.replace(/\n<link rel="alternate" hreflang="[^"]*" href="[^"]*" \/>/g, "");
    html = html.replace(/\n  <nav class="lang-switcher"[\s\S]*?<\/nav>/, "");
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

  // ── 3b. The /unblocked/ card on the hand-maintained playable pages ──────
  if (PLAY_TRACKED.has(label.replace(/^run\//, "").replace(/\/index\.html$/, ""))
      && !html.includes('href="/unblocked/"')) {
    const last = html.lastIndexOf("    </ul>");
    if (last !== -1) {
      html = html.slice(0, last) + UNBLOCKED_CARD + "\n" + html.slice(last);
      unblockedAdded++;
    } else {
      missingAnchor.push(`${label} (no card grid for the /unblocked/ link)`);
    }
  }

  // ── 3c. The /embed/ link in the footer of the English pages ─────────────
  // A footer link on every English page is what makes the hub reachable by a
  // crawler rather than a URL the sitemap merely asserts. Localised pages are
  // left alone: the offer is English-only, and their footers are generated.
  if (!/^(es|pt-BR|de|ja|fr|zh-CN)\//.test(label) && html.includes('<a href="/saves/">Saved games</a>')
      && !html.includes('href="/embed/"')) {
    html = html.replace('<a href="/saves/">Saved games</a>',
      '<a href="/saves/">Saved games</a>\n    <a href="/embed/">Embed our games</a>');
    embedFooterAdded++;
  }

  // ── 4. SYNC METADATA onto the hand-maintained game pages ────────────────
  // app-pages.json is meant to be the single source of truth, but skipGenerate
  // pages never pass through render(), so editing a title or description there
  // silently changed nothing on 16 of 43 playable pages. Found the hard way
  // while fixing 23 meta descriptions that were truncating in the SERP: only
  // 7 of them reached an actual page.
  const slug = label.replace(/^run\//, "").replace(/\/index\.html$/, "");
  const entry = HAND_MAINTAINED.get(slug);
  if (entry) {
    const t = esc(entry.title);
    const dsc = esc(entry.description);
    const newTitle = `<title>${t}</title>`;
    if (!html.includes(newTitle)) {
      html = html.replace(/<title>[\s\S]*?<\/title>/, newTitle);
      metaSynced.add(slug);
    }
    const newDesc = `<meta name="description" content="${dsc}" />`;
    if (!html.includes(newDesc)) {
      html = html.replace(/<meta name="description" content="[^"]*"\s*\/?>/, newDesc);
      metaSynced.add(slug);
    }
  }

  // ── 5. EMBED OFFER on the games we wrote ourselves ──────────────────────
  // Only original work is offered for embedding — see gen-embeds.mjs for why
  // that boundary is a licensing one, not a preference.
  if (EMBEDDABLE.has(slug) && !html.includes('id="embed-offer"')) {
    const p = EMBEDDABLE.get(slug);
    const offer = `
  <section class="card" id="embed-offer" data-slug="${slug}" data-name="${esc(p.appName)}">
    <h2>Put ${esc(p.appName)} on your own site</h2>
    <p>This one is ours — written from scratch, not emulated — so you are welcome to
    embed it anywhere, free, with no permission needed. Paste this where you want it:</p>
    <textarea readonly rows="4" spellcheck="false" aria-label="Embed code for ${esc(p.appName)}"></textarea>
    <p><button type="button" class="cta-btn">Copy embed code</button></p>
    <p class="muted small">Keeping the credit line is the only thing we ask. Games we
    host but did not write are not offered for embedding, because those are not ours
    to hand on.</p>
  </section>
  <script src="/embed-snippet.js?v=1"></script>`;
    if (html.includes("</main>")) {
      html = html.replace("</main>", offer + "\n</main>");
      embedAdded++;
    }
  }

  // ── 6. OG:IMAGE FALLBACK ────────────────────────────────────────────────
  // Three hand-maintained pages (the ScummVM adventures) shipped with no
  // og:image at all, so every share of them rendered a blank card. The
  // generated template always emits one; these never went through it. Use the
  // page's own screenshot when it has one, the site image when it does not.
  if (html.includes("<meta property=\"og:url\"") && !html.includes("og:image")) {
    const shot = existsSync(join(ROOT, "run", slug, "screenshot.png"))
      ? `https://exebrowser.com/run/${slug}/screenshot.png`
      : "https://exebrowser.com/og.png";
    html = html.replace(
      /(<meta property="og:description"[^>]*\/>)/,
      `$1\n<meta property="og:image" content="${shot}" />`
    );
    if (!html.includes("twitter:card")) {
      html = html.replace(
        /(<meta property="og:image"[^>]*\/>)/,
        `$1\n<meta name="twitter:card" content="summary_large_image" />`
      );
    }
    ogAdded++;
  }

  if (html !== before) writeFileSync(abs, html, "utf8");
}

console.log(
  `injected: feed link into ${feedAdded} page(s) (${feedSkipped} already had it), ` +
  `hreflang into ${hreflangAdded} page(s), /unblocked/ card onto ${unblockedAdded} page(s), /embed/ footer link onto ${embedFooterAdded} page(s), play-events into ${playAdded} page(s), ` +
  `metadata synced onto ${metaSynced.size} hand-maintained page(s), ` +
  `embed offer on ${embedAdded} page(s), og:image onto ${ogAdded} page(s)`
);
if (missingAnchor.length) {
  // Not fatal — a page without the favicon line is almost certainly not a real
  // content page — but say so, because a silently skipped page is how the
  // "every page has X" claim quietly stops being true.
  console.warn(`  no anchor found in ${missingAnchor.length}: ${missingAnchor.join(", ")}`);
}
