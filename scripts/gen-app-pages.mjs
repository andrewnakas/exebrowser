#!/usr/bin/env node
// Generates /run/<slug>/index.html app-guide pages that match the existing
// ExeBrowser template exactly (header, nav, AdSense, GA, breadcrumb JSON-LD,
// footer with Privacy/Terms links). Body HTML is supplied per page below.
//
// Run from repo root:  node scripts/gen-app-pages.mjs
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const ROOT = resolve(process.cwd(), "public");

const head = (p) => `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${p.title}</title>
<meta name="description" content="${p.description}" />
<meta name="keywords" content="${p.keywords}" />
<link rel="canonical" href="https://exebrowser.com/run/${p.slug}/" />
<meta property="og:type" content="article" />
<meta property="og:url" content="https://exebrowser.com/run/${p.slug}/" />
<meta property="og:title" content="${p.ogTitle}" />
<meta property="og:description" content="${p.ogDescription}" />
<meta property="og:image" content="https://exebrowser.com/og.png" />
<meta name="twitter:card" content="summary_large_image" />
<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
<link rel="alternate icon" href="/favicon.ico" />
<link rel="stylesheet" href="/style.css?v=15" />
<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-3593636324187853" crossorigin="anonymous"></script>
<script async src="https://www.googletagmanager.com/gtag/js?id=G-C8C4TZC5F1" crossorigin="anonymous"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'G-C8C4TZC5F1');
</script>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://exebrowser.com/" },
    { "@type": "ListItem", "position": 2, "name": "App guides", "item": "https://exebrowser.com/run/" },
    { "@type": "ListItem", "position": 3, "name": "${p.crumb}", "item": "https://exebrowser.com/run/${p.slug}/" }
  ]
}
</script>${p.howto ? "\n" + p.howto : ""}
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
    <a href="/run/">App guides</a>
    <a href="/blog/">Blog</a>
    <a href="/guide/">Guide</a>
    <a href="/about/">About</a>
    <a href="/contact/">Contact</a>
  </nav>
</header>

<main class="prose">
  <nav class="breadcrumb" aria-label="Breadcrumb"><a href="/">Home</a> › <a href="/run/">App guides</a> › ${p.crumb}</nav>
${p.body}
</main>

<footer>
  <p>Built on <a href="https://github.com/danoon2/Boxedwine" target="_blank" rel="noopener">Boxedwine</a> · <a href="https://www.winehq.org/" target="_blank" rel="noopener">Wine</a> · WebAssembly. Wine is a trademark of CodeWeavers. ExeBrowser is not affiliated with WineHQ, CodeWeavers, or Microsoft.</p>
  <nav class="footer-nav" aria-label="Footer">
    <a href="/">Home</a>
    <a href="/run/">App guides</a>
    <a href="/blog/">Blog</a>
    <a href="/guide/">Compatibility Guide</a>
    <a href="/about/">About</a>
    <a href="/contact/">Contact</a>
    <a href="/privacy/">Privacy Policy</a>
    <a href="/terms/">Terms of Use</a>
  </nav>
  <p>© 2026 ExeBrowser. Content licensed openly; runtime under GPL-2.0 / LGPL-2.1.</p>
</footer>
</body>
</html>
`;

// ---- page definitions ----------------------------------------------------
const pages = [];

