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

const pages = JSON.parse(readFileSync(resolve(process.cwd(), "scripts", "app-pages.json"), "utf8"));
const INDEX = resolve(process.cwd(), "public", "index.html");

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const isPlayable = (p) => !!(p.appUrl || p.iframeUrl);
const shotFile = (p) => (p.screenshot ? (typeof p.screenshot === "string" ? p.screenshot : "screenshot.png") : null);
const isNew = (p) => p.addedDate && (Date.now() - Date.parse(p.addedDate + "T00:00:00Z")) / 86400000 < 14;

// Titles with real art first, then newest — the grid should read as a shelf.
const playable = pages.filter(isPlayable).sort((a, b) => {
  const s = (shotFile(b) ? 1 : 0) - (shotFile(a) ? 1 : 0);
  if (s) return s;
  return (isNew(b) ? 1 : 0) - (isNew(a) ? 1 : 0);
});

const card = (p) => {
  const shot = shotFile(p);
  const art = shot
    ? `<img class="pc-shot" src="/run/${p.slug}/${shot}" width="320" height="240" loading="lazy" alt="${esc(p.appName)} running in the browser" />`
    : `<span class="pc-shot pc-placeholder" aria-hidden="true">${esc((p.appName || "?").trim().charAt(0))}</span>`;
  const cats = (p.categories || []).concat(p.fullyFree ? ["Free & complete"] : []).join("|");
  const hay = [p.appName, p.author, ...(p.genre || []), ...(p.categories || []),
    p.fullyFree ? "free complete open source freeware" : ""].filter(Boolean).join(" ").toLowerCase();
  return `        <li class="pc-item" data-cats="${esc(cats)}" data-search="${esc(hay)}"><a class="poster-card" href="/run/${p.slug}/">
          ${art}
          <span class="pc-body"><span class="pc-title">${esc(p.appName)}${isNew(p) ? ` <span class="badge-new">NEW</span>` : ""}${p.fullyFree ? ` <span class="badge-free" title="Free and complete — no shareware episode, nothing held back">FREE</span>` : ""}</span><span class="pc-play">▶ Play free</span></span>
        </a></li>`;
};

const counts = new Map();
for (const p of playable) {
  for (const c of p.categories || []) counts.set(c, (counts.get(c) || 0) + 1);
  if (p.fullyFree) counts.set("Free & complete", (counts.get("Free & complete") || 0) + 1);
}
const ORDER = ["Free & complete", "Shooters", "Platformers", "Action", "Puzzle & strategy", "Racing & sports", "Pinball", "Apps & tools"];
const chips = ORDER.filter((c) => counts.has(c))
  .map((c) => `<button type="button" class="chip" data-cat="${esc(c)}">${esc(c)} <span class="chip-n">${counts.get(c)}</span></button>`)
  .join("\n        ");

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
    </div>`;

let html = readFileSync(INDEX, "utf8");

// Replace the filter block, then the grid that follows the continue-playing one.
const fStart = html.indexOf('<div class="grid-filter"');
if (fStart === -1) throw new Error("homepage: grid-filter block not found");
const fEnd = html.indexOf("</div>", html.indexOf("gf-empty", fStart)) + "</div>".length;
html = html.slice(0, fStart) + filter.trim() + html.slice(fEnd);

const gStart = html.indexOf('<ul class="poster-grid">\n', html.indexOf('id="continue-grid"'));
if (gStart === -1) throw new Error("homepage: play-now poster grid not found");
const gEnd = html.indexOf("</ul>", gStart);
html = html.slice(0, gStart) + '<ul class="poster-grid">\n' + playable.map(card).join("\n") + "\n    " + html.slice(gEnd);

writeFileSync(INDEX, html, "utf8");
console.log(`wrote homepage grid: ${playable.length} titles, ${counts.size} categories`);
