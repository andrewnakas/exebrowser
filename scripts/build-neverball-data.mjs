#!/usr/bin/env node
// Builds /apps/neverball/ from the official Neverball web build at
// https://play.neverball.org/ (Neverball in the browser, by Jānis Rūcis; GPL-2+).
//
//   node scripts/build-neverball-data.mjs
//
// play.neverball.org publishes no versioned release: the files are replaced in
// place when it is rebuilt. So every file is pinned by sha256 below, as fetched
// on 2026-11-13, and cached in assets-too-big-for-pages/neverball/. If upstream
// has moved on and the cache is empty, this script fails on the first
// mismatch; re-pin deliberately (and re-test) rather than loosening the check.
//
// Written into public/apps/neverball/:
//
//   neverball.wasm                      (2.5 MB, unchanged)                ignored
//   neverball.data.part0, part1         (27.6 MB bundle, cut <= 20 MiB)    ignored
//   neverball-source.zip.part0 … part2  (43.6 MB GPL source, cut the same) ignored
//   neverball.parts.json                (part sizes, offsets, sha256)      tracked
//   neverball.js                        (upstream glue, UNCHANGED)         tracked
//   favicon.svg, anim.mp4, anim.jpg     (upstream launcher artwork)        tracked
//   packages/available-packages.txt     (empty: no add-on downloads)       tracked
//   index.html                          (upstream page + the edits below)  tracked
//
// NOTICE.md and COPYING are hand-maintained and not touched here.
//
// Edits to the upstream page, each asserted to apply exactly once:
//   1. The data bundle is fetched in parts before the engine starts and handed
//      to it through getPreloadedPackage (Cloudflare Pages refuses files over
//      25 MB; the glue itself is not patched).
//   2. Upstream's own service worker is not registered. It exists to make
//      play.neverball.org installable and would cache this directory behind
//      the site's back.
//   3. The web-app manifest link is dropped, for the same reason.
//   4. alert( -> console.warn( : the WebGL-context-lost dialog.
//   5. The source link points at NOTICE.md, which says where the three source
//      parts are and how to join them.
//   6. A noindex robots tag: /run/neverball/ is the page meant to be indexed.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = "https://play.neverball.org/";
const FILES = {
  "index.html": "46af5e2ce26c21ee98218561ec47d3340146a68afdc998de0562422a62036c8d",
  "neverball.js": "00596b79f205e26077e529c7bf26b905dd338666c6077f40bf6f6ec2c44dadf1",
  "neverball.wasm": "4622cdabc2356ea830fa1a625dfc26e1eff7fab78102404ed9aa707725dfc7fa",
  "neverball.data": "3703b711b9d88976708017f1985008110fab753d22120f0de1fc0ec63e6e8e08",
  "neverball-source.zip": "47191a04f0645570ac8c0bcd1c2162a571849ee0949dc8c5e75892312affc0c2",
  "favicon.svg": "0bdb1b718f0b3c74aeb4d36d68167a78998936f7a5f6593c99b58900bba6d451",
  "anim.mp4": "e61fbe96508f6cb47c0284aae66a2c01c3870d1ac74ea6e76f1fff29009dd13e",
  "anim.jpg": "54e047f46ab1b217e00e8363cfaea84975498890190ffdee64e587d99939464d",
};
const CACHE = path.join(ROOT, "assets-too-big-for-pages", "neverball");
const OUT = path.join(ROOT, "public", "apps", "neverball");
const PART = 20 * 1024 * 1024;

const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
fs.mkdirSync(CACHE, { recursive: true });
for (const [name, want] of Object.entries(FILES)) {
  const file = path.join(CACHE, name);
  if (!fs.existsSync(file)) {
    console.log("downloading", BASE + name);
    execFileSync("curl", ["-sSL", "--fail", "-o", file, BASE + name], { stdio: "inherit" });
  }
  const got = sha(fs.readFileSync(file));
  if (got !== want) throw new Error(`${name}: sha256 ${got} != pinned ${want} (has play.neverball.org been rebuilt?)`);
}

