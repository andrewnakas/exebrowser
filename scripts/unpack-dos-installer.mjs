// Unpack an Apogee-style DOS installer by running it inside our own DOSBox and
// reading the extracted files back out via the emulator's filesystem API.
//
//   node scripts/unpack-dos-installer.mjs <src-zip> <out-dir> [--keys Enter,Enter,…]
//        [--wait 20] [--exe INSTALL.EXE] [--headed] [--shot file.png]
//
// Serves public/ itself (no wrangler needed), like boot-test.mjs. Needs
// playwright-core (PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core) and
// Google Chrome.
//
// Several shareware packages ship only INSTALL.EXE wrapping a proprietary
// archive (.SHR, ._1, DEICE, .SOW). Rather than reverse-engineer those formats,
// let the game's own installer do the work, then copy out every file the
// emulator's drive holds that the source zip did not (plus the originals,
// which stay beside them in <out-dir>/_src for the record).
//
// --keys is the installer's dialogue: one key per second after the wait
// ("wait5" pauses five seconds; "shot2" saves an intermediate screen beside --shot).
// Default is sixteen Enters, which accepts every default of an Apogee
// installer. --shot saves the final screen so a stuck installer can be read.
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUB = path.join(ROOT, "public");
const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const has = (n) => argv.includes(`--${n}`);
const valued = new Set(["keys", "wait", "exe", "shot", "after"]);
const [srcZipArg, outDirArg] = argv.filter((a, i) => !a.startsWith("--") && !valued.has((argv[i - 1] || "").replace(/^--/, "")));
if (!srcZipArg || !outDirArg) {
  console.error("usage: node scripts/unpack-dos-installer.mjs <src-zip> <out-dir> [--keys a,b] [--wait s] [--exe INSTALL.EXE] [--shot f.png]");
  process.exit(2);
}
const srcZip = path.resolve(srcZipArg);
const outDir = path.resolve(outDirArg);
const KEYS = (flag("keys", Array(16).fill("Enter").join(","))).split(",").filter(Boolean);
const WAIT = parseFloat(flag("wait", 20)) * 1000;
const EXE = flag("exe", "INSTALL.EXE");
// --after "cd \\TV;SETUP.EXE": DOS commands run once the installer exits, for a
// game that needs its sound setup run before it will start. Typing them as
// keys is unreliable (the embed page swallows some letters).
const AFTER = flag("after", "").split(";").filter(Boolean);

async function loadPlaywright() {
  for (const t of [process.env.PLAYWRIGHT_CORE, "playwright-core"].filter(Boolean)) {
    try {
      const spec = t.includes("/") ? pathToFileURL(createRequire(path.join(t, "x.js")).resolve(t)).href : t;
      return (await import(spec)).default ?? (await import(spec));
    } catch {}
  }
  throw new Error("playwright-core not found; set PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core");
}

// Build a boot payload that just runs the installer.
const work = path.join(ROOT, "assets-too-big-for-pages", "unpack-build");
fs.rmSync(work, { recursive: true, force: true });
fs.mkdirSync(path.join(work, ".jsdos"), { recursive: true });
execFileSync("unzip", ["-qq", "-o", srcZip, "-d", work]);
const walk = (dir, rel = "") => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const r = rel ? `${rel}/${e.name}` : e.name;
  return e.isDirectory() ? walk(path.join(dir, e.name), r) : [r];
});
const original = new Set(walk(work).map((r) => r.toUpperCase()));
fs.writeFileSync(path.join(work, ".jsdos", "dosbox.conf"),
  `[cpu]\ncycles=max\n\n[dos]\numb=true\nxms=true\nems=true\n\n[autoexec]\nmount c .\nc:\n${EXE}\n${AFTER.map((l) => l + "\n").join("")}`);
const payload = path.join(ROOT, "assets-too-big-for-pages", "unpack-build.zip");
fs.rmSync(payload, { force: true });
execFileSync("zip", ["-qr", "-X", payload, "."], { cwd: work });

