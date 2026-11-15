import { describe, expect, it, vi } from 'vitest';
import { HOLD_MS, sameWords, Sides } from './sides';

describe('both sides of a call', () => {
  it('lines in the order said, each with its side; an echo of the call never shows', () => {
    vi.useFakeTimers();
    let t = 0;
    const sides = new Sides(
      () => t,
      () => {},
    );
    sides.line('call', 'pl', 'Jak minęła podróż?');
    // (the microphone heard the speakers: the same words, a moment later)
    t += 500;
    sides.line('you', 'pl', 'jak minęła podróż');
    t += 1_000;
    sides.line('you', 'pl', 'Długo, ale dzieci spały.');
    expect(sides.view('pl', undefined, undefined, 10).lines).toEqual(['Jak minęła podróż?']);
    t += HOLD_MS;
    vi.advanceTimersByTime(HOLD_MS);
    const v = sides.view('pl', undefined, { lines: [], first: 0, live: 'Tak' }, 10);
    expect(v.lines).toEqual(['Jak minęła podróż?', 'Długo, ale dzieci spały.']);
    expect(v.speakers).toEqual({ 0: '2', 1: '1' });
    expect(v.live).toBe('Tak');
    expect(v.liveSpeaker).toBe('1');
    // (yours first, the call's same words after: still the echo, dropped while it waits)
    sides.line('you', 'pl', 'Zostaniecie na weekend?');
    sides.line('call', 'pl', 'Zostaniecie na cały weekend?');
    t += HOLD_MS;
    vi.advanceTimersByTime(HOLD_MS);
    expect(sides.view('pl', undefined, undefined, 10).lines).toHaveLength(3);
    sides.close();
    vi.useRealTimers();
  });

  it('same words: a word or two apart, never empty', () => {
    expect(sameWords('Are you staying the whole weekend?', 'are you staying whole weekend')).toBe(
      true,
    );
    expect(sameWords('Yes, thanks.', 'We stopped near Lyon.')).toBe(false);
    expect(sameWords('', '')).toBe(false);
  });
});