// 1. DOOM (shareware) — HOSTED (id shareware license permits free redistribution)
pages.push({
  slug: "doom",
  title: "Play DOOM in Your Browser — Free Shareware Episode — ExeBrowser",
  description:
    "Play the original 1993 DOOM (shareware episode “Knee-Deep in the Dead”) in your browser with Wine + WebAssembly. Free, legal shareware you can download right here, plus how to load it and what to expect.",
  keywords:
    "play doom in browser, doom online free, doom shareware, doom1.wad download, run doom no install, classic doom browser",
  ogTitle: "Play DOOM in Your Browser — Free Shareware Episode",
  ogDescription:
    "The original 1993 DOOM shareware episode, running in your browser with Wine + WebAssembly. Free and legal.",
  crumb: "DOOM",
  howto: `<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "How to play DOOM shareware in your browser",
  "step": [
    { "@type": "HowToStep", "name": "Download the shareware", "text": "Download the freely redistributable DOOM shareware package from this page." },
    { "@type": "HowToStep", "name": "Boot Wine", "text": "Open ExeBrowser, keep the Win32 default variant, and click Boot Wine." },
    { "@type": "HowToStep", "name": "Load the folder", "text": "Unzip the package and upload the whole DOOM folder so DOOM.EXE finds DOOM1.WAD beside it." },
    { "@type": "HowToStep", "name": "Run it", "text": "Choose the DOOM executable as the entry point and click Run in Wine." }
  ]
}
</script>`,
  body: `  <section class="card">
    <h2>Play DOOM in your browser <span class="verdict good">Works — free &amp; legal</span></h2>
    <p>id Software released the first episode of <em>DOOM</em> — <strong>Knee-Deep in the Dead</strong> — as shareware in 1993, and that shareware build has been freely redistributable ever since. That makes it one of the very few genuinely famous games we can host for you directly, no hunting required. Boot Wine, load the folder, and you're fragging imps in a browser tab.</p>

    <div class="download-box">
      <h3 style="margin-top:0;">Download the DOOM shareware (free, legal)</h3>
      <p>This is id Software's official shareware distribution — the complete first episode, unmodified, distributed at no charge exactly as the shareware license permits.</p>
      <p><a class="cta-btn" href="/downloads/doom-shareware.zip" download>Download DOOM shareware (.zip)</a></p>
      <p class="muted small">Contains the DOOM executable and <code>DOOM1.WAD</code>. © id Software — redistributed unmodified under the original shareware terms. The registered episodes (Doom II, etc.) are commercial and are <strong>not</strong> included; buy those from <a href="https://store.steampowered.com/app/2280/DOOM__DOOM_II/" target="_blank" rel="noopener">id / Steam</a>.</p>
    </div>

    <table class="spec-table">
      <tr><th>Game</th><td>DOOM shareware, episode 1 (<code>DOOM.EXE</code> + <code>DOOM1.WAD</code>)</td></tr>
      <tr><th>Best Wine variant</th><td><strong>Win32 (default)</strong> — use the Win95 <code>DOOM95.EXE</code> build if you have it</td></tr>
      <tr><th>Era</th><td>1993–1996, DOS original / Windows 95 port</td></tr>
      <tr><th>How to load</th><td>Unzip, then upload the whole folder so the EXE finds its WAD</td></tr>
      <tr><th>Expected result</th><td>Plays at full speed; sound depends on the build</td></tr>
    </table>

    <h3>DOS DOOM vs. DOOM95</h3>
    <p>The original <code>DOOM.EXE</code> is a DOS program. Wine here targets Win32, so the most reliable thing to run is <strong>DOOM95</strong> — the official Windows 95 port id shipped, which wraps the same game in a Win32 executable. If your download contains <code>DOOM95.EXE</code>, pick that as the entry point. A pure DOS build may not start under Wine without a DOS layer; if it refuses, grab a DOOM95 package or use a source port (below).</p>

    <h3>Even better: a modern source port</h3>
    <p>DOOM's engine was open-sourced by id in 1997, which spawned dozens of <em>source ports</em> — modernized Win32 rebuilds like Chocolate Doom and Crispy Doom that run the original shareware WAD with fixed resolutions and clean sound. These are small 32-bit Win32 EXEs and tend to run very cleanly in ExeBrowser. Put the source-port EXE and <code>DOOM1.WAD</code> in one folder and upload them together.</p>

    <h3>Step by step</h3>
    <ol>
      <li>Download the shareware zip above and unzip it on your computer.</li>
      <li>On the <a href="/">ExeBrowser home page</a>, keep <strong>Win32 (default)</strong> and click <strong>Boot Wine</strong>.</li>
      <li>Use <strong>pick a folder</strong> and select the unzipped DOOM directory.</li>
      <li>Choose the <code>.EXE</code> (prefer <code>DOOM95.EXE</code> or a source-port EXE) as the entry, then <strong>Run in Wine</strong>.</li>
      <li>Click the canvas to capture input. Arrows move, <kbd>Ctrl</kbd> fires, <kbd>Space</kbd> opens doors.</li>
    </ol>

    <div class="cta-row"><a class="cta-btn" href="/">Boot Wine and play →</a></div>
  </section>

  <section class="card">
    <h2>Related guides</h2>
    <ul class="card-grid">
      <li><a class="link-card" href="/run/freeciv/"><span class="lc-title">Freeciv</span><span class="lc-desc">Open-source Civilization-style strategy.</span></a></li>
      <li><a class="link-card" href="/run/age-of-empires/"><span class="lc-title">Age of Empires</span><span class="lc-desc">Another classic to try.</span></a></li>
      <li><a class="link-card" href="/guide/"><span class="lc-title">Full compatibility guide</span><span class="lc-desc">What runs and what doesn't.</span></a></li>
    </ul>
  </section>`,
});

