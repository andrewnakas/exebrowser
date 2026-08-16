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

const HERE = dirname(fileURLToPath(import.meta.url));

const ui = JSON.parse(readFileSync(resolve(HERE, "ui.json"), "utf8"));

// Order matters: it's the order the language switcher renders in.
export const LANGS = ["en", "es", "pt-BR", "de"];

// Per-page translations, keyed by slug. Absent file = language has no pages yet.
function loadPages(code) {
  const file = resolve(HERE, `pages.${code}.json`);
  if (!existsSync(file)) return {};
  const raw = JSON.parse(readFileSync(file, "utf8"));
  delete raw._readme;
  return raw;
}

const pagesByLang = Object.fromEntries(LANGS.map((code) => [code, code === "en" ? {} : loadPages(code)]));

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
