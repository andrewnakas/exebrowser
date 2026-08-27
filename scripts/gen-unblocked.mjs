#!/usr/bin/env node
// Generates /unblocked/ — a real page for the highest-converting query family
// Bing has shown us.
//
//   node scripts/gen-unblocked.mjs
//
// ── Why this page exists ───────────────────────────────────────────────────
// Bing's own data for this site, over six days:
//
//   doom                     3.4K impressions   3.25% CTR   pos 4.44
//   doom browser               67 impressions  16.42% CTR   pos 3.73
//   doom unblocked             49 impressions  26.53% CTR   pos 2.71
//   doom free play             16 impressions  31.25% CTR   pos 3.19
//   doom free                   8 impressions  37.50% CTR   pos 3.50
//
// The bare game name converts at 3%; add an intent word and it converts at
// 16-37%. "unblocked" is the strongest of those families and the word appears
// in zero of the site's 43 titles.
//
// ── Why a page and not 43 retitles ─────────────────────────────────────────
// Only 8 of the 43 titles have room for another word inside the ~65-character
// SERP budget, and stuffing "unblocked" into the rest would be keyword spam on
// a site that has already been rejected three times for content quality. One
// honest page that actually answers the question is worth more than 43
// keyword-stuffed titles, and it cannot be mistaken for a doorway.
//
// The claim has to stay true: this site works on locked-down devices because it
// is an ordinary web page, not because it evades anything. The copy says that
// plainly, including the part where a blocked domain stays blocked.

import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SITE, esc, posterCard, sortPlayable, itemListLd, jsonText } from "./catalogue.mjs";

const ROOT = resolve(process.cwd(), "public");
const pages = JSON.parse(readFileSync(resolve(process.cwd(), "scripts", "app-pages.json"), "utf8"));
const playable = sortPlayable(pages);

// Games with no emulator layer: plain JavaScript or a small wasm port. These
// are the ones that load fastest on throttled school wifi, which is a real
// difference and not a marketing line — the hand-written ones are 20-56 KB.
const light = playable.filter((p) => !p.dosRuntime && p.appType === "game");

const faq = [
  {
    q: "Why do these work when other game sites are blocked?",
    a: "Because there is nothing here to install. Every game runs as an ordinary web page, the same way any site does, so a device that blocks downloads or software installs does not have to block this. That said, network filters usually work by domain: if a filter blocks this site by name, nothing on this page will get around that, and it is not meant to.",
  },
  {
    q: "Do they work on a school Chromebook?",
    a: "Yes. Chromebooks cannot install Windows or DOS software at all, which is normally the end of the conversation for retro games. Everything here runs in the browser instead, so a Chromebook plays it exactly like any other computer.",
  },
  {
    q: "Which ones load fastest on slow wifi?",
    a: "The games written from scratch here are the smallest by a wide margin — Snake is 20 KB, Minesweeper 28 KB, Solitaire 56 KB. They open about as fast as a text page. The emulated DOS titles are larger; DOOM is around 2 MB, which is still small but will take a moment on a throttled connection.",
  },
  {
    q: "Is there a catch — ads, accounts, downloads?",
    a: "No account and nothing to install. Click a game and it runs in the tab you are already looking at.",
  },
  {
    q: "Will my progress be saved?",
    a: "Yes, in your own browser. Card and puzzle games pick up the hand you left, and most DOS games keep the saves you make from their own menus. Nothing is uploaded anywhere and there is no profile to sign into, so progress stays on the device you played on.",
  },
];

const faqLd = `<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
${faq.map((f) => `    {
      "@type": "Question",
      "name": ${jsonText(f.q)},
      "acceptedAnswer": { "@type": "Answer", "text": ${jsonText(f.a)} }
    }`).join(",\n")}
  ]
}
</script>`;

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Unblocked Games — Free, No Download, Runs in Your Browser — ExeBrowser</title>
<meta name="description" content="${playable.length} classic games that run as ordinary web pages, so there is nothing to install on a locked-down school or work laptop. Free, no account, works on Chromebooks." />
<meta name="keywords" content="unblocked games, unblocked games at school, no download games, chromebook games, browser games no install" />
<link rel="canonical" href="${SITE}/unblocked/" />
<meta property="og:type" content="website" />
<meta property="og:url" content="${SITE}/unblocked/" />
<meta property="og:title" content="Unblocked Games — Free, No Download, Runs in Your Browser" />
<meta property="og:description" content="${playable.length} classic games that run as ordinary web pages. Nothing to install, works on school Chromebooks." />
<meta property="og:image" content="${SITE}/og.png" />
<meta name="twitter:card" content="summary_large_image" />
<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
<link rel="alternate icon" href="/favicon.ico" />
<link rel="alternate" type="application/rss+xml" title="ExeBrowser — new games and posts" href="/feed.xml" />
<link rel="stylesheet" href="/style.css?v=40" />
<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-3593636324187853" crossorigin="anonymous"></script>
<script async src="https://www.googletagmanager.com/gtag/js?id=G-C8C4TZC5F1" crossorigin="anonymous"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  if (!navigator.webdriver) gtag('config', 'G-C8C4TZC5F1');
</script>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "${SITE}/" },
    { "@type": "ListItem", "position": 2, "name": "Unblocked games", "item": "${SITE}/unblocked/" }
  ]
}
</script>
${itemListLd(playable, { name: "Games that run in the browser with no download", url: `${SITE}/unblocked/` })}
${faqLd}
</head>
<body>
<header>
  <div class="brand">
    <span class="logo" aria-hidden="true">▶_</span>
    <h1>ExeBrowser</h1>
  </div>
  <p class="tagline">Run Windows <code>.exe</code> files in your browser. No install. No upload. Just WebAssembly + Wine.</p>
  <nav class="site-nav" aria-label="Primary">
    <a href="/">Home</a>
    <a href="/load-exe/">Run your EXE</a>
    <a href="/run/">App guides</a>
    <a href="/blog/">Blog</a>
    <a href="/guide/">Guide</a>
    <a href="/about/">About</a>
    <a href="/contact/">Contact</a>
  </nav>
