// boxedwine-assets — Cloudflare Worker that proxies the 50MB Wine root zip
// from boxedwine.org with CORS + range-request support so the ExeBrowser
// frontend can pull it from a same-origin-like endpoint.
//
// Routes:
//   GET /fs/<file>       -> proxies https://www.boxedwine.org/boxedwine/fs/<file>
//   GET /apps/<file>     -> proxies https://www.boxedwine.org/boxedwine/apps/<file>
//   GET /overlay/<file>  -> proxies https://github.com/andrewnakas/exebrowser-assets/releases/download/<tag>/<file>
//
// Why proxy: boxedwine.org doesn't send CORS headers, so the browser blocks
// the XHR our embedded Boxedwine shell needs. The Wine root zip is also too
// large to commit into Cloudflare Pages (25MB/file limit on free plan).
// GitHub Releases CDN supports range + CORS but we still proxy for uniform
// caching and same-origin appearance.

const ALLOWED_PATHS = [
  /^\/fs\/[A-Za-z0-9._-]+\.zip$/,
  /^\/apps\/[A-Za-z0-9._-]+\.zip$/,
  /^\/overlay\/[A-Za-z0-9._-]+\.zip$/,
];

const OVERLAY_RELEASE_BASE = "https://github.com/andrewnakas/exebrowser-assets/releases/download/runtime-v0.1/";

function corsHeaders(origin, allowed) {
  const list = (allowed || "").split(",").map((s) => s.trim()).filter(Boolean);
  const ok = origin && list.includes(origin);
  return {
    "Access-Control-Allow-Origin": ok ? origin : list[0] || "*",
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "Range, If-None-Match, If-Modified-Since",
    "Access-Control-Expose-Headers": "Content-Length, Content-Range, Accept-Ranges, ETag",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    const cors = corsHeaders(origin, env.ALLOWED_ORIGINS);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", { status: 405, headers: cors });
    }

    if (!ALLOWED_PATHS.some((re) => re.test(url.pathname))) {
      return new Response("Not found", { status: 404, headers: cors });
    }

    let upstreamUrl;
    if (url.pathname.startsWith("/overlay/")) {
      upstreamUrl = OVERLAY_RELEASE_BASE + url.pathname.replace("/overlay/", "");
    } else {
      upstreamUrl = (env.UPSTREAM_BASE || "https://www.boxedwine.org/boxedwine/") + url.pathname.replace(/^\//, "");
    }

    const upstreamHeaders = new Headers();
    const range = request.headers.get("Range");
    if (range) upstreamHeaders.set("Range", range);
    const inm = request.headers.get("If-None-Match");
    if (inm) upstreamHeaders.set("If-None-Match", inm);

    const upstream = await fetch(upstreamUrl, {
      method: request.method,
      headers: upstreamHeaders,
      cf: { cacheTtl: 86400, cacheEverything: true },
    });

    const respHeaders = new Headers(upstream.headers);
    for (const [k, v] of Object.entries(cors)) respHeaders.set(k, v);
    respHeaders.set("Cache-Control", "public, max-age=86400, immutable");
    respHeaders.set("Content-Type", "application/zip");

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: respHeaders,
    });
  },
};
