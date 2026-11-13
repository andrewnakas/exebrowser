# Neverball on exebrowser.com: notice and provenance

This directory runs **Neverball**, the free rolling-ball game, using the
project's own web build, "Neverball in the browser" by Jānis Rūcis
(https://play.neverball.org/).

## Licence

Neverball is released under the **GNU General Public License, version 2 or
later**. `LICENSE.md` is the project's licensing notes and `COPYING.GPL-2` is the
licence text. The browser build also uses Emscripten and gl4es, as its own page
says.

## Source code

The complete source for this build is the `neverball-source.zip` that
play.neverball.org published alongside it (sha256
`47191a04f0645570ac8c0bcd1c2162a571849ee0949dc8c5e75892312affc0c2`, 43.6 MB).
Because this host refuses files over 25 MB, it is served here in three parts:

    /apps/neverball/neverball-source.zip.part0
    /apps/neverball/neverball-source.zip.part1
    /apps/neverball/neverball-source.zip.part2

Download all three and join them in order to get the original zip:

    cat neverball-source.zip.part0 neverball-source.zip.part1 neverball-source.zip.part2 > neverball-source.zip

(on Windows: `copy /b neverball-source.zip.part0+neverball-source.zip.part1+neverball-source.zip.part2 neverball-source.zip`).
The project's repository is https://github.com/Neverball/neverball.

## What is here

Built by `scripts/build-neverball-data.mjs` from the files at
https://play.neverball.org/ as retrieved on 2026-11-13, each pinned by sha256 in
that script.

- `neverball.wasm`, `neverball.js`, `favicon.svg`, `anim.mp4`, `anim.jpg`: unchanged.
- `neverball.data` (27.6 MB) is served as two parts, cut in order without any
  other change; `neverball.parts.json` lists them.
- `index.html` is upstream's page with these edits (2026-11-13): the data parts
  are downloaded and joined before the engine starts and passed to the
  unchanged glue; upstream's service worker and web-app manifest are not used;
  its one `alert()` writes to the console instead; the source link points at
  this notice; and the page is marked noindex.
- `packages/available-packages.txt` is empty, so the launcher page lists no
  add-on downloads. The game's own Addons menu still asks
  play.neverball.org for its add-on list; that address is compiled into the
  upstream build.

ExeBrowser is not affiliated with the Neverball project.
