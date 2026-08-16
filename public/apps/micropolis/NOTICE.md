# Micropolis (micropolisJS) — provenance

This directory is a build of **micropolisJS**, a hand-written JavaScript port of
**Micropolis** — the city simulator Maxis originally released as *SimCity* in
1989, and which Electronic Arts released under the GPL in 2008 for the One
Laptop Per Child project.

It is not an emulator and there is no original binary here: it is a native
JavaScript game. Nothing from any commercial release of *SimCity* is included,
and none is needed to play.

## The game

**micropolisJS** — https://github.com/graememcc/micropolisJS — by Graeme
McCutcheon and contributors. Built from the unmodified upstream repository at
commit `f13a162` with its own toolchain (`npm run build`, webpack production
mode). The output in this directory is that build, copied verbatim; the game
code has not been modified.

Upstream in turn derives from **Micropolis** — https://github.com/SimHacker/micropolis —
the GPL release of the original Maxis source.

## Licence

**GPL-3.0, with the additional terms in `LICENSE`**, plus the **Micropolis
Public Name License** (`name_license.html`, `MicropolisPublicNameLicense.md`
upstream). Both files ship in this directory, as the licence requires: "any
propagation or conveyance of this program must include this copyright notice
and these terms". `COPYING` holds the GPL text.

Two obligations worth stating plainly, because they shape how this game is
presented on the site:

1. **The name is Micropolis, not SimCity.** EA retains the SimCity trademark
   and the licence forbids distributing this program under it, or claiming any
   affiliation or association with Electronic Arts. Our pages call the game
   Micropolis and refer to SimCity only as a statement of where the code came
   from — which is accurate and is not a claim of endorsement.
2. **MICROPOLIS is itself a registered trademark** of Micropolis Corporation
   (Micropolis GmbH), licensed to the upstream project as a courtesy of the
   owner under the Micropolis Public Name License. The notice to that effect is
   in the game's own footer and has been left exactly as upstream renders it.

As GPL-3.0 requires, the corresponding source is available from the upstream
project linked above.
