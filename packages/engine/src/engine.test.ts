// The speech engine (taken over from the wedding app's captions, whose tests these follow).
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyTokens,
  BYTES_PER_MS,
  CATCH_UP,
  cutAt,
  Engine,
  FINALIZE_WAIT_MS,
  FULL_WARN_MS,
  IDLE_MS,
  LineBuilder,
  RELEASE_MS,
  SERVICE_FULL,
  SETTLE_MS,
  sonioxConnect,
  STALL_GAP_MS,
  STALL_MS,
  STALL_PAUSE_MS,
  STREAM_MAX_MS,
  StreamPool,
  type SonioxOptions,
  type SpeechConnect,
  type SpeechEvents,
  type Token,
} from './engine';
import { HEARD } from './types';

const TOPIC = [{ key: 'domain', value: 'Conversation' }];

/** A fake speech service: what each language's latest stream got; the test answers for it. */
function fakeService() {
  const streams = new Map<
    string,
    { events: SpeechEvents; bytes: number; ended: boolean; finalized: number; aborted: boolean }
  >();
  let opened = 0;
  const connect: SpeechConnect = (target, events) => {
    opened++;
    const s = { events, bytes: 0, ended: false, finalized: 0, aborted: false };
    streams.set(target, s);
    return {
      send: (c) => (s.bytes += c.length),
      end: () => (s.ended = true),
      finalize: () => s.finalized++,
      abort: () => (s.aborted = true),
    };
  };
  return { connect, streams, opened: () => opened };
}

const tok = (
  text: string,
  translation_status: string,
  is_final = true,
  language?: string,
): Token => ({
  text,
  translation_status,
  is_final,
  ...(language ? { language } : {}),
});
/** 100 ms of audio. */
const chunk = () => new Uint8Array(100 * BYTES_PER_MS);

