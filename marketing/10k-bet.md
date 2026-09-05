# Which bet is the 10,000/day bet

Decision record, 2026-09-05. Supersedes the open question in the growth brief.
Numbers from the GA4 / Search Console / Bing Webmaster read of the same date.

## The constraint, restated

Bing shows the site **26,200** times a month. Google **7,340**. Total **~33,500**.

- 10,000 users/day = 300,000/month. At a generous 10% CTR that needs **3,000,000
  impressions** — 90× what the site earns.
- **Even at a physically impossible 100% CTR, the current footprint tops out at
  ~1,100 users/day.**

Conversion is no longer the problem. Boot rate is 66.9%, engagement 77.7%,
retention just went 5×. The problem is that the site appears in search for very
few queries, and 80% of the impressions it does get land on one page.

## The distinction that decides this

"Distribution" was carried in the brief as one lever. It is two, and they do
opposite things to the user count:

| | Where the game runs | Does it add GA4 users? |
|---|---|---|
| **Embeds** (`/embed/`) | iframe served **from exebrowser.com** | **Yes** — every play fires `page_view` on our property |
| **Portals** (GameDistribution, GamePix) | a **copy** hosted on their network | **No** — they get the traffic; we get revenue share and a backlink |

This has been the fuzzy part of the plan. Portal listings are worth doing — they
pay something, and each is a referring domain against our current total of two —
but **they cannot move the users/day number**, because the player never touches
our origin. Only embeds do that.

## The decision

**Bet on embeds. Treat portals as a link-and-revenue side bet, not as growth.**

Embeds are the only mechanism available whose arithmetic can reach the target,
and the only one that compounds in two directions at once:

1. Each embedding site sends plays that land on our origin and count as users.
2. Each embedding site is a referring domain, which raises authority, which is
   the specific thing blocking the 43 pages Google has declined to crawl, which
   raises search traffic independently.

The arithmetic that has to hold: roughly **300 embedding sites at ~30 plays/day
each** is 9,000/day. That is a large number of sites, but it is a *findable*
number — it does not require a viral event or beating Wikipedia for "doom".
Nothing else on the list has arithmetic that reaches five figures at all.

## Why not the alternatives

**More catalogue titles.** Settled by this week's data. Titles were fixed a week
ago, so quality is no longer the confound: all 82 non-DOOM titles together
produce ~1,000 impressions/month, about 50 each, and everything ranking below
position 8 converts at 0% regardless of what its title says. Reaching the target
this way needs thousands of pages, which is exactly the scaled-thin-content shape
that has drawn three AdSense rejections. **Adding titles is maintenance.**

**Own the "unblocked" family.** Real, and worth the work already done — but small
here. `doom unblocked` is 246 impressions/month, not 246,000. The head terms need
authority we do not have.

**AI assistants.** Just declined 19% (339 → 275 sessions) with no change on our
side. It was the growth story a fortnight ago. Not a foundation.

**The exe-utility niche.** The genuine surprise of the week — Google organic
tripled on `run exe online` / `exe runner` / `exe emulator`, with branded search
falling from 65% to 8.4% of clicks, and `run exe online` converting at 27.5%.
The site is becoming *the* answer in a niche with little competition. Keep
feeding it; it is currently the fastest-growing thing here. But the whole family
is only ~3,000 impressions/month. It is a strong second channel, not a 43× one.

## What would falsify this

Set a **12-week checkpoint (2026-11-28)**. The leading indicator is not users —
it is:

- **Referring domains** (Bing Webmaster → Backlinks). **Baseline: 2.**
- **`embed_copy` events.** **Baseline: 2/week.**

If referring domains are still in single digits at the checkpoint, the embed bet
has failed at the only step that matters — people finding out the offer exists —
and 10,000/day is not reachable from this asset base. At that point restate the
goal honestly rather than keep spending against it.

## The honest framing

The goal was set at 130× from 75/day. The site is now at 233/day, so it is 43×
away, and the last sixteen days were a genuine 3×. That progress is real and it
came from fixing things that were broken.

But the things that were broken are now fixed. The next order of magnitude does
not come from another round of titles, metrics or retention work — all three are
in good shape and none of them touches the binding constraint. It comes from
other people's websites, or it does not come.
