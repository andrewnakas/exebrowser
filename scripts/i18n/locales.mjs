// Localisation for the generated pages.
//
// English stays exactly where it is (`/run/<slug>/`); every other language gets
// a path prefix (`/es/run/<slug>/`). Path prefix rather than subdomain because
// it needs no DNS work on Cloudflare Pages, keeps all the domain authority in
// one place, and makes hreflang trivial.
//
// ── The rule that matters ─────────────────────────────────────────────────
//
// **A localised page is only generated when a real translation exists for that
// slug.** There is no fallback that dresses English prose in a /es/ URL. That
// would be duplicate content across 80 pages × 3 languages, which is precisely
// the "scaled content abuse" pattern that Search and AdSense penalise — and
// this site has already been rejected once for thin content. A missing
// translation means the page simply doesn't exist in that language, and
// nothing links to it.
//
// UI chrome is the exception: it falls back to English per-key, so a page whose
// prose is translated but whose newest button label isn't shows an English
// button rather than an empty one.

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { SITE, esc } from "../catalogue.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

const ui = JSON.parse(readFileSync(resolve(HERE, "ui.json"), "utf8"));

// Order matters: it's the order the language switcher renders in.
// Chosen from GA country data rather than by market size — Brazil and
// Germany are the most engaged non-English audiences (70.4% and 64.2%),
// Japan is next at 64.3%, and French and Chinese both already show up in
// Bing query data ("doom en ligne", "doom 在线玩").
export const LANGS = ["en", "es", "pt-BR", "de", "ja", "fr", "zh-CN"];

// Per-page translations, keyed by slug. Absent file = language has no pages yet.
//
// Two keys in that file are not pages. `_cards` and `_controls` are shared
// glossaries, and they exist because the alternative was untenable: a related
// card for Freedoom, or a control row reading "Move / turn", is identical on
// every page that shows it. Duplicating those into each slug meant translating
// the same sentence six times and letting the copies drift. Translate once
// here, and every page in the language picks it up.
function loadPages(code) {
  const file = resolve(HERE, `pages.${code}.json`);
  if (!existsSync(file)) return { pages: {}, cards: {}, controls: {} };
  const raw = JSON.parse(readFileSync(file, "utf8"));
  const cards = raw._cards || {};
  const controls = raw._controls || {};
  delete raw._readme;
  delete raw._cards;
  delete raw._controls;
  return { pages: raw, cards, controls };
}

const loaded = Object.fromEntries(
  LANGS.map((code) => [code, code === "en" ? { pages: {}, cards: {}, controls: {} } : loadPages(code)])
);
const pagesByLang = Object.fromEntries(LANGS.map((c) => [c, loaded[c].pages]));

// ── The hand-maintained pages ─────────────────────────────────────────────
//
// Everything above is keyed by catalogue slug, which covers /run/<slug>/ and
// nothing else. The utility surface — the loader, the viewer, the guide, the
// explainer — is hand-written HTML with no slug and no entry in
// app-pages.json, which is why none of it has ever been localised.
//
// `static.<lang>.json` is the same idea keyed by path instead. Same rule: a
// path absent from the file does not exist in that language.
function loadStatic(code) {
  const file = resolve(HERE, `static.${code}.json`);
  if (!existsSync(file)) return {};
  const raw = JSON.parse(readFileSync(file, "utf8"));
  delete raw._readme;
  return raw;
}
const staticByLang = Object.fromEntries(
  LANGS.map((code) => [code, code === "en" ? {} : loadStatic(code)])
);

/** The translation for one hand-maintained path, or null. */
export const staticEntry = (code, path) =>
  code === "en" ? null : (staticByLang[code] || {})[path] || null;

/** Paths translated into a given language. */
export const staticPaths = (code) => Object.keys(staticByLang[code] || {});

/**
 * Languages one hand-maintained path exists in.
 *
 * This is the reason the function exists at all: hreflang for these pages used
 * to fall through to langsWithContent(), which returns every language with ANY
 * translated slug. Six languages have a translated DOOM page, so /guide/ would
 * have advertised /ja/guide/ and five others the moment one of them existed —
 * all 404, and check-consistency rule 7 fails the build on exactly that.
 */
export const staticLocalesFor = (path) =>
  LANGS.filter((c) => c === "en" || Object.prototype.hasOwnProperty.call(staticByLang[c] || {}, path));

/** Is this a path the static localisation pipeline knows about at all? */
export const isLocalisedStaticPath = (path) =>
  LANGS.some((c) => c !== "en" && Object.prototype.hasOwnProperty.call(staticByLang[c] || {}, path));

/**
 * Translated related-card copy, keyed by the card's English href.
 * Returns null when this language hasn't translated that card, which the
 * renderer treats as "drop the card" rather than "show it in English" — the
 * same rule the whole pipeline uses for prose.
 */
export const cardCopy = (code, href) => (loaded[code]?.cards || {})[href] || null;

/**
 * Translated control-table cell, keyed by the English string from the
 * catalogue. Falls back to the English text, which is the right call here:
 * "Ctrl" and "F10" are the same in every language, and an untranslated verb in
 * a two-word table cell is a much smaller problem than a missing row.
 */
