import { describe, expect, it, vi } from 'vitest';
import { langList, langName, rememberLang, usedBefore } from './langs';
import { duration, stopText } from './texts';

describe('language names', () => {
  it('Tagalog is Tagalog (browsers say Filipino), and both find it', () => {
    expect(langName('tl').own).toBe('Tagalog');
    expect(langList('tag')).toContain('tl');
    expect(langList('filip')).toContain('tl');
  });
  it('every language once in the full list; a search by code or name', () => {
    const all = langList('');
    expect(all).toHaveLength(60);
    expect(new Set(all).size).toBe(60);
    expect(langList('pl')).toContain('pl');
    expect(langList('polish')).toEqual(['pl']);
    expect(langList('zzzz')).toEqual([]);
  });
  it('a search matches the start of a word of either name; the whole list A to Z', () => {
    expect(langList('hu')).toEqual(['hu']);
    expect(langList('ungar')).toEqual([]);
    const all = langList('').map((c) => langName(c).here);
    expect(all).toEqual([...all].sort((a, b) => a.localeCompare(b, 'en')));
  });
  it('used before: at most two, never one of the five', () => {
    const kept = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => kept.get(k) ?? null,
      setItem: (k: string, v: string) => kept.set(k, v),
    });
    for (const c of ['tl', 'pl', 'fr', 'hu', 'it']) rememberLang(c);
    expect(usedBefore()).toEqual(['it', 'hu']);
    vi.unstubAllGlobals();
  });
});

describe('texts', () => {
  it('a session’s length', () => {
    expect(duration(40)).toBe('40 s');
    expect(duration(25 * 60)).toBe('25 min');
    expect(duration(65 * 60)).toBe('1 h 05 min');
  });
  it('a stop the host ended says nothing; the others say why', () => {
    expect(stopText('ended')).toBeNull();
    expect(stopText('credits')![0]).toBe('Out of credits');
  });
});
