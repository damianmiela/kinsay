import { describe, expect, it } from 'vitest';
import { nextLine, pickVoice, voiceHelp } from './readAloud';

const voice = (lang: string, extra: Partial<SpeechSynthesisVoice> = {}) => ({
  lang,
  name: lang,
  default: false,
  localService: true,
  voiceURI: lang,
  ...extra,
});

describe('read aloud', () => {
  it('the newest finished line next: one behind is said, several behind skip to the newest', () => {
    const text = { lines: ['a', 'b', 'c'], first: 10, live: 'd' };
    expect(nextLine(11, text)).toBe(12);
    expect(nextLine(9, text)).toBe(12);
    expect(nextLine(12, text)).toBeNull();
  });
  it("a language's voice, the device's default first", () => {
    const vs = [voice('en-US'), voice('pl-PL'), voice('pl_PL', { default: true, name: 'b' })];
    expect(pickVoice(vs, 'pl')?.name).toBe('b');
    expect(pickVoice(vs, 'ca')).toBeNull();
  });
  it('where a device adds a voice', () => {
    expect(voiceHelp('Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X)')).toBe('ios');
    expect(voiceHelp('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', true)).toBe('ios');
    expect(voiceHelp('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')).toBe('mac');
    expect(voiceHelp('Mozilla/5.0 (Linux; Android 14; Pixel 8)')).toBe('android');
    expect(voiceHelp('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('windows');
  });
});
