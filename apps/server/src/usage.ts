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

/** Soniox's days in [start, end) (ISO times); throws with a short reason when it can't. */
export type UsageSource = (startIso: string, endIso: string) => Promise<SonioxDay[]>;

const URL_BASE = 'https://api.soniox.com/v1/usage/summary';

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

/** The real source, its answers kept 5 minutes (the page may be reloaded often). */
export function sonioxUsage(apiKey: string, fetcher: typeof fetch = fetch): UsageSource {
  const kept = new Map<string, { at: number; days: SonioxDay[] }>();
  return async (start, end) => {
    const key = `${start}|${end}`;
    const hit = kept.get(key);
    if (hit && Date.now() - hit.at < 5 * 60_000) return hit.days;
    const url = `${URL_BASE}?start_time=${encodeURIComponent(start)}&end_time=${encodeURIComponent(end)}`;
    const r = await fetcher(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) throw new Error(String(r.status));
    const days = parseSummary(await r.json());
    kept.clear();
    kept.set(key, { at: Date.now(), days });
    return days;
  };
}
