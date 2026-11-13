// Soniox's own numbers for the admin's "Use and cost" (mockups batch 5): its usage API, asked by the
// server with its key (never by a page). GET /v1/usage/summary gives cost and activity per whole
// UTC day for the key's project (checked 2026-11-13, docs.soniox.com: `total.days` with arrays
// aligned to it; costs as decimal strings in dollars; a window of at most 366 days).

/** One UTC day as Soniox billed it. */
export interface SonioxDay {
  day: string;
  costUsd: number;
  /** The audio it heard, in milliseconds (every stream's). */
  audioMs: number;
  requests: number;
}

/** Soniox's count at once now, and its limit, for the whole organization (both apps). */
export interface SonioxNow {
  current: number;
  limit: number;
}

/** The most at once in a period (its start, ISO). */
export interface SonioxPeak {
  start: string;
  max: number;
}

/** What the admin asks Soniox (by the server, never a page); each throws a short reason. */
export interface UsageSource {
  /** Days in [start, end) (ISO times). */
  summary(startIso: string, endIso: string): Promise<SonioxDay[]>;
  /** Now: GET /v1/concurrency-limits. */
  now(): Promise<SonioxNow>;
  /** The most at once per period (60, 3600 or 86400 s): GET /v1/concurrent-streams-history. */
  peaks(startIso: string, endIso: string, periodSec: 60 | 3600 | 86400): Promise<SonioxPeak[]>;
}

const API = 'https://api.soniox.com/v1';

interface Summary {
  total?: {
    days?: unknown;
    cost_usd?: unknown;
    input_audio_duration_ms?: unknown;
    num_requests?: unknown;
  };
}

/** Its answer as days; anything unexpected is a reason, never a crash. */
export function parseSummary(body: unknown): SonioxDay[] {
  const t = (body as Summary | null)?.total;
  const days = Array.isArray(t?.days) ? (t.days as unknown[]) : null;
  if (!days) throw new Error('an answer without days');
  const at = (a: unknown, i: number) => (Array.isArray(a) ? Number(a[i] ?? 0) || 0 : 0);
  return days.map((d, i) => ({
    day: String(d),
    costUsd: at(t?.cost_usd, i),
    audioMs: at(t?.input_audio_duration_ms, i),
    requests: at(t?.num_requests, i),
  }));
}

/** /v1/concurrency-limits: the organization's count now and its limit (speech, not voices). */
export function parseNow(body: unknown): SonioxNow {
  const org = (body as { organization?: { current?: unknown; limits?: unknown } } | null)
    ?.organization;
  const n = (o: unknown) =>
    Number((o as { transcribe_concurrent?: unknown } | undefined)?.transcribe_concurrent);
  const current = n(org?.current);
  const limit = n(org?.limits);
  if (!Number.isFinite(current) || !Number.isFinite(limit))
    throw new Error('an answer without counts');
  return { current, limit };
}

/** /v1/concurrent-streams-history: each period's most at once (`sample_max`). */
export function parsePeaks(body: unknown): SonioxPeak[] {
  const entries = (body as { entries?: unknown } | null)?.entries;
  if (!Array.isArray(entries)) throw new Error('an answer without entries');
  return entries.map((e: { period_start?: unknown; sample_max?: unknown }) => ({
    start: String(e.period_start),
    max: Number(e.sample_max) || 0,
  }));
}

/**
 * The real source. Answers are kept a while (the page asks every 5 s, others reload it): now 3 s,
 * peaks a minute, days 5 minutes.
 */
export function sonioxUsage(apiKey: string, fetcher: typeof fetch = fetch): UsageSource {
  const kept = new Map<string, { at: number; value: unknown }>();
  async function ask<T>(path: string, keepMs: number, parse: (b: unknown) => T): Promise<T> {
    const hit = kept.get(path);
    if (hit && Date.now() - hit.at < keepMs) return hit.value as T;
    const r = await fetcher(`${API}${path}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) throw new Error(String(r.status));
    const value = parse(await r.json());
    if (kept.size > 50) kept.clear();
    kept.set(path, { at: Date.now(), value });
    return value;
  }
  const q = (start: string, end: string) =>
    `start_time=${encodeURIComponent(start)}&end_time=${encodeURIComponent(end)}`;
  return {
    summary: (start, end) => ask(`/usage/summary?${q(start, end)}`, 5 * 60_000, parseSummary),
    now: () => ask('/concurrency-limits', 3_000, parseNow),
    peaks: (start, end, period) =>
      ask(
        `/concurrent-streams-history?${q(start, end)}&period_sec=${period}&kind=stt`,
        60_000,
        parsePeaks,
      ),
  };
}
