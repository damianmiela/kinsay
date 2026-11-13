import { describe, expect, it } from 'vitest';
import { lowestPrice, mergeText, PAGE_LINES, windowDays } from './logic';

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

describe('use and cost (the admin)', () => {
  it('every day of the window, the newest first', () => {
    expect(windowDays('2026-11-11', 3)).toEqual(['2026-11-13', '2026-11-12', '2026-11-11']);
    expect(windowDays('2026-02-27', 3)).toEqual(['2026-03-01', '2026-02-28', '2026-02-27']);
  });
  it('the lowest price: Soniox per hour × the dollar rate × the margin, up to the cent', () => {
    // $0.12 × 0.93 × 1.3 = €0.14508 → €0.15
    expect(lowestPrice(0.12, 0.93, 30)).toBe(150_000);
    expect(lowestPrice(0.12, 1, 0)).toBe(120_000);
    expect(lowestPrice(null, 0.93, 30)).toBeNull();
    expect(lowestPrice(0.12, Number.NaN, 30)).toBeNull();
    expect(lowestPrice(0.12, 0.93, -5)).toBeNull();
  });
});
