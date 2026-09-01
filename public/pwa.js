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
// audience. It is offered only to people who have something to come back FOR:
// a save on this device, or a return visit already recorded.
(() => {
  "use strict";

  // /64/ is cross-origin isolated and runs its own coi-serviceworker shim.
  // Registering a second worker over it risks losing the COEP rewriting that
  // SharedArrayBuffer depends on.
  if (location.pathname.startsWith("/64/")) return;

  const DISMISS_KEY = "exe_install_dismissed";
  const DISMISS_DAYS = 14;
  const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) && !window.MSStream;
  const standalone = (window.matchMedia && matchMedia("(display-mode: standalone)").matches) ||
                     navigator.standalone === true;

  let deferred = null;

  function track(name, params) {
    if (typeof window.gtag === "function") window.gtag("event", name, params || {});
  }

  function readLS(key) { try { return localStorage.getItem(key); } catch (_) { return null; } }
  function writeLS(key, val) { try { localStorage.setItem(key, val); } catch (_) { /* nicety */ } }

  function dismissedRecently() {
    const at = Number(readLS(DISMISS_KEY) || 0);
    return at && Date.now() - at < DISMISS_DAYS * 86400000;
  }

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

  window.addEventListener("appinstalled", () => {
    deferred = null;
    track("install_accepted");
    const bar = document.getElementById("install-bar");
    if (bar) bar.remove();
  });

  window.ExeInstall = {
    available() { return !!deferred || (isIOS && !standalone); },
    isIOS,
    standalone,
    async prompt() {
      if (!deferred) return null;
      const e = deferred;
      deferred = null;
      e.prompt();
      const choice = await e.userChoice.catch(() => null);
      track(choice && choice.outcome === "accepted" ? "install_accepted" : "install_declined");
      return choice;
    },
  };

  // ── The offer ────────────────────────────────────────────────────────────
  function qualifies() {
    if (standalone || dismissedRecently()) return false;
    try {
      if (window.SaveCore && SaveCore.saves().length >= 1) return true;
      if (window.SaveCore && SaveCore.all().length >= 2) return true;
    } catch (_) { /* fall through */ }
    try { return !!sessionStorage.getItem("exe_return_visit_sent"); } catch (_) { return false; }
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

    track("install_prompt_shown", { ios: isIOS ? 1 : 0, saved_games: saved });
  }

  // iOS never fires beforeinstallprompt, so it needs its own trigger. Both
  // paths wait for save-core.js to have loaded and run.
  if (document.readyState === "complete") setTimeout(maybeOffer, 800);
  else addEventListener("load", () => setTimeout(maybeOffer, 800));
})();