const MIME = { ".html": "text/html", ".js": "text/javascript", ".wasm": "application/wasm", ".css": "text/css", ".json": "application/json", ".zip": "application/zip" };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/_unpack/") {
    res.writeHead(200, { "Content-Type": "text/html" });
    return res.end(`<!DOCTYPE html><meta charset="utf-8"><div id="dos-embed" data-app-url="/_unpack/t.zip" data-app-name="Installer" data-slug="unpack-${Date.now()}"></div><script src="/dos-embed.js"></script>`);
  }
  let file = url.pathname === "/_unpack/t.zip" ? payload : path.join(PUB, decodeURIComponent(url.pathname));
  if (file !== payload && !file.startsWith(PUB)) { res.writeHead(403); return res.end(); }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
  if (!fs.existsSync(file)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));

const { chromium } = await loadPlaywright();
const b = await chromium.launch({ channel: "chrome", headless: !has("headed"), args: ["--autoplay-policy=no-user-gesture-required"] });
const page = await b.newPage({ viewport: { width: 1000, height: 800 } });
await page.goto(`http://127.0.0.1:${server.address().port}/_unpack/`, { waitUntil: "domcontentloaded" });
await page.click("#dos-play", { timeout: 10000 });
await page.waitForTimeout(WAIT);
await page.click("#dos-canvas").catch(() => {});
for (const k of KEYS) {
  if (/^wait\d+$/.test(k)) { await page.waitForTimeout(parseInt(k.slice(4), 10) * 1000); continue; }
  if (/^shot\d+$/.test(k) && flag("shot")) {
    const png = await page.evaluate(() => document.getElementById("dos-canvas").toDataURL("image/png"));
    fs.writeFileSync(path.resolve(flag("shot")).replace(/\.png$/, `.${k.slice(4)}.png`), Buffer.from(png.split(",")[1], "base64"));
    continue;
  }
  if (k.length > 1 && !/^(Enter|Escape|Space|Tab|Backspace|Arrow\w+|F\d+)$/.test(k)) for (const ch of k) { await page.keyboard.down(ch); await page.waitForTimeout(120); await page.keyboard.up(ch); await page.waitForTimeout(180); }
  else await page.keyboard.press(k === "Space" ? " " : k);
  await page.waitForTimeout(1000);
}
await page.waitForTimeout(5000);
if (flag("shot")) {
  const png = await page.evaluate(() => document.getElementById("dos-canvas").toDataURL("image/png"));
  fs.writeFileSync(path.resolve(flag("shot")), Buffer.from(png.split(",")[1], "base64"));
}

const files = await page.evaluate(async () => {
  const ci = window.__dosCi;
  if (!ci) return { __err: "emulator not ready" };
  const flat = (node, p, out) => {
    if (!node) return out;
    const here = p + "/" + (node.name || "");
    if (node.nodes) node.nodes.forEach((c) => flat(c, here, out));
    else out.push(here.replace(/^\/\.\//, "/"));
    return out;
  };
  const out = {};
  for (const p of flat(await ci.fsTree(), "", [])) {
    try { const buf = await ci.fsReadFile(p); out[p] = btoa(Array.from(buf, (c) => String.fromCharCode(c)).join("")); } catch {}
  }
  return out;
});
await b.close();
server.close();
fs.rmSync(payload, { force: true });
fs.rmSync(work, { recursive: true, force: true });

if (files.__err) { console.error(files.__err); process.exit(1); }
fs.rmSync(outDir, { recursive: true, force: true });
let total = 0, fresh = 0;
for (const [name, b64] of Object.entries(files)) {
  const rel = name.replace(/^\/+/, "");
  if (!rel || rel.startsWith(".jsdos/")) continue;
  const isOriginal = original.has(rel.toUpperCase());
  const dest = path.join(outDir, isOriginal ? "_src" : "", rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const bytes = Buffer.from(b64, "base64");
  fs.writeFileSync(dest, bytes);
  if (!isOriginal) { fresh++; total += bytes.length; }
}
console.log(`extracted ${fresh} new files (${(total / 1024).toFixed(0)} KB) to ${outDir}`);
if (!fresh) process.exit(1);