export const controlText = (code, text) => (loaded[code]?.controls || {})[text] ?? text;

/** URL prefix for a language: "" for English, "/es" etc. otherwise. */
export const prefixOf = (code) => (code === "en" ? "" : `/${code}`);

/** Locale object handed to the render functions. */
export function locale(code) {
  const strings = ui[code] || {};
  const fallback = ui.en;
  return {
    code,
    prefix: prefixOf(code),
    htmlLang: strings["html.lang"] || code,
    // Targeting code for hreflang, which is not always the document's lang.
    hrefLang: strings["hreflang.code"] || strings["html.lang"] || code,
    name: strings["lang.name"] || code,
    isDefault: code === "en",
    /** Translated UI string, falling back to English rather than to nothing. */
    t: (key) => (strings[key] !== undefined && strings[key] !== "" ? strings[key] : fallback[key] ?? ""),
    /** Prefix a site-absolute path for this language. */
    path: (p) => (code === "en" ? p : `/${code}${p}`),
  };
}

export const LOCALES = Object.fromEntries(LANGS.map((c) => [c, locale(c)]));

/** Does this language have a real translation for this slug? */
export function hasTranslation(code, slug) {
  if (code === "en") return true;
  return Object.prototype.hasOwnProperty.call(pagesByLang[code] || {}, slug);
}

/** Every language this slug actually exists in — the basis for hreflang. */
export const languagesFor = (slug) => LANGS.filter((c) => hasTranslation(c, slug));

/**
 * The English entry with its translated fields laid over the top. Only the
 * fields present in the translation are replaced, so a partial translation
 * still produces a coherent page instead of dropping sections on the floor.
 */
export function translatedEntry(code, entry) {
  if (code === "en") return entry;
  const over = (pagesByLang[code] || {})[entry.slug];
  if (!over) return null;
  return { ...entry, ...over };
}

/** Slugs that have been translated into a given language. */
export const translatedSlugs = (code) => Object.keys(pagesByLang[code] || {});

/**
 * Languages with at least one real page. Used for site-level URLs (the home
 * page, the /run/ hub) that have no slug of their own. Filtering matters: the
 * switcher and hreflang once listed pt-BR and de before either had a single
 * page, advertising URLs that 404.
 */
export const langsWithContent = () => LANGS.filter((c) => c === "en" || translatedSlugs(c).length);

/**
 * hreflang alternates for one path, plus x-default pointing at English.
 *
 * Lives here rather than in gen-app-pages.mjs because the hand-maintained
 * pages need byte-identical markup and are stamped by a different script.
 * Reciprocity is the whole point — Google discards a one-way alternate — so
 * check-consistency verifies every target links back.
 *
 * @param pathAfterPrefix e.g. "/run/doom/" or "/" — the path WITHOUT a /es prefix
 * @param slug            a catalogue slug to scope languages to, or null for
 *                        site-level pages (uses langsWithContent instead)
 */
/**
 * Which languages a given URL exists in — the single decision behind both
 * hreflang and the switcher, so the two can never disagree.
 *
 * Three kinds of page, three answers:
 *   a catalogue page  → the languages that slug is translated into
 *   a hand-maintained page (scope "static") → the languages that PATH exists in,
 *                              which is just English until one is written
 *   everything else (the home page, the /run/ hub) → every language with content
 *
 * Deciding it here rather than at each call site is deliberate: the two callers
 * below are stamped by different scripts onto different page types, and the one
 * bug this area keeps producing is advertising a URL that was never written.
 */
export function langsForPath(pathAfterPrefix, slug, scope) {
  if (slug) return languagesFor(slug);
  if (scope === "static") return staticLocalesFor(pathAfterPrefix);
  return langsWithContent();
}

export function hreflangHtml(pathAfterPrefix, slug, scope) {
  const langs = langsForPath(pathAfterPrefix, slug, scope);
  if (langs.length < 2) return "";
  const rows = langs.map(
    (c) => `<link rel="alternate" hreflang="${LOCALES[c].hrefLang}" href="${SITE}${prefixOf(c)}${pathAfterPrefix}" />`
  );
  rows.push(`<link rel="alternate" hreflang="x-default" href="${SITE}${pathAfterPrefix}" />`);
  return "\n" + rows.join("\n");
}

/**
 * Rendered in the header so a visitor who landed on the wrong language can
 * leave. Only lists languages this page actually exists in.
 */
export function langSwitcherHtml(L, pathAfterPrefix, slug, scope) {
  const langs = langsForPath(pathAfterPrefix, slug, scope);
  if (langs.length < 2) return "";
  const links = langs.map((c) =>
    c === L.code
      ? `<span class="lang-current" aria-current="true">${esc(LOCALES[c].name)}</span>`
      : `<a href="${prefixOf(c)}${pathAfterPrefix}" hreflang="${LOCALES[c].hrefLang}">${esc(LOCALES[c].name)}</a>`
  );
  return `\n  <nav class="lang-switcher" aria-label="${esc(L.t("nav.language"))}">${links.join(" · ")}</nav>`;
}
