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
import { STATIC_PATHS } from "./i18n/static-pages.mjs";
import { embedTier, isEmbeddable } from "./catalogue.mjs";

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
const PLAY_SCRIPT = '<script src="/play-events.js?v=2"></script>';

// Installability has to reach every page, not just the generated ones: the
// browser only offers to install a site from a page that links a manifest, and
// the hand-maintained pages include most of the best-known titles — exactly
// the pages a returning player lands on.
const MANIFEST_LINKS =
  `<link rel="manifest" href="/manifest.webmanifest" />\n` +
  `    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />\n` +
  `    <meta name="theme-color" content="#0e0d0b" />`;
const PWA_SCRIPT = '<script src="/pwa.js?v=2"></script>';

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

// What we hold the rights to let other people host. The rule lives in
// catalogue.mjs so this file, gen-embeds.mjs and gen-embed-hub.mjs cannot drift
// apart on a licensing question.
const EMBEDDABLE = new Map(CATALOGUE.filter(isEmbeddable).map((p) => [p.slug, p]));
// Every catalogue entry by slug, so the pointer below can name the game the
// visitor is actually looking at rather than talking about "this game".
const APP_NAMES = new Map(CATALOGUE.map((p) => [p.slug, p.appName]));
let unblockedAdded = 0;
let embedFooterAdded = 0;
let inspectorFooterAdded = 0;
let dosFooterAdded = 0;
let embedAdded = 0;
let embedPointerAdded = 0;
let ogAdded = 0;

