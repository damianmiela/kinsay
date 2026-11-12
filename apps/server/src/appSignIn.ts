// The desktop app's sign-in (mockups batch 2, part 7): Google allows no sign-in inside an app's
// window, so the window asks for a sign-in here, opens the person's own browser at /app-signin with
// the ask's token, and asks every couple of seconds whether it was answered. In the browser,
// signed in as usual, the person sees the same digits as the window and says yes; the window's next
// ask then gets its own device cookie. The window's secret (`poll`) never leaves the window; the
// browser's link carries only the `token`. In memory only: an ask lasts 10 minutes.
// The browser must answer from the same internet address as the window asked from (the app opens the
// browser on the same computer): a link sent to someone else ("confirm code 123 456") never signs
// the sender's app in as them, whatever digits it shows (audit 32).
import { randomBytes, randomInt } from 'node:crypto';

export const APP_SIGNIN_MS = 10 * 60_000;
/** Asks waiting at once, at most (a few hundred bytes each: a flood can't fill the memory). */
export const APP_SIGNIN_MAX = 20_000;
/** Asks waiting at once from one address (IPv6 per /48): one can't fill them for everyone. */
export const APP_SIGNIN_PER_PLACE = 3;

interface Ask {
  poll: string;
  token: string;
  digits: string;
  expires: number;
  /** The window's address (`ipBucket`: its /64 or IPv4) and its wider one (`wideBucket`). */
  where: string;
  wide: string;
  /** Answered: the person who said yes, or null for no. */
  answer?: number | null;
}

const secret = () => randomBytes(24).toString('base64url');

export class AppSignIns {
  private readonly byToken = new Map<string, Ask>();
  private readonly byPoll = new Map<string, Ask>();

  constructor(private readonly now: () => number = Date.now) {}

  private tidy() {
    const t = this.now();
    for (const a of this.byToken.values()) {
      if (a.expires <= t) {
        this.byToken.delete(a.token);
        this.byPoll.delete(a.poll);
      }
    }
  }

  /** A new ask for the window; null while too many wait (for everyone, or from its address). */
  start(where: string, wide: string): { poll: string; token: string; digits: string } | null {
    this.tidy();
    if (this.byToken.size >= APP_SIGNIN_MAX) return null;
    let here = 0;
    for (const a of this.byToken.values()) if (a.wide === wide && a.answer === undefined) here++;
    if (here >= APP_SIGNIN_PER_PLACE) return null;
    const a: Ask = {
      where,
      wide,
      poll: secret(),
      token: secret(),
      digits: String(randomInt(0, 1_000_000)).padStart(6, '0'),
      expires: this.now() + APP_SIGNIN_MS,
    };
    this.byToken.set(a.token, a);
    this.byPoll.set(a.poll, a);
    return { poll: a.poll, token: a.token, digits: a.digits };
  }

  /** The browser's view of an ask still waiting for its answer: its digits, and whether the
   *  browser is somewhere else than the window (then it may only say no). */
  waiting(token: string, where: string): { digits: string; elsewhere: boolean } | undefined {
    this.tidy();
    const a = this.byToken.get(token);
    return a && a.answer === undefined
      ? { digits: a.digits, elsewhere: a.where !== where }
      : undefined;
  }

  /** The browser's answer: yes for this person (only from the window's address), or no (null). Once. */
  answer(token: string, personId: number | null, where: string): 'ok' | 'gone' | 'elsewhere' {
    this.tidy();
    const a = this.byToken.get(token);
    if (!a || a.answer !== undefined) return 'gone';
    if (personId !== null && a.where !== where) return 'elsewhere';
    a.answer = personId;
    return 'ok';
  }

  /** The window asks: still waiting, no, gone (expired or never), or yes (once: the ask ends). */
  poll(poll: string): 'waiting' | 'no' | 'gone' | { personId: number } {
    this.tidy();
    const a = this.byPoll.get(poll);
    if (!a) return 'gone';
    if (a.answer === undefined) return 'waiting';
    this.byToken.delete(a.token);
    this.byPoll.delete(a.poll);
    return a.answer === null ? 'no' : { personId: a.answer };
  }
}
