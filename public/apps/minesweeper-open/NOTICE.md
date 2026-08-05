# Open Minesweeper — provenance

**Original work, written for ExeBrowser.** `minesweeper.js` and `index.html` in
this directory were written from scratch for this site. There is no third-party
code, no decompiled binary, and no extracted artwork — the board is CSS bevels
and Unicode glyphs.

Licensed **MIT**, the same as the rest of the ExeBrowser frontend.

## What this is not

It is **not** Microsoft's `winmine.exe`, and it is not derived from it.
Microsoft's Minesweeper is proprietary software bundled with Windows and cannot
be redistributed, which is exactly why this exists. `/run/minesweeper/` remains
a bring-your-own-copy compatibility guide for people who want to run their own
`winmine.exe`; this is a free, hostable alternative that plays the same game.

The rules of Minesweeper, the three standard board sizes, and the convention of
colouring the numbers 1–8 are not copyrightable. No Microsoft code or assets
were used.

## Rules implemented

Standard Minesweeper on the three Windows board sizes — Beginner 9×9/10,
Intermediate 16×16/40, Expert 30×16/99. Numbers count mines in all eight
neighbours; blank squares flood-fill their region; flags mark suspected mines
and decrement the counter.

Two behaviours worth noting because clones often omit them:

- **First-click safety.** Mines are placed *after* the first click and never on
  or adjacent to it, so the opening move always reveals a clear region. This
  matches modern Windows releases; the earliest ones could lose on move one.
- **Chording.** Clicking a number whose flag count already matches opens all
  its remaining neighbours at once — the technique fast play depends on.
