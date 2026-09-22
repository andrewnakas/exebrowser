// Install prompt and service worker registration.
//
// The site's retention problem is not that people dislike it — 96.5% of users
// are first-timers who play once and never find their way back. They have a
// save sitting in localStorage and no route to it. An installed icon is that
// route, so this file exists to earn one.
//
// The prompt is deliberately not shown to everyone. A first-time visitor who
// has not played anything has been given no reason to install and asking them
// spends the browser's one-shot beforeinstallprompt on the worst possible
// audience. It is offered to people who have something to come back FOR: a
// save on this device, two titles played, a program run or inspected, three
// pages read in one session, or a return visit already recorded.
//
// That list used to be the first two items only, and both come from
// save-core.js — which is loaded on the catalogue and nowhere else. So every
// reader of the blog, the guide, the .exe explainer and the loader was
// excluded by construction, however engaged they were, and that is now the
// faster-growing half of the site.
(() => {
  "use strict";

  // /64/ is cross-origin isolated and runs its own coi-serviceworker shim.
  // Registering a second worker over it risks losing the COEP rewriting that
  // SharedArrayBuffer depends on.
  if (location.pathname.startsWith("/64/")) return;

  const DISMISS_KEY = "exe_install_dismissed";
  const DISMISS_DAYS = 14;
  // Pages seen this tab session. The qualification test below used to depend
  // entirely on SaveCore, which is loaded on the catalogue and nowhere else —
  // so nobody reading the blog, the guide, the viewer or the .exe explainer
  // could ever be offered an install, however long they stayed. That audience
  // is now the fastest-growing half of the site.
  const VIEWS_KEY = "exe_views";
  const ENGAGED_KEY = "exe_engaged";
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
    maybeOffer();
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
     * Called by the runtimes when a visitor does something that earns the
     * offer: boots a program, or reads one in the viewer. A far better signal
     * than a page view, and the reason the bar can now reach the utility
     * audience at all.
     */
    engaged(what) {
      writeSS(ENGAGED_KEY, what || "1");
      maybeOffer();
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
  // Still not everyone: a first-time visitor who has done nothing has been
  // given no reason to install, and asking them spends the browser's one-shot
  // beforeinstallprompt on the worst possible audience.
  //
  // What changed is who counts as having done something. The old test was
  // SaveCore-only, and SaveCore is loaded on the catalogue and nowhere else,
  // so the entire utility and blog audience — the half that is growing — was
  // structurally excluded no matter how engaged it was.
  function qualifies() {
    if (standalone || dismissedRecently()) return false;
    try {
      if (window.SaveCore && SaveCore.saves().length >= 1) return true;   // has a save
      if (window.SaveCore && SaveCore.all().length >= 2) return true;      // played two things
    } catch (_) { /* fall through */ }
    if (readSS(ENGAGED_KEY)) return true;                                  // ran or inspected something
    if (views >= 3) return true;                                           // read three pages this session
    // Written by save-core.js on a return visit. Kept as a signal, no longer
    // the only one that can reach a reader.
    return !!readSS("exe_return_visit_sent");
  }

  let offered = false;
  function maybeOffer() {
    if (offered || !qualifies()) return;
    if (!deferred && !isIOS) return;
    offered = true;
    render();
  }

  function render() {
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

    // `reason` is the whole point of widening the test: without it the next
    // funnel read cannot tell whether the new audience installs at all.
    track("install_prompt_shown", {
      ios: isIOS ? 1 : 0,
      saved_games: saved,
      reason: saved ? "has_save" : readSS(ENGAGED_KEY) ? "engaged" : views >= 3 ? "read_pages" : "return_visit",
      views,
    });
  }

  // iOS never fires beforeinstallprompt, so it needs its own trigger. Both
  // paths wait for save-core.js to have loaded and run.
  if (document.readyState === "complete") setTimeout(maybeOffer, 800);
  else addEventListener("load", () => setTimeout(maybeOffer, 800));
})();
