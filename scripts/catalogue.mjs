// Pure helpers shared by gen-app-pages.mjs and gen-home-grid.mjs.
//
// These two generators had drifted into keeping seven private copies of the
// same definitions — esc, isPlayable, the screenshot filename rule, the NEW
// window, the rank comparator, the poster card, and the filter-chip order,
// the last of which carried a "must match" comment because nothing enforced
// it. Every copy is a chance for the homepage and the hub to disagree about
// what the catalogue is. They live here now, defined once.
//
// Side-effect free on purpose: no file reads, no writes, no process.cwd().
// Import it from anywhere without wondering what it does on the way in.

export const SITE = "https://exebrowser.com";

// ── Escaping ──────────────────────────────────────────────────────────────
// HTML text/attribute escaping. Note this is NOT safe for XML — see xmlEsc.
export const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// XML escaping for sitemap.xml and feed.xml. Differs from esc() by also
// escaping the apostrophe, which matters inside single-quoted XML attributes.
// Never run esc() on XML and never run this on HTML — mixing them is how you
// get &amp;amp; in a feed reader.
export const xmlEsc = (s) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]));

// Undo HTML escaping. Needed when scraping <title>/description back out of
// generated HTML: those strings are already escaped on disk, so re-escaping
// them for XML would double-encode ("&amp;" → "&amp;amp;").
export const unesc = (s) =>
  String(s)
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&"); // last, or it would re-decode the entities above

// ── Catalogue predicates ──────────────────────────────────────────────────
// A page may only promise instant play when we actually host a payload.
// `hostable` in the JSON is informational and has lied before; this is the
// honest signal.
export const isPlayable = (p) => !!(p.appUrl || p.iframeUrl);

// A captured screenshot of the app running in-browser. `screenshot: true` uses
// the conventional /run/<slug>/screenshot.png; a string overrides the filename.
// Returns null when no screenshot is set (pages fall back to the site og.png).
export const screenshotFile = (p) =>
  p.screenshot ? (typeof p.screenshot === "string" ? p.screenshot : "screenshot.png") : null;

// A game counts as "new" for two weeks after its addedDate, which drives the
// badge on the hub and homepage. Dates are plain YYYY-MM-DD in app-pages.json.
export const NEW_DAYS = 14;
export function isNew(p) {
  if (!p.addedDate) return false;
  const added = Date.parse(p.addedDate + "T00:00:00Z");
  if (Number.isNaN(added)) return false;
  return (Date.now() - added) / 86400000 < NEW_DAYS;
}

// Hand-assigned running order (lower = earlier); the two derived keys only
// break ties among unranked titles. Ranking has to be explicit because the old
// screenshot/new-badge pair silently decayed into raw JSON order once every
// addedDate aged past the 14-day NEW window.
export const rankOf = (p) => (typeof p.rank === "number" ? p.rank : Infinity);
export const sortPlayable = (pages) =>
  pages.filter(isPlayable).sort((a, b) => {
    const r = rankOf(a) - rankOf(b);
    if (r) return r;
    const s = (screenshotFile(b) ? 1 : 0) - (screenshotFile(a) ? 1 : 0);
    if (s) return s;
    return (isNew(b) ? 1 : 0) - (isNew(a) ? 1 : 0);
  });

// ── Poster card ───────────────────────────────────────────────────────────
export const NEW_BADGE = ` <span class="badge-new">NEW</span>`;
// Titles whose engine *and* assets are freely licensed — no shareware episode,
// no bring-your-own-copy. Worth calling out: it's the difference between "try
// the first three levels" and "this is the whole game, free".
export const FREE_BADGE = ` <span class="badge-free" title="Free and complete — no shareware episode, nothing held back">FREE</span>`;

