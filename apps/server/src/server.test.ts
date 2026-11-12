import { afterEach, describe, expect, it } from 'vitest';
import { io as connect, type Socket } from 'socket.io-client';
import { EUR, HEARD, type Ack, type SessionView } from '@translate/shared';
import { createServer } from './server';
import type { SpeechConnect, SpeechEvents, SpeechStream } from './engine';

const ADMIN = 'admin-password-for-tests';
const SECRET = 's'.repeat(40);
let closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const c of closers.reverse()) await c();
  closers = [];
});

/** A speech service that records what each stream got and lets the test send words back. */
function fakeSpeech() {
  const streams: { target: string; events: SpeechEvents; bytes: number; ended: boolean }[] = [];
  const connect: SpeechConnect = (target, events) => {
    const st = { target, events, bytes: 0, ended: false };
    streams.push(st);
    const s: SpeechStream = {
      send: (c) => (st.bytes += c.length),
      end: () => {
        st.ended = true;
        events.closed();
      },
    };
    return s;
  };
  return { connect, streams, open: () => streams.filter((s) => !s.ended) };
}

async function start(speech = fakeSpeech(), price = 0.36 * EUR) {
  const t = { now: 1_800_000_000_000 };
  const server = await createServer({
    adminPassword: ADMIN,
    secret: SECRET,
    dbFile: ':memory:',
    speech: speech.connect,
    streams: 5,
    defaults: { pricePerHour: price, monthlyLimit: 5 * EUR, globalLimit: 20 * EUR },
    trustProxy: false,
    now: () => t.now,
  });
  await server.app.listen({ port: 0, host: '127.0.0.1' });
  const addr = server.app.server.address();
  const url = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  closers.push(() => server.close());
  const post = async (path: string, body: unknown, cookie = '') => {
    const r = await fetch(url + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: url, cookie },
      body: JSON.stringify(body),
    });
    return {
      status: r.status,
      json: (await r.json()) as Record<string, unknown>,
      cookie: r.headers.get('set-cookie') ?? '',
    };
  };
  const admin = (await post('/admin/login', { password: ADMIN })).cookie.split(';')[0]!;
  /** Invites someone and signs a device in for them with a code: their cookie. */
  const person = async (name: string) => {
    const inv = await post('/admin/api/invite', { name }, admin);
    const id = (inv.json.person as { id: number }).id;
    const code = await post('/admin/api/signin-code', { id }, admin);
    const signed = await post('/api/signin/code', { digits: code.json.digits });
    return { id, cookie: signed.cookie.split(';')[0]! };
  };
  const sock = (opts: { cookie?: string; code?: string }) => {
    const s: Socket = connect(url, {
      transports: ['websocket'],
      extraHeaders: { origin: url, ...(opts.cookie ? { cookie: opts.cookie } : {}) },
      auth: opts.code ? { code: opts.code } : {},
      forceNew: true,
    });
    closers.push(() => {
      s.close();
      return Promise.resolve();
    });
    return s;
  };
  const get = async (path: string, cookie = '') => {
    const r = await fetch(url + path, { headers: { cookie } });
    return { status: r.status, json: (await r.json()) as Record<string, unknown> };
  };
  return { server, url, post, get, admin, person, sock, speech, t };
}

const next = <T>(s: Socket, ev: string, ok: (v: T) => boolean = () => true) =>
  new Promise<T>((res) => {
    const on = (v: T) => {
      if (!ok(v)) return;
      s.off(ev, on);
      res(v);
    };
    s.on(ev, on);
  });
const ask = (s: Socket, ev: string, ...args: unknown[]) =>
  s.timeout(2000).emitWithAck(ev, ...args) as Promise<Ack>;

