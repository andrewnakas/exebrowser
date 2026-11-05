// Install prompt and service worker registration.
//
// The site's retention problem is not that people dislike it — 96.5% of users
// are first-timers who play once and never find their way back. They have a
// save sitting in localStorage and no route to it. An installed icon is that
// route, so this file exists to earn one.
//
// The prompt is shown at a moment, not on a page load. It used to appear 800ms
// after load for anyone with a save, two titles played, a return visit or three
// pages read — 19,080 shows to 6,012 users in the 28 days to 2026-11-03, for
// 510 installs. Most of those shows landed on someone who had just arrived and
// had not done anything yet on this page.
//
// Now it waits for the visitor to do the thing they came for: their first
// save lands, a program has been running for a minute, or the viewer has read
// a file. `trigger` on install_prompt_shown says which, so the next funnel read
// can compare the three.
(() => {
  "use strict";

  // /64/ is cross-origin isolated and runs its own coi-serviceworker shim.
  // Registering a second worker over it risks losing the COEP rewriting that
  // SharedArrayBuffer depends on.
  if (location.pathname.startsWith("/64/")) return;

  const DISMISS_KEY = "exe_install_dismissed";
  const DISMISS_DAYS = 14;
  // Pages seen this tab session — reported with the offer, no longer a trigger.
  const VIEWS_KEY = "exe_views";
  const ENGAGED_KEY = "exe_engaged";
  // A boot is the start of a session, not proof of one; the bar appearing over
  // the first frame is an interruption. A minute in, they are playing.
  const BOOT_DELAY_MS = 60000;
  const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) && !window.MSStream;
  const standalone = (window.matchMedia && matchMedia("(display-mode: standalone)").matches) ||
                     navigator.standalone === true;

  let deferred = null;

  function track(name, params) {
    if (typeof window.gtag === "function") window.gtag("event", name, params || {});
  }

  function readLS(key) { try { return localStorage.getItem(key); } catch (_) { return null; } }
  function writeLS(key, val) { try { localStorage.setItem(key, val); } catch (_) { /* nicety */ } }

  function readSS(key) { try { return sessionStorage.getItem(key); } catch (_) { return null; } }
  function writeSS(key, val) { try { sessionStorage.setItem(key, val); } catch (_) { /* nicety */ } }

  function dismissedRecently() {
    const at = Number(readLS(DISMISS_KEY) || 0);
    return at && Date.now() - at < DISMISS_DAYS * 86400000;
  }

  // Count this page view. Cheap, session-scoped, and independent of save-core.js
  // — which is the point: it works on every page that loads pwa.js, which is
  // 143 of 175.
  const views = Number(readSS(VIEWS_KEY) || 0) + 1;
  writeSS(VIEWS_KEY, String(views));

  // ── Service worker ───────────────────────────────────────────────────────
  if ("serviceWorker" in navigator) {
    addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch(() => { /* installability is a bonus, never a requirement */ });
    });
  }

  if (standalone) track("launch_standalone", { page_path: location.pathname });

  window.addEventListener("beforeinstallprompt", e => {
    e.preventDefault();
    deferred = e;
    // The moment may already have passed before Chrome decided the site was
    // installable; offer it now rather than lose it.
    if (pending) maybeOffer(pending);
  });

  // One install, one event. `appinstalled` and the userChoice promise both
  // resolve for the same install, so this used to count it twice — and the
  // install numbers are the only measure this lever has.
  let countedInstall = false;
  function countInstall(source) {
    if (countedInstall) return;
    countedInstall = true;
    track("install_accepted", { source });
  }

  window.addEventListener("appinstalled", () => {
    deferred = null;
    // "browser" means they used Chrome's own address-bar install rather than
    // our bar — worth telling apart, because it says the bar was unnecessary.
    countInstall("browser");
    const bar = document.getElementById("install-bar");
    if (bar) bar.remove();
  });

  window.ExeInstall = {
    available() { return !!deferred || (isIOS && !standalone); },
    isIOS,
    standalone,
    /**
     * Called by the runtimes at the moments that earn the offer:
     *   "save"    — the first save landed (dos-embed.js, app.js)
     *   "boot"    — a program or game started; offered a minute later
     *   "inspect" — the viewer read a file (pe-inspect.js)
     */
    engaged(what) {
      what = what || "engaged";
      writeSS(ENGAGED_KEY, what);
      if (what === "boot") setTimeout(() => maybeOffer("boot"), BOOT_DELAY_MS);
      else maybeOffer(what);
    },
    async prompt() {
      if (!deferred) return null;
      const e = deferred;
      deferred = null;
      e.prompt();
      let choice = null, failed = false;
      try { choice = await e.userChoice; } catch (_) { failed = true; }
      // A rejected userChoice is a browser problem, not a person saying no.
      // Reporting it as install_declined made the decline rate unreadable.
      if (failed || !choice) track("install_prompt_error");
      else if (choice.outcome === "accepted") countInstall("bar");
      else track("install_declined");
      return choice;
    },
  };

  // ── The offer ────────────────────────────────────────────────────────────
  //
  // Only ever called from engaged(), so there is no page-load path: whoever
  // sees it has just saved, played for a minute, or read a file.
  let offered = false;
  let pending = null;   // a moment that came before beforeinstallprompt did
  function maybeOffer(trigger) {
    if (offered || standalone || dismissedRecently()) return;
    if (!deferred && !isIOS) { pending = trigger; return; }
    offered = true;
    render(trigger);
  }

  function render(trigger) {
    if (document.getElementById("install-bar")) return;
    const bar = document.createElement("p");
    bar.className = "resume-bar install-bar";
    bar.id = "install-bar";

    const label = document.createElement("span");
    label.className = "resume-label";
    let saved = 0;
    try { saved = window.SaveCore ? SaveCore.saves().length : 0; } catch (_) {}
    label.textContent = saved
      ? (saved === 1 ? "Your saved game, one tap away —" : "Your " + saved + " saved games, one tap away —")
      : "Keep ExeBrowser one tap away —";
    bar.appendChild(label);

    if (isIOS) {
      const how = document.createElement("span");
      how.className = "resume-link";
      how.textContent = "tap Share, then “Add to Home Screen”.";
      bar.appendChild(how);
    } else {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "button primary install-go";
      btn.textContent = "Install";
      btn.addEventListener("click", () => { window.ExeInstall.prompt(); });
      bar.appendChild(btn);
    }

    const no = document.createElement("button");
    no.type = "button";
    no.className = "install-dismiss";
    no.textContent = "Not now";
    no.addEventListener("click", () => {
      writeLS(DISMISS_KEY, String(Date.now()));
      track("install_dismissed");
      bar.remove();
    });
    bar.appendChild(no);

    // Under the resume bar when there is one, so "resume your game" always
    // outranks "install the site" — the first is the thing they came for.
    const resume = document.getElementById("resume-bar");
    const main = document.querySelector("main");
    if (resume && resume.parentNode && !resume.hidden) resume.parentNode.insertBefore(bar, resume.nextSibling);
    else if (resume && resume.parentNode) resume.parentNode.insertBefore(bar, resume);
    else if (main) main.insertBefore(bar, main.firstChild);
    else return;

    // `trigger` is the moment that raised the bar (save, boot or inspect).
    // `reason` keeps its old meaning so the funnel stays comparable with the
    // reads before 2026-11.
    track("install_prompt_shown", {
      ios: isIOS ? 1 : 0,
      saved_games: saved,
      trigger: trigger || "engaged",
      reason: saved ? "has_save" : "engaged",
      views,
    });
  }
})();
