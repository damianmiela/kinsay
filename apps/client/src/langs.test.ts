import { describe, expect, it } from 'vitest';
import { langList, langName } from './langs';
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
