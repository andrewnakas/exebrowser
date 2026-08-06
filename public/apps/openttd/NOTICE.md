# OpenTTD in WebAssembly — provenance

This directory is a WebAssembly build of **OpenTTD** together with the project's
own **free replacement assets**. It needs no files from the original
*Transport Tycoon Deluxe*, and none are included.

## The engine

**OpenTTD** — https://github.com/OpenTTD/OpenTTD — **GPL-2.0**.

OpenTTD is not a decompilation of Transport Tycoon Deluxe; it is an
independent reimplementation of the game, written from scratch, that has been
developed well past the original. Built here from the unmodified upstream
repository using OpenTTD's own in-tree Emscripten support
(`os/emscripten/`), with emsdk 6.0.1 — the version the project pins in its
own Dockerfile.

As GPL-2.0 requires, the corresponding source is available from the upstream
project linked above.

## The assets — free replacements, not Transport Tycoon's files

Early OpenTTD needed the original game's graphics. It doesn't any more: the
community produced complete free replacements, and those are what ship here.

| Baseset | What it replaces | Licence |
|---|---|---|
| **OpenGFX 7.1** | All graphics | GPL-2.0 |
| **OpenMSX 0.4.2** | All music | GPL-2.0 |

Both were downloaded from OpenTTD's own CDN (`cdn.openttd.org`) and are
included unmodified, with their licence files intact.

**OpenSFX** (sound effects, CC BY-SA 3.0) is *not* bundled: at 13 MB it would
push the Emscripten preload bundle past Cloudflare Pages' 25 MB per-file
limit. The game runs without it — sound is simply absent. It can be added
in-game through OpenTTD's own content downloader.

This is why OpenTTD is hostable when most reimplementation projects are not.
Engines are usually free; assets usually aren't. Here both are.

## What was changed

Nothing in the engine or the assets. OpenGFX's `.grf`/`.obg` files and
OpenMSX's `.mid`/`.obm` files were copied into the build's `baseset/`
directory before linking, so Emscripten preloads them into the virtual
filesystem — the mechanism OpenTTD's own build already uses for its default
baseset.

ExeBrowser is not affiliated with OpenTTD, and OpenTTD is not affiliated with
the makers of Transport Tycoon.
