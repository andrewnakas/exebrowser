#!/usr/bin/env node
// Rewrites the homepage's "Play now" filter + poster grid in place from
// app-pages.json, so the hand-maintained public/index.html stays in step with
// the generated hub instead of drifting.
//
//   node scripts/gen-home-grid.mjs
//
// Lives in the repo (not a scratch dir) because it's needed every time a game
// is added — same reason gen-app-pages.mjs does.

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { categoryChips, categoryCounts, esc, itemListLd, posterCard, sortPlayable, SITE } from "./catalogue.mjs";
import { blogPosts } from "./blog-meta.mjs";

const pages = JSON.parse(readFileSync(resolve(process.cwd(), "scripts", "app-pages.json"), "utf8"));
const ROOT = resolve(process.cwd(), "public");
const INDEX = resolve(ROOT, "index.html");

// Replace the contents of a <!-- gen:name --> … <!-- /gen:name --> pair.
//
// The regions used to be located by searching for '<div class="grid-filter"'
// and then for the next '</div>' after "gf-empty" — which quietly depended on
// the block never containing a nested <div>. Adding one line with a wrapper
// element to that block would have truncated the rest of the page, silently,
// on the next build. Sentinels make the boundaries explicit and a missing one
// a loud failure instead of a corrupt homepage.
function replaceRegion(html, name, body) {
  const open = `<!-- gen:${name} -->`;
  const close = `<!-- /gen:${name} -->`;
  const start = html.indexOf(open);
  const end = html.indexOf(close, start);
  if (start === -1 || end === -1) {
    throw new Error(`homepage: missing sentinel pair for "${name}" — expected ${open} … ${close}`);
  }
  return html.slice(0, start + open.length) + body + html.slice(end);
}

// Best-known titles first, then real art, then newest — the grid should read
// as a shelf, and the famous names are what a first-time visitor is looking
// for. The comparator lives in catalogue.mjs so the hub can't sort differently.
const playable = sortPlayable(pages);
const card = posterCard;

const counts = categoryCounts(playable);
const chips = categoryChips(counts);

// The chips are <button>s, which a crawler cannot follow. The categories that
// have a real page at /play/<slug>/ therefore also get a plain link. Read from
// the same JSON gen-app-pages.mjs uses, and filtered by the same member
// minimum, so the homepage can never advertise a category page that wasn't
// generated. Kept in step by check-consistency, which resolves every href.
const CATS = JSON.parse(readFileSync(resolve(process.cwd(), "scripts", "play-categories.json"), "utf8"));
const MIN_FOR_PAGE = 4;
const liveCats = (CATS.categories || []).filter((c) => {
  const n = c.match === "slugs"
    ? (c.slugs || []).filter((s) => playable.some((p) => p.slug === s)).length
    : playable.filter((p) => (p.categories || []).includes(c.name)).length;
  return n >= MIN_FOR_PAGE;
});
const browseLine = liveCats.length
  ? `      <p class="gf-browse">Browse by category: ${liveCats
      .map((c) => `<a href="/play/${c.slug}/">${esc(c.h1.replace(/,.*$/, ""))}</a>`)
      .join(" · ")}</p>\n`
  : "";

const filter = `    <div class="grid-filter" data-grid-filter>
      <label class="gf-search">
        <span class="visually-hidden">Search games</span>
        <input type="search" placeholder="Search ${playable.length} titles…" autocomplete="off" data-grid-search />
      </label>
      <div class="gf-chips">
        <button type="button" class="chip is-on" data-cat="">All <span class="chip-n">${playable.length}</span></button>
        ${chips}
      </div>
      <p class="gf-empty" hidden>No titles match — <button type="button" class="link" data-grid-reset>show everything</button>.</p>
${browseLine}    </div>`;

// The 43-title shelf is the homepage's actual subject, but structurally it was
// just an unannotated <ul>. ItemList is the schema that says "this page is a
// catalogue of these things" — and this site emitted 88 FAQPage blocks and not
// one ItemList. It lives here rather than in gen-app-pages.mjs because the
// order has to match the grid exactly, and the order is computed here.
const itemList = itemListLd(playable, {
  name: "Play classic Windows and DOS games free in your browser",
  url: `${SITE}/`,
});

// Three most recently updated posts. The homepage linked to no blog post at
// all — eight long-form articles sitting one nav click away from the only page
// Google crawls often. This is the link equity they were missing.
const posts = blogPosts(ROOT);
const strip = posts.length
  ? `
  <section class="card" id="from-the-blog">
    <h2>From the blog</h2>
    <p class="muted small" style="margin-top:0;">How the runtimes work, what actually runs, and where to get classic software legally.</p>
    <ul class="card-grid">
${posts.slice(0, 3).map((p) => `      <li><a class="link-card" href="${p.path}"><span class="lc-title">${esc(p.title)}</span><span class="lc-desc">${esc(p.description)}</span></a></li>`).join("\n")}
    </ul>
    <p class="muted small" style="margin:1rem 0 0;"><a href="/blog/">All ${posts.length} posts →</a></p>
  </section>
`
  : "";

let html = readFileSync(INDEX, "utf8");
html = replaceRegion(html, "itemlist", "\n" + itemList);
html = replaceRegion(html, "gridfilter", "\n" + filter);
html = replaceRegion(html, "postergrid", '\n    <ul class="poster-grid">\n' + playable.map(card).join("\n") + "\n    </ul>\n    ");
html = replaceRegion(html, "blogstrip", strip);

writeFileSync(INDEX, html, "utf8");
console.log(
  `wrote homepage: ${playable.length} titles, ${counts.size} categories, ` +
  `ItemList + ${Math.min(posts.length, 3)} blog cards`
);
