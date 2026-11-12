import { describe, expect, it } from 'vitest';
import { EUR, euros, GRANT_STEPS, isSpeechLang, SPEECH_LANGS } from './index';

describe('euros', () => {
  it('shows cents; a little above zero never shows as €0.00', () => {
    expect(euros(EUR)).toBe('€1.00');
    expect(euros(843_000)).toBe('€0.84');
    expect(euros(1)).toBe('€0.01');
    expect(euros(0)).toBe('€0.00');
    expect(euros(12_345_678)).toBe('€12.34');
  });
  it('the one-tap amounts are €1, €2, €5, €10', () => {
    expect(GRANT_STEPS.map(euros)).toEqual(['€1.00', '€2.00', '€5.00', '€10.00']);
  });
});

describe('the speech service languages', () => {
  it('sixty, each once, Tagalog among them, no made-up codes', () => {
    expect(SPEECH_LANGS).toHaveLength(60);
    expect(new Set(SPEECH_LANGS).size).toBe(60);
    expect(isSpeechLang('tl')).toBe(true);
    expect(isSpeechLang('ceb')).toBe(false); // (Cebuano: not offered by the service)
    expect(isSpeechLang('heard')).toBe(false);
  });
});
