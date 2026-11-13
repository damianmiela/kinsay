import { describe, expect, it } from 'vitest';
import { deviceKind, EUR, euros, GRANT_STEPS, isSpeechLang, SPEECH_LANGS } from './index';

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

describe('deviceKind', () => {
  it('a phone, a tablet, a computer', () => {
    expect(deviceKind('Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) Mobile/15E148')).toBe(
      'phone',
    );
    expect(
      deviceKind('Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/131.0 Mobile Safari/537.36'),
    ).toBe('phone');
    expect(deviceKind('Mozilla/5.0 (Linux; Android 14; SM-X710) Chrome/131.0 Safari/537.36')).toBe(
      'tablet',
    );
    expect(deviceKind('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)')).toBe('tablet');
    expect(deviceKind('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0 Safari/537.36')).toBe(
      'computer',
    );
    expect(deviceKind('')).toBe('computer');
  });
});
