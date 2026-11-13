#!/usr/bin/env node
// Builds /apps/supertux/ from the official SuperTux 0.6.3 WebAssembly release.
//
//   node scripts/build-supertux-data.mjs
//
// The binaries (~252 MB) are gitignored, like Warzone 2100 and LibreQuake: this
// script is the record of exactly what ships. It downloads the release once into
// assets-too-big-for-pages/, checks its sha256, and writes into
// public/apps/supertux/:
//
//   supertux2.wasm                    (6 MB, unchanged)                 ignored
//   supertux2.data.part0 … partN      (246 MB bundle, cut <= 20 MiB)    ignored
//   supertux2.parts.json              (part sizes, offsets, sha256)     tracked
//   supertux2.js, supertux2.worker.js (upstream glue, UNCHANGED)        tracked
//   supertux2.png, supertux2_bkg.png  (upstream loading artwork)        tracked
//   index.html                        (upstream supertux2.html + the
//                                      three edits listed below)        tracked
//
// NOTICE.md and COPYING are hand-maintained and not touched here.
//
// Why the data is split: Cloudflare Pages refuses files over 25 MB. The glue
// asks Module.getPreloadedPackage() for the bundle before it tries to download
// it, so index.html fetches the parts itself, joins them, and hands the glue
// the finished buffer. That is why the glue needs no patch.
//
// Edits to the upstream page, each asserted to apply exactly once (or the
// stated number of times) so a changed release fails here rather than in a
// browser:
//   1. alert( -> console.warn( : the two persistent-storage warnings and the
//      WebGL-context-lost one. A modal dialog on load blocks the page, and the
//      game runs either way.
//   2. <script async src="supertux2.js"> -> the part loader (LOADER below).
//   3. <title> and a noindex robots tag: the /run/supertux/ page is the one
//      meant to be indexed.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VERSION = "0.6.3";
const RELEASE = `https://github.com/SuperTux/supertux/releases/download/v${VERSION}/SuperTux-v${VERSION}-WASM.zip`;
const SHA256 = "f9fa6eed36d403a283f3c544540b8a45b6c110375c1824e137ce1b4357e2d5df";
const CACHE = path.join(ROOT, "assets-too-big-for-pages", "supertux");
const OUT = path.join(ROOT, "public", "apps", "supertux");
const PART = 20 * 1024 * 1024; // 20 MiB, comfortably under the 25 MB Pages cap

fs.mkdirSync(CACHE, { recursive: true });
const zip = path.join(CACHE, `SuperTux-v${VERSION}-WASM.zip`);
if (!fs.existsSync(zip)) {
  console.log("downloading", RELEASE);
  execFileSync("curl", ["-sSL", "--fail", "-o", zip, RELEASE], { stdio: "inherit" });
}
const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const zipSum = execFileSync("shasum", ["-a", "256", zip]).toString().split(" ")[0];
if (zipSum !== SHA256) throw new Error(`release zip sha256 ${zipSum} != pinned ${SHA256}`);

const src = path.join(CACHE, VERSION);
if (!fs.existsSync(path.join(src, "supertux2.data"))) {
  fs.mkdirSync(src, { recursive: true });
  execFileSync("unzip", ["-o", "-q", zip, "-d", src]);
}

// Wipe only what this script owns, so NOTICE.md / COPYING survive.
fs.mkdirSync(OUT, { recursive: true });
for (const f of fs.readdirSync(OUT)) {
  if (/^supertux2[._]|^index\.html$/.test(f)) fs.rmSync(path.join(OUT, f));
}

// 1. wasm, glue, worker, artwork: unchanged.
for (const f of ["supertux2.wasm", "supertux2.js", "supertux2.worker.js", "supertux2.png", "supertux2_bkg.png"]) {
  fs.copyFileSync(path.join(src, f), path.join(OUT, f));
}

