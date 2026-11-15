// Both sides of a call (mockups batch 9, 2026-11-15): the window's microphone ("you") and this
// computer's sound ("the call") go to two engines; their finished lines meet here, one list per
// language in the order they were said, each marked with its side (the captions' speaker colours:
// "1" you, "2" the call). Without a headset the microphone also hears the call: a line of yours that
// repeats what the call said a moment ago is an echo: never shown, or wiped once the call's comes.
import type { CaptionText, Target } from '@translate/shared';

export type Side = 'you' | 'call';
export const SIDE_MARK: Record<Side, string> = { you: '1', call: '2' };
/** A call line counts as the echo's source this long (the echo's own delay, audit 37). */
const ECHO_MS = 3_000;
/** An echo has at least this many words, mostly the same (short replies are never one: audit 37). */
const ECHO_WORDS = 4;
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
  if (x.size < ECHO_WORDS || y.size < ECHO_WORDS) return false;
  let both = 0;
  for (const w of x) if (y.has(w)) both++;
  return both / Math.max(x.size, y.size) >= 0.8;
}

interface List {
  lines: string[];
  marks: string[];
  /** When each line came (an echo is looked for among the last ECHO_MS). */
  ats: number[];
  count: number;
}

export class Sides {
  private lists = new Map<Target, List>();

  constructor(
    private now: () => number,
    private changed: () => void,
  ) {}

  private list(t: Target): List {
    let l = this.lists.get(t);
    if (!l) this.lists.set(t, (l = { lines: [], marks: [], ats: [], count: 0 }));
    return l;
  }

  /** The recent lines of one side, as their places in the list. */
  private recent(l: List, side: Side, at: number): number[] {
    const out: number[] = [];
    for (let i = l.lines.length - 1; i >= 0 && at - (l.ats[i] ?? 0) < ECHO_MS; i--) {
      if (l.marks[i] === SIDE_MARK[side] && l.lines[i]) out.push(i);
    }
    return out;
  }

  /**
   * A finished line of one side, shown at once (never held back: Damian, 2026-11-15). A line of
   * yours with mostly the call's words of the last moments is an echo: never added; a line of yours
   * already shown that the call says after it is wiped (its place stays empty: pages hide it).
   */
  line(side: Side, target: Target, text: string) {
    const l = this.list(target);
    const at = this.now();
    if (side === 'call') {
      for (const i of this.recent(l, 'you', at)) if (sameWords(l.lines[i]!, text)) l.lines[i] = '';
    } else if (this.recent(l, 'call', at).some((i) => sameWords(l.lines[i]!, text))) {
      return;
    }
    l.lines.push(text);
    l.marks.push(SIDE_MARK[side]);
    l.ats.push(at);
    l.count++;
    if (l.lines.length > KEPT) {
      l.lines.shift();
      l.marks.shift();
      l.ats.shift();
    }
    this.changed();
  }

  /** The list for one language, with the line coming in (the call's first, else yours). */
  view(
    target: Target,
    call: CaptionText | undefined,
    you: CaptionText | undefined,
    n: number,
  ): CaptionText {
    const l = this.list(target);
    const at = this.now();
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
      !this.recent(l, 'call', at).some((i) => sameWords(l.lines[i]!, you.live))
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
}
