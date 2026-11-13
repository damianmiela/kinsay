// Pure helpers of the pages (tested).
import { EUR, type CaptionText, type CaptionsUpdate } from '@translate/shared';

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

// ---------- the admin's "Use and cost" (mockups batch 5) ----------
/** The days of the window, newest first (every day, used or not). */
export function windowDays(from: string, days: number): string[] {
  const start = Date.parse(`${from}T00:00:00Z`);
  return Array.from({ length: days }, (_, i) =>
    new Date(start + (days - 1 - i) * 86_400_000).toISOString().slice(0, 10),
  );
}

/**
 * The lowest price per stream-hour (micro-euros) that covers Soniox's cost per hour of audio with
 * the margin: cost × dollar rate × (1 + margin); null without a cost.
 */
export function lowestPrice(usdPerHour: number | null, rate: number, marginPct: number) {
  if (!usdPerHour || !(rate > 0) || !(marginPct >= 0)) return null;
  return Math.ceil(usdPerHour * rate * (1 + marginPct / 100) * 100) * (EUR / 100);
}
