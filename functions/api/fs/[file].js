// Pages Function: proxy /boxedwine/fs/<file> -> the Cloudflare Worker that
// serves the 50MB Wine root zip with CORS + range support.
//
// Why this exists: browserfs.boxedwine.js hardcodes lazy on-demand zip fetches
// to /boxedwine/fs/<zip> on the current origin. The 50MB Wine root is too big
// for Cloudflare Pages (25MB per-file limit), so it lives behind a Worker.
// This Function bridges the two so the path browserfs expects actually serves
// the right bytes (including 206 Partial Content for range requests).
//
// _redirects rewrites to external hosts are unreliable on Pages; Functions
// always work.

const WORKER_BASE = "https://boxedwine-assets.andrew-nakas.workers.dev/fs/";

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

  // Pass through body + status. COOP/COEP/CORP are applied uniformly by
  // _headers; we DON'T set them here, otherwise Cloudflare merges them
  // and the duplicated COEP header makes Chrome reject the policy.
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