function engine(
  o: { pool?: StreamPool; warn?: (m: string) => void; sent?: (ms: number, n: number) => void } = {},
) {
  const fake = fakeService();
  const status = vi.fn();
  const e = new Engine(fake.connect, {
    onText: () => {},
    onStatus: status,
    onSent: o.sent,
    warn: o.warn,
    pool: o.pool ?? null,
  });
  return { e, fake, status };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('caption lines', () => {
  it('a stream gives its own text (none + translation) and what was heard (none + original)', () => {
    const own = new LineBuilder();
    const heard = new LineBuilder();
    applyTokens(
      [tok(' Hola', 'original'), tok(' a todos', 'original', false), tok(' Cześć', 'translation')],
      own,
      heard,
    );
    expect(own.view(6, true)).toEqual({ lines: [], first: 0, live: 'Cześć' });
    expect(heard.view(6, true)).toEqual({ lines: [], first: 0, live: 'Hola a todos' });
  });

  it('the end of speech finishes a line; long sentences end one; no line is longer than 160', () => {
    const t = new LineBuilder();
    t.add('Short one.', true);
    expect(t.lines).toEqual(['Short one.']);
    t.add(`${'word '.repeat(60)}end`);
    t.finish();
    expect(t.lines.every((l) => l.length <= 160)).toBe(true);
    expect(cutAt(`${'a'.repeat(60)}, ${'b'.repeat(120)}`)).toBe(61);
  });

  it('readers get a guessed word once it stayed the same for SETTLE_MS', () => {
    let now = 0;
    const t = new LineBuilder(() => now);
    t.preview = ' Chic';
    now += 500;
    t.preview = ' Chicago is'; // (the word changed: its time starts again)
    expect(t.view(6, false).live).toBe('');
    expect(t.settling).toBe(true);
    now += SETTLE_MS - 1;
    expect(t.view(6, false).live).toBe('');
    now += 1;
    t.preview = ' Chicago is'; // (the same again: keeps its time)
    expect(t.view(6, false).live).toBe('Chicago is');
    expect(t.view(6, true).live).toBe('Chicago is');
    expect(t.settling).toBe(false);
  });

  it('lines are numbered from 0; a clear starts again', () => {
    const t = new LineBuilder();
    t.add('One.', true);
    t.add('Two.', true);
    expect(t.view(1)).toEqual({ lines: ['Two.'], first: 1, live: '' });
    t.clear();
    t.add('Three.', true);
    expect(t.view()).toEqual({ lines: ['Three.'], first: 0, live: '' });
  });
});

describe('the engine', () => {
  it('no translation: one stream without one, with the first audio; it ends after a silence', () => {
    vi.useFakeTimers();
    const { e, fake } = engine();
    e.audio(chunk());
    expect([...fake.streams.keys()]).toEqual([HEARD]);
    fake.streams
      .get(HEARD)!
      .events.tokens([tok(' Dzień dobry.', 'none', true, 'pl'), tok('<end>', 'none')]);
    expect(e.update(null).texts[HEARD]!.lines).toEqual(['Dzień dobry.']);
    expect(e.update(null).heardLangs).toEqual({ 0: 'pl' });
    vi.advanceTimersByTime(IDLE_MS + 1);
    expect(fake.streams.get(HEARD)!.ended).toBe(true);
    expect(e.service).toBe('idle');
    e.close();
  });

  it('a stream per language read; the first also gives what was heard', () => {
    vi.useFakeTimers();
    const { e, fake } = engine();
    e.setLangs(['tl', 'pl']);
    e.audio(chunk());
    expect([...fake.streams.keys()].sort()).toEqual(['pl', 'tl']);
    fake.streams
      .get('tl')!
      .events.tokens([
        tok(' Good morning.', 'original', true, 'en'),
        tok(' Magandang umaga.', 'translation'),
        tok('<end>', 'none'),
      ]);
    fake.streams
      .get('pl')!
      .events.tokens([
        tok(' Good morning.', 'original', true, 'en'),
        tok(' Dzień dobry.', 'translation'),
        tok('<end>', 'none'),
      ]);
    const u = e.update('pl');
    expect(u.texts.pl!.lines).toEqual(['Dzień dobry.']);
    expect(u.texts[HEARD]!.lines).toEqual(['Good morning.']); // (once: only from the first stream)
    expect(u.texts.tl).toBeUndefined(); // (a page gets its own language and what was heard)
    e.close();
  });

  it('a new language opens at once while running; one nobody reads ends, its late words dropped', () => {
    vi.useFakeTimers();
    const { e, fake } = engine();
    e.setLangs(['tl']);
    e.audio(chunk());
    e.setLangs(['tl', 'de']);
    expect(fake.opened()).toBe(2);
    const de = fake.streams.get('de')!;
    e.setLangs(['tl']);
    expect(de.ended).toBe(true);
    de.events.tokens([tok(' Spät.', 'translation'), tok('<end>', 'none')]);
    expect(e.update('de').texts.de!.lines).toEqual([]);
    e.close();
  });

  it('the first language changes: every stream starts again (it gives what was heard)', () => {
    vi.useFakeTimers();
    const { e, fake } = engine();
    e.setLangs(['tl']);
    e.audio(chunk());
    const tl = fake.streams.get('tl')!;
    e.setLangs(['pl']);
    expect(tl.ended).toBe(true);
    e.audio(chunk());
    expect(fake.streams.get('pl')).toBeTruthy();
    e.close();
  });

  it('an error pauses, the audio waits and goes to the next try; failures wait longer', () => {
    vi.useFakeTimers();
    const warn = vi.fn();
    const { e, fake } = engine({ warn });
    e.audio(chunk());
    fake.streams.get(HEARD)!.events.closed('500 broken');
    expect(e.service).toBe('error');
    e.audio(chunk());
    e.audio(chunk());
    expect(fake.opened()).toBe(1);
    vi.advanceTimersByTime(5_000);
    expect(fake.opened()).toBe(2);
    expect(fake.streams.get(HEARD)!.bytes).toBe(2 * chunk().length);
    fake.streams.get(HEARD)!.events.closed('500 broken');
    e.audio(chunk());
    vi.advanceTimersByTime(5_000);
    expect(fake.opened()).toBe(2); // (the second failure waits 10 s)
    vi.advanceTimersByTime(5_000);
    expect(fake.opened()).toBe(3);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('500 broken'));
    e.close();
  });

  it('a refused key is asked again only once a minute', () => {
    vi.useFakeTimers();
    const { e, fake } = engine();
    e.audio(chunk());
    fake.streams.get(HEARD)!.events.closed('401 bad key');
    e.audio(chunk());
    vi.advanceTimersByTime(59_000);
    expect(fake.opened()).toBe(1);
    vi.advanceTimersByTime(1_000);
    expect(fake.opened()).toBe(2);
    e.close();
  });

  it('kept audio is caught up at twice real time', () => {
    vi.useFakeTimers();
    const { e, fake } = engine();
    e.audio(chunk());
    fake.streams.get(HEARD)!.events.closed('500 broken');
    for (let i = 0; i < 50; i++) e.audio(chunk()); // (5 s kept)
    vi.advanceTimersByTime(5_000);
    const st = fake.streams.get(HEARD)!;
    const sentAtOnce = st.bytes;
    expect(sentAtOnce).toBeLessThan(50 * chunk().length);
    vi.advanceTimersByTime(5_000 / CATCH_UP + 500);
    expect(st.bytes).toBe(50 * chunk().length);
    e.close();
  });

  it('fresh streams before Soniox ends one at 300 minutes', () => {
    vi.useFakeTimers();
    const { e, fake } = engine();
    e.audio(chunk());
    for (let t = 0; t < STREAM_MAX_MS + 2_000; t += 5_000) {
      vi.advanceTimersByTime(5_000);
      e.audio(chunk());
    }
    expect(fake.opened()).toBe(2);
    e.close();
  });

  it('counts every chunk sent, times the streams it went to (the credits)', () => {
    vi.useFakeTimers();
    const sent = vi.fn();
    const { e } = engine({ sent });
    e.setLangs(['tl', 'pl']);
    e.audio(chunk());
    expect(sent).toHaveBeenCalledWith(100, 2);
    e.close();
  });

  it('discard: every line and the kept audio go; ended streams’ late words never show', () => {
    vi.useFakeTimers();
    const { e, fake } = engine();
    e.audio(chunk());
    const st = fake.streams.get(HEARD)!;
    st.events.tokens([tok(' Hello.', 'none'), tok('<end>', 'none')]);
    e.discard();
    st.events.tokens([tok(' Late.', 'none'), tok('<end>', 'none')]);
    expect(e.update(null).texts[HEARD]).toEqual({ lines: [], first: 0, live: '' });
    expect(e.heardLangs.size).toBe(0);
    e.close();
  });
});

