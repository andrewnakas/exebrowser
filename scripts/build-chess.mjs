#!/usr/bin/env node
// Vendors the third-party parts of /apps/chess/ into public/apps/chess/vendor/.
//
//   node scripts/build-chess.mjs            # engine, board and rules
//   node scripts/build-chess.mjs --puzzles  # also rebuild puzzles.json (needs zstd)
//
// Every download is pinned and checked against its sha256, then cached in
// assets-too-big-for-pages/chess/. The output is small and is committed.
//
//   stockfish-19-lite-single.{js,wasm}  Stockfish 19 via nmrugg/stockfish.js,
//       the single-threaded lite build: 1.8 MB, its NNUE net built in, and no
//       SharedArrayBuffer (so no COOP/COEP headers, which would block ad
//       iframes). GPL-3.0. The full builds carry a ~99 MB net, over the Pages cap.
//   chessground.min.js + 3 css          lichess's board UI, GPL-3.0-or-later;
//       the cburnett pieces inside chessground.cburnett.css are GPLv2+.
//   chess.js                            move generation and rules, BSD-2-Clause.
//
// Because chessground and Stockfish are GPL, the chess pages' own code is
// GPL-3.0-or-later too (public/apps/chess/NOTICE.md), and its source is
// what's served — unminified — plus this script. GPL allows ads.
//
// --puzzles: the Lichess puzzle database (CC0, about 6 million puzzles, 293 MB
// compressed) is streamed through zstd and cut down to a few thousand
// well-tested, popular puzzles spread evenly over the rating range.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import readline from "node:readline";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = path.join(ROOT, "assets-too-big-for-pages", "chess");
const OUT = path.join(ROOT, "public", "apps", "chess", "vendor");

const SF = "https://github.com/nmrugg/stockfish.js/releases/download/v19.0.1";
const FILES = [
  { url: `${SF}/stockfish-19-lite-single.js`, sha: "ccb130d7ff29408531c47d859a49f91d59d4f482d05a53eb1a3231a4f624c91a",
    out: { "": "stockfish-19-lite-single.js" } },
  { url: `${SF}/stockfish-19-lite-single.wasm`, sha: "ee4f115bdb2d32cadf96cada104a05b5ec257d7ad6f57582190b49bc71f096de",
    out: { "": "stockfish-19-lite-single.wasm" } },
  { url: "https://registry.npmjs.org/chessground/-/chessground-9.2.1.tgz",
    sha: "6bcb9f102c05aa1d5e3cfe9eb82338fb79d829cd575b545a6896706b4a06d058",
    out: {
      "package/dist/chessground.min.js": "chessground.min.js",
      "package/assets/chessground.base.css": "chessground.base.css",
      "package/assets/chessground.brown.css": "chessground.brown.css",
      "package/assets/chessground.cburnett.css": "chessground.cburnett.css",
      "package/LICENSE": "LICENSE-chessground.txt",
    } },
  { url: "https://registry.npmjs.org/chess.js/-/chess.js-1.4.0.tgz",
    sha: "dce92e280439d7a16f645be94f22e6da50e579a1f3011d0a2381755bfe2c2ef7",
    out: { "package/dist/esm/chess.js": "chess.js", "package/LICENSE": "LICENSE-chess.js.txt" } },
];

function fetchPinned(url, sha) {
  const file = path.join(CACHE, path.basename(url));
  if (!fs.existsSync(file)) execFileSync("curl", ["-sSL", "--fail", "-o", file, url], { stdio: "inherit" });
  const got = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  if (got !== sha) throw new Error(`${path.basename(url)} sha256 ${got} != pinned ${sha}`);
  return file;
}

fs.mkdirSync(CACHE, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });
for (const f of FILES) {
  const file = fetchPinned(f.url, f.sha);
  if (!file.endsWith(".tgz")) { fs.copyFileSync(file, path.join(OUT, f.out[""])); continue; }
  const dir = path.join(CACHE, path.basename(file, ".tgz"));
  if (!fs.existsSync(dir)) { fs.mkdirSync(dir); execFileSync("tar", ["xzf", file, "-C", dir]); }
  for (const [from, to] of Object.entries(f.out)) fs.copyFileSync(path.join(dir, from), path.join(OUT, to));
}
// Stockfish ships its licence inside the npm tarball only (161 MB); the GPL
// text is the same one chessground carries, so reuse it.
fs.copyFileSync(path.join(OUT, "LICENSE-chessground.txt"), path.join(OUT, "COPYING-stockfish.txt"));
console.log("vendored:", fs.readdirSync(OUT).join(", "));

if (process.argv.includes("--puzzles")) await buildPuzzles();

async function buildPuzzles() {
  // The database is republished monthly, so it can't be sha-pinned; the
  // result is committed instead. Its rows are in random puzzle-id order, so
  // the start of the file already spans every rating: stream it and stop as
  // soon as every band is full rather than fetching all 293 MB. A local copy
  // of the .zst in the cache is used if present.
  const zst = path.join(CACHE, "lichess_db_puzzle.csv.zst");
  const URL = "https://database.lichess.org/lichess_db_puzzle.csv.zst";
  const BAND = 100, MIN = 600, MAX = 2700, PER_BAND = 220;
  const NBANDS = (MAX - MIN) / BAND;
  const bands = new Map();
  const z = spawn("zstd", fs.existsSync(zst) ? ["-dc", zst] : ["-dc"]);
  const dl = fs.existsSync(zst) ? null : spawn("curl", ["-sSL", "--fail", URL]);
  if (dl) { dl.stdout.pipe(z.stdin); z.stdin.on("error", () => {}); }
  const rl = readline.createInterface({ input: z.stdout });
  let header = null, seen = 0, full = 0;
  for await (const line of rl) {
    if (full === NBANDS) break;
    if (!header) { header = line.split(","); continue; }
    seen++;
    // PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags
    const [id, fen, moves, rating, dev, pop, plays, themes] = line.split(",");
    const r = +rating;
    if (r < MIN || r >= MAX || +dev > 85 || +pop < 85 || +plays < 300) continue;
    const b = Math.floor((r - MIN) / BAND);
    const list = bands.get(b) || [];
    if (list.length >= PER_BAND) continue;
    list.push([id, fen, moves, r, themes.split(" ").filter((t) => !/^(short|long|veryLong|oneMove)$/.test(t)).slice(0, 4).join(" ")]);
    bands.set(b, list);
    if (list.length === PER_BAND) full++;
  }
  // Stop early: kill both ends so node can exit with the stream half read.
  rl.close();
  dl?.kill();
  z.kill();
  const all = [...bands.keys()].sort((a, b) => a - b).flatMap((b) => bands.get(b));
  const out = path.join(ROOT, "public", "apps", "chess", "puzzles.json");
  fs.writeFileSync(out, JSON.stringify({
    source: "Lichess puzzle database (CC0), database.lichess.org",
    fields: ["id", "fen", "moves", "rating", "themes"],
    puzzles: all,
  }));
  console.log(`puzzles: ${all.length} kept of ${seen}, ${(fs.statSync(out).size / 1024).toFixed(0)} KB`);
}
