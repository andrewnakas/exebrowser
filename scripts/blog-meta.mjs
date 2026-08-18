// Reads the blog's own HTML back out as data.
//
// The blog is hand-authored — there is no blog-posts.json — but every post
// already carries machine-readable Article JSON-LD with datePublished and
// dateModified. That is the truth, so read it rather than maintaining a second
// list. Before this existed, the sitemap hardcoded 2026-07-01 for all nine blog
// URLs and a comment reminded you to add new posts by hand; a crawler was being
// told nothing on the blog had changed in six weeks.
//
// Used by: the sitemap (real lastmod), feed.xml, and the homepage blog strip.

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { unesc } from "./catalogue.mjs";

const pick = (html, re) => {
  const m = html.match(re);
  return m ? m[1] : null;
};

// Sorted newest-modified first. Throws rather than guessing: a post with no
// datePublished would otherwise get a silently wrong date in the sitemap and
// the feed, which is precisely the failure this file exists to end.
export function blogPosts(root) {
  const dir = join(root, "blog");
  if (!existsSync(dir)) return [];
  const posts = [];
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    if (!statSync(abs).isDirectory()) continue;
    const file = join(abs, "index.html");
    if (!existsSync(file)) continue;
    const html = readFileSync(file, "utf8");

    const published = pick(html, /"datePublished":\s*"(\d{4}-\d{2}-\d{2})/);
    if (!published) throw new Error(`blog/${name}: no datePublished in its JSON-LD`);
    const modified = pick(html, /"dateModified":\s*"(\d{4}-\d{2}-\d{2})/) || published;

    // Titles and descriptions are stored HTML-escaped on disk. Decode them
    // here so callers can escape once, for whichever syntax they're emitting.
    // Skipping this is how "&amp;" becomes "&amp;amp;" in a feed reader.
    const rawTitle = pick(html, /<title>([^<]*)<\/title>/) || name;
    const title = unesc(rawTitle).replace(/\s*—\s*ExeBrowser\s*$/, "").trim();
    const description = unesc(pick(html, /<meta name="description" content="([^"]*)"/) || "");

    posts.push({ slug: name, path: `/blog/${name}/`, title, description, published, modified });
  }
  return posts.sort((a, b) => (a.modified < b.modified ? 1 : a.modified > b.modified ? -1 : 0));
}