// 2. Freeciv — open-source, link out (GPL, large download)
pages.push({
  slug: "freeciv",
  title: "Run Freeciv in Your Browser — Free Civilization-Style Strategy — ExeBrowser",
  description:
    "Run Freeciv, the free open-source empire-building strategy game inspired by Civilization, in your browser with Wine + WebAssembly. Which build to use, how to load it, and realistic expectations.",
  keywords:
    "freeciv browser, play freeciv online, free civilization game, open source strategy game windows, civ game no install",
  ogTitle: "Run Freeciv in Your Browser — Free Civ-Style Strategy",
  ogDescription:
    "Freeciv, the open-source empire-building game, running in your browser with Wine + WebAssembly.",
  crumb: "Freeciv",
  body: `  <section class="card">
    <h2>Run Freeciv in your browser <span class="verdict partial">Works (older builds)</span></h2>
    <p><em>Freeciv</em> is a free, open-source, turn-based empire-building game openly inspired by the classic <em>Civilization</em> series. Because it's GPL software with no DRM and a long history of small 32-bit releases, it's a natural fit for browser-based Wine — with the caveat that you'll want an older, lighter build rather than the newest one.</p>

    <table class="spec-table">
      <tr><th>Game</th><td>Freeciv (GTK or SDL client, 32-bit Windows build)</td></tr>
      <tr><th>License</th><td>GPL-2.0 — free and open source</td></tr>
      <tr><th>Best Wine variant</th><td><strong>Win32 (default)</strong></td></tr>
      <tr><th>How to load</th><td>Install on a PC, then upload the program folder; or use a portable build</td></tr>
      <tr><th>Where to get it</th><td><a href="https://www.freeciv.org/download.html" target="_blank" rel="noopener">freeciv.org/download</a> (official)</td></tr>
    </table>

    <h3>Use an older, lighter build</h3>
    <p>Modern Freeciv releases lean on newer GTK and OpenGL features that browser-based Wine 1.7.55 handles poorly. The classic 2.2–2.5-era Windows builds, especially the SDL client, are much friendlier: smaller, fewer modern dependencies, and closer to the Wine era we target. Grab one of those from the official downloads or the project's archive.</p>

    <h3>How to get the files in</h3>
    <p>Freeciv ships as an installer. The cleanest path: install it on any Windows PC (or extract a portable/zip build), then copy the whole Freeciv program directory — the client EXE plus its <code>data\\</code> folder of rulesets and tilesets — into one folder and upload that with the <strong>folder picker</strong>. Freeciv reads its rulesets from disk at runtime, so the data folder must come along.</p>

    <h3>What to expect</h3>
    <p>Turn-based games are forgiving of emulation speed — there's no real-time pressure — so once it boots, play is comfortable. The risk is at startup: a modern client may fail to create its window. If that happens, drop to an older SDL-client build. The single-player game runs a local server in-process, so no network is needed.</p>

    <div class="cta-row"><a class="cta-btn" href="/">Boot Wine and try it →</a></div>
  </section>

  <section class="card">
    <h2>Related guides</h2>
    <ul class="card-grid">
      <li><a class="link-card" href="/run/doom/"><span class="lc-title">DOOM</span><span class="lc-desc">Free shareware, hosted here.</span></a></li>
      <li><a class="link-card" href="/run/age-of-empires/"><span class="lc-title">Age of Empires</span><span class="lc-desc">A real-time strategy classic.</span></a></li>
      <li><a class="link-card" href="/guide/"><span class="lc-title">Full compatibility guide</span><span class="lc-desc">What runs and what doesn't.</span></a></li>
    </ul>
  </section>`,
});

