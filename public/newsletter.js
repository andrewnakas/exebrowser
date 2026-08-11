// Report newsletter signups to GA. The form posts to the provider directly —
// this only observes it, so a blocked or failed analytics call can never stop
// someone subscribing.
(() => {
  "use strict";
  for (const form of document.querySelectorAll("[data-newsletter]")) {
    form.addEventListener("submit", () => {
      window.gtag?.("event", "newsletter_signup", { page_path: location.pathname });
    });
  }
})();
