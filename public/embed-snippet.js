// Renders the "put this game on your site" box.
//
// This is the acquisition mechanism, not a feature: every accepted embed puts a
// real <a href> to this domain on someone else's page, and external links are
// the constraint everything else on this site is stuck behind.
(() => {
  "use strict";
  const box = document.getElementById("embed-offer");
  if (!box) return;

  const slug = box.dataset.slug;
  const name = box.dataset.name || "this game";
  const site = "https://exebrowser.com";

  const snippet =
    `<iframe src="${site}/embed/${slug}/" width="100%" height="600" ` +
    `style="border:0;max-width:760px" title="${name}" loading="lazy"></iframe>\n` +
    `<p><a href="${site}/run/${slug}/">${name}</a> by <a href="${site}/">ExeBrowser</a></p>`;

  const ta = box.querySelector("textarea");
  const btn = box.querySelector("button");
  if (ta) ta.value = snippet;

  if (btn && ta) {
    btn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(snippet);
      } catch {
        // Clipboard API needs permission and a secure context; selecting the
        // text is a fine fallback and works everywhere.
        ta.select();
      }
      const was = btn.textContent;
      btn.textContent = "Copied";
      if (typeof window.gtag === "function") {
        window.gtag("event", "embed_copy", { app_slug: slug });
      }
      setTimeout(() => { btn.textContent = was; }, 1600);
    });
  }
})();
