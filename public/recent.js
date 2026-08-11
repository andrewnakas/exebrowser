// Recently-played tracking, shared by every runtime and every listing page.
//
// Two halves, both tiny and both purely client-side:
//   rememberPlayed(slug, name)  — called by the embeds when a game boots
//   renderContinue(...)         — called by the homepage and /run/ hub
//
// Nothing here talks to the network, so crawlers see an empty strip and the
// pages stay static. Storage is localStorage under one key; if it's full or
// blocked (private mode, cookie-blockers) every path degrades to a no-op.
(() => {
  "use strict";

  const KEY = "exe_recent";
  const MAX = 8;
  const DAY = 86400000;

  function read() {
    try {
      const raw = localStorage.getItem(KEY);
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list.filter(e => e && e.slug) : [];
    } catch {
      return [];
    }
  }

  function write(list) {
    try {
      localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
    } catch {
      /* quota or blocked storage — recently-played is a nicety, never required */
    }
  }

  // Most recent first, one entry per game.
  window.rememberPlayed = function rememberPlayed(slug, name) {
    if (!slug) return;
    const list = read();

    // A returning player is someone whose history predates today. GA's own
    // returning-user metric can't see this — it's cookie-scoped and the site has
    // no login — so the play history is the only honest signal we have.
    const priorDay = list.some(e => e.ts && Date.now() - e.ts > DAY);
    if (priorDay && typeof window.gtag === "function") {
      window.gtag("event", "return_play", { app_slug: slug, prior_games: list.length });
    }

    write([{ slug, name: name || slug, ts: Date.now() }, ...list.filter(e => e.slug !== slug)]);
  };

  window.getRecentlyPlayed = read;

  // Render into a <ul> using poster cards cloned from the page's own grid, so
  // the strip inherits whatever art the listing already has. `catalog` maps
  // slug -> { href, art } scraped from the existing cards on the page.
  window.renderContinue = function renderContinue(wrapId, gridId) {
    const wrap = document.getElementById(wrapId);
    const grid = document.getElementById(gridId);
    if (!wrap || !grid) return;

    const recent = read();
    if (!recent.length) return;

    const seen = new Set();
    let added = 0;
    for (const entry of recent) {
      // Reuse the existing card for this game if the page lists one.
      const source = document.querySelector(`.poster-card[href="/run/${CSS.escape(entry.slug)}/"]`);
      if (!source || seen.has(entry.slug)) continue;
      seen.add(entry.slug);
      const clone = source.cloneNode(true);
      const play = clone.querySelector(".pc-play");
      if (play) play.textContent = "▶ Continue";
      const li = document.createElement("li");
      li.appendChild(clone);
      grid.appendChild(li);
      added++;
      if (added >= 4) break;
    }
    if (added) wrap.hidden = false;
  };

  // A returning player's saved game is the single most valuable thing on the
  // page, and until now it was only reachable by scrolling to the Continue
  // strip. This puts it at the top of any page that opts in with #resume-bar.
  // Deliberately not shown on the game's own page — you're already there.
  window.renderResumeBar = function renderResumeBar(barId) {
    const bar = document.getElementById(barId);
    if (!bar) return;

    const last = read()[0];
    if (!last || !last.slug) return;
    const href = `/run/${last.slug}/`;
    if (location.pathname === href) return;

    const link = document.createElement("a");
    link.href = href;
    link.className = "resume-link";
    link.textContent = `▶ Resume ${last.name}`;
    link.addEventListener("click", () => {
      window.gtag?.("event", "resume_click", { app_slug: last.slug });
    });

    const label = document.createElement("span");
    label.className = "resume-label";
    label.textContent = "Welcome back —";

    bar.append(label, link);
    bar.hidden = false;
  };
})();