describe('signing in', () => {
  it('a code works once; a wrong one is refused; the welcome credit comes with the invitation', async () => {
    const { post, admin } = await start();
    const inv = await post('/admin/api/invite', { name: 'Jan Kowalski' }, admin);
    const id = (inv.json.person as { id: number }).id;
    const code = await post('/admin/api/signin-code', { id }, admin);
    expect(String(code.json.digits)).toMatch(/^\d{6}$/);
    const wrong = String((Number(code.json.digits) + 1) % 1_000_000).padStart(6, '0');
    expect((await post('/api/signin/code', { digits: wrong })).status).toBe(401);
    const ok = await post('/api/signin/code', { digits: code.json.digits });
    expect(ok.status).toBe(200);
    expect((await post('/api/signin/code', { digits: code.json.digits })).status).toBe(401);
    expect(ok.cookie).toMatch(/^tr_device=[\w-]{40,};/);
    expect(ok.cookie).toContain('HttpOnly');
  });

  it('the QR link signs in too; the account shows the welcome €1', async () => {
    const { post, admin, url } = await start();
    const inv = await post('/admin/api/invite', { name: 'Ola' }, admin);
    const code = await post(
      '/admin/api/signin-code',
      { id: (inv.json.person as { id: number }).id },
      admin,
    );
    const signed = await post('/api/signin/code', { link: code.json.link });
    const me = await fetch(`${url}/api/me`, { headers: { cookie: signed.cookie.split(';')[0]! } });
    const body = (await me.json()) as { balance: number; history: { kind: string }[] };
    expect(body.balance).toBe(EUR);
    expect(body.history[0]!.kind).toBe('welcome');
  });

  it('the admin API needs the admin; POSTs from another site are refused', async () => {
    const { url, post } = await start();
    expect((await fetch(`${url}/admin/api/state`)).status).toBe(401);
    const r = await fetch(`${url}/admin/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
      body: JSON.stringify({ password: ADMIN }),
    });
    expect(r.status).toBe(403);
    expect((await post('/admin/login', { password: 'nope' })).status).toBe(401);
  });

  it('blocking someone signs their devices out', async () => {
    const { post, admin, person, url } = await start();
    const p = await person('Pablo');
    await post('/admin/api/person', { id: p.id, blocked: true }, admin);
    expect((await fetch(`${url}/api/me`, { headers: { cookie: p.cookie } })).status).toBe(401);
  });
});

describe('captions', () => {
  it('a host starts in one language: one stream; a reader with the code reads it, another language adds one', async () => {
    const { person, sock, speech } = await start();
    const p = await person('Marta');
    const host = sock({ cookie: p.cookie });
    const first = await next<SessionView>(host, 'state:session');
    expect(first.role).toBe('host');
    expect(first.code).toMatch(/^[A-Z2-9]{6}$/);
    expect(await ask(host, 'session:start', { lang: 'tl' })).toEqual({ ok: true });
    host.emit('host:audio', new Uint8Array(3200).buffer, {
      age: 0,
      seq: 1,
      stream: 'mic-aaaaaaaa',
    });
    await next(host, 'captions:ack');
    expect(speech.open().map((s) => s.target)).toEqual(['tl']);

    const reader = sock({ code: first.code! });
    const rv = await next<SessionView>(reader, 'state:session');
    expect(rv.role).toBe('reader');
    expect(rv.lang).toBe('tl'); // (the host's language first)
    expect(rv.code).toBeUndefined();
    expect(rv.balance).toBeUndefined();
    expect(await ask(reader, 'session:lang', { lang: 'pl' })).toEqual({ ok: true });
    expect(
      speech
        .open()
        .map((s) => s.target)
        .sort(),
    ).toEqual(['pl', 'tl']);

    // words come back: the reader gets its own language and what was heard
    const got = next<{ texts: Record<string, { lines: string[] }> }>(
      reader,
      'captions',
      (u) => !!u.texts.pl?.lines.length,
    );
    speech
      .open()
      .find((s) => s.target === 'pl')!
      .events.tokens([
        { text: 'Dzień dobry wszystkim.', translation_status: 'translation' },
        { text: '<end>' },
      ]);
    expect((await got).texts.pl!.lines).toEqual(['Dzień dobry wszystkim.']);
  });

  it('a wrong code lets nobody in; a reader can never start or send audio', async () => {
    const { person, sock, speech } = await start();
    const bad = sock({ code: 'ZZZZZZ' });
    await expect(new Promise((_, rej) => bad.on('connect_error', rej))).rejects.toThrow(
      'no-session',
    );
    const p = await person('Marta');
    const host = sock({ cookie: p.cookie });
    const v = await next<SessionView>(host, 'state:session');
    const reader = sock({ code: v.code! });
    await next(reader, 'state:session');
    expect(await ask(reader, 'session:start', { lang: 'en' })).toEqual({
      ok: false,
      error: 'not-host',
    });
    reader.emit('host:audio', new Uint8Array(3200).buffer, {
      age: 0,
      seq: 1,
      stream: 'mic-bbbbbbbb',
    });
    await new Promise((r) => setTimeout(r, 100));
    expect(speech.streams).toHaveLength(0);
  });

  it('no translation: one stream without one, what is heard only', async () => {
    const { person, sock, speech } = await start();
    const host = sock({ cookie: (await person('Marta')).cookie });
    await next(host, 'state:session');
    expect(await ask(host, 'session:start', { lang: null })).toEqual({ ok: true });
    host.emit('host:audio', new Uint8Array(3200).buffer, {
      age: 0,
      seq: 1,
      stream: 'mic-cccccccc',
    });
    await next(host, 'captions:ack');
    expect(speech.open().map((s) => s.target)).toEqual([HEARD]);
  });

  it('a session reads at most three translations', async () => {
    const { person, sock } = await start();
    const host = sock({ cookie: (await person('Marta')).cookie });
    const v = await next<SessionView>(host, 'state:session');
    await ask(host, 'session:start', { lang: 'en' });
    const langs = ['pl', 'es', 'de'];
    const results: Ack[] = [];
    for (const l of langs) {
      const r = sock({ code: v.code! });
      await next(r, 'state:session');
      results.push(await ask(r, 'session:lang', { lang: l }));
    }
    expect(results).toEqual([{ ok: true }, { ok: true }, { ok: false, error: 'too-many-langs' }]);
  });

  it(
    'the credits pay for every stream; at zero the session stops and says why',
    { timeout: 20_000 },
    async () => {
      // (€3.60 an hour per stream: the €1 welcome lasts 1000 s with one stream)
      const { person, sock, t } = await start(fakeSpeech(), 3.6 * EUR);
      const p = await person('Marta');
      const host = sock({ cookie: p.cookie });
      await next(host, 'state:session');
      await ask(host, 'session:start', { lang: 'en' });
      const stopped = next<SessionView>(host, 'state:session', (s) => s.stopped === 'credits');
      // 1001 s of audio in 1 s chunks, the clock moving with it (each chunk confirmed before the
      // next: the engine paces kept audio at twice real time)
      for (let i = 1; i <= 1_001; i++) {
        t.now += 1000;
        const acked = next(host, 'captions:ack');
        host.emit('host:audio', new Uint8Array(32_000).buffer, {
          age: 0,
          seq: i,
          stream: 'mic-dddddddd',
        });
        await acked;
      }
      const s = await stopped;
      expect(s.running).toBe(false);
      expect(s.balance).toBeLessThanOrEqual(0);
      expect(await ask(host, 'session:start', { lang: 'en' })).toEqual({
        ok: false,
        error: 'credits',
      });
    },
  );
});

describe('audit 30', () => {
  it('an encoded address never gets round the admin gate', async () => {
    const { url, post, person } = await start();
    const p = await person('Marta');
    for (const path of ['/admin/%61pi/state', '/%61dmin/api/state', '/admin/ap%69/state']) {
      expect((await fetch(url + path)).status).toBe(401);
    }
    expect((await post('/admin/%61pi/signin-code', { id: p.id })).status).toBe(401);
    expect((await post('/admin/%61pi/grant', { personId: p.id, amount: EUR })).status).toBe(401);
  });

  it("a grant for a request must be that person's waiting request, once", async () => {
    const { post, get, admin, person } = await start();
    const a = await person('Marta');
    const b = await person('Ola');
    expect((await post('/api/ask', { amount: 2 * EUR }, a.cookie)).status).toBe(200);
    const st = await get('/admin/api/state', admin);
    const id = (st.json.requests as { id: number }[])[0]!.id;
    const grant = (personId: number) =>
      post('/admin/api/grant', { personId, amount: 2 * EUR, requestId: id }, admin);
    expect((await grant(b.id)).status).toBe(409);
    expect((await grant(a.id)).status).toBe(200);
    expect((await grant(a.id)).status).toBe(409); // (a double tap adds nothing)
    const me = await get('/api/me', a.cookie);
    expect(me.json.balance).toBe(3 * EUR);
  });

  it("an email link has no digits to type; the admin's code stays", async () => {
    const { server, post, admin, person } = await start();
    const p = await person('Marta');
    const code = await post('/admin/api/signin-code', { id: p.id }, admin);
    server.store.newCode(p.id, 15 * 60_000, false);
    const rows = server.store.db.prepare('select digits_hash from codes').all() as {
      digits_hash: string;
    }[];
    expect(rows.filter((r) => r.digits_hash.startsWith('none.'))).toHaveLength(1);
    expect((await post('/api/signin/code', { digits: code.json.digits })).status).toBe(200);
  });

  it('signing a device out closes its page; deleting an account mid-session stops it, the server goes on', async () => {
    const { post, person, sock, speech } = await start();
    const p = await person('Marta');
    const host = sock({ cookie: p.cookie });
    await next(host, 'state:session');
    const gone = new Promise((r) => host.on('disconnect', r));
    await post('/api/signout', {}, p.cookie);
    await gone;

    const q = await person('Ola');
    const h2 = sock({ cookie: q.cookie });
    const v = await next<SessionView>(h2, 'state:session');
    await ask(h2, 'session:start', { lang: 'en' });
    h2.emit('host:audio', new Uint8Array(3200).buffer, { age: 0, seq: 1, stream: 'mic-eeeeeeee' });
    await next(h2, 'captions:ack');
    const reader = sock({ code: v.code! });
    await next(reader, 'state:session');
    const closed = new Promise((r) => h2.on('disconnect', r));
    expect((await post('/api/delete-account', {}, q.cookie)).status).toBe(200);
    await closed;
    // its code lets nobody in any more; the server still answers
    const again = sock({ code: v.code! });
    await expect(new Promise((_, rej) => again.on('connect_error', rej))).rejects.toThrow(
      'no-session',
    );
    expect(speech.open()).toHaveLength(0);
    const r = await person('Pia');
    expect(r.cookie).toMatch(/^tr_device=/);
  });

  it('readers reconnecting often are never locked out; wrong codes are', async () => {
    const { person, sock } = await start();
    const host = sock({ cookie: (await person('Marta')).cookie });
    const v = await next<SessionView>(host, 'state:session');
    for (let i = 0; i < 25; i++) {
      const r = sock({ code: v.code! });
      await next(r, 'state:session');
      r.close();
    }
    for (let i = 0; i < 20; i++) {
      const bad = sock({ code: 'ZZZZZZ' });
      await new Promise((res) => bad.on('connect_error', res));
    }
    const late = sock({ code: v.code! });
    await expect(new Promise((_, rej) => late.on('connect_error', rej))).rejects.toThrow(
      'too-many',
    );
  });
});
