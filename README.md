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

Run all six, in this order — the last two depend on the output of the others,
and running them out of order silently loses work:

```bash
# 1. all /run/ pages, the hub, /play/ category pages, 404, sitemap, feed, llms.txt
node scripts/gen-app-pages.mjs

# 2. the homepage's shelf, filter, ItemList and blog strip, in place
node scripts/gen-home-grid.mjs

# 3. /unblocked/ — the intent-modifier landing page
node scripts/gen-unblocked.mjs

# 4. /embed/ — the hub for the embed offer
node scripts/gen-embed-hub.mjs

# 5. head links onto the ~35 hand-maintained pages the generators don't own
node scripts/inject-page-links.mjs

# 6. check nothing drifted out of sync
node scripts/check-consistency.mjs
```

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