describe('what the wedding needs too', () => {
  it('the languages at the start; each finished line with when its audio was recorded; lines kept', () => {
    const fake = fakeService();
    const lines: [string, string, number, number][] = [];
    const e = new Engine(fake.connect, {
      onText: () => {},
      onStatus: () => {},
      langs: ['pl', 'en'],
      linesKept: 2,
      onLine: (target, line, n, at) => lines.push([target, line, n, at]),
    });
    e.audio(chunk(), 1_000);
    expect([...fake.streams.keys()]).toEqual(['pl', 'en']);
    const pl = fake.streams.get('pl')!.events;
    for (const w of ['One.', 'Two.', 'Three.']) {
      pl.tokens([tok(` ${w}`, 'translation'), tok('<end>', 'none')]);
    }
    expect(lines.filter((l) => l[0] === 'pl')).toEqual([
      ['pl', 'One.', 0, 1_000],
      ['pl', 'Two.', 1, 1_000],
      ['pl', 'Three.', 2, 1_000],
    ]);
    expect(e.text('pl').lines).toEqual(['Two.', 'Three.']);
    // the server's end: what was coming in is finished (and reported)
    pl.tokens([tok(' Four', 'translation')]);
    e.close();
    expect(lines.at(-1)).toEqual(['pl', 'Four', 3, 1_000]);
  });

  it('behind while kept audio waits; drain sends it, then ends the streams and says so', () => {
    vi.useFakeTimers();
    const { e, fake, status } = engine();
    e.audio(chunk());
    fake.streams.get(HEARD)!.events.closed('500 something broke');
    for (let i = 0; i < 12; i++) e.audio(chunk());
    expect(e.behind).toBe(true);
    expect(status).toHaveBeenCalled();
    const done = vi.fn();
    e.drain(done);
    expect(done).not.toHaveBeenCalled();
    vi.advanceTimersByTime(5_001 + 2_000);
    expect(done).toHaveBeenCalledOnce();
    expect(e.behind).toBe(false);
    expect([...fake.streams.values()].every((s) => s.ended)).toBe(true);
  });
});

