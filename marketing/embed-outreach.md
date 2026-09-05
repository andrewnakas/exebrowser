# /embed/ — outreach plan

**Status: the hub is built and healthy. It has never been shown to anyone.**

Written 2026-09-05.

## State of the thing

Verified today:

| Check | Result |
|---|---|
| Embeddable games | 11 |
| Internal links to `/embed/` | 109 pages |
| In sitemap | yes |
| `robots` meta | none (indexable) |
| Traffic, week to Sep 4 | **10 views** |
| `embed_copy` events, week to Sep 4 | **2** |

Nothing is broken. The hub works, it is linked, it is crawlable. It has simply
never been put in front of a person who would use it. Shipping it was treated as
the deliverable; it was only ever the prerequisite.

**One trap, now fixed:** `gen-app-pages.mjs` does not know about the `/embed/`
footer link — that is added by `inject-page-links.mjs`, step 5 of the documented
six-step build. Running the generator alone silently strips `/embed/` from all
64 generated pages. This happened during today's session and was caught by the
diff. Always run all six steps in README order.

## Why this is worth doing at all

Not for the embed traffic. An embedded iframe on someone else's page sends
almost no clicks back. The point is **the referring domain**: exebrowser.com has
two, and every page that embeds a game links to the source. That is the only
mechanism on the site that produces links as a side effect of someone else
getting something they want.

## Who to approach, in order of likelihood

The offer is: a free, self-contained retro game your visitors can play in one
iframe, no ads, no account, no tracking, no download. That is genuinely useful
to a specific and findable set of people.

1. **Teachers and school-IT blogs.** The honest pitch is the Chromebook one:
   these run in a locked-down tab with no install. Search `chromebook classroom
   games blog` and `free browser games for school 2026`. This audience is the
   natural home of the "unblocked" query family and takes the offer at face
   value.
2. **Retro-computing and DOS blogs.** Smaller, but they link generously and
   their links carry topical weight. The Open Cadet story is the door here —
   lead with that, mention embedding second.
3. **"Free games for your website" roundup posts.** Search that phrase; the
   posts that already exist are mostly listing dead Flash portals. A working,
   dependency-free replacement is a real update for them, which is a much better
   email than a request for a link.
4. **Newsletter and Discord communities** for homeschooling, libraries and
   after-school clubs. Not link value, but real usage, and usage is what makes
   the roundup posts happen later.

## The email

Short, specific, no ask beyond "here it is". Do not request a link — that is
what makes these get deleted.

> Subject: Free retro games you can embed — no ads, no account, no download
>
> Hi <name>,
>
> I read your post on <specific thing, and mean it>.
>
> I run exebrowser.com, which runs old DOS and Windows games in a browser tab.
> Ten of them are ones I wrote myself — Minesweeper, FreeCell, Solitaire,
> Snake, JezzBall, Rodent's Revenge and a few others — and they're free to
> embed anywhere:
>
> https://exebrowser.com/embed/
>
> One iframe, no ads, no account, no tracking, nothing to install. They're
> 8–19 KB each, so they don't slow a page down, and they work on a locked-down
> school Chromebook, which is the reason I built them this way.
>
> Genuinely no ask — if it's useful to your readers it's there, and if not,
> no reply needed.
>
> Andrew

## Sequence

1. Build a list of **20 targets** with a real, specific first line for each.
   Twenty considered emails beat two hundred templated ones, and templated
   outreach is how a domain acquires a spam reputation it cannot shed.
2. Send in batches of five, a few days apart.
3. Two weeks later, check Bing Webmaster Tools → Backlinks. **The metric is
   referring domains, currently 2.** Not clicks, not embed_copy.

## Measurement

`embed_copy` is already instrumented and currently fires twice a week, so the
baseline is unambiguous. Watch:

- Bing Webmaster Tools → Backlinks → referring domains (**baseline: 2**)
- GA4 → Traffic acquisition → Referral (**baseline: 40 sessions/wk, almost all
  github.com**)
- `embed_copy` events (**baseline: 2/wk**)
