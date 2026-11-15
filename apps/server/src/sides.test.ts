import { describe, expect, it } from 'vitest';
import { sameWords, Sides } from './sides';

describe('both sides of a call', () => {
  it('every line at once, in order, with its side; an echo of the call never stays', () => {
    let t = 0;
    const sides = new Sides(
      () => t,
      () => {},
    );
    const lines = () => sides.view('pl', undefined, undefined, 10).lines;
    sides.line('call', 'pl', 'Jak minęła wam dzisiaj podróż?');
    // (the microphone heard the speakers after the call's line: never added)
    t += 500;
    sides.line('you', 'pl', 'jak minęła wam dzisiaj podróż');
    sides.line('you', 'pl', 'Długo, ale dzieci spały.');
    const v = sides.view('pl', undefined, { lines: [], first: 0, live: 'Tak' }, 10);
    expect(v.lines).toEqual(['Jak minęła wam dzisiaj podróż?', 'Długo, ale dzieci spały.']);
    expect(v.speakers).toEqual({ 0: '2', 1: '1' });
    expect(v.liveSpeaker).toBe('1');
    // (yours first, shown at once; the call's same words after: yours is wiped, its place empty)
    sides.line('you', 'pl', 'Zostaniecie u nas na weekend?');
    expect(lines()).toHaveLength(3);
    sides.line('call', 'pl', 'Zostaniecie u nas na cały weekend?');
    expect(lines()).toEqual([
      'Jak minęła wam dzisiaj podróż?',
      'Długo, ale dzieci spały.',
      '',
      'Zostaniecie u nas na cały weekend?',
    ]);
    // (long after: the same words are no echo)
    t += 60_000;
    sides.line('you', 'pl', 'Zostaniecie u nas na cały weekend?');
    expect(lines().at(-1)).toBe('Zostaniecie u nas na cały weekend?');
  });

  it('same words: a word or two apart, never empty', () => {
    expect(sameWords('Are you staying the whole weekend?', 'are you staying whole weekend')).toBe(
      true,
    );
    expect(sameWords('Yes, thanks.', 'We stopped near Lyon.')).toBe(false);
    expect(sameWords('', '')).toBe(false);
    // a real answer is no echo (audit 37): short, or only some of the words
    expect(sameWords('Yes', 'Yes')).toBe(false);
    expect(sameWords('Can you hear me?', 'Yes, I can hear you')).toBe(false);
  });
});