// 3. KeePass — open-source, link out
pages.push({
  slug: "keepass",
  title: "Run KeePass in Your Browser — Open-Source Password Manager — ExeBrowser",
  description:
    "Run KeePass, the free open-source password manager, in your browser with Wine + WebAssembly. Which version works (KeePass 1.x is the safe bet), how to load your database, and important safety notes.",
  keywords:
    "keepass browser, run keepass online, open source password manager windows, keepass 1.x wine, kdbx in browser",
  ogTitle: "Run KeePass in Your Browser — Open-Source Password Manager",
  ogDescription:
    "KeePass, the free open-source password manager, running in your browser with Wine + WebAssembly.",
  crumb: "KeePass",
  body: `  <section class="card">
    <h2>Run KeePass in your browser <span class="verdict partial">Works (KeePass 1.x)</span></h2>
    <p><em>KeePass</em> is the long-running, free, open-source password manager. It's GPL software with no activation or cloud requirement, which is exactly the kind of thing that runs well under Wine — with one important version caveat and one big safety caveat.</p>

    <table class="spec-table">
      <tr><th>App</th><td>KeePass Password Safe</td></tr>
      <tr><th>License</th><td>GPL-2.0 — free and open source</td></tr>
      <tr><th>Best version</th><td><strong>KeePass 1.x</strong> (Classic) — native Win32, no .NET needed</td></tr>
      <tr><th>Best Wine variant</th><td><strong>Win32 (default)</strong></td></tr>
      <tr><th>Where to get it</th><td><a href="https://keepass.info/download.html" target="_blank" rel="noopener">keepass.info/download</a> (official)</td></tr>
    </table>

    <h3>Pick KeePass 1.x, not 2.x</h3>
    <p>There are two KeePass lines. <strong>KeePass 2.x</strong> is built on Microsoft .NET, which browser-based Wine 1.7.55 supports poorly — it usually won't start. <strong>KeePass 1.x</strong> (the “Classic Edition”) is a native Win32 program with no .NET dependency, and it's the version to run here. It opens <code>.kdb</code> databases; note that 1.x and 2.x use different database formats.</p>

    <div class="warn-box">
      <h3 style="margin-top:0;">⚠️ A note on security</h3>
      <p>ExeBrowser runs everything locally in your browser tab and never uploads your files — so opening a database here doesn't send your passwords anywhere. That said, a password vault is the most sensitive file you own. For day-to-day use, run KeePass natively on a trusted device. Treat the browser as a convenience for <em>viewing</em> a vault on a machine where you can't install software — not as your primary password manager. Always close the tab when done; the in-memory drive is wiped on reload.</p>
    </div>

    <h3>How to load your database</h3>
    <p>Put <code>KeePass.exe</code> (the 1.x build) and your <code>.kdb</code> file in one folder and upload it with the <strong>folder picker</strong>, then open the database from inside KeePass. To get an edited database back out, use <strong>Download files written by this app</strong> after saving — it packages the updated <code>.kdb</code> into a zip you can download before closing the tab.</p>

    <div class="cta-row"><a class="cta-btn" href="/">Boot Wine and try it →</a></div>
  </section>

  <section class="card">
    <h2>Related guides</h2>
    <ul class="card-grid">
      <li><a class="link-card" href="/run/7-zip/"><span class="lc-title">7-Zip</span><span class="lc-desc">Open-source archiver.</span></a></li>
      <li><a class="link-card" href="/run/notepad/"><span class="lc-title">Notepad &amp; utilities</span><span class="lc-desc">Small Win32 tools.</span></a></li>
      <li><a class="link-card" href="/guide/"><span class="lc-title">Full compatibility guide</span><span class="lc-desc">What runs and what doesn't.</span></a></li>
    </ul>
  </section>`,
});

