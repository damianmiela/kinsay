import { describe, expect, it } from 'vitest';
import {
  AudioOutbox,
  CHUNK_SAMPLES,
  makeResampler,
  micHelp,
  peak,
  randomId,
  SendAsks,
} from './logic';

describe('makeResampler', () => {
  it('48 kHz → 16 kHz: every 3 samples become one, in 100 ms chunks', () => {
    const chunks: Int16Array[] = [];
    const feed = makeResampler(48_000, (c) => chunks.push(c));
    // one second of a constant half-level signal, in the browser's 128-sample frames
    for (let i = 0; i < 375; i++) feed(new Float32Array(128).fill(0.5));
    expect(chunks).toHaveLength(10);
    expect(chunks[0]).toHaveLength(CHUNK_SAMPLES);
    expect(chunks[9]![CHUNK_SAMPLES - 1]).toBe(Math.round(0.5 * 32767));
  });

  it('44.1 kHz keeps time (one second in, one second out) and clips at full scale', () => {
    let samples = 0;
    let last: Int16Array | undefined;
    const feed = makeResampler(44_100, (c) => {
      samples += c.length;
      last = c;
    });
    for (let i = 0; i < 441; i++) feed(new Float32Array(100).fill(2)); // louder than allowed
    expect(samples).toBe(16_000);
    expect(last![0]).toBe(32767);
    expect(peak(last!)).toBe(1);
  });

  it('averages within each output sample (a simple low-pass)', () => {
    const chunks: Int16Array[] = [];
    const feed = makeResampler(48_000, (c) => chunks.push(c));
    const alternating = new Float32Array(CHUNK_SAMPLES * 3).map((_, i) => (i % 3 === 0 ? 0.9 : 0));
    feed(alternating);
    expect(chunks[0]![0]).toBe(Math.round(0.3 * 32767));
  });
});

describe('AudioOutbox (no gap after a break, 2026-10-09)', () => {
  const chunk = () => new Int16Array(CHUNK_SAMPLES); // 100 ms
  it('keeps every chunk until confirmed, sends again after a reconnect, waits while offline', () => {
    const box = new AudioOutbox(60_000);
    for (let i = 0; i < 5; i++) box.push(chunk(), 1000 + i * 100);
    expect(box.take(3).map((c) => c.seq)).toEqual([1, 2, 3]);
    expect(box.waitingMs).toBe(200);
    box.confirm(2);
    // the connection was gone: 3 may never have arrived; everything from 3 goes again
    box.resend();
    expect(box.waitingMs).toBe(300);
    expect(box.take(10).map((c) => [c.seq, c.at])).toEqual([
      [3, 1200],
      [4, 1300],
      [5, 1400],
    ]);
    expect(box.waitingMs).toBe(0);
    box.confirm(5);
    expect(box.take(10)).toEqual([]);
  });

  it('a very long break: at most maxMs kept, the oldest goes', () => {
    const box = new AudioOutbox(1_000);
    for (let i = 0; i < 15; i++) box.push(chunk(), i);
    expect(box.waitingMs).toBe(1_000);
    expect(box.take(1)[0]?.seq).toBe(6);
    // sent ones that go are no longer waiting
    for (let i = 0; i < 5; i++) box.push(chunk(), 100 + i);
    expect(box.waitingMs).toBe(1_000);
    expect(box.take(20).map((c) => c.seq)).toEqual([11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
  });
});

describe('SendAsks: starts and stops while the input opens (audit 21)', () => {
  it('a double tap: both starts stand (no Stop for the first)', () => {
    const asks = new SendAsks();
    const [a, b] = [asks.start(), asks.start()];
    expect([asks.stands(a), asks.stands(b)]).toEqual([true, true]);
  });

  it('Stop while it opens: the start is cancelled and the Stop closes the input', () => {
    const asks = new SendAsks();
    const start = asks.start();
    const stop = asks.stop();
    expect(asks.stands(start)).toBe(false);
    expect(asks.isLast(stop)).toBe(true);
  });

  it('Start, Stop, Start again: only the last start stands, and the Stop closes nothing', () => {
    const asks = new SendAsks();
    const first = asks.start();
    const stop = asks.stop();
    const again = asks.start();
    expect([asks.stands(first), asks.isLast(stop), asks.stands(again)]).toEqual([
      false,
      false,
      true,
    ]);
  });
});

describe('randomId (2026-10-10)', () => {
  it('32 hex digits, different each time (no crypto.randomUUID: older iPhones lack it)', () => {
    const a = randomId();
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(randomId()).not.toBe(a);
  });
});

describe('micHelp', () => {
  it('the steps for each browser', () => {
    const android =
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';
    const iphone =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
    const mac =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15';
    const win =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0';
    expect(micHelp(android)).toBe('chromeAndroid');
    expect(micHelp(android.replace('Chrome/', 'SamsungBrowser/26.0 Chrome/'))).toBe('other');
    expect(micHelp(iphone)).toBe('safariIos');
    expect(micHelp(iphone.replace('Version/18.1', 'CriOS/131.0'))).toBe('other');
    expect(micHelp(mac)).toBe('safari');
    expect(micHelp(mac, true)).toBe('safariIos'); // an iPad
    expect(micHelp(win)).toBe('chrome');
    expect(micHelp('Mozilla/5.0 (Windows NT 10.0; rv:133.0) Gecko/20100101 Firefox/133.0')).toBe(
      'firefox',
    );
  });
});
