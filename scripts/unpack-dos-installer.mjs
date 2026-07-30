// Unpack an Apogee-style DOS installer by running it inside our own DOSBox and
// reading the extracted files back out via the emulator's filesystem API.
//
//   node scripts/unpack-dos-installer.mjs <abs-src-zip> <abs-out-dir>
//
// Requires `npx wrangler pages dev public --port 8788` running, and
// playwright-core available. Paths must be absolute.
//
// Several Apogee shareware packages ship only INSTALL.EXE wrapping a
// proprietary archive (.SHR, ._1, DEICE). Rather than reverse-engineer those
// formats, let the game's own unpacker do the work.
import { chromium } from 'playwright-core';
import { writeFileSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { execSync } from 'node:child_process';

const [srcZip, outDir] = process.argv.slice(2);
if (!srcZip || !outDir) { console.error('usage: node scripts/unpack-dos-installer.mjs <abs-src-zip> <abs-out-dir>'); process.exit(2); }

const SITE = '/Users/nakas/Documents/WineOnline/public';
const STAGE = `${SITE}/_unpack`;
mkdirSync(STAGE, { recursive: true });
mkdirSync(outDir, { recursive: true });

// Build a boot payload that just runs the installer.
const tmp = '/tmp/unpack-build';
execSync(`rm -rf ${tmp} && mkdir -p ${tmp}/.jsdos && cd ${tmp} && unzip -qo ${srcZip}`);
writeFileSync(`${tmp}/.jsdos/dosbox.conf`,
  '[cpu]\ncycles=max\n\n[dos]\numb=true\nxms=true\nems=true\n\n[autoexec]\nmount c .\nc:\nINSTALL.EXE\n');
execSync(`cd ${tmp} && zip -qr ${STAGE}/t.zip .`);
writeFileSync(`${STAGE}/index.html`,
  `<!DOCTYPE html><meta charset="utf-8"><div id="dos-embed" data-app-url="/_unpack/t.zip" data-app-name="Installer" data-autoboot="true"></div><script src="/dos-embed.js"></script>`);

// Candidate filenames: whatever the archive mentions in plaintext.
const cands = new Set();
for (const f of readdirSync(tmp)) {
  try {
    const s = readFileSync(`${tmp}/${f}`).toString('latin1');
    for (const m of s.match(/[A-Z0-9][A-Z0-9_\-]{0,7}\.[A-Z0-9]{2,3}/g) || []) cands.add(m);
  } catch {}
}
console.log(`candidate names: ${cands.size}`);

const b = await chromium.launch({ channel: 'chrome' });
const page = await b.newPage({ viewport: { width: 900, height: 800 } });
await page.goto('http://localhost:8788/_unpack/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(20000);
for (let i = 0; i < 16; i++) { await page.keyboard.press('Enter'); await page.waitForTimeout(1000); }
await page.waitForTimeout(3000);

const files = await page.evaluate(async (names) => {
  const ci = window.__dosCi;
  if (!ci) return { __err: 'emulator not ready' };
  const out = {};
  // Installers drop files either at the root or in a game subdirectory.
  const dirs = ['', 'CAVES/', 'BASH/', 'GAME/', 'APOGEE/', 'PAGA/', 'WORD/', 'MATH/'];
  for (const n of names) for (const dir of dirs) {
    try { const buf = await ci.fsReadFile(dir + n); if (buf?.length) { out[n] = Array.from(buf); break; } } catch {}
  }
  return out;
}, [...cands]);

await b.close();
execSync(`rm -rf ${STAGE}`);

if (files.__err) { console.error(files.__err); process.exit(1); }
let total = 0;
for (const [name, bytes] of Object.entries(files)) {
  writeFileSync(`${outDir}/${name}`, Buffer.from(bytes));
  total += bytes.length;
}
console.log(`extracted ${Object.keys(files).length} files (${(total/1024).toFixed(0)} KB) to ${outDir}`);
