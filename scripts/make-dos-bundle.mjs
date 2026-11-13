#!/usr/bin/env node
// Builds public/apps/<slug>/<slug>.zip for a DOS game from its pinned source.
//
//   node scripts/make-dos-bundle.mjs <slug> [<slug>…]
//   node scripts/make-dos-bundle.mjs --all
//
// scripts/dos-sources.json is the record of exactly what ships: for each slug,
// the source URL, its sha256, the entry program and anything to strip. The
// source is downloaded once into assets-too-big-for-pages/dos/ and checked
// against the pinned sum, so a bundle can always be rebuilt byte-for-byte from
// the same files.
//
// The bundle is the source's game files unmodified plus ONE added file,
// .jsdos/dosbox.conf, whose [autoexec] starts the game. The `entry` field in
// app-pages.json is ignored for DOS pages; this conf is what decides.
//
// Source entry fields:
//   url       where the original archive came from (Internet Archive item file
//             URLs for the abandoned tier)
//   sha256    pinned sum of that file; the build fails on any mismatch. Leave
//             it out on first run and the script prints the sum to pin.
//   exe       entry program, relative to the bundle root ("OREGON/OREGON.EXE"
//             runs `cd OREGON` then `OREGON.EXE`). A .BAT works too.
//   args      optional command-line arguments for the entry program
//   root      optional directory inside the archive to treat as the root (for
//             archives that wrap the game in a folder we don't want)
//   strip     optional array of paths or *.ext globs the archive added (site
//             banners, .url shortcuts, the archive's own dosbox.conf).
//             file_id.diz is always stripped. Never take a source that ships
//             a cracking group's .nfo or intro: pick another item instead.
//   cycles    DOSBox cycles; default 8000. "max" for later 386/486 games.
//   inner     optional zip inside the archive that holds the game (some items
//             wrap the real zip in another one)
//   retrieved YYYY-MM-DD the source was fetched, copied into NOTICE.md
//   member    path of the game's zip inside `url`, when `url` is a tarball
//             holding many (the archived ftp.3drealms.com mirror). The tarball
//             is fetched once into dos/_shared/ and checked against
//             `urlSha256`; `sha256` then pins the member itself.
//   installer true (or {keys:[…], wait:s, exe:"INSTALL.EXE", after:[dos commands]}) when the archive
//             holds only an installer: it is run in our own DOSBox by
//             scripts/unpack-dos-installer.mjs and the bundle is what it
//             installs. `exe` is then relative to the installed tree.
//   keepAll   true to skip the default strip list below. For shareware whose
//             licence allows distribution only with every original file
//             present (file_id.diz included).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCES = path.join(ROOT, "scripts", "dos-sources.json");
const CACHE = path.join(ROOT, "assets-too-big-for-pages", "dos");
const MAX_BYTES = 25 * 1024 * 1024;

const sources = JSON.parse(fs.readFileSync(SOURCES, "utf8"));
const argv = process.argv.slice(2);
const slugs = argv.includes("--all") ? Object.keys(sources) : argv.filter((a) => !a.startsWith("--"));
if (!slugs.length) {
  console.error("usage: node scripts/make-dos-bundle.mjs <slug>… | --all");
  process.exit(2);
}

function conf(src) {
  const parts = src.exe.replace(/\\/g, "/").split("/");
  const exe = parts.pop();
  const cd = parts.length ? `cd ${parts.join("\\")}\n` : "";
  return `[cpu]
cycles=${src.cycles || 8000}

[dos]
xms=true
ems=true
umb=true

[mixer]
nosound=false
rate=44100
blocksize=1024
prebuffer=20

[sblaster]
sbtype=sb16
sbbase=220
irq=7
dma=1
hdma=5
mixer=true
oplmode=auto
oplrate=44100

[speaker]
pcspeaker=true
pcrate=44100

[autoexec]
@echo off
SET BLASTER=A220 I7 D1 H5 T6
mount c . >NUL
c:
cls
${cd}${exe}${src.args ? " " + src.args : ""}
`;
}

function globToRe(g) {
  return new RegExp("^" + g.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*") + "$", "i");
}

function walk(dir, rel = "") {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const r = rel ? `${rel}/${e.name}` : e.name;
    return e.isDirectory() ? walk(path.join(dir, e.name), r) : [r];
  });
}