// 4. AbiWord — open-source word processor, link out
pages.push({
  slug: "abiword",
  title: "Run AbiWord in Your Browser — Free Word Processor — ExeBrowser",
  description:
    "Run AbiWord, the free open-source word processor, in your browser with Wine + WebAssembly. One of the most reliable office apps for browser-based Wine — how to load it and edit a document with no install.",
  keywords:
    "abiword browser, free word processor online, open source word processor, run abiword wine, edit doc in browser no install",
  ogTitle: "Run AbiWord in Your Browser — Free Word Processor",
  ogDescription:
    "AbiWord, the free open-source word processor, running cleanly in your browser with Wine + WebAssembly.",
  crumb: "AbiWord",
  body: `  <section class="card">
    <h2>Run AbiWord in your browser <span class="verdict good">Works well</span></h2>
    <p><em>AbiWord</em> is a free, open-source word processor that has been around since the late 1990s. It's lightweight, native Win32, and — as we note in the main <a href="/guide/">compatibility guide</a> — one of the most reliable office applications to run under browser-based Wine. If you need to open or edit a document on a Chromebook or locked-down machine, this is a great choice.</p>

    <table class="spec-table">
      <tr><th>App</th><td>AbiWord (<code>AbiWord.exe</code>)</td></tr>
      <tr><th>License</th><td>GPL-2.0 — free and open source</td></tr>
      <tr><th>Best Wine variant</th><td><strong>Win32 (default)</strong></td></tr>
      <tr><th>Opens</th><td><code>.abw</code>, <code>.doc</code>, <code>.rtf</code>, <code>.txt</code>, <code>.html</code>, and more</td></tr>
      <tr><th>Where to get it</th><td><a href="https://www.abisource.com/download/" target="_blank" rel="noopener">abisource.com/download</a> (official)</td></tr>
    </table>

    <h3>Why it runs so cleanly</h3>
    <p>AbiWord draws a standard window with standard controls, reads and writes files, and prints to a file — it doesn't reach for modern GPU features, recent .NET, or post-Windows-7 APIs. That maps almost perfectly onto what Wine 1.7.55 implements well, which is why older AbiWord builds are among the most dependable office apps in ExeBrowser.</p>

    <h3>Editing and saving a document</h3>
    <p>Bundle the AbiWord program folder (the EXE plus its DLLs) with any document you want to edit, upload it as a folder, and open the file inside AbiWord. When you're done, save inside the app, then click <strong>Download files written by this app</strong> to pull your edited document out of the in-memory <code>C:\\</code> as a zip. Remember the virtual drive is wiped on reload — download before you close the tab.</p>

    <h3>A practical workflow</h3>
    <p>AbiWord opens many <code>.doc</code> files well enough to read and lightly edit, and exports to RTF, HTML, and plain text. That makes it handy for rescuing the contents of an old Word document on a machine with no Office installed: open it, save as RTF or HTML, and download the result.</p>

    <div class="cta-row"><a class="cta-btn" href="/">Boot Wine and try it →</a></div>
  </section>

  <section class="card">
    <h2>Related guides</h2>
    <ul class="card-grid">
      <li><a class="link-card" href="/run/gnumeric/"><span class="lc-title">Gnumeric</span><span class="lc-desc">The free spreadsheet companion.</span></a></li>
      <li><a class="link-card" href="/run/notepad/"><span class="lc-title">Notepad &amp; utilities</span><span class="lc-desc">Small Win32 tools.</span></a></li>
      <li><a class="link-card" href="/guide/"><span class="lc-title">Full compatibility guide</span><span class="lc-desc">What runs and what doesn't.</span></a></li>
    </ul>
  </section>`,
});

