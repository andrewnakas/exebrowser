#!/usr/bin/env node
// Generates /embed/ — the front door to the embed offer.
//
//   node scripts/gen-embed-hub.mjs
//
// ── Why this page exists ───────────────────────────────────────────────────
// Search Console records **one** external link to this whole site. That single
// number is why 37 pages sit at "Discovered — currently not indexed": Google
// has the URLs and has decided the domain isn't worth the crawl. Nothing else
// on the site moves that needle, and no amount of writing changes it.
//
// The embed offer is the one acquisition mechanism here that compounds without
// the owner doing outreach every week: each accepted embed puts a real <a href>
// to this domain on somebody else's page, permanently, because the credit line
// travels with the iframe.
//
// It was already built and already working — eleven games, an offer box on each
// of their pages, a copy button, a noindex wrapper at /embed/<slug>/. What it
// had no version of was a **front door**. The offer only appeared once you were
// already on that specific game's page, which means the only people who ever
// saw it were people who had already found the site. Someone searching "free
// games to embed on my website" had no entry point at all, and there was no
// single URL to hand to a directory, a forum thread or a Show HN comment.
//
// So: one page, listing all eleven, with the licence stated plainly and the
// snippet visible without a click. Genuinely useful to a webmaster, which is
// also the only kind of page that earns the link.

import { writeFileSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { SITE, esc, jsonText, screenshotFile, embedTier, isEmbeddable } from "./catalogue.mjs";

const ROOT = resolve(process.cwd(), "public");
const pages = JSON.parse(readFileSync(resolve(process.cwd(), "scripts", "app-pages.json"), "utf8"));

// Same rule the injector and the wrapper generator use, kept in catalogue.mjs
// so the three cannot drift. Everything else is hosted under someone else's
// licence and offering it for embedding would be handing out a right we don't
// have. `embedTier` separates the games written from scratch here from Space
// Cadet, which is our CC0 data on an MIT engine — both free to hand on, but
// only one of them can be described as written from scratch, and only one of
// them is measured in kilobytes.
const games = pages
  .filter(isEmbeddable)
  .sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity));

