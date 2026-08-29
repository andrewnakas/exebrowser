// Newsletter signup: submit in place, report to GA, and never lose the address.
//
// The form used to post natively with target="_blank", which suited a provider
// that renders its own confirmation page. It posts to our own /api/subscribe
// now, so a native post would dump the visitor on a bare response page. This
// intercepts and shows the result inline instead.
//
// The form still works with this script blocked or broken: the markup is a real
// POST form to a real endpoint, and the endpoint answers a non-fetch request
// with an HTML page. That is the whole reason it content-negotiates.
(() => {
  "use strict";

  for (const form of document.querySelectorAll("[data-newsletter]")) {
    const status = form.parentElement?.querySelector("[data-newsletter-status]");
    const button = form.querySelector("button[type=submit]");
    const input = form.querySelector("input[type=email]");
    let busy = false;

    const say = (msg, ok) => {
      if (!status) return;
      status.textContent = msg;
      status.hidden = false;
      // Announce it: the message replaces the form's own feedback, and someone
      // on a screen reader gets nothing at all otherwise.
      status.setAttribute("role", "status");
      status.classList.toggle("is-error", ok === false);
    };

    form.addEventListener("submit", async (e) => {
      // Analytics first and unconditionally, so a failure below can't cost the
      // event — and outside the try, so a blocked gtag can't stop the signup.
      window.gtag?.("event", "newsletter_signup", { page_path: location.pathname });

      if (!window.fetch) return; // Let the native POST happen.
      e.preventDefault();
      if (busy) return;

      const email = (input?.value || "").trim();
      if (!email) return;

      busy = true;
      if (button) button.disabled = true;
      say("Signing you up…");

      try {
        const res = await fetch(form.action, {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify({ email, source: location.pathname }),
        });
        const data = await res.json().catch(() => ({}));
        const ok = res.ok && data.ok !== false;
        say(data.message || (ok ? "You're on the list." : "That didn't work. Please try again."), ok);
        if (ok && input) input.value = "";
      } catch {
        say("Couldn't reach the server. Please try again in a moment.", false);
      } finally {
        busy = false;
        if (button) button.disabled = false;
      }
    });
  }
})();
