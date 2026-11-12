// The speech service's languages for people: each in its own name and in the page's language
// (the browser's Intl.DisplayNames: no list of names to keep), the last used first.
import { SPEECH_LANGS } from '@translate/shared';

const RECENT_KEY = 'tr-recent-langs';

const names = (inLang: string) => {
  try {
    return new Intl.DisplayNames([inLang], { type: 'language' });
  } catch {
    return null;
  }
};
const page = names(navigator.language || 'en');

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

/** Every language, the last used first, then by the page's name; `query` filters (any of its names). */
export function langList(query: string): string[] {
  const q = query.trim().toLocaleLowerCase();
  const recent = recentLangs();
  const all = [...SPEECH_LANGS].sort((a, b) => langName(a).here.localeCompare(langName(b).here));
  const ordered = [...recent, ...all.filter((c) => !recent.includes(c))];
  if (!q) return ordered;
  return ordered.filter((c) => {
    const n = langName(c);
    return (
      n.own.toLocaleLowerCase().includes(q) || n.here.toLocaleLowerCase().includes(q) || c === q
    );
  });
}
