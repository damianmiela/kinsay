import { describe, expect, it } from 'vitest';
import { mergeText, PAGE_LINES } from './logic';

describe('mergeText', () => {
  it('adds new lines by number and replaces the line coming in', () => {
    const a = mergeText(undefined, { lines: ['one', 'two'], first: 0, live: 'thr' });
    const b = mergeText(a, { lines: ['two', 'three'], first: 1, live: '' });
    expect(b).toEqual({ lines: ['one', 'two', 'three'], first: 0, live: '' });
  });
  it('a gap or a text started again replaces what the page had', () => {
    const a = { lines: ['one', 'two'], first: 0, live: '' };
    expect(mergeText(a, { lines: ['ten'], first: 9, live: '' }).first).toBe(9);
    expect(mergeText(a, { lines: [], first: 0, live: 'new' })).toEqual({
      lines: [],
      first: 0,
      live: 'new',
    });
  });
  it('keeps at most PAGE_LINES lines, the oldest go', () => {
    const many = Array.from({ length: PAGE_LINES }, (_, i) => `l${i}`);
    const m = mergeText(
      { lines: many, first: 0, live: '' },
      { lines: [`l${PAGE_LINES}`], first: PAGE_LINES, live: '' },
    );
    expect(m.lines).toHaveLength(PAGE_LINES);
    expect(m.first).toBe(1);
    expect(m.lines.at(-1)).toBe(`l${PAGE_LINES}`);
  });
});
