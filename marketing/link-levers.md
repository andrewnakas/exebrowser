# Link levers — ranked, drafted, ready to fire

Written 2026-09-21, from the funnel read of the same date.

## Why this file exists

The [10k bet](10k-bet.md) rests on embeds, and embeds rest on other people
knowing the offer exists. The 09-21 read established two things:

1. **On-page work is finished as a lever.** The DOOM title test won outright
   (Bing weekday clicks 113 → 144/day, bare `doom` CTR 4.49% → 5.72%), and the
   impression ceiling still only moved to ~1,800 users/day at a physically
   impossible 100% CTR.
2. **Referring domains: 4.** cloudspress, itechfaqs, itechguides, decompgames.
   Bing Webmaster's own top recommendation for the site is now "your site does
   not have enough inbound links from high quality domains."

So: links, or nothing. Everything below needs Andrew's account — none of it can
be fired by an agent, and none of it should be.

## What was fixed on the site side first

The embed offer was only ever rendered on the 11 pages licensed to carry it, and
those 11 earn ~120 of the site's 47,900 monthly Bing impressions — **0.25%**.
`/run/doom/` earns 37,600 and mentioned the offer nowhere above the footer.
`embed_copy` firing twice a week was never a demand signal.

Shipped 2026-09-21: an embed **pointer** on 75 pages routing to `/embed/`, with
an `embed_pointer_click` event. That removes the excuse that nobody was asked.
It does not remove the need for the items below — a player is not a webmaster,
and the conversion rate from this will be low even when it works.

---

## 1. Show HN — Open Cadet · **highest value, ready now**

Fully drafted in [show-hn-open-cadet.md](show-hn-open-cadet.md). Re-dated to
**Tuesday 2026-09-22, 08:30 ET**. Every prerequisite re-verified live on 09-21:
repo 200, NOTICE.md 200, playable build 200, README links the playable build.

This is the best single shot at a *dofollow* link from a real publication,
because it is the only asset here with a story a writer would cover on its own
merits. Post it, answer comments for two hours, judge it on referring domains a
fortnight later.

## 2. Upstream: k4zmu2a/SpaceCadetPinball · **best relevance-to-effort on the list**

**4.7k stars.** Its README says only: *"Place compiled executable into a folder
containing original game resources (not included)."* It never says where to get
them legally, and the issue tracker has been circling that gap for years —
**#243**, **#233**, **#223**, **#197** are all data-file confusion, and
**#105 "Ability to add custom assets separately"** is Open Cadet's exact shape.
Searched 09-21: **no existing issue mentions CC0 or free replacement assets.**

Open Cadet is the answer to the most-repeated question in that repo. Raising it
there is a contribution, not promotion.

**Honest caveat:** GitHub user content is `rel="nofollow"`, so this passes no
direct ranking signal. Its value is **discovery** — it puts the project in front
of the exact audience that writes retro-computing posts, and those posts are
dofollow. Treat it as feeding lever 4, not as a link itself.

Draft, as a new issue (not a PR to the README — let the maintainer decide that):