// 5. Gnumeric — open-source spreadsheet, link out
pages.push({
  slug: "gnumeric",
  title: "Run Gnumeric in Your Browser — Free Spreadsheet — ExeBrowser",
  description:
    "Run Gnumeric, the free open-source spreadsheet, in your browser with Wine + WebAssembly. Open and edit XLS/CSV files with no install — one of the most reliable office apps for browser-based Wine.",
  keywords:
    "gnumeric browser, free spreadsheet online, open source excel alternative, run gnumeric wine, edit xls in browser",
  ogTitle: "Run Gnumeric in Your Browser — Free Spreadsheet",
  ogDescription:
    "Gnumeric, the free open-source spreadsheet, running in your browser with Wine + WebAssembly.",
  crumb: "Gnumeric",
  body: `  <section class="card">
    <h2>Run Gnumeric in your browser <span class="verdict good">Works well</span></h2>
    <p><em>Gnumeric</em> is a free, open-source spreadsheet — the spreadsheet counterpart to <a href="/run/abiword/">AbiWord</a> from the GNOME world. It's accurate, fast, lightweight, and runs reliably under browser-based Wine, making it a solid way to open or edit a spreadsheet on a machine where you can't install Excel or LibreOffice.</p>

    <table class="spec-table">
      <tr><th>App</th><td>Gnumeric (<code>gnumeric.exe</code>)</td></tr>
      <tr><th>License</th><td>GPL-2.0 — free and open source</td></tr>
      <tr><th>Best Wine variant</th><td><strong>Win32 (default)</strong></td></tr>
      <tr><th>Opens</th><td><code>.xls</code>, <code>.xlsx</code>, <code>.csv</code>, <code>.gnumeric</code>, <code>.ods</code></td></tr>
      <tr><th>Where to get it</th><td><a href="http://www.gnumeric.org/" target="_blank" rel="noopener">gnumeric.org</a> (official)</td></tr>
    </table>

    <h3>Why a spreadsheet is a good fit</h3>
    <p>Gnumeric is famous for the accuracy of its statistical functions and for being light on resources. It doesn't depend on modern GPU features or recent .NET, so older Windows builds run dependably in ExeBrowser. Recalculation is CPU work, so very large sheets will feel the emulation tax — but everyday spreadsheets are perfectly comfortable.</p>

    <h3>Open, edit, and get your file back</h3>
    <p>Bundle the Gnumeric program folder with the spreadsheet you want to open, upload as a folder, and edit inside the app. Save (Gnumeric can write CSV, XLS, and its own format), then click <strong>Download files written by this app</strong> to retrieve the saved file as a zip before you close the tab. This is a clean way to convert a stray <code>.xls</code> to CSV without any Office install.</p>

    <div class="cta-row"><a class="cta-btn" href="/">Boot Wine and try it →</a></div>
  </section>

  <section class="card">
    <h2>Related guides</h2>
    <ul class="card-grid">
      <li><a class="link-card" href="/run/abiword/"><span class="lc-title">AbiWord</span><span class="lc-desc">The free word processor.</span></a></li>
      <li><a class="link-card" href="/run/7-zip/"><span class="lc-title">7-Zip</span><span class="lc-desc">Open-source archiver.</span></a></li>
      <li><a class="link-card" href="/guide/"><span class="lc-title">Full compatibility guide</span><span class="lc-desc">What runs and what doesn't.</span></a></li>
    </ul>
  </section>`,
});

