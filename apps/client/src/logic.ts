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

/** A chart's bar: its value (and a second one, side by side), with its numbers for the tooltip. */
export interface Bar {
  key: string;
  a: number;
  b?: number;
  tip: string;
}

/** A year's daily peaks as months: each month's highest, oldest first. */
export function byMonth(peaks: readonly { start: string; max: number }[]) {
  const m = new Map<string, number>();
  for (const p of peaks) {
    const k = p.start.slice(0, 7);
    m.set(k, Math.max(m.get(k) ?? 0, p.max));
  }
  return [...m.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([start, max]) => ({ start, max }));
}

/**
 * What was charged (euros) next to Soniox's cost (dollars) per day, or per month for a year:
 * Soniox's days decide the bars (it gives every day of the window), oldest first.
 */
export function chartBars(
  costs: readonly { day: string; costUsd: number }[],
  charged: readonly { day: string; charged: number }[],
  months: boolean,
): Bar[] {
  const k = (day: string) => (months ? day.slice(0, 7) : day);
  const ours = new Map<string, number>();
  for (const c of charged) ours.set(k(c.day), (ours.get(k(c.day)) ?? 0) + c.charged / EUR);
  const theirs = new Map<string, number>();
  for (const c of costs) theirs.set(k(c.day), (theirs.get(k(c.day)) ?? 0) + c.costUsd);
  return [...theirs.keys()].sort().map((key) => {
    const a = ours.get(key) ?? 0;
    const b = theirs.get(key) ?? 0;
    return { key, a, b, tip: `${key}: charged €${a.toFixed(2)}, Soniox $${b.toFixed(2)}` };
  });
}
