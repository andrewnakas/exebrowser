// Builds redistributable, self-contained copies of the ten owned games for
// portal submission (GameDistribution, GamePix, itch.io) into dist/games/.
//
// Why this script exists rather than a hand-made zip: the games as served from
// public/apps/ are NOT portable, despite having been described that way. Every
// one of them loads /apps/gamesave.js by absolute path, and freecell + spider
// also load /apps/_shared/cards.{css,js}. Dropped onto a portal as-is, all ten
// 404 on those and lose saves; two of them lose card rendering entirely. This
// script bundles the shared dependencies alongside each game and rewrites those
// absolute references to relative ones, which is the whole difference between a
// package that works off-site and one that silently half-works.
//
//   node scripts/build-distribution.mjs
//
// Output: dist/games/<name>/ and dist/games/<name>.zip, one per title.
// Verified 2026-09-05: snake (plain shape) and freecell (shared-cards shape)
// both load from a bare static server with all requests 200 and no console
// errors. Re-verify after changing anything under public/apps/_shared/.

import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, readdirSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = process.cwd();
const APPS = resolve(ROOT, "public", "apps");
const DIST = resolve(ROOT, "dist", "games");

// The ten titles that are ours to redistribute: original implementations, no
// Microsoft or id Software assets, no third-party engine with its own terms.
// Anything requiring a user-supplied EXE (the Wine titles) is deliberately absent.
const TITLES = [
  "blockdrop-open",
  "freecell-open",
  "hearts-open",
  "jezzball-open",
  "minesweeper-open",
  "pipes-open",
  "rodents-open",
  "snake-open",
  "solitaire-open",
  "spider-open",
];

// Absolute site paths -> paths relative to the game's own directory. Order
// matters: the _shared prefix must be rewritten before the bare /apps/ one
// would otherwise match it.
const REWRITES = [
  [/"\/apps\/_shared\//g, '"_shared/'],
  [/"\/apps\/gamesave\.js/g, '"gamesave.js'],
];

function build(slug) {
  const src = join(APPS, slug);
  if (!existsSync(src)) throw new Error(`missing source: ${src}`);

  const name = slug.replace(/-open$/, "");
  const out = join(DIST, name);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });

  for (const f of readdirSync(src)) {
    if (f === ".DS_Store") continue;
    cpSync(join(src, f), join(out, f));
  }

  // Every game uses the save shim; only the card games use the shared renderer.
  cpSync(join(APPS, "gamesave.js"), join(out, "gamesave.js"));

  const indexPath = join(out, "index.html");
  let html = readFileSync(indexPath, "utf8");

  if (/_shared\/cards/.test(html)) {
    mkdirSync(join(out, "_shared"), { recursive: true });
    for (const f of ["cards.css", "cards.js"]) {
      cpSync(join(APPS, "_shared", f), join(out, "_shared", f));
    }
  }

  for (const [pattern, replacement] of REWRITES) html = html.replace(pattern, replacement);
  writeFileSync(indexPath, html);

  // A leftover site-absolute reference is the exact failure this script exists
  // to prevent, so fail loudly rather than shipping a package that 404s.
  const leftover = html.match(/(?:src|href)="\/[^"]*"/g);
  if (leftover) throw new Error(`${name}: absolute refs survived rewriting: ${leftover.join(", ")}`);

  execFileSync("zip", ["-qr", join(DIST, `${name}.zip`), name, "-x", "*.DS_Store"], { cwd: DIST });

  const files = readdirSync(out).length;
  return { name, files };
}

rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });

for (const slug of TITLES) {
  const { name, files } = build(slug);
  console.log(`built dist/games/${name}/ (${files} files) + ${name}.zip`);
}

console.log(`\n${TITLES.length} packages in dist/games/ — self-contained, no network calls.`);
