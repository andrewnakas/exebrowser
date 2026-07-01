// Pages Function middleware for the Open Cadet play page.
//
// The site-wide _headers catch-all sets COOP: same-origin. This page embeds the
// game bundle in an <iframe>; COOP: same-origin on the PARENT puts it in its own
// browsing-context group and blocks the cross-origin-isolated iframe embed from
// loading (blank frame). Open Cadet needs no cross-origin isolation, so we force
// a single COOP: unsafe-none here (Functions replace headers; _headers only
// merges, which left a conflicting double header).

export async function onRequest(context) {
  const response = await context.next();
  const headers = new Headers(response.headers);
  headers.set("Cross-Origin-Opener-Policy", "unsafe-none");
  headers.delete("Cross-Origin-Embedder-Policy");
  // Drop X-Frame-Options so this page can host the same-origin game iframe
  // without the frame-embedding block.
  headers.delete("X-Frame-Options");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
