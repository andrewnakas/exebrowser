// Measures whether the embed pointer on the high-traffic game pages actually
// sends anyone to /embed/.
//
// The pointer exists because the embed offer itself is licensed to eleven pages
// that between them earn 0.25% of the site's search impressions, while the page
// that earns 78% of them had no mention of the offer above the footer. Without
// this event there is no way to tell a pointer nobody clicks from a pointer
// nobody was shown — and that difference decides whether the embed bet is
// failing at the offer or at the distribution of the offer.
(() => {
  "use strict";
  const cta = document.getElementById("embed-pointer-cta");
  if (!cta) return;

  cta.addEventListener("click", () => {
    if (typeof window.gtag !== "function") return;
    // Which page the visitor came from: the pointer's whole job is to move
    // people off the pages we cannot offer, so the source is the metric. The
    // pointer also sits on the homepage, the loader and the guide, which have
    // no slug — report those by path so the two are told apart in GA4.
    const m = location.pathname.match(/\/run\/([^/]+)\//);
    const slug = m ? m[1] : (location.pathname === "/" ? "home" : location.pathname.replace(/^\/|\/$/g, ""));
    window.gtag("event", "embed_pointer_click", { app_slug: slug });
  });
})();
