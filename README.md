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

## Deploy

### Worker (one-time)

```bash
cd worker
npx wrangler deploy
# Note the deployed URL, update ROOT_FS_URL in public/app.js if it differs
```

### Pages

```bash
npx wrangler pages deploy public --project-name=exebrowser
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
