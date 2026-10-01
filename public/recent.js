// The "come back to what you were doing" surfaces, on every listing page.
//
// This used to be a play-history list and nothing more: the embeds called
// rememberPlayed() as a game booted, and every page that had ever been opened
// came back labelled "▶ Continue" — whether or not there was anything to
// continue into. Several of the hand-written game pages called it on page
// *load*, so a title you glanced at for two seconds claimed a save you'd never
// made.
//
// Now the source of truth is save-core.js: an entry only says Resume if a save
// actually exists, and the card shows the frame it was saved on, because the
// most direct way to offer someone their game back is to show it to them.
// Play history is still kept — it's how "played but not saved" is ranked — but
// it's a separate fact and it's labelled as one.
(() => {
  "use strict";

  const KEY = "exe_recent";
  const MAX = 8;
  // Four cards was a phone-sized guess made when almost nobody had saves. A
  // returning player with six saved games could see only four of them, and the
  // other two had no route at all until the "all saved games" link below.
  const MAX_CONTINUE = 8;

  const core = () => window.SaveCore;

  function readLegacy() {
    try {
      const raw = localStorage.getItem(KEY);
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list.filter(e => e && e.slug) : [];
    } catch {
      return [];
    }
  }

  // Everything the index knows, newest activity first. Falls back to the old
  // list so a page that somehow loads without save-core.js still works.
  function entries() {
    const sc = core();
    if (!sc) return readLegacy().map(e => ({ slug: e.slug, name: e.name, playedAt: e.ts }));
    const seen = new Set();
    const out = sc.all();
    for (const rec of out) seen.add(rec.slug);
    for (const e of readLegacy()) {
      if (!seen.has(e.slug)) out.push({ slug: e.slug, name: e.name, playedAt: e.ts });
    }
    return out.sort((a, b) =>
      Math.max(b.updatedAt || 0, b.playedAt || 0) - Math.max(a.updatedAt || 0, a.playedAt || 0));
  }

  function relativeTime(ts) {
    if (!ts) return "";
    const mins = Math.round((Date.now() - ts) / 60000);
    if (mins < 2) return "just now";
    if (mins < 60) return mins + " min ago";
    const hours = Math.round(mins / 60);
    if (hours < 24) return hours === 1 ? "an hour ago" : hours + " hours ago";
    const days = Math.round(hours / 24);
    return days === 1 ? "yesterday" : days + " days ago";
  }

  // Kept for the embeds and the hand-written pages that still call it. It now
  // records history only — claiming a save is save-core's job, and only after
  // one has been written.
  // The path a resume link should point at: where the visitor actually played,
  // falling back to the English page for history recorded before we stored it.
  //
  // An EXE the visitor uploaded themselves is saved as "byo-<hash>" and has no
  // page of its own, so /run/byo-…/ is a 404 — and for a month it was the
  // destination of every Resume link for those saves, which made it nearly
  // every 404 on the site. Its files come back when the same EXE is opened in
  // the loader again, so the loader is where the link goes.
  function isByo(entry) {
    return !!(entry && /^(byo-|home$)/.test(entry.slug || ""));
  }
  function resumeHref(entry) {
    if (isByo(entry)) {
      return (entry.path && /\/load-exe\/$/.test(entry.path)) ? entry.path : "/load-exe/";
    }
    return (entry && entry.path) || `/run/${entry.slug}/`;
  }
  // Poster art exists only for catalogue games; asking for an uploaded EXE's
  // is just another 404.
  function fallbackShot(entry) {
    return isByo(entry) ? "" : `/run/${entry.slug}/screenshot.png`;
  }
  window.resumeHref = resumeHref;

  // Where a *Resume* link points: the same page, plus a fragment the game
  // page reads as "boot straight in". The click on the card is already the
  // decision to play; the game page used to ask for it a second time with its
  // own Play button, and a return loop is only as strong as its weakest step.
  // Only saves get it — a "Play again" card promises nothing to resume.
  function resumeLink(entry) {
    return resumeHref(entry) + (entry && entry.updatedAt && !isByo(entry) ? "#resume" : "");
  }

  // `runtime` is optional and deliberately passed through undefined when it is
  // not known: markPlayed falls back to the runtime already on the record, so
  // calling this after a runtime-aware markPlayed no longer downgrades every
  // record to "unknown" the way passing the literal string did.
  window.rememberPlayed = function rememberPlayed(slug, name, runtime) {
    if (!slug) return;
    core()?.markPlayed(slug, name, runtime);
    try {
      const list = readLegacy().filter(e => e.slug !== slug);
      localStorage.setItem(KEY, JSON.stringify([{ slug, name: name || slug, ts: Date.now() }, ...list].slice(0, MAX)));
    } catch {
      /* quota or blocked storage — history is a nicety, never required */
    }
  };

  window.getRecentlyPlayed = entries;

  // The click-the-screenshot affordance itself. One implementation, used by
  // the resume bar, the Continue strip and the game pages, so the thing you
  // click always looks the same wherever you meet it.
  window.renderResumeCard = function renderResumeCard(entry, opts) {
    const o = opts || {};
    const card = document.createElement("a");
    card.className = "poster-card resume-card";
    card.href = resumeLink(entry);

    const img = document.createElement("img");
    img.className = "pc-shot";
    img.alt = "";
    img.loading = "lazy";
    const shot = entry.thumb || fallbackShot(entry);
    if (shot) img.src = shot;
    // A save written before thumbnails existed, or a game whose canvas can't
    // be read back, falls through to the poster art; a missing poster leaves
    // the card text-only rather than showing a broken image.
    img.addEventListener("error", () => img.remove(), { once: true });

    const body = document.createElement("span");
    body.className = "pc-body";
    const title = document.createElement("span");
    title.className = "pc-title";
    title.textContent = entry.name || entry.slug;
    const play = document.createElement("span");
    play.className = "pc-play";
    play.textContent = o.label || (entry.updatedAt ? "▶ Resume" : "▶ Play again");
    body.append(title, play);

    if (entry.updatedAt) {
      const when = document.createElement("span");
      when.className = "pc-when muted small";
      when.textContent = "Saved " + relativeTime(entry.updatedAt);
      body.appendChild(when);
    }

    if (shot) card.appendChild(img);
    card.appendChild(body);
    card.addEventListener("click", () => {
      window.gtag?.("event", "resume_click", { app_slug: entry.slug, has_save: entry.updatedAt ? 1 : 0 });
    });
    return card;
  };

  // Render into the listing page's own grid. Saves come first and say Resume;
  // games that were opened but never saved follow and say Play again, which is
  // what they actually offer.
  window.renderContinue = function renderContinue(wrapId, gridId) {
    const wrap = document.getElementById(wrapId);
    const grid = document.getElementById(gridId);
    if (!wrap || !grid) return;

    const list = entries();
    if (!list.length) return;

    const withSave = list.filter(e => e.updatedAt);
    const played = list.filter(e => !e.updatedAt);

    const seen = new Set();
    let added = 0;
    for (const entry of withSave.concat(played)) {
      if (seen.has(entry.slug)) continue;
      seen.add(entry.slug);
      // Only offer games this page actually lists, so a card can't outlive the
      // catalog entry it came from.
      const source = document.querySelector(`.poster-card[href="/run/${CSS.escape(entry.slug)}/"]`);
      if (!source) continue;

      const name = entry.name || source.querySelector(".pc-title")?.textContent || entry.slug;
      const li = document.createElement("li");
      li.appendChild(window.renderResumeCard(Object.assign({}, entry, { name })));
      grid.appendChild(li);
      added++;
      if (added >= MAX_CONTINUE) break;
    }
    // A player with more saves than fit needs a route to the rest; without it
    // the older ones are unreachable from the page they land on.
    const savedTotal = withSave.length;
    if (added && savedTotal > added && !wrap.querySelector(".continue-all")) {
      const more = document.createElement("p");
      more.className = "continue-all muted small";
      const a = document.createElement("a");
      a.href = "/saves/";
      a.textContent = `All ${savedTotal} saved games \u2192`;
      a.addEventListener("click", () => {
        window.gtag?.("event", "saves_all_click", { saved_games: savedTotal });
      });
      more.appendChild(a);
      wrap.appendChild(more);
    }
    if (added) wrap.hidden = false;
  };

  // The single most valuable thing on the page for a returning player, put at
  // the top of any page that opts in with #resume-bar. Deliberately not shown
  // on the game's own page — you're already there.
  window.renderResumeBar = function renderResumeBar(barId) {
    const bar = document.getElementById(barId);
    if (!bar) return;

    const last = entries().find(e => e.updatedAt);
    if (!last) return;
    const href = resumeHref(last);
    if (location.pathname === href) {
      // Already on the loader: there is nothing to link to, but the visitor
      // needs telling that opening the same file brings their work back.
      if (!isByo(last)) return;
      const label = document.createElement("span");
      label.className = "resume-label";
      label.textContent = "Welcome back —";
      const note = document.createElement("span");
      const name = last.name || "your program";
      note.textContent = ` your files from ${name} are saved in this browser. Open ${name} again below and they come back.`;
      bar.append(label, note);
      bar.hidden = false;
      return;
    }

    const link = document.createElement("a");
    link.href = resumeLink(last);
    link.className = "resume-link resume-bar-link";

    const img = document.createElement("img");
    img.className = "resume-bar-shot";
    img.alt = "";
    const shot = last.thumb || fallbackShot(last);
    if (shot) img.src = shot;
    img.addEventListener("error", () => img.remove(), { once: true });

    const text = document.createElement("span");
    text.textContent = `▶ Resume ${last.name || last.slug}`;

    const when = document.createElement("span");
    when.className = "muted small";
    when.textContent = " · saved " + relativeTime(last.updatedAt);

    if (shot) link.append(img);
    link.append(text, when);
    link.addEventListener("click", () => {
      window.gtag?.("event", "resume_click", { app_slug: last.slug, has_save: 1 });
    });

    const label = document.createElement("span");
    label.className = "resume-label";
    label.textContent = "Welcome back —";

    bar.append(label, link);
    bar.hidden = false;
  };
})();
