# ExeBrowser

Run Windows `.exe` files directly in your browser using WebAssembly + Wine. No installation, no upload. Live at https://exebrowser.com.

Built on [Boxedwine](https://www.boxedwine.org/) (Wine + a 32-bit x86 CPU emulator compiled to WebAssembly).

## Architecture

```
exebrowser.com   ────►  public/                 (Cloudflare Pages — static)
                          index.html, app.js, style.css
                          boxedwine/build/default/*    (runtime, ~2.5MB)
                          boxedwine/apps/*-min-online.zip  (overlay, ~9.3MB)

                ────►  boxedwine-assets.exebrowser.workers.dev  (Cloudflare Worker)
                          /fs/fullWine1.7.55-v8.zip   (50MB Wine root, range-fetched)
```

The Worker proxies the 50MB Wine root from `boxedwine.org` with CORS + range support (Cloudflare Pages free tier caps file size at 25MB).

## Local dev

```bash
# (one-time) fetch the Boxedwine runtime
./scripts/fetch-runtime.sh

# serve public/ on http://localhost:8765
python3 -m http.server 8765 --directory public
```

For local testing without the Worker, edit `public/app.js` and change `ROOT_FS_URL` to point at a local copy.

## Adding or changing a game

Every `/run/<slug>/` page is generated from `scripts/app-pages.json` — never
hand-edit the HTML, it gets overwritten.

Run all seven, in this order — the last two depend on the output of the others,
and running them out of order silently loses work:

```bash
# 1. all /run/ pages, the hub, /play/ category pages, 404, sitemap, feed, llms.txt
node scripts/gen-app-pages.mjs

# 1b. localised copies of the hand-maintained utility pages (/es/load-exe/ etc).
#     After step 1, because step 1 owns the sitemap and lists what this writes.
node scripts/gen-static-pages.mjs

# 2. the homepage's shelf, filter, ItemList and blog strip, in place
node scripts/gen-home-grid.mjs

# 3. /unblocked/ — the intent-modifier landing page
node scripts/gen-unblocked.mjs

# 4. /embed/ — the hub for the embed offer
node scripts/gen-embed-hub.mjs

# 5. head links onto the ~35 hand-maintained pages the generators don't own
node scripts/inject-page-links.mjs

# 5b. /embed/<slug>/ wrappers for our own games (a new own-work game fails
#     step 6 until this has run)
node scripts/gen-embeds.mjs

# 5c. the Mediavine ad tag: added where scripts/ads.mjs allows it, removed
#     everywhere else. Generators write pages without it, so this runs LAST;
#     step 6 fails if any page disagrees with the rule.
node scripts/inject-ads.mjs

# 6. check nothing drifted out of sync
node scripts/check-consistency.mjs
```

Some game data is too large for git and is gitignored, like `public/64/`. It
is rebuilt from a pinned, checksummed upstream release, and **must be on disk
before `wrangler pages deploy`**, or the deploy ships a page whose game 404s:

```bash
node scripts/build-librequake-data.mjs   # public/apps/librequake/id1/ (~79 MB)
node scripts/build-warzone2100-data.mjs  # public/apps/warzone2100/ parts, wasm, music (~87 MB)
```

### Hand-translated game pages

Generated `/run/` pages are localised from `scripts/i18n/pages.<lang>.json`.
Pages marked `skipGenerate` can't be: the generator never writes them, in any
language. Two of them are translated by hand anyway, because they are among the
most-played titles: `space-cadet-open` and `parkhaven`, in es, pt-BR, zh-CN and
fr. That means eight HTML files under `public/<lang>/run/<slug>/`.

Each one also has an entry in `pages.<lang>.json`. That entry is what puts the
page in the sitemap and the `/xx/run/` listing, and what makes
`inject-page-links.mjs` stamp reciprocal hreflang and a language switcher onto
both the English page and its copies. **When the English page changes, update
the eight copies by hand.** Nothing regenerates them.

### The logic puzzles

`public/apps/puzzles/` is Simon Tatham's Portable Puzzle Collection (MIT),
built from a pinned, sha-checked source tarball by
`node scripts/build-puzzles.mjs` (needs emcc and cmake). The output is small
and committed. Each frame uses the collection's fit-to-container mode, so a
puzzle fills its iframe at any width; its `/run/` page sets `iframeHeight`
rather than the default 16:10 box.

### Board games and NetHack

These are web apps under `public/apps/<slug>/`, shown on their `/run/` page in
an iframe (`iframeUrl`). Their third-party parts are fetched by pinned,
sha-checked scripts. The output is small and is committed, so these only need
re-running to change a version:

```bash
node scripts/build-chess.mjs             # Stockfish 19 lite-single, chessground, chess.js → apps/chess/vendor/
node scripts/build-chess.mjs --puzzles   # also re-cut apps/chess/puzzles.json from the Lichess CC0 database (needs zstd)
node scripts/build-mahjong-tiles.mjs     # CC0 riichi tile SVGs → apps/mahjong/tiles/
node scripts/build-nethack.mjs           # NetHack 3.6.7 wasm (@neth4ck/wasm-367) → apps/nethack/vendor/
```

Checkers, Reversi, Four in a Row, Backgammon and Mahjong are our own code
(MIT). The chess pages are GPL-3.0 because Stockfish and chessground are. The
NetHack window port, `apps/nethack/nethack-ui.js`, is ours and goes with the
NetHack General Public License. None of them needs SharedArrayBuffer or
COOP/COEP headers, which would block ad iframes.

### Adding a DOS game

Every hosted title carries a `provenance` in `app-pages.json`: `clean`,
`open`, `freeware`, `shareware` or `grey`. Grey means abandoned: a commercial
game that no store sells today, hosted under the `/takedown/` policy. The
consistency check holds grey titles to three rules. They never get `adsOk`.
They need `public/apps/<slug>/NOTICE.md` with a `Not sold:` line naming the
stores checked and the date. And no title marked `sold` may be hosted.

```bash
# 1. pin the source in scripts/dos-sources.json (url, sha256, exe, strip, cycles)
node scripts/make-dos-bundle.mjs <slug>     # → public/apps/<slug>/<slug>.zip
# 2. it must draw a picture before its page may say "play"
node scripts/boot-test.mjs <slug> [--keys Enter] [--shot]
```

Three optional source fields cover the awkward packages. `installer` is for an
archive that holds only the publisher's INSTALL.EXE: the bundler runs it inside
our own DOSBox (`scripts/unpack-dos-installer.mjs`, which needs Chrome and
playwright-core like the boot test) and bundles what it installs; its `keys`
and `after` lists also drive a game's sound-setup program when the game will
not start without one (see `shadow-warrior` and `realms-of-chaos`). `member`
names a zip inside a tarball `url`, used for the archived ftp.3drealms.com
mirror that most Apogee shareware comes from. `keepAll` skips the default
strip list, for shareware whose licence requires every original file.

`boot-test.mjs` serves `public/` itself and loads the bundle into a bare DOS
embed, so a title can be tested before it has a page. It judges the
emulator's canvas buffer, not a page screenshot. `--shot` writes the page
screenshot from that same canvas. Failures land in
`assets-too-big-for-pages/boot-shots/` to look at.

Steps 3 and 4 were previously undocumented, which is how `/unblocked/` came to
sit on a stale `save-core.js` version: every other generator was bumped, that
one was not, and it would have reverted the page the next time anyone ran it.
The consistency check now fails when one asset is referenced at two versions.

The consistency check exists because the same class of bug kept recurring:
a page states something that was true when written and quietly stopped being
true when a game was added or a payload rebuilt. It verifies that hosted
payloads exist and fit the 25 MB Cloudflare Pages limit, that declared
screenshots are on disk, that **every** internal link resolves (not just
`/run/` ones — `_redirects` rules count as resolving), that hreflang
alternates exist and point back, that the sitemap lists every indexable page
and nothing else, that the blog compatibility table matches the live verdicts,
that no hosted game still claims it can't be played here, that guides link to
the playable version of the game they describe, that every `/play/`
category page carries its word floor of original prose, that no `related` card
links to the page it sits on or contradicts its own title, and that a localised
page translates every prose field its English original fills rather than
silently falling back to English. It exits non-zero, so
it can gate a deploy.

## After deploying

```bash
npx wrangler pages deploy public --project-name=exebrowser --branch=main
node scripts/indexnow.mjs        # tell Bing/DuckDuckGo/Yandex what changed
```

`--branch=main` is mandatory, not tidiness. Without it wrangler infers the
branch from git and ships a *preview* deployment, which succeeds, prints a URL,
and leaves production untouched.

`indexnow.mjs` is not optional housekeeping: Bing is this site's largest search
channel by roughly two to one, IndexNow gets URLs crawled in hours rather than
weeks, and Google ignores it entirely (Search Console is the only lever there).
Run it *after* the deploy is live — the endpoint fetches the URLs to verify
them, so submitting first wastes the ping.

**`window.__I18N` must be emitted before the scripts that read it.** embed.js,
app.js and dos-embed.js are IIFEs that run on parse, so a translation block
placed after them is set too late: every `T()` silently returns its English
fallback and you get a fully translated page wrapping an English application.
Nothing fails, and the HTML looks correct. Only loading the page shows it.

**Always boot-test a new payload before writing "play online" copy** — judge
the canvas buffer, not a screenshot of the page around it, and check the DOS
banner in the console output to confirm which edition of an engine you're
actually running.

## Deploy

### Worker (one-time)

```bash
cd worker
npx wrangler deploy
# Note the deployed URL, update ROOT_FS_URL in public/app.js if it differs
```

### Pages

```bash
npx wrangler pages deploy public --project-name=exebrowser --branch=main
```

Then in the Cloudflare dashboard:
1. Add custom domain `exebrowser.com` and `www.exebrowser.com`
2. Verify `_headers` is applied (COOP/COEP must be present for SharedArrayBuffer)

## Refreshing the runtime

```bash
./scripts/fetch-runtime.sh
```

This re-downloads Boxedwine's published JS/WASM from `boxedwine.org`. Commit the updated files in `public/boxedwine/`.

## License

ExeBrowser frontend: MIT. Boxedwine (bundled in `public/boxedwine/`) is GPL-2.0. Wine is LGPL.
