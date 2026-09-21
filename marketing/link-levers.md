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

## An open question this surfaced — Andrew's call

Two pages carry **our own CC0 artwork on k4zmu2a's MIT engine** and are *not*
currently in the embed offer:

- `/run/space-cadet-open/` — runs on Open Cadet's CC0 replacement data
- `/run/dragon-keep/` — an original table, our CC0 artwork

Both were excluded because `OWN_WORK` in `inject-page-links.mjs` matches only
`ExeBrowser (original implementation)`. The 09-21 pointer work had to route
around them: the generic "we didn't write it" line contradicted their own pages,
which say "CC0 artwork" outright, so they get neutral copy instead.

**Space Cadet Pinball is by some distance the most recognisable title in the
catalogue**, and an embed offer that leads with it is a much stronger offer than
one that leads with Block Drop. The licensing looks permissive — MIT engine,
CC0 data, and an iframe embed is a link to our origin rather than a
redistribution of anything. But it is a licensing decision, not a build one, so
it is not being made by an agent. If the answer is yes, the change is adding
those two slugs to `OWN_WORK` and writing offer copy that states the split
(MIT engine, CC0 data) rather than the current "written from scratch, not
emulated", which would not be accurate for either.

## Measurement — all of it rolls up to one number

Bing Webmaster Tools → Backlinks → **referring domains. Baseline 4.**
The [10k bet](10k-bet.md) checkpoint is **2026-11-28** and its falsification
test is "still single digits". Secondary: `embed_pointer_click` (baseline 0,
shipped 09-21), `embed_copy` (baseline 2/wk), GA4 Referral sessions (baseline
69/wk).