let failed = 0;
for (const slug of slugs) {
  const src = sources[slug];
  if (!src) { console.error(`${slug}: not in scripts/dos-sources.json`); failed++; continue; }
  try {
    fs.mkdirSync(CACHE, { recursive: true });
    const ext = path.extname(src.member || new URL(src.url).pathname).toLowerCase() || ".zip";
    const file = path.join(CACHE, `${slug}${ext}`);
    if (!fs.existsSync(file) && src.member) {
      const shared = path.join(CACHE, "_shared", path.basename(new URL(src.url).pathname));
      fs.mkdirSync(path.dirname(shared), { recursive: true });
      if (!fs.existsSync(shared)) {
        console.log(`${slug}: downloading ${src.url}`);
        execFileSync("curl", ["-sSL", "--fail", "-o", shared, src.url], { stdio: "inherit" });
      }
      if (src.urlSha256) {
        const got = execFileSync("shasum", ["-a", "256", shared]).toString().split(" ")[0];
        if (got !== src.urlSha256) throw new Error(`tarball sha256 ${got} != pinned ${src.urlSha256}`);
      }
      fs.writeFileSync(file, execFileSync("tar", ["-xOf", shared, src.member], { maxBuffer: 1 << 28 }));
    } else if (!fs.existsSync(file)) {
      console.log(`${slug}: downloading ${src.url}`);
      execFileSync("curl", ["-sSL", "--fail", "-o", file, src.url], { stdio: "inherit" });
    }
    const sum = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
    if (!src.sha256) {
      console.log(`${slug}: no sha256 pinned — pin this: "sha256": "${sum}"`);
    } else if (sum !== src.sha256) {
      throw new Error(`source sha256 ${sum} != pinned ${src.sha256}`);
    }

    const work = path.join(CACHE, `${slug}.build`);
    fs.rmSync(work, { recursive: true, force: true });
    fs.mkdirSync(work, { recursive: true });
    execFileSync("unzip", ["-qq", "-o", file, "-d", work]);
    if (src.inner) {
      const inner = path.join(work, src.inner);
      const out = path.join(CACHE, `${slug}.inner`);
      fs.rmSync(out, { recursive: true, force: true });
      fs.mkdirSync(out);
      execFileSync("unzip", ["-qq", "-o", inner, "-d", out]);
      fs.rmSync(work, { recursive: true, force: true });
      fs.renameSync(out, work);
    }
    if (src.installer) {
      const o = src.installer === true ? {} : src.installer;
      const out = path.join(CACHE, `${slug}.installed`);
      const args = [path.join(ROOT, "scripts", "unpack-dos-installer.mjs"), file, out];
      if (o.keys) args.push("--keys", o.keys.join(","));
      if (o.wait) args.push("--wait", String(o.wait));
      if (o.exe) args.push("--exe", o.exe);
      if (o.after) args.push("--after", o.after.join(";"));
      execFileSync(process.execPath, args, { stdio: "inherit" });
      fs.rmSync(path.join(out, "_src"), { recursive: true, force: true });
      fs.rmSync(work, { recursive: true, force: true });
      fs.renameSync(out, work);
    }
    const base = src.root ? path.join(work, src.root) : work;
    if (!fs.existsSync(base)) throw new Error(`root ${src.root} not in archive`);

    // file_id.diz (a TOSEC catalogue card), *.ba1 launcher stubs and
    // "Recalbox Ready.txt" are added by archivists, not part of the game;
    // always drop them.
    const res = [...(src.keepAll ? [] : ["file_id.diz", "*.ba1", "Recalbox Ready.txt"]), ...(src.strip || [])].map(globToRe);
    for (const rel of walk(base)) {
      if (res.some((re) => re.test(rel) || re.test(path.basename(rel)))) fs.rmSync(path.join(base, rel));
    }
    // Anything the archive shipped under .jsdos/ is replaced by ours.
    fs.rmSync(path.join(base, ".jsdos"), { recursive: true, force: true });

    const entries = walk(base);
    const exeRel = src.exe.replace(/\\/g, "/");
    if (!entries.some((r) => r.toLowerCase() === exeRel.toLowerCase())) {
      throw new Error(`entry ${src.exe} not found; top-level: ${[...new Set(entries.map((r) => r.split("/")[0]))].slice(0, 20).join(", ")}`);
    }

    fs.mkdirSync(path.join(base, ".jsdos"));
    fs.writeFileSync(path.join(base, ".jsdos", "dosbox.conf"), conf(src));

    const outDir = path.join(ROOT, "public", "apps", slug);
    fs.mkdirSync(outDir, { recursive: true });
    const outZip = path.join(outDir, `${slug}.zip`);
    fs.rmSync(outZip, { force: true });
    execFileSync("zip", ["-qr", "-X", "-9", outZip, "."], { cwd: base });
    const size = fs.statSync(outZip).size;
    if (size > MAX_BYTES) throw new Error(`bundle is ${(size / 1048576).toFixed(1)} MB, over the 25 MB Pages cap`);
    fs.rmSync(work, { recursive: true, force: true });
    console.log(`${slug}: ${path.relative(ROOT, outZip)} ${(size / 1024).toFixed(0)} KB, ${entries.length} files, runs ${src.exe}`);
  } catch (e) {
    console.error(`${slug}: FAILED — ${e.message}`);
    failed++;
  }
}
process.exit(failed ? 1 : 0);
