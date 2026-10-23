#!/usr/bin/env node
// Vendors NetHack 3.6.7 (WebAssembly) into public/apps/nethack/vendor/.
//
//   node scripts/build-nethack.mjs
//
// One npm package, pinned and sha256-checked, cached in
// assets-too-big-for-pages/nethack/: @neth4ck/wasm-367, NetHack 3.6.7
// compiled with Emscripten (Asyncify, no threads, no SharedArrayBuffer).
// nethack.wasm is 4.9 MB with the game data embedded. (Its companion
// @neth4ck/neth4ck shim is not used: it misreads 3.6 status values, and the
// wiring it does is a few lines in nethack-ui.js.)
// It is under the NetHack General Public License, which allows
// redistribution (including on pages with ads) as long as the licence travels
// with it and the source stays available; LICENSE.md is copied alongside.
//
// The window port itself — map, messages, status, menus, keyboard and touch
// input — is our own code in public/apps/nethack/nethack-ui.js.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = path.join(ROOT, "assets-too-big-for-pages", "nethack");
const OUT = path.join(ROOT, "public", "apps", "nethack", "vendor");

const PKGS = [
  { url: "https://registry.npmjs.org/@neth4ck/wasm-367/-/wasm-367-2.1.2.tgz",
    sha: "0971338312dcb6952972a3000a458ed82d2bb489cb2e3ba065a30816b8827796",
    out: { "package/build/nethack.js": "nethack.js", "package/build/nethack.wasm": "nethack.wasm",
      "package/LICENSE.md": "LICENSE.md" } },
];

fs.mkdirSync(CACHE, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });
for (const p of PKGS) {
  const file = path.join(CACHE, path.basename(p.url));
  if (!fs.existsSync(file)) execFileSync("curl", ["-sSL", "--fail", "-o", file, p.url], { stdio: "inherit" });
  const got = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  if (got !== p.sha) throw new Error(`${path.basename(file)} sha256 ${got} != pinned ${p.sha}`);
  const dir = path.join(CACHE, path.basename(file, ".tgz"));
  if (!fs.existsSync(dir)) { fs.mkdirSync(dir); execFileSync("tar", ["xzf", file, "-C", dir]); }
  for (const [from, to] of Object.entries(p.out)) fs.copyFileSync(path.join(dir, from), path.join(OUT, to));
}
console.log("vendored NetHack 3.6.7 →", path.relative(ROOT, OUT));