describe('the shared pool of streams', () => {
  it('opens nothing without room, says so after a while, opens when room comes back', () => {
    vi.useFakeTimers();
    const pool = new StreamPool(2);
    pool.used = 1;
    const { e, fake } = engine({ pool });
    e.setLangs(['tl', 'pl']);
    e.audio(chunk());
    expect(fake.opened()).toBe(0);
    expect(e.service).not.toBe('error');
    vi.advanceTimersByTime(FULL_WARN_MS + 600);
    expect(e.error).toBe(SERVICE_FULL);
    pool.used = 0;
    vi.advanceTimersByTime(600);
    expect(fake.opened()).toBe(2);
    expect(e.service).toBe('live');
    e.close();
  });

  it('a stream gives its place back once it closed, or after RELEASE_MS closed by us, never twice', () => {
    vi.useFakeTimers();
    const pool = new StreamPool(5);
    const { e, fake } = engine({ pool });
    e.setLangs(['tl', 'pl']);
    e.audio(chunk());
    expect(pool.used).toBe(2);
    vi.advanceTimersByTime(IDLE_MS + 1);
    fake.streams.get('tl')!.events.closed();
    fake.streams.get('tl')!.events.closed();
    expect(pool.used).toBe(1);
    vi.advanceTimersByTime(RELEASE_MS);
    expect(pool.used).toBe(0);
    expect(fake.streams.get('pl')!.aborted).toBe(true);
    e.close();
  });
});

describe('the watchdog', () => {
  const heardOnly = [tok(' Maayong buntag', 'original')];

  it('words heard with nothing in its language: finalize, then every stream starts again, once in a while', () => {
    vi.useFakeTimers();
    const warn = vi.fn();
    const { e, fake } = engine({ warn });
    e.setLangs(['en']);
    const en = () => fake.streams.get('en')!;
    const wait = (ms: number) => {
      for (let t = 0; t < ms; t += 2_000) {
        vi.advanceTimersByTime(Math.min(2_000, ms - t));
        e.audio(chunk());
        en().events.tokens(heardOnly);
      }
    };
    e.audio(chunk());
    en().events.tokens(heardOnly);
    wait(STALL_MS);
    en().events.tokens(heardOnly);
    expect(en().finalized).toBe(1);
    wait(FINALIZE_WAIT_MS);
    en().events.tokens(heardOnly);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('nothing in en'));
    e.audio(chunk());
    expect(fake.opened()).toBe(2);
    en().events.tokens(heardOnly);
    wait(STALL_MS + FINALIZE_WAIT_MS);
    en().events.tokens(heardOnly);
    expect(fake.opened()).toBe(2); // (not again before STALL_GAP_MS)
    wait(STALL_GAP_MS);
    en().events.tokens(heardOnly);
    e.audio(chunk());
    expect(fake.opened()).toBe(3);
    e.close();
  });

  it('a pause in what is heard starts the count again; translations coming keep the stream', () => {
    vi.useFakeTimers();
    const { e, fake } = engine();
    e.setLangs(['en']);
    e.audio(chunk());
    const en = fake.streams.get('en')!;
    en.events.tokens(heardOnly);
    for (let t = 0; t < 10 * 60_000; t += 2_000) {
      vi.advanceTimersByTime(2_000);
      e.audio(chunk()); // (silence: the microphone keeps sending)
    }
    en.events.tokens(heardOnly);
    vi.advanceTimersByTime(STALL_PAUSE_MS - 1_000);
    e.audio(chunk());
    en.events.tokens([tok(' Good morning', 'translation')]);
    expect(en.finalized).toBe(0);
    expect(fake.opened()).toBe(1);
    e.close();
  });
});

