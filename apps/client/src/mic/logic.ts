// The mic page's audio math (W3), kept pure so it can be tested.

/** What the speech service gets: 16 kHz, 16-bit, mono. */
export const TARGET_RATE = 16_000;
/** 100 ms per chunk (3200 bytes): small enough to be live, few enough messages. */
export const CHUNK_SAMPLES = 1_600;

/** A random id, 32 hex digits (crypto.randomUUID is missing before iOS 15.4: /live's phones). */
export const randomId = (): string =>
  Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');

/**
 * Turns the browser's audio (any sample rate, floats from -1 to 1) into 16 kHz 16-bit chunks.
 * Each output sample is the average of the input samples it covers (a simple low-pass, enough for
 * speech).
 */
export function makeResampler(fromRate: number, onChunk: (pcm: Int16Array) => void) {
  const step = fromRate / TARGET_RATE;
  let acc = 0;
  let count = 0;
  let consumed = 0;
  let next = step;
  let out = new Int16Array(CHUNK_SAMPLES);
  let n = 0;
  return (input: Float32Array) => {
    for (const x of input) {
      acc += x;
      count++;
      consumed++;
      while (consumed >= next) {
        const v = Math.max(-1, Math.min(1, acc / count));
        out[n++] = Math.round(v * 32767);
        if (n === CHUNK_SAMPLES) {
          onChunk(out);
          out = new Int16Array(CHUNK_SAMPLES);
          n = 0;
        }
        next += step;
        acc = 0;
        count = 0;
      }
      // keep the numbers small over hours of audio
      if (consumed > 1e6) {
        consumed -= 1e6;
        next -= 1e6;
      }
    }
  };
}

/** How loud a chunk is, 0 to 1 (its peak), for the level meter. */
export function peak(pcm: Int16Array): number {
  let max = 0;
  for (const v of pcm) max = Math.max(max, Math.abs(v));
  return max / 32767;
}

/** One chunk on its way: its number in the page's stream of audio and when it was recorded. */
export interface OutChunk {
  seq: number;
  pcm: Int16Array;
  at: number;
}

/**
 * The audio on its way to the server (2026-10-09): every chunk stays until the server confirms
 * it (`captions:ack`), so a break in the internet loses nothing. What wasn't confirmed goes again
 * after a reconnect (the server drops what it has already): even the seconds before the page
 * noticed the connection was gone. At most `maxMs` is kept; in a longer break the oldest goes.
 */
/** How a start of sending ended: running, the input failed (it says why), or a later Stop. */
export type StartResult = 'started' | 'failed' | 'cancelled';

/**
 * Starts and stops of sending, in the order asked (audit 21): a start that opens after a later Stop
 * is cancelled, and that Stop closes the input once it opens unless a start came after it. A later
 * start never cancels an earlier one (a double tap: both open the same input).
 */
export class SendAsks {
  private asked = 0;
  private lastStop = 0;
  start(): number {
    return ++this.asked;
  }
  stop(): number {
    return (this.lastStop = ++this.asked);
  }
  /** The start asked as `ask` still stands: no Stop came after it. */
  stands(ask: number): boolean {
    return ask > this.lastStop;
  }
  /** The Stop asked as `ask` is still the last word: no start came after it. */
  isLast(ask: number): boolean {
    return ask === this.asked;
  }
}

export class AudioOutbox {
  private items: OutChunk[] = [];
  /** The first chunk not sent yet (on this connection). */
  private next = 0;
  private seq = 0;
  private keptMs = 0;
  private sentMs = 0;

  constructor(private readonly maxMs: number) {}

  push(pcm: Int16Array, at: number): void {
    this.items.push({ seq: ++this.seq, pcm, at });
    this.keptMs += pcm.length / 16;
    while (this.keptMs > this.maxMs && this.items.length > 1) this.drop(1);
  }

  /** Up to `n` chunks to send now (they stay until confirmed). */
  take(n: number): OutChunk[] {
    const out = this.items.slice(this.next, this.next + n);
    this.next += out.length;
    for (const c of out) this.sentMs += c.pcm.length / 16;
    return out;
  }

  /** The server has everything up to `seq`. */
  confirm(seq: number): void {
    const i = this.items.findIndex((c) => c.seq > seq);
    this.drop(i < 0 ? this.items.length : i);
  }

  /** A new connection: what wasn't confirmed goes again. */
  resend(): void {
    this.next = 0;
    this.sentMs = 0;
  }

  /** Audio not sent yet (waiting for the connection), in ms. */
  get waitingMs(): number {
    return this.keptMs - this.sentMs;
  }

  private drop(n: number) {
    for (const c of this.items.splice(0, n)) {
      const ms = c.pcm.length / 16;
      this.keptMs -= ms;
      if (this.next > 0) {
        this.next--;
        this.sentMs -= ms;
      }
    }
  }
}

/** Which steps unblock the microphone in this browser (the blocked sheet's pictures). */
export type MicHelp = 'chromeAndroid' | 'chrome' | 'safariIos' | 'safari' | 'firefox' | 'other';

/** `touch`: an iPad says it is a Mac; it has touch points. */
export function micHelp(ua: string, touch = false): MicHelp {
  const apple = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && touch);
  if (apple) return /CriOS|FxiOS|EdgiOS/.test(ua) ? 'other' : 'safariIos';
  if (/Android/.test(ua)) {
    return /Chrome\//.test(ua) && !/SamsungBrowser|Firefox|OPR|EdgA/.test(ua)
      ? 'chromeAndroid'
      : 'other';
  }
  if (/Firefox\//.test(ua)) return 'firefox';
  if (/Chrome\/|Edg\//.test(ua)) return 'chrome';
  if (/Macintosh/.test(ua) && /Safari\//.test(ua)) return 'safari';
  return 'other';
}
