// UI language follows the cartridge region (USA/Europe: en, Canada/France: fr, Germany: de).
// Catalogs live in ./locales as plain JSON so translators can edit them without touching code.

import de from './locales/de.json';
import en from './locales/en.json';
import fr from './locales/fr.json';
import type { Locale } from './shared/index.js';

// Errors are looked up by server error code, so any string key is allowed there.
export type Strings = Omit<typeof en, 'errors'> & { errors: Record<string, string> };

export const catalogs: Record<Locale, Strings> = { en, fr, de };

/** Current strings. Mutated in place by setLocale so importers always see the active locale. */
export const t: Strings = structuredClone(en);

export function setLocale(locale: Locale) {
  Object.assign(t, catalogs[locale]);
  document.documentElement.lang = locale;
}

export function browserLocale(): Locale {
  const l = navigator.language.slice(0, 2);
  return l === 'fr' || l === 'de' ? l : 'en';
}
