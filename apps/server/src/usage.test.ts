import { describe, expect, it } from 'vitest';
import { parseSummary } from './usage';

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
