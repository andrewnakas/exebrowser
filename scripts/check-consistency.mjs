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

// ── 3. Every internal /run/ link resolves ──────────────────────────────────
// A dead link is worse on this site than most, because visitors follow them
// expecting a game.
const runDirs = new Set(
  existsSync(join(ROOT, "run"))
    ? readdirSync(join(ROOT, "run")).filter((d) => existsSync(join(ROOT, "run", d, "index.html")))
    : []
);
function checkLinks(file, label) {
  if (!existsSync(file)) return;
  const html = readFileSync(file, "utf8");
  for (const m of html.matchAll(/href="\/run\/([a-z0-9-]+)\/"/g)) {
    if (!runDirs.has(m[1])) warn(`${label}: links to /run/${m[1]}/ which does not exist`);
  }
}
for (const p of pages) checkLinks(join(ROOT, "run", p.slug, "index.html"), `run/${p.slug}`);
checkLinks(join(ROOT, "index.html"), "homepage");
checkLinks(join(ROOT, "run", "index.html"), "hub");
if (existsSync(join(ROOT, "blog"))) {
  for (const d of readdirSync(join(ROOT, "blog"))) {
    checkLinks(join(ROOT, "blog", d, "index.html"), `blog/${d}`);
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

// ── report ────────────────────────────────────────────────────────────────
if (problems.length === 0) {
  console.log(`✓ consistency: ${pages.length} pages, ${pages.filter(isPlayable).length} playable — no issues`);
  process.exit(0);
}
console.error(`✗ consistency: ${problems.length} issue(s)`);
for (const p of problems) console.error("  - " + p);
process.exit(1);
