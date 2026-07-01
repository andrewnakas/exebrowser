// Pages Function middleware for the Open Cadet WASM bundle.
//
// Why this exists: the site-wide _headers catch-all sets
//   Cross-Origin-Opener-Policy: same-origin
// (needed by the Boxedwine apps for SharedArrayBuffer). Open Cadet uses NO
// SharedArrayBuffer / threads and is loaded in an <iframe> from
// /run/space-cadet-open/. COOP:same-origin severs the parent<->iframe browsing
// context group, so Chrome silently blocks the iframe navigation (blank frame).
//
// _headers rules only MERGE (append) — they can't remove the catch-all's COOP,
// so we end up with two conflicting COOP headers and the browser keeps the
// stricter same-origin. A Function runs AFTER _headers and can REPLACE headers
// authoritatively. Here we force a single COOP: unsafe-none (and drop COEP,
// which this game doesn't need) so the embed loads.

export async function onRequest(context) {
  const response = await context.next();
  const headers = new Headers(response.headers);
  headers.set("Cross-Origin-Opener-Policy", "unsafe-none");
  headers.delete("Cross-Origin-Embedder-Policy");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
