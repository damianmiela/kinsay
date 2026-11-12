// Pure helpers of the pages (tested).
import type { CaptionText, CaptionsUpdate } from '@translate/shared';

/** Lines a page keeps (the server keeps 200 per text). */
export const PAGE_LINES = 400;

/**
 * Adds an update's lines to what the page has, by line number. Lines that don't go on from what
 * it has (a gap, a text started again: fewer lines than before) replace it.
 */
export function mergeText(prev: CaptionText | undefined, next: CaptionText): CaptionText {
  if (!prev) return next;
  const prevEnd = prev.first + prev.lines.length;
  const nextEnd = next.first + next.lines.length;
  if (next.first < prev.first || next.first > prevEnd || nextEnd < prevEnd) return next;
  let lines = [...prev.lines.slice(0, next.first - prev.first), ...next.lines];
  let first = prev.first;
  if (lines.length > PAGE_LINES) {
    first += lines.length - PAGE_LINES;
    lines = lines.slice(-PAGE_LINES);
  }
  return { lines, first, live: next.live };
}

export function mergeUpdate(prev: CaptionsUpdate, next: CaptionsUpdate): CaptionsUpdate {
  const texts = { ...prev.texts };
  for (const [k, v] of Object.entries(next.texts)) if (v) texts[k] = mergeText(prev.texts[k], v);
  return {
    texts,
    heardLangs: { ...prev.heardLangs, ...next.heardLangs },
    ...(next.speaking ? { speaking: next.speaking } : {}),
  };
}
