import { describe, expect, it } from 'vitest';
import { GLIDE_MS, glideStep } from './captionScroll';

describe('glideStep: following the newest line (2026-10-11)', () => {
  it('most of the way in a few frames, there within a second, never past the target', () => {
    let y = 0;
    for (let frame = 0; frame < 30; frame++) y = glideStep(y, 600, 1000 / 60);
    expect(y).toBeGreaterThan(570); // (95 % in half a second)
    for (let frame = 0; frame < 30; frame++) y = glideStep(y, 600, 1000 / 60);
    expect(y).toBe(600);
    expect(glideStep(0, 600, GLIDE_MS)).toBeCloseTo(600 * (1 - Math.exp(-1)), 5);
    expect(glideStep(590, 600, 10_000)).toBe(600);
  });

  it('at least a pixel a frame (a phone rounds smaller steps away), never past the target', () => {
    expect(glideStep(100, 103, 1)).toBe(101);
    expect(glideStep(100, 100.4, 16)).toBe(100.4);
  });
});
