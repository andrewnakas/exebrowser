// Which hand-maintained pages the localisation pipeline knows how to build,
// and how each one is shaped.
//
// Kept separate from gen-static-pages.mjs because three other scripts need the
// same list: gen-app-pages.mjs writes the sitemap entries, inject-page-links.mjs
// stamps hreflang onto the English originals, and check-consistency.mjs
// verifies the two agree. A list that lived in the generator would have to be
// duplicated into all three, which is how the locale allowlist in this repo
// ended up written out as a regex in four places.

import { staticEntry } from "./locales.mjs";

/**
 * `kind`     — "page" renders one card per section (the utility pages);
 *              "article" renders a single card with a byline and h3s (the blog).
 * `parent`   — a second breadcrumb level, if the page sits under one.
 * `scripts`  — extra client scripts this page needs, in order.
 * `pri`      — sitemap priority for the localised copies. Deliberately below
 *              the English originals: these are newer, thinner in link terms,
 *              and should not outrank the page they were translated from.
 */
export const STATIC_PAGES = {
  // The loader is the one with measured non-English demand behind it —
  // "exe在线运行" converts at 33% at position 2, "abrir exe online" at 10% —
  // and it is the page the rest of the utility surface routes into.
  "/load-exe/": {
    kind: "page",
    pri: "0.8",
    resumeBar: true,
    // embed.js builds the runtime DOM that app.js binds to, so the order here
    // is load-bearing, exactly as on the English page.
    scripts: ["/save-core.js?v=5", "/recent.js?v=7", "/embed.js?v=10", "/app.js?v=22", "/embed-pointer.js?v=1"],
  },
  "/open-exe-file/": {
    kind: "page",
    pri: "0.7",
    scripts: [],
  },
  "/guide/": {
    kind: "page",
    pri: "0.7",
    // The English guide carries the embed pointer and measures it; a localised
    // copy that dropped the script would silently stop counting the clicks.
    scripts: ["/embed-pointer.js?v=1"],
  },
  "/exe-inspector/": {
    kind: "page",
    pri: "0.7",
    // The viewer parses in the page, so its own strings have to come with it.
    scripts: ["/pe-inspect.js?v=2"],
  },
  "/blog/what-is-an-exe-file/": {
    kind: "article",
    pri: "0.6",
    parent: { href: "/blog/", labelKey: "nav.blog" },
    published: "2026-09-22",
    modified: "2026-09-22",
    scripts: [],
  },
};

/**
 * A link to one of these pages from a localised page: the reader's own
 * language when it exists there, the English original otherwise.
 *
 * The same shape as linkFor() in gen-app-pages.mjs, and for the same reason —
 * linking to /ja/guide/ unconditionally is a 404 generator, because most of
 * this list is untranslated in most languages at any given moment.
 */
export const staticLinkFor = (L, path) =>
  L.code !== "en" && staticEntry(L.code, path) ? L.path(path) : path;

/** Every path this pipeline can build, for the scripts that need the list. */
export const STATIC_PATHS = Object.keys(STATIC_PAGES);
