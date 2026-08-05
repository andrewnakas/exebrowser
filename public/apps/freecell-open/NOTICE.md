# Open FreeCell — provenance

**Original work, written for ExeBrowser.** The HTML and JavaScript in this
directory were written from scratch for this site. There is no third-party
code, no decompiled binary, and no extracted artwork.

Licensed **MIT**, the same as the rest of the ExeBrowser frontend.

## What this is not

It is **not** Microsoft's `freecell.exe`, and it is not derived from it. That
software is proprietary and bundled with Windows (or the Microsoft
Entertainment Pack), and cannot be redistributed — which is exactly why this
exists. The corresponding bring-your-own-copy guide remains available for
people who want to run their own copy.

Game rules, board layouts and scoring conventions are not copyrightable. No
Microsoft code or assets were used.

## On the deal numbering

The deal generator reproduces the numbering the Windows games used, so a deal
number identifies the same layout here as it does there. That algorithm — a
linear congruential generator seeded with the deal number, driving a
deal-from-the-end shuffle — is publicly documented and has been reimplemented
independently many times; the reference implementation and expected output for
deal #1 are on Rosetta Code. It was written from that description, not taken
from any Microsoft binary. Deal #1 here matches the published reference
(J♦ 2♦ 9♥ J♣ 5♦ 7♥ 7♣ 5♥ across the eight columns), and #11982 is the same
famously unsolvable deal.
