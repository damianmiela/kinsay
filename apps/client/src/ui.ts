// The language of the pages themselves (not the captions' translation): the one chosen on this
// device (the gear's "Page language", the sign-in page's foot), else the browser's first of the
// five, else English. Chosen once at load: a change reloads the page.
export const UI_LANGS = ['en', 'pl', 'es', 'ca', 'de'] as const;
export type UiLang = (typeof UI_LANGS)[number];
/** Each in its own name, for the switch. */
export const UI_NAMES: Record<UiLang, string> = {
  en: 'English',
  pl: 'Polski',
  es: 'Español',
  ca: 'Català',
  de: 'Deutsch',
};
const KEY = 'tr-ui-lang';
const isUi = (v: unknown): v is UiLang => UI_LANGS.includes(v as UiLang);

/** The page's language from a stored choice and the browser's list (tested). */
export function pickUi(stored: string | null, browser: readonly string[]): UiLang {
  if (isUi(stored)) return stored;
  for (const l of browser) {
    const base = l.toLowerCase().split('-')[0];
    if (isUi(base)) return base;
  }
  return 'en';
}

const stored = (() => {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
})();
export const ui: UiLang = pickUi(
  stored,
  typeof navigator === 'undefined' ? [] : (navigator.languages ?? [navigator.language]),
);

export function setUi(lang: UiLang) {
  try {
    localStorage.setItem(KEY, lang);
  } catch {
    // (not kept: this page only)
  }
  window.location.reload();
}