// 6. MS Paint / classic Paint — guide, link out
pages.push({
  slug: "mspaint",
  title: "Run Classic MS Paint in Your Browser — ExeBrowser",
  description:
    "Run a classic Windows Paint (MSPAINT) in your browser with Wine + WebAssembly. How to load the old XP-era Paint, what works, and free open-source paint alternatives that run cleanly with no install.",
  keywords:
    "mspaint browser, run ms paint online, classic windows paint, old mspaint exe, paint program no install browser",
  ogTitle: "Run Classic MS Paint in Your Browser",
  ogDescription:
    "The classic Windows Paint, running in your browser with Wine + WebAssembly. Plus open-source paint alternatives.",
  crumb: "MS Paint",
  body: `  <section class="card">
    <h2>Run classic MS Paint in your browser <span class="verdict partial">Works (classic builds)</span></h2>
    <p>The classic <em>Microsoft Paint</em> (<code>MSPAINT.EXE</code>) that shipped with Windows 95 through XP is a tiny, single-purpose Win32 program — exactly the kind of thing browser-based Wine handles well. If you want that pixel-perfect, no-frills painting experience without installing anything, the old Paint runs nicely in ExeBrowser.</p>

    <table class="spec-table">
      <tr><th>App</th><td>Microsoft Paint, classic (<code>MSPAINT.EXE</code>, Win95–XP era)</td></tr>
      <tr><th>Best Wine variant</th><td><strong>Win32 (default)</strong></td></tr>
      <tr><th>How to load</th><td>The old XP <code>MSPAINT.EXE</code> is essentially self-contained; upload it (add <code>MFC</code> DLLs if prompted)</td></tr>
      <tr><th>Saves</th><td><code>.bmp</code>, <code>.gif</code>, <code>.jpg</code>, <code>.png</code> (later builds)</td></tr>
    </table>

    <div class="warn-box">
      <h3 style="margin-top:0;">A licensing note</h3>
      <p><code>MSPAINT.EXE</code> is part of Windows and is Microsoft's copyrighted property — we can't host it, and you should only run a copy you already own (for example, one copied from your own Windows installation). The <strong>open-source alternatives below carry no such restriction</strong> and are the easier, fully-legal route.</p>
    </div>

    <h3>Better: free, open-source paint programs</h3>
    <p>Several classic open-source paint tools are freely distributable and run cleanly under browser-based Wine:</p>
    <ul>
      <li><strong>mtPaint</strong> — a tiny, fast, GPL pixel-art and image editor; a near-perfect fit for the Wine era we target. <a href="http://mtpaint.sourceforge.net/" target="_blank" rel="noopener">mtpaint.sourceforge.net</a></li>
      <li><strong>Pinta</strong> — a Paint.NET-style editor (note: needs .NET/Mono, so it's hit-or-miss on old Wine).</li>
      <li><strong>GrafX2</strong> — a classic 256-color pixel-art editor, very lightweight. <a href="http://grafx2.chez.com/" target="_blank" rel="noopener">grafx2 project</a></li>
    </ul>
    <p>Download the program folder, upload it with the folder picker, draw, save, then use <strong>Download files written by this app</strong> to get your image out as a zip.</p>

    <h3>Step by step</h3>
    <ol>
      <li>On the <a href="/">home page</a>, keep <strong>Win32 (default)</strong> and click <strong>Boot Wine</strong>.</li>
      <li>Use <strong>pick a folder</strong> and upload mtPaint (or your own classic <code>MSPAINT.EXE</code>) with its files.</li>
      <li>Select the EXE entry and <strong>Run in Wine</strong>.</li>
      <li>Draw, then save your image and click <strong>Download files written by this app</strong> before reloading.</li>
    </ol>

    <div class="cta-row"><a class="cta-btn" href="/">Boot Wine and try it →</a></div>
  </section>

  <section class="card">
    <h2>Related guides</h2>
    <ul class="card-grid">
      <li><a class="link-card" href="/run/notepad/"><span class="lc-title">Notepad &amp; utilities</span><span class="lc-desc">Small Win32 tools.</span></a></li>
      <li><a class="link-card" href="/run/abiword/"><span class="lc-title">AbiWord</span><span class="lc-desc">Free word processor.</span></a></li>
      <li><a class="link-card" href="/guide/"><span class="lc-title">Full compatibility guide</span><span class="lc-desc">What runs and what doesn't.</span></a></li>
    </ul>
  </section>`,
});

