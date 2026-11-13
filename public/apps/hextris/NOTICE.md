# Hextris (2014)

Logan Engstrom, Garrett Finucane, Noah Moroze and Michael Yang.

## Why this is hosted here

Open source: Hextris is published by its authors under the GNU General Public
License v3 (`LICENSE.md` in this directory).

## Source

Retrieved 2026-11-13 from https://github.com/Hextris/hextris
(commit `3f4847dc8fd7dab3d1c87e6324b9159d92fbd396`).

## Changes made here (GPL-3 section 5 notice, 2026-11-13)

The game itself is unchanged. These were removed so the page makes no
third-party requests:

- `index.html`: the Google AdSense script, the Google Analytics snippet, the Google Fonts stylesheet link
  and the web-app manifest link; the social-share buttons and app-store badges
  are hidden with one added `<style>` rule.
- `js/initialization.js`: the second Google Analytics snippet.
- `js/main.js`: the request that reported each final score to a remote server,
  and the loader that fetched `a.js` from hextris.io.
- Not shipped: `a.js`, `CNAME`, `README.md`, `manifest.webmanifest`.

The modified source is exactly the files in this directory.

ExeBrowser is not affiliated with the authors.
