# Chess and chess puzzles — provenance

`index.html`, `play.js`, `puzzles.html`, `puzzles.js`, `board.js` and
`chess.css` were written for ExeBrowser and are licensed **GPL-3.0-or-later**,
because they combine with GPL components below. They are served unminified;
that is their source.

## Third-party parts (vendor/, fetched by scripts/build-chess.mjs)

| File | Project | Licence |
|---|---|---|
| `stockfish-19-lite-single.js` / `.wasm` | Stockfish 19 via [nmrugg/stockfish.js](https://github.com/nmrugg/stockfish.js) v19.0.1 — the single-threaded lite build, NNUE net built in | GPL-3.0 (`COPYING-stockfish.txt`); Stockfish source: https://github.com/official-stockfish/Stockfish |
| `chessground.min.js`, `chessground.*.css` | [lichess-org/chessground](https://github.com/lichess-org/chessground) 9.2.1; the cburnett piece set inside `chessground.cburnett.css` is by Colin M.L. Burnett | GPL-3.0-or-later (`LICENSE-chessground.txt`); pieces GPLv2+ |
| `chess.js` | [jhlywa/chess.js](https://github.com/jhlywa/chess.js) 1.4.0 | BSD-2-Clause (`LICENSE-chess.js.txt`) |

Every download is pinned to a sha256 in the build script.

## Puzzles

`puzzles.json` is a selection of about 4,600 puzzles from the
[Lichess puzzle database](https://database.lichess.org/#puzzles), which is
released under **CC0**. `node scripts/build-chess.mjs --puzzles` rebuilds it:
220 popular, well-tested puzzles per 100-point rating band from 600 to 2700.

## Ads

GPL-3.0, BSD-2 and CC0 all permit commercial use, so these pages may carry ads.
None of it needs SharedArrayBuffer or cross-origin isolation headers.
