# Open Rodent's Revenge — provenance

**Original work, written for ExeBrowser.** The HTML and JavaScript in this
directory were written from scratch for this site. No third-party code, no
decompiled binary, no extracted artwork — the mouse, cats and blocks are drawn
with canvas primitives.

Licensed **MIT**, the same as the rest of the ExeBrowser frontend.

## What this is not

It is **not** Microsoft's Rodent's Revenge, and it is not derived from it. That
game shipped in the *Microsoft Entertainment Pack* and is proprietary software
that cannot be redistributed — which is exactly why this exists.
`/run/rodents-revenge/` remains a bring-your-own-copy compatibility guide for
people who want to run the original.

Game rules and mechanics are not copyrightable. No Microsoft code or assets
were used.

## Rules implemented

You are a mouse on a grid of pushable blocks; cats hunt you. Pushing moves a
whole run of blocks at once, not just one. A cat sealed into a pocket it cannot
escape turns to cheese, which you eat for points. Clearing every cat advances
the level, which adds another cat and speeds them up.
