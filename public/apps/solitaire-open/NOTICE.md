# Open Solitaire — provenance

**Original work, written for ExeBrowser.** `solitaire.js` and `index.html` in
this directory were written from scratch for this site. There is no third-party
code, no decompiled binary, and no extracted artwork here — the cards are drawn
with CSS and a canvas, from Unicode suit characters.

Licensed **MIT**, the same as the rest of the ExeBrowser frontend.

## What this is not

It is **not** Microsoft's `sol.exe`, and it is not derived from it. Microsoft's
Solitaire is proprietary software bundled with Windows and cannot be
redistributed, which is exactly why this exists. `/run/solitaire/` remains a
bring-your-own-copy compatibility guide for people who want to run their own
`sol.exe`; this is a free, hostable alternative that plays the same game.

It is also not a port of [DualBrain/Solitaire](https://github.com/DualBrain/Solitaire)
(MIT, VB.NET). That project targets `net8.0-windows` with WinForms, which needs
the .NET 8 desktop runtime — browser-based Wine 1.7.55 cannot provide it, so
that codebase cannot run here at all. Only the idea of a freely-licensed
Solitaire is shared; no code was taken from it.

## Rules implemented

Standard Klondike: seven tableau columns dealt 1..7 with only the last card
face up; four foundations built up by suit from the ace; tableau builds down in
alternating colours; only a king (or a run headed by a king) may fill an empty
column; draw 1 or draw 3 with unlimited redeals.

Scoring follows the conventions the Windows version used — Standard (+10 to a
foundation, +5 for turning a tableau card, +5 waste→tableau, −15 off a
foundation, −100 per redeal in draw-1, −2 per 10 seconds after the first 30,
plus a time bonus on a win) and Vegas (−$52 for the deck, +$5 per card sent
home). The rules and point values of Klondike are not copyrightable; no
Microsoft code or assets were used to implement them.
