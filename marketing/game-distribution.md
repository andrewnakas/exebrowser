# Distributing the ten owned games

**Status: packages built and verified. Submission needs Andrew's account.**

Written 2026-09-05.

## Build the packages

```bash
node scripts/build-distribution.mjs
```

Writes `dist/games/<name>/` and `dist/games/<name>.zip` for all ten. `dist/` is
gitignored; rebuild rather than commit.

| Game | Zip | Files |
|---|---|---|
| minesweeper | 10 KB | 4 |
| solitaire | 19 KB | 4 |
| freecell | 16 KB | 5 |
| spider | 14 KB | 5 |
| hearts | 9.9 KB | 3 |
| pipes | 10 KB | 4 |
| blockdrop | 8.9 KB | 4 |
| rodents | 9.1 KB | 4 |
| jezzball | 8.8 KB | 4 |
| snake | 8.3 KB | 4 |

## The portability bug this fixes — read before submitting

The project notes recorded these as "272 KB, 2–3 files each, zero external
dependencies, **verified portable**". That was wrong, and submitting on the
strength of it would have failed review.

As served from `public/apps/`, **all ten load `/apps/gamesave.js` by absolute
path**, and `freecell` and `spider` also load `/apps/_shared/cards.css` and
`cards.js`. On any origin that is not exebrowser.com those are 404s: every game
loses saving, and the two card games lose card rendering entirely — while still
appearing to "load", which is the worst failure mode for a portal review.

`scripts/build-distribution.mjs` bundles those dependencies into each package
and rewrites the references to relative paths. It throws if any site-absolute
`src`/`href` survives, so the bug cannot come back silently.

**Verified 2026-09-05** in a real browser against a bare static server:

- `snake` (plain shape) — canvas 480×360, `gamesave.js` resolves, `GameSave`
  present, no console errors.
- `freecell` (shared-cards shape) — all 5 requests 200, `cards.css` applied,
  53 cards dealt and playable.

Re-run the build and re-check both shapes after touching anything in
`public/apps/_shared/`.

## Where to submit

**GameDistribution** (<https://developer.gamedistribution.com>) — the main
target. HTML5, revenue share on their ad network, **no traffic requirement of
your own**, and each listing carries a link back. Expect their SDK to be pushed
during onboarding; the games work without it, and adding it is a separate
decision — see below.

**GamePix** (<https://developer.gamepix.com>) — same shape, second submission.
Take whichever accepts first as the signal for whether to keep going.

**itch.io** — no revenue but no gatekeeping either, and it is a real referring
domain that appears the same day. Cheapest possible test of the packaging; do
this one first to shake out any submission-form surprises before the two that
matter.

## Metadata for the forms

Same across portals, adjust field names as needed.

- **Category:** Puzzle / Card / Arcade (per title)
- **Orientation:** Landscape, desktop-first; all are mouse/keyboard
- **Technology:** HTML5, vanilla JS, no engine, no external requests
- **Ads:** none embedded
- **Tracking:** none. The site's analytics are not in these builds — verified.
- **Licence:** original implementations, written for exebrowser.com. No
  Microsoft, id Software or third-party assets. Solitaire credits
  DualBrain/Solitaire in `NOTICE.md`; check that repo's licence before ticking
  any "wholly original" box on that one title specifically.
- **Author:** Andrew Nakas — <https://exebrowser.com>

Suggested description (Minesweeper; adapt per title):

> Classic Minesweeper with all three board sizes and chording for experienced
> players. Runs instantly in the browser — no download, no account, no ads.
> 10 KB total, works on low-end hardware and school Chromebooks.

## Honest expectations

Revenue at this scale is negligible; the memo on monetisation is right about
that and nothing here changes it. **The reason to do this is the referring
domains and the audience that isn't rationed by exebrowser's own search
rankings** — the site currently has 2 referring domains and a hard ceiling of
~1,100 users/day from its own search footprint. Portal listings are the only
lever on that list whose upside is not capped by that footprint.

Judge it on: referring domains (baseline 2), and whether any portal sends
recurring traffic after a month.

## Open decision: their SDK

GameDistribution's revenue share requires their ad SDK, which means an external
script and their tracking inside a game that currently has neither. That is a
real change to what these builds are, and it is worth deciding deliberately
rather than during a signup flow. The distribution value (links, audience) does
not require it; only the revenue does, and the revenue is not the point.
Recommendation: submit without the SDK first, and treat adding it as a separate
decision if a portal actually sends traffic.