let playAdded = 0;
let feedAdded = 0;
let manifestAdded = 0;
let pwaAdded = 0;
let feedSkipped = 0;
let hreflangAdded = 0;
// English pages that get a reciprocal hreflang block: label on disk → the path
// it lives at. The homepage plus every hand-maintained page the localisation
// pipeline can build, so the two never drift apart.
const HREFLANG_PAGES = Object.fromEntries([
  ["index.html", "/"],
  ...STATIC_PATHS.map((path) => [path.replace(/^\//, "") + "index.html", path]),
]);

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

  // ── 1b. Manifest + install script ────────────────────────────────────────
  // Both are guarded on presence, so a page the generators already stamped is
  // left alone and running this twice is a no-op.
  if (!html.includes('rel="manifest"') && html.includes(FAVICON_ANCHOR)) {
    html = html.replace(FAVICON_ANCHOR, `${FAVICON_ANCHOR}\n    ${MANIFEST_LINKS}`);
    manifestAdded++;
  }
  if (!html.includes("/pwa.js") && html.includes("</body>")) {
    html = html.replace("</body>", `${PWA_SCRIPT}\n</body>`);
    pwaAdded++;
  }

  // ── 2. hreflang + language switcher on the English homepage ──────────────
  // The localised homepages have pointed at "/" since they were built, but "/"
  // never pointed back, so the alternates were one-way and Google discards
  // those. This is the reciprocal half.
  // Re-stamp rather than skip-if-present: this block used to bail whenever any
  // hreflang existed, so adding a language left the homepage advertising the
  // old set forever. check-consistency's reciprocity rule caught it the moment
  // ja/fr/zh-CN were registered.
  // It is no longer only the homepage. The utility pages are hand-written too,
  // and gen-static-pages.mjs now builds localised copies of them, so each one
  // needs the same reciprocal stamp — and each has a DIFFERENT canonical, which
  // is why the old hardcoded "/" had to become a lookup.
  //
  // hreflangHtml decides the language set per path, so a page with no
  // translations yet emits nothing rather than advertising six 404s.
  const hreflangPath = HREFLANG_PAGES[label];
  if (hreflangPath) {
    html = html.replace(/\n<link rel="alternate" hreflang="[^"]*" href="[^"]*" \/>/g, "");
    html = html.replace(/\n  <nav class="lang-switcher"[\s\S]*?<\/nav>/, "");
    const canonical = `<link rel="canonical" href="https://exebrowser.com${hreflangPath}" />`;
    if (html.includes(canonical)) {
      // "/" is a site-level URL; everything else in this map is a page the
      // static pipeline owns, and must be scoped to what it has actually built.
      const scope = hreflangPath === "/" ? undefined : "static";
      html = html.replace(canonical, canonical + hreflangHtml(hreflangPath, null, scope));
      hreflangAdded++;
    } else {
      missingAnchor.push(`${label} (canonical anchor for hreflang)`);
    }
    const navEnd = `    <a href="/contact/">Contact</a>\n  </nav>`;
    if (html.includes(navEnd)) {
      html = html.replace(navEnd, navEnd + langSwitcherHtml(LOCALES.en, hreflangPath, null, hreflangPath === "/" ? undefined : "static"));
    } else {
      // Worth reporting: the switcher failing silently is how a localised page
      // ends up unreachable from the English one it was translated from.
      missingAnchor.push(`${label} (nav anchor for the language switcher)`);
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

  // ── 3d. The EXE viewer in both navs of the English pages ───────────────
  // This one goes in the primary nav, not only the footer. Reading an .exe and
  // running one are two halves of the same question and the site now answers
  // both, so burying the second half in a footer would misdescribe the product.
  // The eighth nav item is affordable *here* because this script owns it: the
  // alternative was hand-editing the six nav templates plus ~35 pages, which is
  // what made it not worth doing before.
  //
  // Both navs carry the identical "App guides" then "Blog" pair, so this
  // replaces every occurrence rather than the first — a plain .replace() would
  // have silently updated the header and left the footer behind.
  // Idempotence comes from the pair itself: once injected, "App guides" is no
  // longer directly followed by "Blog", so a second run finds nothing. Guarding
  // on href="/exe-inspector/" instead would have stopped after the header and
  // left every footer without the link.
  if (!/^(es|pt-BR|de|ja|fr|zh-CN)\//.test(label)) {
    const pair = '<a href="/run/">App guides</a>\n    <a href="/blog/">Blog</a>';
    if (html.includes(pair)) {
      html = html.split(pair).join('<a href="/run/">App guides</a>\n    <a href="/exe-inspector/">EXE viewer</a>\n    <a href="/blog/">Blog</a>');
      inspectorFooterAdded++;
    }
  }

  // ── 3e. The DOS emulator in the footer of the English pages ────────────
  // Footer only: the primary nav is already eight items. Anchored on the
  // "Saved games" link, which appears in the footer and nowhere else, and
  // guarded on the href so a second run adds nothing.
  if (!/^(es|pt-BR|de|ja|fr|zh-CN)\//.test(label) && !html.includes('href="/dos-emulator/">DOS emulator</a>')) {
    const anchor = '<a href="/saves/">Saved games</a>';
    if (html.includes(anchor)) {
      html = html.replace(anchor, '<a href="/dos-emulator/">DOS emulator</a>\n    ' + anchor);
      dosFooterAdded++;
    }
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
    // Two different reasons a game can be on offer, and the copy has to say
    // which. "Written from scratch, not emulated" is true of the eleven and
    // false of Space Cadet, whose engine is k4zmu2a's.
    const why = embedTier(p) === "own"
      ? `This one is ours — written from scratch, not emulated — so you are welcome to
    embed it anywhere, free, with no permission needed.`
      : `This one you can embed because the Microsoft problem was solved rather than
    ignored: the engine is <a href="https://github.com/k4zmu2a/SpaceCadetPinball"
    target="_blank" rel="noopener">MIT-licensed</a> and the game data was rebuilt from
    scratch here and <a href="https://github.com/andrewnakas/open-cadet" target="_blank"
    rel="noopener">dedicated to the public domain</a>, so no Windows files are involved
    and no permission is needed. It is a full WebAssembly pinball engine, so the frame
    is a few megabytes — keep it lazy-loaded and below the fold.`;
    const offer = `
  <section class="card" id="embed-offer" data-slug="${slug}" data-name="${esc(p.appName)}">
    <h2>Put ${esc(p.appName)} on your own site</h2>
    <p>${why} Paste this where you want it:</p>
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

  // ── 5b. EMBED POINTER on the games that are NOT ours to hand on ─────────
  // The embed offer is the one acquisition mechanism whose arithmetic reaches
  // the traffic goal, and it was only ever shown on the eleven pages we are
  // licensed to offer. Those eleven earn about 120 of the site's 47,900 monthly
  // Bing impressions — 0.25%. /run/doom/ alone earns 37,600 and had no mention
  // of the offer anywhere above the footer. `embed_copy` firing twice a week
  // was never a demand signal; 99.75% of the audience was never shown the offer.
  //
  // So the high-traffic pages get a pointer, not an offer: they say plainly
  // that THIS game is not ours to give away, and send the visitor to the ones
  // that are. The distinction matters — implying DOOM is embeddable would be
  // handing out a right we do not have.
  const notLocalised = !/^(es|pt-BR|de|ja|fr|zh-CN)\//.test(label);
  // The homepage, the loader and the guide as well as the game pages. The
  // loader's audience is the most webmaster-shaped traffic the site has —
  // someone running their own .exe in a browser tab is disproportionately
  // likely to run a site — and the homepage's last section is the open-source
  // licensing list, which is the right neighbour for a giveaway offer.
  const EXTRA_POINTER_PAGES = new Set(["index.html", "load-exe/index.html", "guide/index.html", "exe-inspector/index.html"]);
  const onGamePage = label.startsWith("run/") && !EMBEDDABLE.has(slug) && APP_NAMES.has(slug);
  const onExtraPage = EXTRA_POINTER_PAGES.has(label);
  if ((onGamePage || onExtraPage) && notLocalised
      && !html.includes('id="embed-pointer"') && html.includes("</main>")) {
    // On a game page, name the game and say why it is not on offer; elsewhere
    // there is no specific title to disclaim, so lead with the offer itself.
    // "We didn't write it" is true of DOOM and almost everything else here, and
    // it is the line that makes the pointer land. It is NOT true of the two
    // pinball builds: Dragon's Keep is our own CC0 artwork and Space Cadet runs
    // on Open Cadet's CC0 replacement data, both on k4zmu2a's MIT engine. Those
    // pages say "CC0 artwork" in their own copy, so the disclaimer would
    // contradict the page it sits on. They get the neutral lead instead — it
    // claims nothing about the current game and is true everywhere.
    const ours = /ExeBrowser original|CC0|open source port/i.test(
      (CATALOGUE.find((c) => c.slug === slug) || {}).author || ""
    );
    const lead = onGamePage && !ours
      ? `<h2>Want a game like this on your own site?</h2>
    <p>${esc(APP_NAMES.get(slug))} isn't ours to give away — we host it, we didn't write
    it. But eleven of the games here we did write from scratch, and those are free for
    anyone to put on their own page:`
      : `<h2>Put one of these games on your own site</h2>
    <p>Eleven of the games here were written from scratch for this site, which makes them
    ours to give away — and we do. Free for anyone to put on their own page:`;
    const pointer = `
  <section class="card" id="embed-pointer">
    ${lead} one line of HTML, no account, no permission, no attribution
    beyond a credit line.</p>
    <p><a class="cta-btn" href="/embed/" id="embed-pointer-cta">See the games you can embed</a></p>
  </section>
  <script src="/embed-pointer.js?v=1"></script>`;
    html = html.replace("</main>", pointer + "\n</main>");
    embedPointerAdded++;
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
  `manifest into ${manifestAdded}, pwa.js into ${pwaAdded}, ` +
  `hreflang into ${hreflangAdded} page(s), /unblocked/ card onto ${unblockedAdded} page(s), /embed/ footer link onto ${embedFooterAdded} page(s), EXE viewer footer link onto ${inspectorFooterAdded} page(s), DOS emulator footer link onto ${dosFooterAdded} page(s), play-events into ${playAdded} page(s), ` +
  `metadata synced onto ${metaSynced.size} hand-maintained page(s), ` +
  `embed offer on ${embedAdded} page(s), embed pointer on ${embedPointerAdded} page(s), og:image onto ${ogAdded} page(s)`
);
if (missingAnchor.length) {
  // Not fatal — a page without the favicon line is almost certainly not a real
  // content page — but say so, because a silently skipped page is how the
  // "every page has X" claim quietly stops being true.
  console.warn(`  no anchor found in ${missingAnchor.length}: ${missingAnchor.join(", ")}`);
}
