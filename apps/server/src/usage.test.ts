import { describe, expect, it } from 'vitest';
import { parseNow, parsePeaks, parseSummary } from './usage';

describe('Soniox’s usage summary', () => {
  it('its days with their cost, audio and requests (the docs’ shape)', () => {
    const body = {
      total: {
        model: null,
        days: ['2026-11-12', '2026-11-13'],
        cost_usd: ['0.1200000000', '0.0000000000'],
        input_audio_duration_ms: [3_600_000, 0],
        num_requests: [5, 0],
      },
      models: [],
    };
    expect(parseSummary(body)).toEqual([
      { day: '2026-11-12', costUsd: 0.12, audioMs: 3_600_000, requests: 5 },
      { day: '2026-11-13', costUsd: 0, audioMs: 0, requests: 0 },
    ]);
  });
  it('an unexpected answer is a reason, never a crash', () => {
    expect(() => parseSummary({})).toThrow('an answer without days');
    expect(() => parseSummary(null)).toThrow();
  });
});

describe('Soniox’s concurrency', () => {
  it('the organization’s count now and its limit (speech)', () => {
    const body = {
      project: {
        current: { transcribe_concurrent: 2, tts_concurrent: 0 },
        limits: { transcribe_concurrent: 4, tts_concurrent: 1 },
      },
      organization: {
        current: { transcribe_concurrent: 7, tts_concurrent: 0 },
        limits: { transcribe_concurrent: 10, tts_concurrent: 3 },
      },
    };
    expect(parseNow(body)).toEqual({ current: 7, limit: 10 });
    expect(() => parseNow({})).toThrow('an answer without counts');
  });
  it('the history: each period’s most at once', () => {
    const body = {
      kind: 'stt',
      entries: [
        {
          period_start: '2026-11-13T09:00:00Z',
          period_sec: 3600,
          sample_min: 0,
          sample_max: 6,
          sample_sum: 9,
          sample_count: 3,
          total_count: 4,
        },
      ],
    };
    expect(parsePeaks(body)).toEqual([{ start: '2026-11-13T09:00:00Z', max: 6 }]);
    expect(() => parsePeaks({})).toThrow();
  });
});