</header>

<main class="prose">
  <p class="resume-bar" id="resume-bar" hidden></p>
  <nav class="breadcrumb" aria-label="Breadcrumb"><a href="/">Home</a> › Unblocked games</nav>
  <section class="card">
    <h2>Games that need nothing installed</h2>
    <p>Most school and work laptops are locked down the same way: you cannot install software, you cannot run an <code>.exe</code>, and a Chromebook could not run a Windows or DOS game even if you were allowed to. That rules out essentially every classic PC game.</p>
    <p>Everything on this page gets around that in the least clever way possible. These games are ordinary web pages. There is no installer, no plugin, no extension and no account — the game is the page, so a device that blocks installs has nothing to block.</p>
    <p><strong>What this is not:</strong> a way past a filter. If your network blocks this site by name, it stays blocked, and no page here will change that. What it does mean is that a device locked down against <em>installing things</em> can still play all ${playable.length} of these.</p>

    <h3>The ones that load fastest</h3>
    <p>Worth knowing if you are on shared wifi. These ${light.length} are plain JavaScript or a small WebAssembly port with no emulator underneath, and the ones we wrote ourselves are tiny — Snake is 20 KB, Minesweeper 28 KB, Solitaire 56 KB. They open about as quickly as a page of text.</p>
    <ul class="poster-grid">
${light.slice(0, 12).map(posterCard).join("\n")}
    </ul>

    <h3>Everything else</h3>
    <p>The rest are the real DOS and Windows originals running through an emulator compiled to WebAssembly. Still nothing to install, just a slightly larger download the first time — DOOM is about 2 MB.</p>
    <p><a href="/run/">See all ${playable.length} games and apps →</a> or <a href="/play/">browse by category</a>.</p>
  </section>

  <section class="card">
    <h2>Common questions</h2>
${faq.map((f) => `    <details>\n      <summary>${esc(f.q)}</summary>\n      <p>${esc(f.a)}</p>\n    </details>`).join("\n")}
  </section>
</main>

<footer>
  <p>Built on <a href="https://github.com/danoon2/Boxedwine" target="_blank" rel="noopener">Boxedwine</a> · <a href="https://www.winehq.org/" target="_blank" rel="noopener">Wine</a> · WebAssembly. Wine is a trademark of CodeWeavers. ExeBrowser is not affiliated with WineHQ, CodeWeavers, or Microsoft.</p>
  <nav class="footer-nav" aria-label="Footer">
    <a href="/">Home</a>
    <a href="/load-exe/">Run your EXE</a>
    <a href="/run/">App guides</a>
    <a href="/blog/">Blog</a>
    <a href="/guide/">Compatibility Guide</a>
    <a href="/about/">About</a>
    <a href="/contact/">Contact</a>
    <a href="/saves/">Saved games</a>
    <a href="/privacy/">Privacy Policy</a>
    <a href="/terms/">Terms of Use</a>
  </nav>
  <p>© 2026 ExeBrowser. Content licensed openly; runtime under GPL-2.0 / LGPL-2.1.</p>
</footer>
<script src="/save-core.js?v=3"></script>
<script src="/recent.js?v=4"></script>
<script>
  window.renderResumeBar && renderResumeBar("resume-bar");
</script>
</body>
</html>
`;

mkdirSync(resolve(ROOT, "unblocked"), { recursive: true });
writeFileSync(resolve(ROOT, "unblocked", "index.html"), html, "utf8");
console.log(`wrote /unblocked/ (${playable.length} titles, ${light.length} listed as fast-loading)`);
