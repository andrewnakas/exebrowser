# Zork I, II and III (1980–1982)

Marc Blank, Dave Lebling, Bruce Daniels and Tim Anderson; published by Infocom.
Copyright Microsoft.

## Why this is hosted here

Open source: on 20 November 2025 Microsoft released Zork I, II and III under
the MIT licence (`LICENSE-zork.txt` in this directory; announcement at
https://opensource.microsoft.com/blog/2025/11/20/preserving-code-that-shaped-generations-zork-i-ii-and-iii-go-open-source/).
The licence covers the code in the three repositories below. It does not grant
any trademark rights, and none are claimed here.

## Source

Retrieved 2026-11-13. The story files are the `COMPILED/zorkN.z3` files that
ship inside each MIT-licensed repository, unmodified:

- `zork1.z3` — https://github.com/historicalsource/zork1 (commit `97b7b3d68c075dd9af7da499c3e9690ada3471fd`)
- `zork2.z3` — https://github.com/historicalsource/zork2 (commit `3da9661098809788a99cef00f00c865c6c204f96`)
- `zork3.z3` — https://github.com/historicalsource/zork3 (commit `3ec9ed412b5f3cafe65d83c727d07db1fe4a86a8`)

## Interpreter

`parchment.html` is Parchment 2026.8.23, the single-file build, by Dannii
Willis and contributors (MIT, `LICENSE-parchment.txt`; it bundles the Bocfel
Z-machine interpreter, also MIT), from
https://github.com/curiousdannii/parchment/releases/tag/2026.8.23
(release zip sha256 `2183f9aabbe9f31e13846a674b68da1c7e4c0ab7b6017ffcfed169354a31b86f`).

One change: `"use_proxy": 0` was added to its options block, so the page can
only load story files from this site and never calls a third-party proxy.

ExeBrowser is not affiliated with Microsoft, Infocom or the Parchment authors.
