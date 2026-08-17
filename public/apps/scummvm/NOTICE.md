# ScummVM in WebAssembly — provenance

This directory is a WebAssembly build of **ScummVM** (GPL-3.0). The games it
runs live in `/data/games/`, and every one of them was **released as freeware
by its own rights holders**. Nothing here is redistributed without permission.

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
| **Flight of the Amazon Queen** | John Passfield and Steve Stamatiadis | 15 March 2004, as freeware via the ScummVM project. The floppy release; the file's SHA-256 matches the checksum ScummVM publishes beside it |

The game's own 1995 title screen names **Interactive Binary Illusions** and
**Warner Interactive** and carries the retail "unauthorised copying" notice.
Interactive Binary Illusions was Passfield and Stamatiadis's own studio (later
Krome Studios), and it is they who released the game as freeware nine years
later; Warner was the publisher. The 2004 licence governs this copy. The
player-facing page says so out loud, because visitors see that screen.

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
with the game folders copied into `data/games/` and ScummVM's own
`build-make_http_index.py` re-run so its virtual filesystem can find them.

ExeBrowser is not affiliated with ScummVM, Revolution Software, L.K. Avalon, or the authors of
Flight of the Amazon Queen.
