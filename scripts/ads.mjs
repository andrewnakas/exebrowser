// Which pages carry the Mediavine ad script, decided in one place.
//
// Used by scripts/inject-ads.mjs (adds or removes the tag on every built page)
// and scripts/check-consistency.mjs (fails the build if any page disagrees).
//
// The rule:
//   - Content pages carry ads: home, /run/ guides, blog, guides, utilities.
//   - Never where a game or app actually runs, or on someone else's site:
//     /apps/ (the game frames: ads would compete with the emulators for memory,
//     and Warzone 2100's isolated page would block them anyway), the
//     /embed/<slug>/ wrappers (those run on other people's pages), the runtime
//     directories, 404, and noindex utility pages.
//   - A /run/<slug>/ page whose game is HOSTED here carries ads only when that
//     title's entry in app-pages.json says `adsOk: true`. That flag is set for
//     our own games and open-source titles (GPL/BSD/MIT/LGPL). Shareware and
//     freeware licences permit copying "at no charge", and ads beside the game
//     could be read as commercial use, so those pages stay ad-free. A new hosted
//     title is ad-free until someone checks its licence and sets the flag.
//   - Pages for titles we don't host (bring-your-own guides) carry ads.
import { readFileSync } from "node:fs";

// Ads are switched off site-wide. Google's MCM review rejected exebrowser.com
// twice for "low value content" (Mediavine, 2026-10-21), so Mediavine will
// never serve here and its tag only threw errors. Set back to true with the
// next network's tag in AD_TAG/AD_TAG_RE (Media.net application pending).
export const ADS_ON = false;
import { resolve } from "node:path";

export const AD_TAG =
  '<script type="text/javascript" async="async" data-noptimize="1" data-cfasync="false" src="//scripts.mediavine.com/tags/c56060b8-5def-4889-a40e-9e36b06bfd48.js"></script>';

// Matches the tag in any page, so stale or edited copies are found and removed.
export const AD_TAG_RE = /[ \t]*<script[^>]*src="(?:https?:)?\/\/scripts\.mediavine\.com\/tags\/[^"]*"[^>]*><\/script>\n?/g;

const NO_AD_DIRS = ["apps/", "64/", "boxedwine/", "dosbox/", "dosbox-snap/", "data/"];
const LOCALES = ["es", "pt-BR", "de", "ja", "fr", "zh-CN"];

export function loadPages(root = process.cwd()) {
  const pages = JSON.parse(readFileSync(resolve(root, "scripts", "app-pages.json"), "utf8"));
  return new Map(pages.map((p) => [p.slug, p]));
}

// `rel` is the page's path under public/, e.g. "run/doom/index.html".
// Returns null when the page should carry ads, or the reason it must not.
export function noAdReason(rel, html, bySlug) {
  if (!ADS_ON) return "ads switched off site-wide";
  if (NO_AD_DIRS.some((d) => rel.startsWith(d))) return "runtime or game frame";
  if (/^embed\/[^/]+\/index\.html$/.test(rel)) return "embed wrapper (runs on other sites)";
  if (rel === "404.html") return "404 page";
  if (/<meta name="robots" content="noindex/i.test(html)) return "noindex page";
  let path = rel;
  const first = path.split("/")[0];
  if (LOCALES.includes(first)) path = path.slice(first.length + 1);
  const m = /^run\/([^/]+)\/index\.html$/.exec(path);
  if (m) {
    const p = bySlug.get(m[1]);
    if (p && (p.appUrl || p.iframeUrl) && !p.adsOk) return `hosted title without adsOk (${m[1]})`;
  }
  return null;
}

// Desktop ad rail. Pages that carry ads get their <main> wrapped with an empty
// right-hand column for Mediavine's sidebar units (the sticky sidebar is the
// best-paying desktop slot and the one that stays beside the game while people
// play). Below 1250px the wrapper is display:contents and the rail is hidden,
// so the phone and tablet layout is unchanged. Mediavine's dashboard sidebar
// selector must point at #mv-sidebar. Pages without ads get the wrapper removed.
export const RAIL_OPEN = '<div class="ad-layout">';
export const RAIL_CLOSE =
  '<aside class="ad-rail" aria-label="Advertisement"><div id="mv-sidebar"></div></aside></div>';

export function addRail(html) {
  if (html.includes(RAIL_OPEN)) return html;
  if ((html.match(/<main[\s>]/g) || []).length !== 1 || (html.match(/<\/main>/g) || []).length !== 1) return html;
  return html.replace(/<main([\s>])/, `${RAIL_OPEN}<main$1`).replace("</main>", `</main>${RAIL_CLOSE}`);
}

export function stripRail(html) {
  return html.split(RAIL_OPEN + "<main").join("<main").split("</main>" + RAIL_CLOSE).join("</main>");
}
