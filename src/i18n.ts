// Strings.
//
// Every user-visible string in the game goes through `t()` from the first commit — design
// §11, and the rule exists because Math Quest is Spanish-only and the site is English, and
// that split is a retrofit nobody wants to do twice.
//
// The language comes from the SITE's own key, read-only. `kidtopia:lang` belongs to
// kidtopiaplay.com; a kid who set the site to Spanish gets a Spanish game, and this game
// never writes to it.

import { EN } from './data/strings.en.js';
import { ES } from './data/strings.es.js';

export type StringKey = keyof typeof EN;
export type Lang = 'en' | 'es';

export const SITE_LANG_KEY = 'kidtopia:lang';

const TABLES: Record<Lang, Partial<Record<StringKey, string>>> = { en: EN, es: ES };

let current: Lang = 'en';
let blank = false;

/**
 * Stored site choice, then the browser, then English — the same order the rest of the site
 * uses, so a page and the game inside it never disagree about the language.
 */
export function detectLang(): Lang {
  try {
    const stored = localStorage.getItem(SITE_LANG_KEY);
    if (stored && stored in TABLES) return stored as Lang;
  } catch {
    // Storage can throw in a sandboxed frame; the browser's own preference still works.
  }
  const langs = typeof navigator !== 'undefined' ? navigator.languages ?? [navigator.language] : [];
  for (const l of langs) {
    const base = (l ?? '').split('-')[0];
    if (base && base in TABLES) return base as Lang;
  }
  return 'en';
}

export function setLang(lang: Lang): void {
  current = lang in TABLES ? lang : 'en';
}

export function getLang(): Lang {
  return current;
}

/**
 * Blank every string. `?blank=1` turns this on, and the matchday path has to remain fully
 * playable with it (design §11) — which is the mechanism that proves the wordless claim
 * rather than merely asserting it.
 */
export function setBlankStrings(on: boolean): void {
  blank = on;
}

/**
 * Look up a string. A missing key returns the key itself, on purpose: it is ugly, it shows
 * up immediately, and it is far better than silently rendering nothing.
 */
export function t(key: StringKey, params?: Record<string, string | number>): string {
  if (blank) return '';
  const table = TABLES[current];
  const value = table[key] ?? EN[key] ?? key;
  if (!params) return value;
  return value.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? `{${name}}`));
}

/**
 * A position as an ordinal, in the current language.
 *
 * This cannot be done with a placeholder in the string table — "{n}th" gives "1th", "2th"
 * and "21th" in English, and Spanish does not form ordinals that way at all. So the number
 * arrives already formatted, and each language says how. (The game ships en and es; the
 * site's de and pt overlays translate the catalog copy, not this.)
 */
export function ordinal(n: number): string {
  if (blank) return '';
  switch (current) {
    case 'es':
      return `${n}.º`;
    default: {
      // English: 1st, 2nd, 3rd, 4th — with the 11th/12th/13th exceptions.
      const rem100 = n % 100;
      if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
      const rem10 = n % 10;
      return `${n}${rem10 === 1 ? 'st' : rem10 === 2 ? 'nd' : rem10 === 3 ? 'rd' : 'th'}`;
    }
  }
}

/** Every key, for the parity test. */
export function keysOf(lang: Lang): string[] {
  return Object.keys(TABLES[lang]).sort();
}
