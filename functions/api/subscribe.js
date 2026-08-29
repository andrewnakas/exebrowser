// Pages Function: POST /api/subscribe — the newsletter list.
//
// Why this exists rather than a provider's form action: 96.5% of visitors are
// first-timers and the site has no account, no login and no other way to reach
// anyone again. The capture was written weeks ago but NEWSLETTER_ACTION was
// empty, so it rendered nothing at all. This is somewhere for the addresses to
// go that needs no third-party signup.
//
// KV stores the list. It does not send anything — exporting to a real sender is
// a separate, later decision:
//   npx wrangler kv key list --binding=SUBS --remote
//
// Two response shapes on purpose. fetch() from newsletter.js asks for JSON and
// renders the result inline; a native form POST from a browser with JS off gets
// a small HTML page instead, because otherwise it would land on raw JSON.

const MAX_BODY = 2048;

// Deliberately loose. The job here is to reject obvious junk and typos, not to
// adjudicate RFC 5322 — an over-strict pattern silently drops real addresses
// (plus-tags, long TLDs, unicode domains) and you never hear about it.
const EMAIL = /^[^\s@,;]{1,64}@[^\s@,;.]+(\.[^\s@,;.]+)+$/;

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });

const page = (title, body, status = 200) =>
  new Response(
    `<!doctype html><meta charset="utf-8"><title>${title} — ExeBrowser</title>` +
      `<meta name="robots" content="noindex">` +
      `<meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<style>body{font:16px/1.6 system-ui,sans-serif;max-width:34rem;margin:15vh auto;padding:0 1.5rem;` +
      `background:#14161c;color:#edeef2}a{color:#8faaf7}</style>` +
      `<h1 style="font-size:1.4rem">${title}</h1><p>${body}</p>` +
      `<p><a href="/">Back to ExeBrowser</a></p>`,
    { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } }
  );

export async function onRequestPost(context) {
  const { request, env } = context;
  const wantsJson = (request.headers.get("accept") || "").includes("application/json");
  const reply = (ok, message, status) =>
    wantsJson
      ? json({ ok, message }, status)
      : page(ok ? "You're subscribed" : "That didn't work", message, status);

  if (!env.SUBS) {
    // Binding missing (local `wrangler pages dev` without --kv, or a broken
    // deploy). Say so rather than pretending the address was stored.
    return reply(false, "Signups aren't available right now. Please try again later.", 503);
  }

  let email = "";
  let source = "";
  try {
    const type = request.headers.get("content-type") || "";
    if (type.includes("application/json")) {
      const raw = await request.text();
      if (raw.length > MAX_BODY) return reply(false, "That request was too large.", 413);
      const body = JSON.parse(raw);
      email = String(body.email || "");
      source = String(body.source || "");
    } else {
      const form = await request.formData();
      email = String(form.get("email") || "");
      source = String(form.get("source") || "");
    }
  } catch {
    return reply(false, "We couldn't read that. Please try again.", 400);
  }

  email = email.trim().toLowerCase();
  if (email.length > 254 || !EMAIL.test(email)) {
    return reply(false, "That doesn't look like an email address. Check it and try again.", 400);
  }

  // The key is the address, so re-subscribing overwrites instead of adding a
  // duplicate row — dedupe for free, and no read needed before the write.
  const key = "sub:" + email;
  const now = new Date().toISOString();

  try {
    const existing = await env.SUBS.get(key);
    if (existing) {
      return reply(true, "You're already on the list — nothing more to do.", 200);
    }
    await env.SUBS.put(
      key,
      JSON.stringify({
        at: now,
        // Which page it came from, so it's possible to tell later whether the
        // signups come from the games or from the .exe loader.
        source: source.slice(0, 120),
        country: request.headers.get("cf-ipcountry") || "",
      })
    );
  } catch {
    return reply(false, "Something went wrong saving that. Please try again.", 500);
  }

  return reply(true, "You're on the list. One game a week, unsubscribe any time.", 200);
}

// A GET here is someone poking the URL, or a crawler that found it. Neither
// should see an error page or get the endpoint indexed.
export async function onRequestGet() {
  return page("Nothing to see here", "This address only accepts newsletter signups.", 405);
}
