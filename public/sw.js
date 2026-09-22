// ExeBrowser service worker — deliberately minimal.
//
// The site's whole value is multi-megabyte emulator runtimes and game bundles
// that the HTTP cache already handles well (see public/_headers: /dosbox/*.wasm
// and /boxedwine/* are immutable for a year). A service worker that tried to
// own those would duplicate hundreds of megabytes into the Cache API for no
// gain and every chance of serving a stale runtime against a fresh bundle.
//
// So this one exists for exactly two reasons: it makes the site installable,
// and it gives an installed copy something to show when the network is gone.
// It touches nothing else.
//
// Hard rules, each of which has a real failure behind it:
//   - Only navigations are intercepted. Sub-resources go straight to the
//     network and keep their HTTP caching semantics untouched.
//   - /64/*, /apps/* and /api/* are never intercepted. /64/ is cross-origin
//     isolated and runs its own coi-serviceworker shim, which rewrites
//     responses to carry COEP; passing those through a second worker risks
//     dropping the headers and silently disabling SharedArrayBuffer. /apps/*
//     are the iframed game frames and /api/* is a Cloudflare Function.
//   - Network-first for navigations, always. An offline page is a fallback,
//     never a cache that could pin a stale page in front of a deployed one.
//     HTML is never written to the cache, for the same reason.
//
// Considered and rejected, 2026-09-22: serving the small shared assets
// (style.css, pwa.js, the icons) cache-first, so an installed app opens
// instantly on a slow connection. It was written, and then removed, because it
// fights a deliberate decision recorded in public/_headers: those files are
// served max-age=60, must-revalidate precisely so a deploy reaches people in a
// minute. A cache-first worker in front of that pins whatever it saw first
// until the next load, and the version query strings only protect you if every
// change remembers to bump one — which is a rule, not a guarantee. The upside
// was a faster second paint; the downside was shipping a fix and not knowing
// who had it. Not worth it for this site.

// Bumped whenever the worker's behaviour changes: activate() deletes every
// other exebrowser-* cache, so an old shell can never outlive the code that
// filled it. Without the bump, installed users keep the previous worker and
// none of this ships to the people it was written for.
const CACHE = "exebrowser-shell-v2";
const OFFLINE_URL = "/offline/index.html";

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(c => c.add(new Request(OFFLINE_URL, { cache: "reload" })))
      .catch(() => { /* no offline page is survivable; a failed install is not */ })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE && k.startsWith("exebrowser-")).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET" || req.mode !== "navigate") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (/^\/(64|apps|api)\//.test(url.pathname)) return;

  event.respondWith(
    fetch(req).catch(() =>
      caches.match(OFFLINE_URL).then(hit => hit || new Response(
        "<!doctype html><title>Offline</title><p>You are offline.</p>",
        { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } }
      ))
    )
  );
});