> **Title:** CC0 replacement data files, so the engine can run without Windows resources
>
> Not a bug report — a pointer, in case it's useful to people hitting the
> "original game resources (not included)" step (#243, #223, #197 and others).
>
> I've put together a complete CC0 set of replacement data files:
> https://github.com/andrewnakas/open-cadet
>
> Every bitmap is procedurally generated, all 47 sounds are synthesised from
> sine/noise/decay envelopes, and the whole set is dedicated CC0. Nothing was
> copied from Microsoft's files. The group names, record type codes,
> wall-segment coordinates, component positions, physics constants and camera
> matrix are reused as facts for interoperability — NOTICE.md walks through
> which is which, file by file, since that's the part worth checking.
>
> The table looks different as a direct result — it's a neon redraw, not a
> copy of the beige-and-chrome original. That's the honest consequence of the
> art being newly created.
>
> Your engine is unchanged and unbundled; this is purely a data set that loads
> in it. Happy to be told the copyright analysis is wrong — that's the part I'd
> most like scrutinised. If it's useful enough to mention in the README I'd be
> glad, but no expectation either way.

**Do not** post this the same day as the Show HN. Space it by a few days, and
let the HN thread's scrutiny of the legal split happen first — if someone finds
a hole in it there, you want to know before raising it upstream.

## 3. Awesome-list PRs · low effort, low-moderate value

Also nofollow, also discovery rather than ranking. Worth an hour, not a week.

- **mcuking/Awesome-WebAssembly-Applications** — the best fit by far. It lists
  client-side browser applications, several with near-identical pitches to this
  one ("files never leave the browser"). ExeBrowser is Wine + an x86 emulator
  compiled to WASM running real `.exe` files locally; that belongs on the list
  on merit.
- **mbasso/awesome-wasm** — the canonical ecosystem list.
- **pventuzelo/awesome-wasm-examples** — narrower, examples-focused.

Read each list's CONTRIBUTING before opening a PR; several auto-reject entries
that don't match the existing one-line format. One entry per list, matching
their format exactly, no marketing adjectives.

## 4. Cold outreach to real blogs · slowest, but the only *dofollow* source at volume

Plan, email template and target categories are in
[embed-outreach.md](embed-outreach.md) and still stand. Its sequence step 1
("build a list of 20 targets with a real, specific first line for each") is
still the blocker and is still unstarted.

**A note found while researching on 09-21:** searching for
`"free games for your website"` returns almost entirely *competitors* —
Playpager, Y8, Gamezop, GameZipper, iDev.Games, 1000webgames, onlinegames.io.
These are portals that want traffic, not blogs that give links. They are not
targets. The targets are categories 1 and 2 of the outreach plan — teacher and
school-IT blogs, and retro-computing writers — and those have to be found one at
a time by reading what they actually publish. Twenty considered emails beat two
hundred templated ones, and templated outreach is how a domain acquires a spam
reputation it cannot shed.

---

## Settled 2026-09-21 — Space Cadet is now embeddable

Decided yes. `/run/space-cadet-open/` is in the embed offer, live, and leads the
`/embed/` list. It is the most recognisable title in the catalogue and the offer
is much stronger for it. The eligibility rule now lives in `catalogue.mjs` as
`embedTier()` — three scripts had each been testing the same author regex, which
is a licensing question that must not drift between them.

It needed more than a list entry. Nearly every claim on `/embed/` was written
for eleven hand-written games and is **false** of a WebAssembly pinball engine:
"written from scratch rather than emulated", "the largest is 48 KB, less than a
single photograph", "every game here is small", "the games are responsive",
"every game has touch controls". The page now describes two tiers and states the
trade-off in the visitor's terms — the eleven are 14–48 KB, Space Cadet is
**6.1 MB**, every frame is lazy-loaded, and budget for it if it goes above the
fold. The small-game size figure is now measured across those games only, so a
heavy title can never quietly falsify it again.

## Dragon's Keep is BROKEN — fix before offering it

`/run/dragon-keep/` was the other candidate and is deliberately excluded. Two
faults found 2026-09-21:

1. **The build aborts on load.** `/apps/dragon-keep/` throws
   `Aborted('FS' was not exported. add it to EXPORTED_RUNTIME_METHODS)` from
   `/apps/_shared/save-bridge.js:141`, which reads `Module.FS`. The Dragon's
   Keep `SpaceCadetPinball.js` (400 KB) is a **different build** from the
   working Space Cadet one (192 KB) and does not export `FS`. The fix is an
   Emscripten rebuild with `-sEXPORTED_RUNTIME_METHODS=...,FS`, or rebuilding
   the data against the engine build that already works.
2. **Its own page never launches it.** `/run/dragon-keep/` has no iframe, no
   canvas, no play button and no link to `/apps/dragon-keep/` — only links to
   the licence files. Yet it carries a "Works · no files needed" badge and says
   "play right now in your browser". That is a false claim on a live page, and
   the same class of problem the honest-title policy exists to prevent.

`appUrl` is also empty for it in `app-pages.json`, which is why every generator
skips it. Fix the build first, then set `appUrl` to `/apps/dragon-keep/`, then
add the slug to `CC0_ON_OSS_ENGINE` in `catalogue.mjs`.

## Measurement — all of it rolls up to one number

Bing Webmaster Tools → Backlinks → **referring domains. Baseline 4.**
The [10k bet](10k-bet.md) checkpoint is **2026-11-28** and its falsification
test is "still single digits". Secondary: `embed_pointer_click` (baseline 0,
shipped 09-21), `embed_copy` (baseline 2/wk), GA4 Referral sessions (baseline
69/wk).
