# SuperTux on exebrowser.com: notice and provenance

This directory runs **SuperTux 0.6.3**, the free side-scrolling platformer by the
SuperTux Devel Team, using the project's own official WebAssembly build.

## Licence

- Code: **GNU General Public License v3 or later** (`COPYING` in this directory).
- Data (levels, graphics, music): mostly **CC BY-SA** and GPL, as set out in the
  SuperTux source tree; credits are in the game's own Credits menu.
- Source: https://github.com/SuperTux/supertux at tag `v0.6.3`
  (source archive: https://github.com/SuperTux/supertux/releases/tag/v0.6.3).

## What is here

Built by `scripts/build-supertux-data.mjs` from the official release asset
`SuperTux-v0.6.3-WASM.zip`
(https://github.com/SuperTux/supertux/releases/download/v0.6.3/SuperTux-v0.6.3-WASM.zip,
sha256 `f9fa6eed36d403a283f3c544540b8a45b6c110375c1824e137ce1b4357e2d5df`), retrieved 2026-11-13.

- `supertux2.wasm`, `supertux2.js`, `supertux2.worker.js`, `supertux2.png`,
  `supertux2_bkg.png`: unchanged.
- `supertux2.data` (246 MB) is served as `supertux2.data.part0` … `part11`, cut
  in order without any other change, because the host refuses files over 25 MB.
  `supertux2.parts.json` lists the parts and the sha256 of the whole bundle.
- `index.html` is the release's `supertux2.html` with three edits (2026-11-13):
  its three `alert()` warnings write to the console instead; the script tag for
  `supertux2.js` is replaced by a loader that downloads the parts, joins them
  and passes them to the unchanged glue; and the page is titled "SuperTux" and
  marked noindex.
- `launch.html` was written for exebrowser.com (GPL-3.0-or-later). It is the
  small frame shown on /run/supertux/ that links to this directory.

ExeBrowser is not affiliated with the SuperTux project.
