# NetHack — provenance

## The game

`vendor/nethack.js` and `vendor/nethack.wasm` are **NetHack 3.6.7**, © the
NetHack DevTeam, built from the official source
(https://github.com/NetHack/NetHack) to WebAssembly by the
[@neth4ck/wasm-367](https://www.npmjs.com/package/@neth4ck/wasm-367) package,
version 2.1.2. It is distributed under the **NetHack General Public License**
(`vendor/LICENSE.md`), which allows redistribution, including commercially,
provided the licence accompanies it and the source is available — the official
source is linked above. `node scripts/build-nethack.mjs` fetches the package and
checks its sha256.

The build uses Asyncify and no threads, so it needs no SharedArrayBuffer or
cross-origin isolation headers.

## The window port

`nethack-ui.js` and `index.html` were written for ExeBrowser. They implement
NetHack's window-port callbacks: the map, messages, status lines, menus,
prompts, keyboard and touch input, and saving to IndexedDB. Like any
modification distributed with NetHack, they are offered under the NetHack
General Public License.