// 2. The data bundle, cut into parts. Read and written through a file
// descriptor, one part at a time, so the 246 MB bundle is never held whole.
const dataFile = path.join(src, "supertux2.data");
const total = fs.statSync(dataFile).size;
const whole = crypto.createHash("sha256");
const fd = fs.openSync(dataFile, "r");
const parts = [];
for (let off = 0, i = 0; off < total; off += PART, i++) {
  const buf = Buffer.alloc(Math.min(PART, total - off));
  fs.readSync(fd, buf, 0, buf.length, off);
  whole.update(buf);
  const name = `supertux2.data.part${i}`;
  fs.writeFileSync(path.join(OUT, name), buf);
  // ?v= is a content hash, so _headers can mark the parts immutable.
  parts.push({ name, url: `${name}?v=${sha(buf).slice(0, 12)}`, offset: off, size: buf.length });
}
fs.closeSync(fd);
fs.writeFileSync(
  path.join(OUT, "supertux2.parts.json"),
  JSON.stringify({ release: VERSION, total, sha256: whole.digest("hex"), parts }, null, 2) + "\n",
);

// 3. The page.
const LOADER = `<script>
  // Added by scripts/build-supertux-data.mjs: fetch the data bundle in parts
  // (three at a time), join them, and give the glue the finished buffer
  // through Module.getPreloadedPackage, which it checks before downloading.
  (function () {
    function say(t) { if (Module.setStatus) Module.setStatus(t); }
    fetch("supertux2.parts.json").then(function (r) {
      if (!r.ok) throw new Error(r.status + ": supertux2.parts.json");
      return r.json();
    }).then(async function (m) {
      var buf = new Uint8Array(m.total), next = 0, loaded = 0;
      async function lane() {
        while (next < m.parts.length) {
          var p = m.parts[next++];
          var r = await fetch(p.url);
          if (!r.ok) throw new Error(r.status + ": " + p.name);
          var reader = r.body.getReader(), at = p.offset;
          for (;;) {
            var x = await reader.read();
            if (x.done) break;
            buf.set(x.value, at);
            at += x.value.length;
            loaded += x.value.length;
            say("Downloading data... (" + loaded + "/" + m.total + ")");
          }
          if (at - p.offset !== p.size) throw new Error(p.name + ": got " + (at - p.offset) + " of " + p.size + " bytes");
        }
      }
      await Promise.all([lane(), lane(), lane()]);
      Module.getPreloadedPackage = function (name) {
        return /(^|\\/)supertux2\\.data$/.test(name) ? buf.buffer : null;
      };
      var s = document.createElement("script");
      s.src = "supertux2.js?v=${VERSION}";
      document.body.appendChild(s);
    }).catch(function (e) {
      say("Could not download the game data: " + (e && e.message ? e.message : e));
    });
  })();
  </script>`;

let html = fs.readFileSync(path.join(src, "supertux2.html"), "utf8");
const edit = (from, to, times = 1) => {
  const n = html.split(from).length - 1;
  if (n !== times) throw new Error(`page edit ${JSON.stringify(from.slice(0, 40))} found ${n} times, expected ${times}: has the release changed?`);
  html = html.split(from).join(to);
};
edit("alert(", "console.warn(", 3);
edit('<script async src="supertux2.js"></script>', LOADER);
const title = html.match(/<title>[^<]*<\/title>/);
if (!title) throw new Error("page has no <title>");
edit(title[0], '<title>SuperTux</title>\n  <meta name="robots" content="noindex">');
fs.writeFileSync(path.join(OUT, "index.html"), html);

// 4. Size check, and a listing of what was written.
let sum = 0;
for (const f of fs.readdirSync(OUT)) {
  const size = fs.statSync(path.join(OUT, f)).size;
  if (size > 25 * 1000 * 1000) throw new Error(`${f} is ${size} bytes, over the Pages cap`);
  sum += size;
}
console.log(`public/apps/supertux: ${(sum / 1e6).toFixed(1)} MB, ${parts.length} data parts`);