// Payload size per game, measured rather than claimed — it's the number a
// webmaster actually cares about and the strongest thing this offer has.
function kb(p) {
  const dir = resolve(ROOT, p.appUrl.replace(/^\//, "").replace(/\/[^/]*$/, ""));
  // Recursive: Skyrise and Parkhaven keep their code in js/, and a flat read
  // reported them as a few KB when they are a few hundred.
  const walk = (d) => {
    let total = 0;
    for (const f of readdirSync(d)) {
      try {
        const st = statSync(resolve(d, f));
        total += st.isDirectory() ? walk(resolve(d, f)) : st.size;
      } catch { /* skip */ }
    }
    return total;
  };
  let total;
  try { total = walk(dir); } catch { return null; }
  return Math.round(total / 1024);
}
const sized = games.map((p) => ({ p, kb: kb(p), tier: embedTier(p) }));
// The size claims on this page describe the hand-written games, so `biggest`
// must be measured across THOSE only. Space Cadet is a WebAssembly build of a
// real pinball engine and is ~6 MB; folding it into this number would turn the
// page's central promise ("less than a single photograph") into a false one.
const biggest = Math.max(...sized.filter((s) => s.tier === "own").map((s) => s.kb || 0));
const heavy = sized.filter((s) => s.tier !== "own");
const sizeLabel = (kb) =>
  !kb ? "▶ Play free" : kb < 1024 ? `${kb} KB` : `${(kb / 1024).toFixed(1)} MB`;

const snippet = (slug, name) =>
  `<iframe src="${SITE}/embed/${slug}/" width="100%" height="600"\n` +
  `        style="border:0;max-width:760px" title="${name}" loading="lazy"></iframe>\n` +
  `<p><a href="${SITE}/run/${slug}/">${name}</a> by <a href="${SITE}/">ExeBrowser</a></p>`;

const rows = sized
  .map(({ p, kb }) => {
    const shot = screenshotFile(p);
    const art = shot
      ? `<img class="pc-shot" src="/run/${p.slug}/${shot}" width="320" height="240" loading="lazy" alt="${esc(p.appName)}" />`
      : `<span class="pc-shot pc-placeholder" aria-hidden="true">${esc((p.appName || "?").trim().charAt(0))}</span>`;
    return `      <li class="embed-item">
        <a class="poster-card" href="/run/${p.slug}/">
          ${art}
          <span class="pc-body"><span class="pc-title">${esc(p.appName)}</span><span class="pc-play">${sizeLabel(kb)}</span></span>
        </a>
        <details>
          <summary>Embed code for ${esc(p.appName)}</summary>
          <pre><code>${esc(snippet(p.slug, p.appName))}</code></pre>
          <p class="muted small"><a href="/embed/${p.slug}/" target="_blank" rel="noopener">Preview the frame on its own →</a></p>
        </details>
      </li>`;
  })
  .join("\n");

const faq = [
  { q: "Can I really put these on my own site for free?",
    a: `Yes, for these ${games.length}. ${games.length - heavy.length} were written from scratch here rather than emulated, and Space Cadet is an MIT-licensed engine running public-domain data we created, so all of them are ours to hand on. You need no permission and no key. Keeping the credit line under the frame is the only thing we ask.` },
  { q: "Why aren't DOOM, SkiFree and the rest of the catalogue on this list?",
    a: "Because they aren't ours to give. We host them under shareware and freeware licences that let us run them on this site, which is not the same as a right to sub-license them to anybody else. Offering them for embedding would be handing out permission we don't have. Space Cadet is on the list precisely because that problem was solved rather than ignored: the engine is MIT and the data files were rebuilt from scratch and dedicated to the public domain, so no Microsoft files are involved." },
  { q: "Will this slow my page down?",
    a: `Not if it is below the fold. Every frame is lazy-loaded, so nothing is fetched until a visitor scrolls it into view. The ${games.length - heavy.length} hand-written games are small — the largest is ${sizeLabel(biggest)}, less than one phone photograph — with no framework and no third-party player. Space Cadet is the one to think about: it is a WebAssembly pinball engine at roughly ${(heavy[0] ? heavy[0].kb / 1024 : 0).toFixed(1)} MB, which is fine lazily below the fold and is not what you want at the top of a landing page.` },
  { q: "Does it work on mobile?",
    a: "The hand-written games all have touch controls and the frame is responsive, so it fills whatever width you give it up to 760px. Space Cadet is a keyboard game by design — it plays best on a desktop, and on a phone it will load and render but the flippers want a keyboard. Set your own width and height on the iframe if that suits your layout better." },
  { q: "Do you track my visitors?",
    a: "The embedded frame carries no analytics, no advertising and no cookies. It is the game and nothing else. We can't see who plays it on your site and we don't want to." },
  { q: "Will the game break if you change something?",
    a: "The embed URLs are stable and we treat them as an interface, not an internal detail. If a game ever had to be withdrawn, the URL would keep working and show a short message rather than turning into a broken frame on your page." },
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

const itemLd = `<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "ItemList",
  "name": "Free games you can embed on your own site",
  "url": "${SITE}/embed/",
  "numberOfItems": ${games.length},
  "itemListElement": [
${games.map((p, i) => `    { "@type": "ListItem", "position": ${i + 1}, "name": ${jsonText(p.appName)}, "url": "${SITE}/run/${p.slug}/" }`).join(",\n")}
  ]
}
</script>`;

// 60 characters is the ceiling — Bing cuts around 65 and the " — ExeBrowser"
// suffix sat past the cut, paid for and never displayed. Same rule as the
// 1 Sep 2026 sweep, which covered the catalogue titles but not this one.
const title = `Free Games You Can Embed on Your Website — No Key, No Ads`;
const desc = `${games.length} classic games — 3D Pinball Space Cadet, Solitaire, Minesweeper, Snake, JezzBall and more — free to embed on any site. One iframe, no API key, no ads, no tracking.`;

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}" />
<meta name="keywords" content="embed games on website, free html5 games to embed, embeddable games, free solitaire widget, add game to my site, iframe games free" />
<link rel="canonical" href="${SITE}/embed/" />
<meta property="og:type" content="website" />
<meta property="og:url" content="${SITE}/embed/" />
<meta property="og:title" content="Free Games You Can Embed on Your Website" />
<meta property="og:description" content="${games.length} classic games, free to embed anywhere. One iframe, no key, no ads, no tracking." />
<meta property="og:image" content="${SITE}/og.png" />
<meta name="twitter:card" content="summary_large_image" />
<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
<link rel="alternate icon" href="/favicon.ico" />
    <link rel="manifest" href="/manifest.webmanifest" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
    <meta name="theme-color" content="#0e0d0b" />
<link rel="alternate" type="application/rss+xml" title="ExeBrowser — new games and posts" href="/feed.xml" />
<link rel="stylesheet" href="/style.css?v=42" />
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
    { "@type": "ListItem", "position": 2, "name": "Embed our games", "item": "${SITE}/embed/" }
  ]
}
</script>
${itemLd}
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
  <nav class="breadcrumb" aria-label="Breadcrumb"><a href="/">Home</a> › Embed our games</nav>
  <section class="card">
    <h2>Free games you can put on your own site</h2>
    <p>These ${games.length} games are ours to give away, and we do. Copy one <code>&lt;iframe&gt;</code>, paste it into your page, done. <strong>No API key, no sign-up, no advertising, no tracking, no fee.</strong></p>
    <p>${games.length - heavy.length} of them were written from scratch for this site rather than emulated, and they are small enough not to matter: the largest is <strong>${sizeLabel(biggest)}</strong>, less than a single phone photograph. There is no framework underneath and no third-party player phoning home.</p>
    <p><strong>3D Pinball Space Cadet is the exception, and worth stating plainly.</strong> It is a WebAssembly build of <a href="https://github.com/k4zmu2a/SpaceCadetPinball" target="_blank" rel="noopener">k4zmu2a's MIT-licensed engine</a> running <a href="https://github.com/andrewnakas/open-cadet" target="_blank" rel="noopener">replacement game data we wrote and dedicated to the public domain</a>, so it needs no Microsoft files and is free to hand on — but it is a real pinball engine and the frame is about <strong>${(heavy[0] ? heavy[0].kb / 1024 : 0).toFixed(1)} MB</strong>, not kilobytes. Every frame on this page is <code>loading="lazy"</code>, so nothing is fetched until a visitor actually scrolls to it; budget for it anyway if you are putting it above the fold.</p>
    <p class="muted small">The only condition is the credit line that comes with the snippet. Leave it in place and you are square with us.</p>

    <h3>Pick one</h3>
    <ul class="poster-grid embed-list">