// Wipe only what this script owns, so NOTICE.md / COPYING survive.
fs.mkdirSync(path.join(OUT, "packages"), { recursive: true });
for (const f of fs.readdirSync(OUT)) {
  if (/^neverball[.-]|^(index\.html|favicon\.svg|anim\.(mp4|jpg))$/.test(f)) fs.rmSync(path.join(OUT, f));
}

for (const f of ["neverball.js", "neverball.wasm", "favicon.svg", "anim.mp4", "anim.jpg"]) {
  fs.copyFileSync(path.join(CACHE, f), path.join(OUT, f));
}
fs.writeFileSync(path.join(OUT, "packages", "available-packages.txt"), "");

const split = (name) => {
  const data = fs.readFileSync(path.join(CACHE, name));
  const parts = [];
  for (let off = 0, i = 0; off < data.length; off += PART, i++) {
    const buf = data.subarray(off, Math.min(off + PART, data.length));
    const part = `${name}.part${i}`;
    fs.writeFileSync(path.join(OUT, part), buf);
    parts.push({ name: part, url: `${part}?v=${sha(buf).slice(0, 12)}`, offset: off, size: buf.length });
  }
  return { total: data.length, sha256: sha(data), parts };
};
const data = split("neverball.data");
const source = split("neverball-source.zip");
fs.writeFileSync(path.join(OUT, "neverball.parts.json"), JSON.stringify({ fetched: "2026-11-13", ...data, source }, null, 2) + "\n");

let html = fs.readFileSync(path.join(CACHE, "index.html"), "utf8");
const edit = (from, to) => {
  const n = html.split(from).length - 1;
  if (n !== 1) throw new Error(`page edit ${JSON.stringify(from.slice(0, 50))} found ${n} times, expected 1: has the page changed?`);
  html = html.replace(from, () => to);
};

// 1. Prefetch the data parts, then hand them to the engine.
edit(
  `        const config = {
          print: function (text) {`,
  `        // Added by scripts/build-neverball-data.mjs: the data bundle is served in
        // parts; fetch and join them, then give the engine the finished buffer.
        const partsManifest = await (await fetch('neverball.parts.json')).json();
        const preloaded = new Uint8Array(partsManifest.total);
        Neverball.showProgress(-partsManifest.total);
        await Promise.all(partsManifest.parts.map(async (part) => {
          const response = await fetch(part.url);
          if (!response.ok) throw Error(response.status + ': ' + part.name);
          const reader = response.body.getReader();
          let at = part.offset;
          for (;;) {
            const chunk = await reader.read();
            if (chunk.done) break;
            preloaded.set(chunk.value, at);
            at += chunk.value.length;
            Neverball.showProgress(chunk.value.length);
          }
          if (at - part.offset !== part.size) throw Error(part.name + ': incomplete download');
        }));

        const config = {
          getPreloadedPackage: function (name) {
            return /(^|\\/)neverball\\.data$/.test(name) ? preloaded.buffer : null;
          },

          print: function (text) {`,
);
// 2. No upstream service worker.
edit(
  `        if ('serviceWorker' in navigator) {
          const registration = await navigator.serviceWorker.register('./service-worker.js', {`,
  `        if (false) { // exebrowser.com: upstream's service worker is not shipped
          const registration = await navigator.serviceWorker.register('./service-worker.js', {`,
);
// 3. No manifest.
edit(`  <link rel="manifest" href="neverball.webmanifest">\n`, "");
// 4. No modal dialog.
edit("alert(", "console.warn(");
// 5. Source link.
edit(
  `<a href="./neverball-source.zip" download="neverball-source.zip">neverball-source.zip</a>`,
  `<a href="./NOTICE.md" target="_blank">how to get neverball-source.zip from this site</a>`,
);
// 6. Not the page to index.
edit(`  <title>Neverball</title>`, `  <title>Neverball</title>\n  <meta name="robots" content="noindex">`);
fs.writeFileSync(path.join(OUT, "index.html"), html);

let sum = 0;
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
for (const f of walk(OUT)) {
  const size = fs.statSync(f).size;
  if (size > 25 * 1000 * 1000) throw new Error(`${f} is ${size} bytes, over the Pages cap`);
  sum += size;
}
console.log(`public/apps/neverball: ${(sum / 1e6).toFixed(1)} MB, ${data.parts.length} data parts, ${source.parts.length} source parts`);
