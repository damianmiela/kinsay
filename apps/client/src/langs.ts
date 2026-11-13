// The speech service's languages for people: each in its own name and in the page's language
// (the browser's Intl.DisplayNames: no list of names to keep).
import { SPEECH_LANGS } from '@translate/shared';
import { t } from './texts';
import { ui } from './ui';

const RECENT_KEY = 'tr-recent-langs';

const names = (inLang: string) => {
  try {
    return new Intl.DisplayNames([inLang], { type: 'language' });
  } catch {
    return null;
  }
};
// (other languages' names in the page's own language)
const page = names(ui);

/** Where the browser's name isn't the speech service's: Tagalog is "Filipino" to browsers. */
const OWN: Record<string, string> = { tl: 'Tagalog' };

/** "Polski" (its own name, capitalised) and "Polish" (in the page's language). */
export function langName(code: string): { own: string; here: string } {
  const own = OWN[code] ?? names(code)?.of(code) ?? code;
  const here = page?.of(code) ?? code;
  const cap = (s: string) => s.charAt(0).toLocaleUpperCase(code) + s.slice(1);
  return { own: cap(own), here: cap(here) };
}

export function recentLangs(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as unknown;
    return Array.isArray(v) ? v.filter((c): c is string => SPEECH_LANGS.includes(c as never)) : [];
  } catch {
    return [];
  }
}
export function rememberLang(code: string) {
  try {
    const next = [code, ...recentLangs().filter((c) => c !== code)].slice(0, 6);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // not remembered: fine
  }
}

/** The list's own five, first and in this order (mockups batch 3). */
export const MAIN_LANGS = ['pl', 'en', 'de', 'es', 'ca'] as const;

/** At most two languages used before that aren't among the five. */
export const usedBefore = (): string[] =>
  recentLangs()
    .filter((c) => !MAIN_LANGS.includes(c as never))
    .slice(0, 2);

/**
 * Every language A to Z by the page's name for it; `query` keeps those where a word of either name
 * starts with it ("hu": Magyar, Hungarian), or the code itself.
 */
export function langList(query: string): string[] {
  const q = query.trim().toLocaleLowerCase();
  const all = [...SPEECH_LANGS].sort((a, b) =>
    langName(a).here.localeCompare(langName(b).here, ui),
  );
  if (!q) return all;
  const starts = (name: string) =>
    name
      .toLocaleLowerCase()
      .split(/[\s()-]+/)
      .some((w) => w.startsWith(q)) || name.toLocaleLowerCase().startsWith(q);
  return all.filter((c) => {
    const n = langName(c);
    return starts(n.own) || starts(n.here) || c === q;
  });
}

/** A language's name on the control bar: its own name, or "Original" without a translation. */
export const barName = (lang: string | null) => (lang ? langName(lang).own : t.original);