describe('Soniox', () => {
  /** A WebSocket server that reads the first (masked) frame and closes. */
  async function firstMessage(target: string, extra: Partial<SonioxOptions> = {}) {
    const seen: { auth?: string; first?: Record<string, unknown> } = {};
    const srv = createServer();
    srv.on('upgrade', (req, socket) => {
      seen.auth = req.headers.authorization;
      const accept = createHash('sha1')
        .update(`${req.headers['sec-websocket-key'] ?? ''}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
        .digest('base64');
      socket.write(
        [
          'HTTP/1.1 101 Switching Protocols',
          'Upgrade: websocket',
          'Connection: Upgrade',
          `Sec-WebSocket-Accept: ${accept}`,
          '',
          '',
        ].join('\r\n'),
      );
      socket.once('data', (b: Buffer) => {
        let len = b[1]! & 0x7f;
        let at = 2;
        if (len === 126) {
          len = b.readUInt16BE(2);
          at = 4;
        }
        const mask = b.subarray(at, at + 4);
        const body = b.subarray(at + 4, at + 4 + len).map((x, i) => x ^ mask[i % 4]!);
        seen.first = JSON.parse(Buffer.from(body).toString('utf8')) as Record<string, unknown>;
        socket.destroy();
      });
    });
    await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', ok));
    const { port } = srv.address() as AddressInfo;
    try {
      await new Promise<void>((ok) => {
        sonioxConnect('the-key', { topic: TOPIC, url: `ws://127.0.0.1:${port}`, ...extra })(
          target,
          {
            tokens: () => {},
            closed: () => ok(),
          },
        );
      });
    } finally {
      srv.close();
    }
    return seen;
  }

  it('the key in the Authorization header, never in the first message; v6, our topic, the target', async () => {
    const seen = await firstMessage('tl');
    expect(seen.auth).toBe('Bearer the-key');
    expect(seen.first).toMatchObject({
      model: 'stt-rt-v6',
      translation: { type: 'one_way', target_language: 'tl' },
      context: { general: TOPIC },
    });
    expect(seen.first).not.toHaveProperty('api_key');
  });

  it('names to spell right and the likely languages, when given (the wedding)', async () => {
    const seen = await firstMessage('pl', { terms: () => ['Anna', 'Ben'], hints: ['pl', 'es'] });
    expect(seen.first).toMatchObject({
      language_hints: ['pl', 'es'],
      context: { general: TOPIC, terms: ['Anna', 'Ben'] },
    });
    const plain = await firstMessage('pl');
    expect(plain.first).not.toHaveProperty('language_hints');
    expect(plain.first!.context).not.toHaveProperty('terms');
  });

  it('no translation: a stream without one', async () => {
    const seen = await firstMessage(HEARD);
    expect(seen.first).not.toHaveProperty('translation');
    expect(seen.first).toMatchObject({ enable_language_identification: true });
  });
});
