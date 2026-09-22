#!/usr/bin/env node
// Generates /embed/<slug>/ — a bare, embeddable build of the games we wrote
// ourselves, plus the copy-paste snippet each game page offers.
//
//   node scripts/gen-embeds.mjs
//
// ── Why this exists ────────────────────────────────────────────────────────
// The binding constraint on this site is authority: Search Console has recorded
// exactly ONE external link to the domain, which is why ~37 pages sit at
// "Discovered - currently not indexed". Google will not spend crawl budget on a
// site nothing points at. Embeds are the repeatable version of the Show HN that
// worked: an artifact living on someone else's page, carrying a link home.
//
// **An iframe is not a link.** Google does not pass authority through an
// iframe's src. All the SEO value is in the <a href> that ships alongside it in
// the snippet, so the snippet is iframe + visible attribution, and the embed
// page itself carries a corner link home for the sites that strip the caption.
//
// ── The licensing boundary, which is not negotiable ────────────────────────
// Only what we hold the rights to hand on is embeddable — see `embedTier` in
// catalogue.mjs. That is the eleven games written from scratch here, plus Space
// Cadet, which is our own CC0 art and audio on k4zmu2a's MIT-licensed engine.
// Offering a DOOM or Commander Keen embed would be purporting to grant third
// parties the right to redistribute id Software's and Apogee's shareware — a
// right we do not hold and cannot sub-license. The filter is on rights, not on
// convenience.

import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SITE, esc, embedTier, isEmbeddable } from "./catalogue.mjs";

const ROOT = resolve(process.cwd(), "public");
const pages = JSON.parse(readFileSync(resolve(process.cwd(), "scripts", "app-pages.json"), "utf8"));

// Authorship is the test. `fullyFree` is not — plenty of third-party titles are
// free to play here without being ours to hand onward. The rule lives in
// catalogue.mjs so the hub, the game pages and this file cannot drift apart,
// and it distinguishes games written from scratch here from our CC0 data on
// k4zmu2a's MIT engine — both free to hand on, but not the same claim.
const embeddable = pages.filter(isEmbeddable);

const embedHtml = (p) => `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${esc(p.appName)} — free to embed — ExeBrowser</title>
<meta name="description" content="${esc(p.appName)}, free to embed on any site. ${embedTier(p) === "own" ? "Written from scratch and hosted by ExeBrowser." : "Open-source engine and public-domain data, hosted by ExeBrowser."}" />
<!-- Embedded copies must not compete with the canonical game page in search. -->
<link rel="canonical" href="${SITE}/run/${p.slug}/" />
<meta name="robots" content="noindex, follow" />
<style>
  html, body { margin: 0; padding: 0; height: 100%; background: #111; }
  .wrap { position: relative; width: 100%; height: 100%; }
  iframe { display: block; width: 100%; height: 100%; border: 0; }
  /* Survives a host page that strips the snippet's caption: the only
     attribution some embedders will ever show. Deliberately small and out of
     the way — an embed that annoys the host gets removed, and a removed embed
     is worth nothing. */
  .by {
    position: absolute; right: 6px; bottom: 6px; z-index: 2;
    font: 11px/1 system-ui, -apple-system, "Segoe UI", sans-serif;
    background: rgba(0,0,0,.62); color: #fff; text-decoration: none;
    padding: 4px 7px; border-radius: 4px; opacity: .75;
  }
  .by:hover { opacity: 1; }
</style>
</head>
<body>
  <div class="wrap">
    <iframe src="${p.appUrl}" title="${esc(p.appName)}" loading="eager"
            allow="autoplay; fullscreen"></iframe>
    <a class="by" href="${SITE}/run/${p.slug}/?utm_source=embed&amp;utm_medium=iframe&amp;utm_campaign=${p.slug}"
       target="_blank" rel="noopener">${esc(p.appName)} — play more free games</a>
  </div>
</body>
</html>
`;

// The snippet an embedder copies. The <a> is the load-bearing part: it is the
// only element here that passes authority, and it sits OUTSIDE the iframe so a
// host page renders it as ordinary body text.
export const snippetFor = (p) =>
  `<iframe src="${SITE}/embed/${p.slug}/" width="100%" height="600" ` +
  `style="border:0;max-width:760px" title="${esc(p.appName)}" loading="lazy"></iframe>\n` +
  `<p><a href="${SITE}/run/${p.slug}/">${esc(p.appName)}</a> by ` +
  `<a href="${SITE}/">ExeBrowser</a></p>`;

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const p of embeddable) {
    const dir = resolve(ROOT, "embed", p.slug);
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, "index.html"), embedHtml(p), "utf8");
    console.log(`wrote /embed/${p.slug}/`);
  }
  console.log(`\n${embeddable.length} embeddable games (games we hold the rights to hand on).`);
}

export { embeddable };
