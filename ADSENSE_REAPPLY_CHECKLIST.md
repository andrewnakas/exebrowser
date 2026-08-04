# AdSense Re-Apply Checklist

The site was rejected for **"low value content."** The repo-side fixes (honest
titles on all non-playable `/run` pages, screenshots, expanded blog, author
identity, COEP removal so ads can actually render) are done in code. The steps
below are the **manual, dashboard-side** actions only you can do, in order.

## 1. Before / at deploy

- [ ] **Cloudflare Email Routing** (dash → exebrowser.com → Email → Email Routing):
      create address `hello@exebrowser.com` → forward to `treesixtyweather@gmail.com`,
      then verify the destination address. The contact page now lists this address.
- [ ] **Cloudflare bot protection** (dash → Security → Bots): make sure
      **Bot Fight Mode is OFF** (or at minimum that *verified bots* are allowed).
      During the audit, non-browser fetchers got HTTP 403 from the site — if
      Google's AdSense review crawler (`Mediapartners-Google`) gets challenged,
      the reviewer sees an empty site and "low value content" is the automatic
      verdict. Also check Security → WAF for any custom rules that could catch
      crawlers.
- [ ] Deploy (git push → Pages build), then sanity-check in an incognito window:
      - `https://exebrowser.com/run/` shows the new "Play now / bring your own
        copy" grouping.
      - A guide page (e.g. `/run/hearts/`) has the new honest title in the tab.
      - Homepage still boots Wine; `/run/doom/` still plays DOOM.

## 2. Search Console (first day)

- [ ] Property `exebrowser.com` → **Sitemaps**: confirm `sitemap.xml` is
      submitted and shows Success (re-submit to nudge a re-crawl).
- [ ] **URL Inspection** → *Request Indexing* for the ~15 most important URLs:
      `/`, `/run/`, `/guide/`, `/blog/`, all 7 blog posts, `/about/`, and a few
      hosted app pages (`/run/doom/`, `/run/space-cadet-open/`, `/run/skifree/`,
      `/run/7-zip/`).
- [ ] **Settings → Crawl stats**: look for 403/blocked responses to Googlebot in
      the last 90 days. Any 403s = go back to the Cloudflare bot step.
- [ ] Check **Indexing → Pages**: today only ~1 page is indexed. The goal before
      re-applying is that most of the 64 sitemap URLs are either *Indexed* or at
      least *Crawled*. Pages stuck at "Crawled – currently not indexed" for
      weeks are Google's quality signal — tell Claude and we iterate on those
      specific pages.

## 3. The waiting period (2–4 weeks)

- [ ] **Publish one blog post every 1–2 weeks** during the wait ("site is
      regularly updated" is an explicit AdSense minimum-requirement). Easiest
      path: ask Claude for a new post; remember each new post must also be added
      to `STATIC_URLS` in `scripts/gen-app-pages.mjs` and the `/blog/` index,
      then regenerate (`node scripts/gen-app-pages.mjs`).
- [ ] Watch Search Console indexing counts weekly.
- [ ] Do **not** request the AdSense review until key pages are indexed —
      premature repeat requests hurt.

## 4. Re-apply

- [ ] AdSense → Sites → exebrowser.com → fix issues → **Request review**.
      Reviews take from a few days up to ~2–4 weeks.
- [ ] While waiting, don't make large structural changes to the site.

## 5. After approval

- [ ] Place ad units on **content pages first** (blog posts, guide, compatibility
      guide pages) — long-form pages carry ads best and are policy-safest.
- [ ] Keep ads off the `/64/` experimental pages (they keep the cross-origin
      isolation headers that block ad iframes — by design, no ads there).
- [ ] Avoid ads directly inside/over the emulator canvas area ("ads must not
      interfere with content").

## Reference: what was changed in the repo and why

| Change | AdSense policy it addresses |
|---|---|
| ~41 `/run` pages retitled from "Play X Online — No Download" to honest compatibility-guide titles; embed button no longer says "Play X" without a hosted payload | Misleading functionality / doorway pages ("claiming services you don't have") |
| `/run/` hub + homepage cards regrouped into "Play now (hosted)" vs "bring your own copy" | Same |
| "Guide updated <month year>" + tested-runtime line on every app page; sitemap `<lastmod>` | Freshness / "regularly updated" |
| Screenshots of hosted apps on app pages + og:image | "Thin content with little added value" |
| Blog expanded from 3×~500-word posts to 7 posts of 1,200+ words with author bylines | Minimum content requirements / added value |
| About page names the maintainer; blog posts carry Person authorship schema; hello@exebrowser.com | E-E-A-T / publisher identity |
| COOP/COEP removed everywhere except `/64/*` (the 32-bit runtime never used SharedArrayBuffer) | Ads physically couldn't render under `COEP: require-corp` |
