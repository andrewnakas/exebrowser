# /64/ — experimental 64-bit wine64 runtime

Self-contained page that runs **real Debian wine64** in the browser, built from
[Boxedwine64](https://github.com/andrewnakas/Boxedwine64) (`wasm64-mt` target).
Linked from the homepage variant dropdown ("wine64 · 64-bit, experimental"),
which redirects here with `?chunked=1`.

## What's committed vs. not

Committed (small text): `index.html` (= `wine64.html`), `wine64-launcher.js`,
`boxedwine64.js`, `boxedwine-shell.js`, `boxedwine.css`, `coi-serviceworker.js`,
and the three `*.manifest.json` files.

**NOT committed** (gitignored — too big for GitHub's free LFS budget): the wasm
module and the rootfs binaries:

- `boxedwine64.wasm`
- `glibc-rootfs64.zip`, `prefix64.zip`
- `wine64.zip.part000` … `part009`

These live on local disk only. `wrangler pages deploy public` uploads them
straight to Cloudflare Pages from disk, so the deployed site has them even
though git doesn't.

## Regenerating the binaries

From a Boxedwine64 checkout (default: `~/Documents/boxedwine64/Boxedwine64`):

```bash
BW=~/Documents/boxedwine64/Boxedwine64
source ~/emsdk/emsdk_env.sh

# 1) Build the wasm64 multi-threaded runtime.
( cd "$BW/project/emscripten" && make wasm64-mt )

# 2) Build the rootfs zips (Docker-based) if not already in tools/rootfs64/dist/.
#    See tools/rootfs64/build-wine64-zip.sh etc.

# 3) Copy runtime artifacts here.
cp "$BW/project/emscripten/Build/Wasm64Mt/"{boxedwine64.wasm,boxedwine64.js,wine64.html,wine64-launcher.js,boxedwine-shell.js,boxedwine.css,coi-serviceworker.js} .
cp wine64.html index.html

# 4) Re-split the rootfs into <25 MB parts (Cloudflare Pages per-file cap).
#    Patch split-rootfs.sh's CHUNK_BYTES from 90 MiB to 20 MiB, then:
bash /path/to/split-rootfs.sh "$BW/tools/rootfs64/dist" .
```

## Why split into <25 MB parts

`wine64.zip` is ~196 MB. Cloudflare Pages caps individual files at 25 MB. The
launcher fetches the rootfs as same-origin `<zip>.partNNN` pieces listed in
`<zip>.manifest.json` and stitches them back in-browser before mounting
(`?chunked=1`). Same-origin parts also satisfy COEP `require-corp` with no CORP
header. COOP/COEP themselves come from the site-wide rule in `public/_headers`.
