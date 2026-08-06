# ScummVM in WebAssembly — provenance

This directory is a WebAssembly build of **ScummVM** (GPL-3.0) together with
**three adventure games that their own rights holders released as freeware**.
Nothing here is redistributed without permission.

## The engine

**ScummVM** — https://github.com/scummvm/scummvm — GPL-3.0. Built from source
with ScummVM's own in-tree Emscripten backend
(`dists/emscripten/build.sh`), using emsdk 4.0.10 as the project pins.

Built with `--disable-all-engines --enable-engine=sky,lure,queen,cge,agi,griffon`
so the binary carries only the engines these games need, rather than all ~80.

Source for this build is the unmodified upstream repository at the commit
fetched on 2026-08-06. As GPL-3.0 requires, the corresponding source is
available from the upstream project linked above.

## The games — all released as freeware by their rights holders

| Game | Rights holder | Released |
|---|---|---|
| **Beneath a Steel Sky** | Revolution Software | 2 August 2003, as freeware *specifically for use with ScummVM*, source code included |
| **Lure of the Temptress** | Revolution Software | 1 April 2003, as freeware. The source was lost, so ScummVM reverse-engineered the engine |
| **Sołtys** | L.K. Avalon | November 2011, as freeware via the ScummVM website |

Each was obtained from ScummVM's own distribution at
https://downloads.scummvm.org/frs/extras/ — the channel the rights holders
themselves chose for these releases.

This matters: these are not abandonware, not "grandfathered" freeware of
uncertain status, and not shareware episodes. In each case the company that
owns the game deliberately released it for free, and ScummVM distributes it
with their blessing. That is a stronger provenance than most of the DOS
shareware elsewhere on this site.

## What was changed

Nothing in the engine or the game data. The build output is used as produced,
with the three game folders copied into `data/games/` and ScummVM's own
`build-make_http_index.py` re-run so its virtual filesystem can find them.

ExeBrowser is not affiliated with ScummVM, Revolution Software, or L.K. Avalon.
