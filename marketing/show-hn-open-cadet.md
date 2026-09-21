# Show HN — Open Cadet

**Status: ready to post. Needs Andrew's HN account — nobody else can post it.**

Written 2026-09-05, replacing the draft that lived in a session scratchpad and
was lost with it. This copy is committed so it stops evaporating.

Repo: <https://github.com/andrewnakas/open-cadet> (live, CC0, 1 star)
Playable: <https://exebrowser.com/run/space-cadet-open/>

## Why this is the link lever

exebrowser.com has **4 referring domains** (2 when this was written; cloudspress,
itechfaqs, itechguides, decompgames as of 2026-09-21). Bing Webmaster's own top
recommendation for the site is now "your site does not have enough inbound links
from high quality domains". That is the root cause of the 43 pages Google lists
as "Discovered — currently not indexed": crawl budget follows authority, and
there is barely any to follow. Ranking work downstream of that is capped no
matter how good the titles are — and the 2026-09-21 read confirmed it from the
other side: the DOOM title test won outright (weekday Bing clicks 113 → 144/day)
and the impression ceiling still only moved to ~1,800 users/day at a physically
impossible 100% CTR. On-page work is done. This is the constraint.

Open Cadet is the strongest link asset the project has, because the story is
genuinely novel rather than promotional: it is (as far as we know) the first
Space Cadet build that needs zero Microsoft files, and the legal reasoning —
separating copyrightable *expression* from uncopyrightable *facts* — is the part
HN actually argues about. The playable link is a supporting detail, not the ask.

## Title

Post as:

```
Show HN: Open Cadet – CC0 game data so Space Cadet Pinball needs no MS files
```

75 characters, inside HN's 80 limit. Factual, no superlatives, leads with what
it is. Alternatives if that reads long:

```
Show HN: I remade Space Cadet Pinball's data files from scratch as CC0
Show HN: Open Cadet – public-domain PINBALL.DAT for SpaceCadetPinball
```

**Submit the GitHub repo URL, not the exebrowser page.** HN's audience is there
for the artifact; a link to a games site reads as marketing and gets flagged.
The playable build is linked from the README's third paragraph and again in the
first comment, which is where the traffic actually comes from.

## First comment (post immediately after submitting)

> Author here. The engine side of this was already solved — k4zmu2a's
> SpaceCadetPinball is a faithful MIT reimplementation and has been for years.
> The problem is that it still needs `PINBALL.DAT` and 47 sound files from a
> Windows install to boot, and those are Microsoft's. So there has never been a
> complete build anyone could legally redistribute. You had to already own
> Windows XP, or find the files somewhere you shouldn't.
>
> This replaces the data. Every bitmap is procedurally generated in a neon-space
> style, every one of the 47 sounds is synthesised with numpy from sine/noise/
> decay envelopes, and all of it is dedicated CC0. No pixels or samples were
> copied from anything.
>
> The interesting part isn't the art, it's the split. Copyright protects
> creative expression; it doesn't protect facts, and it doesn't protect a file
> format. So the original expression (bitmaps, palette, sounds, strings) is
> newly created, while the things that have to match for the engine to load it
> at all (group names and record type codes, wall-segment coordinates, component
> positions, physics constants, the table boundary polygon, the camera matrix)
> are reused as facts for interoperability. NOTICE.md in the repo walks through
> which is which, file by file, because that's the bit I'd want to check if
> someone else posted this.
>
> The table looks different from the original as a direct result — it's a neon
> redraw, not a beige-and-chrome copy. That's the honest consequence of the art
> being original rather than a design choice I'd defend on its own merits.
>
> If you want to try it without building anything, I compiled the engine to
> WebAssembly with these assets: https://exebrowser.com/run/space-cadet-open/
> — no download, runs in the tab.
>
> Happy to be told I've got the copyright analysis wrong. That's the part I'd
> most like scrutinised.

That last line is deliberate. Inviting correction on the legal split is both
honest — it *is* the part that would sink this — and the most reliable way to
get substantive replies rather than a silent upvote-or-nothing.

## Timing

Post **Tuesday 2026-09-22, 08:30 ET**. (Re-dated 2026-09-21: the 09-08 slot
passed unposted. Nothing in the draft has gone stale — repo, NOTICE.md, the
playable build and the README's link to it were all re-verified live on 09-21.)
Tue–Thu mornings US Eastern is the window where /newest turnover is slow enough
for a Show HN to be seen. Do not post Friday–Sunday.

Be at a keyboard for the two hours after. On HN the author answering questions
in the first hour is most of the difference between a post that lands and one
that doesn't.

## What to expect, honestly

Most Show HN posts get single-digit points and 100–400 referred visits. That
would still be a meaningful week for this site. The outcome worth having is not
the traffic spike — it's **one or two links from domains that aren't
cloudspress.com and itechfaqs.com**, which is what unblocks the 43 uncrawled
pages. Judge it on referring domains a fortnight later, not on the front page.

## Do not

- Do not submit the exebrowser.com URL. It reads as marketing and gets flagged.
- Do not mention traffic goals, SEO, or the games catalogue in the comment.
- Do not post the same link to r/programming the same day. Space it a week.
- Do not ask anyone to upvote. HN detects voting rings and it kills the account.