// 7. Winamp — classic media player, link out (freeware, no redistribution)
pages.push({
  slug: "winamp",
  title: "Run Classic Winamp in Your Browser — ExeBrowser",
  description:
    "Run a classic Winamp (2.x / 5.x) in your browser with Wine + WebAssembly. How to load the legendary MP3 player, what works and what doesn't under browser-based Wine, and where to get it.",
  keywords:
    "winamp browser, run winamp online, classic winamp, winamp 2.95, play mp3 winamp wine, it really whips the llama",
  ogTitle: "Run Classic Winamp in Your Browser",
  ogDescription:
    "The legendary classic Winamp, running in your browser with Wine + WebAssembly. What works and what doesn't.",
  crumb: "Winamp",
  body: `  <section class="card">
    <h2>Run classic Winamp in your browser <span class="verdict partial">Partial — UI yes, audio is iffy</span></h2>
    <p><em>Winamp</em> — the player that really whipped the llama's behind — is one of the most nostalgic pieces of late-90s Windows software there is. The classic 2.x and early 5.x builds are small native Win32 programs, so the interface and skins load under browser-based Wine. Audio playback is the catch: it depends on the emulated audio path, so treat this as a fun nostalgia trip more than a reliable music player.</p>

    <table class="spec-table">
      <tr><th>App</th><td>Winamp, classic (2.9x or 5.x “Lite/Full”, 32-bit)</td></tr>
      <tr><th>Best Wine variant</th><td><strong>Win32 (default)</strong></td></tr>
      <tr><th>UI &amp; skins</th><td>Generally load — the classic skinned window renders</td></tr>
      <tr><th>Audio</th><td>Hit-or-miss — depends on the emulated Web Audio path</td></tr>
      <tr><th>Where to get it</th><td>The official site and reputable archives host the classic installers; this is freeware we link to rather than host.</td></tr>
    </table>

    <h3>What works, honestly</h3>
    <p>The classic skinned Winamp window, the playlist editor, the equalizer, and skin loading all tend to render correctly — it genuinely looks like 2001 again. Where it gets shaky is actual sound output: Boxedwine routes audio to Web Audio, and Winamp's output plugins don't always cooperate with that path. You may get silence or stutter even when the UI is perfect. The visualizer and any plugins that probe hardware are also unreliable.</p>

    <h3>How to load it</h3>
    <p>Winamp ships as an installer, which won't run well here directly. Install it on a Windows PC (or extract a portable build), then upload the resulting Winamp program folder — <code>winamp.exe</code> plus its <code>Plugins\\</code> and <code>Skins\\</code> folders — with the <strong>folder picker</strong>. Bundle a small MP3 in the same folder if you want to test playback.</p>

    <div class="warn-box">
      <p style="margin:0;">We don't host Winamp here — it's freeware, not open-source, and its license doesn't grant redistribution rights. Download it from the official site or a reputable archive, and only run a copy you obtained legitimately.</p>
    </div>

    <div class="cta-row"><a class="cta-btn" href="/">Boot Wine and try it →</a></div>
  </section>

  <section class="card">
    <h2>Related guides</h2>
    <ul class="card-grid">
      <li><a class="link-card" href="/run/doom/"><span class="lc-title">DOOM</span><span class="lc-desc">Free shareware, hosted here.</span></a></li>
      <li><a class="link-card" href="/run/notepad/"><span class="lc-title">Notepad &amp; utilities</span><span class="lc-desc">Small Win32 tools.</span></a></li>
      <li><a class="link-card" href="/guide/"><span class="lc-title">Full compatibility guide</span><span class="lc-desc">What runs and what doesn't.</span></a></li>
    </ul>
  </section>`,
});

// ---- write files ---------------------------------------------------------
for (const p of pages) {
  const out = resolve(ROOT, "run", p.slug, "index.html");
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, head(p), "utf8");
  console.log("wrote", out);
}
console.log(`\nGenerated ${pages.length} pages.`);
