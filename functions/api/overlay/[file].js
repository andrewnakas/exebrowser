// Pages Function: proxy /api/overlay/<file> -> the Cloudflare Worker that
// fetches optional Wine overlay zips (e.g., Gecko-bundled root) from a public
// GitHub Releases asset.
//
// Why this exists: GitHub Releases supports CORS + range requests, but the
// asset URL 302-redirects to a signed Azure blob with a short TTL. Going
// through our Worker keeps the URL stable, lets Cloudflare cache it, and
// matches the same-origin model used for /api/fs/.

const WORKER_BASE = "https://boxedwine-assets.andrew-nakas.workers.dev/overlay/";

export async function onRequest(context) {
  const { request, params } = context;
  const url = WORKER_BASE + params.file;

  const headers = new Headers();
  const range = request.headers.get("Range");
  if (range) headers.set("Range", range);
  const ifNoneMatch = request.headers.get("If-None-Match");
  if (ifNoneMatch) headers.set("If-None-Match", ifNoneMatch);
  const ifModifiedSince = request.headers.get("If-Modified-Since");
  if (ifModifiedSince) headers.set("If-Modified-Since", ifModifiedSince);

  const upstream = await fetch(url, {
    method: request.method,
    headers,
    cf: { cacheTtl: 86400, cacheEverything: true },
  });

  // _headers applies COOP/COEP/CORP uniformly. Strip upstream copies to
  // prevent Cloudflare from merging them and breaking the policy.
  const out = new Headers(upstream.headers);
  out.delete("Cross-Origin-Resource-Policy");
  out.delete("Cross-Origin-Embedder-Policy");
  out.delete("Cross-Origin-Opener-Policy");
  out.delete("Access-Control-Allow-Origin");
  out.delete("Access-Control-Allow-Methods");
  out.delete("Access-Control-Allow-Headers");
  out.delete("Access-Control-Expose-Headers");
  out.delete("Access-Control-Max-Age");
  out.delete("Vary");

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: out,
  });
}
