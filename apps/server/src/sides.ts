// Both sides of a call (mockups batch 9, 2026-11-15): the window's microphone ("you") and this
// computer's sound ("the call") go to two engines; their finished lines meet here, one list per
// language in the order they were said, each marked with its side (the captions' speaker colours:
// "1" you, "2" the call). Without a headset the microphone also hears the call: a line of yours that
// repeats what the call said a moment ago is an echo, never shown (it waits HOLD_MS for the call's).
import type { CaptionText, Target } from '@translate/shared';

export type Side = 'you' | 'call';
export const SIDE_MARK: Record<Side, string> = { you: '1', call: '2' };
/** A line of yours waits this long for the call's same words (the echo), then shows. */
export const HOLD_MS = 2_000;
/** A call line counts as the echo's source this long. */
const ECHO_MS = 10_000;
const KEPT = 200;

const words = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^\p{L}\p{N}\s]/gu, '')
      .split(/\s+/)
      .filter(Boolean),
  );

/** Mostly the same words (an echo heard through the microphone, a word or two apart). */
export function sameWords(a: string, b: string): boolean {
  const x = words(a);
  const y = words(b);
  if (!x.size || !y.size) return false;
  let both = 0;
  for (const w of x) if (y.has(w)) both++;
  return both / Math.max(x.size, y.size) >= 0.6;
}

interface List {
  lines: string[];
  marks: string[];
  count: number;
  calls: { text: string; at: number }[];
  held: { text: string; at: number }[];
}

export class Sides {
  private lists = new Map<Target, List>();
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private now: () => number,
    private changed: () => void,
  ) {}

  private list(t: Target): List {
    let l = this.lists.get(t);
    if (!l) this.lists.set(t, (l = { lines: [], marks: [], count: 0, calls: [], held: [] }));
    return l;
  }

  private add(l: List, text: string, side: Side) {
    l.lines.push(text);
    l.marks.push(SIDE_MARK[side]);
    l.count++;
    if (l.lines.length > KEPT) {
      l.lines.shift();
      l.marks.shift();
    }
  }

  /** A finished line of one side. */
  line(side: Side, target: Target, text: string) {
    const l = this.list(target);
    const at = this.now();
    if (side === 'call') {
      // (a line of yours waiting with the same words was this line's echo)
      l.held = l.held.filter((h) => !sameWords(h.text, text));
      l.calls = [...l.calls.filter((c) => at - c.at < ECHO_MS), { text, at }];
      this.add(l, text, 'call');
    } else if (!l.calls.some((c) => at - c.at < ECHO_MS && sameWords(c.text, text))) {
      l.held.push({ text, at });
      this.armRelease();
    }
    this.changed();
  }

  private armRelease() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (this.release()) this.changed();
      if ([...this.lists.values()].some((l) => l.held.length)) this.armRelease();
    }, HOLD_MS / 4);
  }

  /** Yours that waited long enough show. True when any did. */
  release(): boolean {
    const at = this.now();
    let any = false;
    for (const l of this.lists.values()) {
      while (l.held.length && at - (l.held[0]?.at ?? at) >= HOLD_MS) {
        this.add(l, l.held.shift()!.text, 'you');
        any = true;
      }
    }
    return any;
  }

  /** The list for one language, with the line coming in (the call's first, else yours). */
  view(
    target: Target,
    call: CaptionText | undefined,
    you: CaptionText | undefined,
    n: number,
  ): CaptionText {
    const l = this.list(target);
    const lines = l.lines.slice(-n);
    const first = l.count - lines.length;
    const speakers: Record<number, string> = {};
    const marks = l.marks.slice(-lines.length);
    lines.forEach((_, i) => (speakers[first + i] = marks[i] ?? SIDE_MARK.call));
    const text: CaptionText = { lines, first, live: '', speakers };
    if (call?.live) {
      text.live = call.live;
      text.liveSpeaker = SIDE_MARK.call;
    } else if (
      you?.live &&
      !l.calls.some((c) => this.now() - c.at < ECHO_MS && sameWords(c.text, you.live))
    ) {
      text.live = you.live;
      text.liveSpeaker = SIDE_MARK.you;
    }
    return text;
  }

  clearText(target: Target) {
    this.lists.delete(target);
  }

  clear() {
    this.lists.clear();
  }

  close() {
    clearTimeout(this.timer);
    this.timer = undefined;
  }
}
