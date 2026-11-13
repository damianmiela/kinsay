import { describe, expect, it } from 'vitest';
import { euros } from '@translate/shared';
import { TEXTS } from './texts';
import { pickUi } from './ui';

describe('the language of the pages', () => {
  it("the device's choice, else the browser's first of the five, else English", () => {
    expect(pickUi('de', ['pl-PL'])).toBe('de');
    expect(pickUi(null, ['fr-FR', 'pl-PL', 'en'])).toBe('pl');
    expect(pickUi(null, ['ca-ES'])).toBe('ca');
    expect(pickUi('xx', ['fr'])).toBe('en');
    expect(pickUi(null, [])).toBe('en');
  });

  it('every language has every text, none empty, each name or number in its place', () => {
    const walk = (v: unknown, path: string, out: [string, string][]) => {
      if (typeof v === 'string') out.push([path, v]);
      else if (typeof v === 'function') {
        // (the low balance takes an amount: it shows as euros)
        const money = path.endsWith('lowBody') || path.endsWith('lowLeft');
        const s = (v as (...a: unknown[]) => string)(money ? 2_500_000 : 'ARG1', 'ARG2');
        out.push([path, s]);
        expect(s, path).toContain(money ? euros(2_500_000) : 'ARG1');
      } else if (v && typeof v === 'object') {
        for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`, out);
      }
    };
    const shape = (lang: keyof typeof TEXTS) => {
      const out: [string, string][] = [];
      walk(TEXTS[lang], lang, out);
      return out;
    };
    const en = shape('en').map(([p]) => p.slice(2));
    for (const lang of ['pl', 'es', 'ca', 'de'] as const) {
      const all = shape(lang);
      expect(all.map(([p]) => p.slice(2))).toEqual(en);
      for (const [p, s] of all) expect(s.trim(), p).not.toBe('');
    }
  });
});