${rows}
    </ul>
  </section>

  <section class="card">
    <h2>What the snippet does</h2>
    <p>Each block above is complete and self-contained — an iframe pointing at a dedicated wrapper page, plus the credit paragraph. The wrapper is deliberately bare: no navigation, no header, no advertising, just the game filling the frame.</p>
    <p>Adjust <code>width</code> and <code>height</code> to suit your layout. The default is full width up to 760px and 600px tall, which suits most article columns. The hand-written games are responsive and will fill whatever you give them; Space Cadet renders its table at a fixed aspect and letterboxes into the space, so give it height if you want it large. <code>loading="lazy"</code> is in there on purpose and worth keeping.</p>
    <p>Want to see one in isolation first? Every entry above links to its bare frame, which is exactly what your visitors will get.</p>
  </section>

  <section class="card">
    <h2>Common questions</h2>
${faq.map((f) => `    <details>\n      <summary>${esc(f.q)}</summary>\n      <p>${esc(f.a)}</p>\n    </details>`).join("\n")}
  </section>

  <section class="card">
    <h2>The rest of the catalogue</h2>
    <p>Beyond the ${games.length} above, this site runs the real DOS and Windows originals — DOOM, Wolfenstein 3D, SkiFree, Tyrian and a few dozen more — through emulators compiled to WebAssembly. Those we host under their own shareware and freeware licences, so they are playable here but not ours to hand on for embedding.</p>
    <p><a href="/run/">See everything you can play or run →</a> · <a href="/unblocked/">Games that need nothing installed</a> · <a href="/play/">Browse by category</a></p>
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
    <a href="/embed/">Embed our games</a>
    <a href="/privacy/">Privacy Policy</a>
    <a href="/terms/">Terms of Use</a>
  </nav>
  <p>© 2026 ExeBrowser. Content licensed openly; runtime under GPL-2.0 / LGPL-2.1.</p>
</footer>
</body>
</html>
`;

mkdirSync(resolve(ROOT, "embed"), { recursive: true });
writeFileSync(resolve(ROOT, "embed", "index.html"), html, "utf8");
console.log(`wrote /embed/ — ${games.length} embeddable games, largest ${biggest} KB`);
