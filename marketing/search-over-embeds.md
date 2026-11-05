# Search is the bet now, not embeds

Decision record, 2026-11-05. Supersedes the decision in `10k-bet.md`, three
weeks ahead of the 2026-11-28 checkpoint it set. Numbers are from the GA4,
Search Console and Cloudflare read of 2026-11-04, covering the 28 days from
2026-10-07 to 2026-11-03.

## The premise that failed

`10k-bet.md` rested on one claim: search could not get there. Google showed the
site 7,340 times a month and Bing 26,200, so even a 100% CTR "tops out at
~1,100 users/day". From that it concluded that the next order of magnitude
"comes from other people's websites, or it does not come."

Two months later:

| | 2026-09-05 | 28 days to 2026-11-03 |
|---|---|---|
| Google impressions | 7,340 / month | **66,600** |
| Google clicks | — | **11,800** (CTR 17.7%, avg pos 6.6) |
| Organic share of sessions | — | **61%** (18,100 of 29,489) |
| GA4 users | ~233 / day | **~750 / day** |

Google impressions are up ninefold. The ceiling the bet was built on was the
footprint of the day, not a limit of the asset. It moved because the site began
answering specific questions ("exe file opener", "run exe online", "doom
unblocked") with pages that win them, and it is still moving.

## What the embed bet produced

The checkpoint named two leading indicators.

- **`embed_copy` events: 31 in 28 days**, about 8 a week, against a 2-a-week
  baseline. That is four times better, from a base too small to matter.
- **Referring domains** (Bing Webmaster, Backlinks, read 2026-11-05): baseline
  2. **Now 8**, from 266 referring pages. Most of the links come from two
  domains: decompgames.com (212) and openoldfile.com (44). Then macemu.com (4),
  pages.dev (2), and one each from cloudspress.com, goblinarcade.com,
  itechfaqs.com and itechguides.com. That is still single digits, which is the
  exact failure condition `10k-bet.md` set for the checkpoint. And nothing here
  shows that embeds account for any of the six new domains.

Referral traffic of every kind was 470 sessions, 1.6% of the total. The embed
hub had 394 users. The pointer that sells it gets clicked (383
`embed_pointer_click`), but almost nobody goes on to put a game on their own site.

## The decision

**Search work takes priority. Embeds move to maintenance.**

- Keep the `/embed/` hub, the wrappers and the pointer. They cost nothing to run
  and every embed is still a referring domain.
- Stop spending new effort on outreach for them. `embed-outreach.md` stays as a
  record, not a to-do list.
- Spend the effort on the queries that already show the site and sit at
  positions 6–12. The 2026-11 growth plan works these: "how to open exe file",
  "exe file", "doom online / browser / emulator", "mshearts", "micropolis".
  Translations of the pages that already work fall under the same heading.

## What would reverse this

- Referring domains reach double digits by 2026-11-28 without new outreach. That
  would mean embeds spread on their own, and the bet deserves another look.
- Google organic clicks stall. Two consecutive 28-day windows with flat clicks
  after the 2026-11 changes would mean the search footprint has reached its
  limit too, and the question this record answers would be open again.

## The honest framing

The embed bet was a reasonable call on the 2026-09-05 data, and it was set up
so it could be shown wrong. It has been shown wrong, though not by embeds
failing. The alternative it dismissed turned out to have far more room than
the arithmetic allowed.