// Poster-style card for the visual grids: real screenshot when we have one,
// otherwise a lettered placeholder tile so the grid never looks broken.
export function posterCard(p) {
  const shot = screenshotFile(p);
  const art = shot
    ? `<img class="pc-shot" src="/run/${p.slug}/${shot}" width="320" height="240" loading="lazy" alt="${esc(p.appName)} running in the browser" />`
    : `<span class="pc-shot pc-placeholder" aria-hidden="true">${esc((p.appName || "?").trim().charAt(0))}</span>`;
  // Categories and a search haystack ride on the <li> so filtering is a pure
  // client-side attribute match — no data duplicated into a JS blob, and the
  // grid stays fully populated for crawlers with JS off.
  const cats = ((p.categories || []).concat(p.fullyFree ? ["Free & complete"] : [])).join("|");
  const hay = [p.appName, p.author, ...(p.genre || []), ...(p.categories || []),
    p.fullyFree ? "free complete open source freeware" : ""]
    .filter(Boolean).join(" ").toLowerCase();
  return `        <li class="pc-item" data-cats="${esc(cats)}" data-search="${esc(hay)}"><a class="poster-card" href="/run/${p.slug}/">
          ${art}
          <span class="pc-body"><span class="pc-title">${esc(p.appName)}${isNew(p) ? NEW_BADGE : ""}${p.fullyFree ? FREE_BADGE : ""}</span><span class="pc-play">▶ Play free</span></span>
        </a></li>`;
}

// ── Categories ────────────────────────────────────────────────────────────
// Display order for the filter chips, on the homepage and the /run/ hub alike.
// "Free & complete" is derived from `fullyFree`, not written in categories[].
export const CATEGORY_ORDER = [
  "Free & complete", "Windows classics", "Shooters", "Platformers", "Action",
  "Puzzle & strategy", "Racing & sports", "Pinball", "Apps & tools",
];

// Count titles per chip, including the derived "Free & complete".
export function categoryCounts(pages) {
  const counts = new Map();
  for (const p of pages) {
    for (const c of p.categories || []) counts.set(c, (counts.get(c) || 0) + 1);
    if (p.fullyFree) counts.set("Free & complete", (counts.get("Free & complete") || 0) + 1);
  }
  return counts;
}

// The chip <button>s, in CATEGORY_ORDER, skipping categories with no titles.
export function categoryChips(counts) {
  return CATEGORY_ORDER.filter((c) => counts.has(c))
    .map((c) => `<button type="button" class="chip" data-cat="${esc(c)}">${esc(c)} <span class="chip-n">${counts.get(c)}</span></button>`)
    .join("\n        ");
}

// ── Dates ─────────────────────────────────────────────────────────────────
// Newest of a set of YYYY-MM-DD strings; ignores empties. Plain string compare
// is correct for ISO dates and avoids timezone surprises.
export const maxDate = (dates) =>
  dates.filter(Boolean).map(String).sort().pop() || null;

// RFC-822 date for RSS <pubDate>, e.g. "Mon, 17 Aug 2026 00:00:00 +0000".
// Fixed English tables rather than Intl: RSS requires English day/month names
// regardless of the build machine's locale.
const RFC_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const RFC_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function toRfc822(iso) {
  const d = new Date(String(iso) + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) throw new Error(`toRfc822: unparseable date ${iso}`);
  const pad = (n) => String(n).padStart(2, "0");
  return `${RFC_DAYS[d.getUTCDay()]}, ${pad(d.getUTCDate())} ${RFC_MONTHS[d.getUTCMonth()]} ` +
    `${d.getUTCFullYear()} 00:00:00 +0000`;
}

// ── Structured data ───────────────────────────────────────────────────────
// For JSON-LD string values: strip tags, collapse whitespace, JSON-encode.
export const jsonText = (s) =>
  JSON.stringify(String(s).replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim());

// An ItemList describing a catalogue listing. URL-form ListItems rather than
// nested VideoGame objects: each game's own /run/ page already carries the full
// VideoGame schema, so repeating it here would be duplication, not detail.
export function itemListLd(items, { name, url }) {
  const els = items.map((p, i) => `      { "@type": "ListItem", "position": ${i + 1}, ` +
    `"url": "${SITE}/run/${p.slug}/", "name": ${jsonText(p.appName || p.crumb)} }`).join(",\n");
  return `<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "ItemList",
  "name": ${jsonText(name)},
  "url": "${url}",
  "numberOfItems": ${items.length},
  "itemListElement": [
${els}
  ]
}
</script>`;
}
