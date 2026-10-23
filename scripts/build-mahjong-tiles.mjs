#!/usr/bin/env node
// Fetches the mahjong tile art for /apps/mahjong/ into public/apps/mahjong/tiles/.
//
//   node scripts/build-mahjong-tiles.mjs
//
// Source: FluffyStuff/riichi-mahjong-tiles, "Regular" SVG set, pinned to a
// commit (raw.githubusercontent URLs at a commit hash never change). The
// repo's LICENSE.md dedicates the art to the public domain (CC0), so the
// mahjong page may carry ads. The 34 faces are the standard riichi set — three
// suits 1–9, four winds, three dragons —.
// There are no flower or season tiles, so our layouts use 136 tiles (34 × 4).
//
// The output is committed (about 0.8 MB of SVG, much less gzipped). The
// Inkscape metadata is stripped; nothing else in the drawings is changed.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const COMMIT = "26e127ba2117f45cdce5ea0225748cc0cfad3169";
const BASE = `https://raw.githubusercontent.com/FluffyStuff/riichi-mahjong-tiles/${COMMIT}`;
const OUT = path.join(ROOT, "public", "apps", "mahjong", "tiles");

const NAMES = ["Chun", "Haku", "Hatsu", "Ton", "Nan", "Shaa", "Pei"];
for (const s of ["Man", "Pin", "Sou"]) for (let i = 1; i <= 9; i++) NAMES.push(s + i);

fs.mkdirSync(OUT, { recursive: true });
const sums = [];
for (const n of NAMES) {
  const res = await fetch(`${BASE}/Regular/${n}.svg`);
  if (!res.ok) throw new Error(`${n}.svg: HTTP ${res.status}`);
  const raw = await res.text();
  sums.push(`${crypto.createHash("sha256").update(raw).digest("hex")}  ${n}.svg`);
  const svg = raw
    .replace(/<\?xml[^>]*>\s*/, "")
    .replace(/<!--[\s\S]*?-->\s*/g, "")
    .replace(/<metadata[\s\S]*?<\/metadata>\s*/g, "")
    .replace(/<sodipodi:namedview\b[^>]*\/>\s*/g, "")
    .replace(/<sodipodi:namedview\b[\s\S]*?<\/sodipodi:namedview>\s*/g, "")
    .replace(/\s+(inkscape|sodipodi):[a-z-]+="[^"]*"/g, "");
  fs.writeFileSync(path.join(OUT, `${n}.svg`), svg);
}
const licence = await (await fetch(`${BASE}/LICENSE.md`)).text();
fs.writeFileSync(path.join(OUT, "LICENSE.md"),
  `Tile art: FluffyStuff/riichi-mahjong-tiles @ ${COMMIT}\n\n${licence.trim()}\n\nUpstream sha256 of each file before metadata stripping:\n\n${sums.join("\n")}\n`);
console.log(`${NAMES.length} tiles → ${path.relative(ROOT, OUT)}`);
