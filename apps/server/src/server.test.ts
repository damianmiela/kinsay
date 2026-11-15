import { afterEach, describe, expect, it } from 'vitest';
import { io as connect, type Socket } from 'socket.io-client';
import { EUR, HEARD, type Ack, type CaptionsUpdate, type SessionView } from '@translate/shared';
import { createServer, type Config } from './server';
import type { SpeechConnect, SpeechEvents, SpeechStream } from '@translate/engine';
import type { UsageSource } from './usage';

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

async function start(speech = fakeSpeech(), price = 0.36 * EUR, extra: Partial<Config> = {}) {
  const t = { now: 1_800_000_000_000 };
  const server = await createServer({
    adminPassword: ADMIN,
    secret: SECRET,
    dbFile: ':memory:',
    speech: speech.connect,
    streams: 5,
    defaults: { pricePerHour: price, monthlyLimit: 5 * EUR, globalLimit: 20 * EUR, streamShare: 5 },
    trustProxy: false,
    now: () => t.now,
    ...extra,
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
  const sock = (opts: { cookie?: string; code?: string; ua?: string }) => {
    const s: Socket = connect(url, {
      transports: ['websocket'],
      extraHeaders: {
        origin: url,
        ...(opts.cookie ? { cookie: opts.cookie } : {}),
        ...(opts.ua ? { 'user-agent': opts.ua } : {}),
      },
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

describe('both sides of a call (batch 9)', () => {
  it('the microphone in its own streams; the two sides merged, each line with its side', async () => {
    const { person, sock, speech } = await start();
    const host = sock({ cookie: (await person('Marta')).cookie });
    await next<SessionView>(host, 'state:session');
    await ask(host, 'session:start', { lang: 'en' });
    expect(await ask(host, 'session:bothSides', { on: true })).toEqual({ ok: true });
    const audio = (seq: number, side?: 'you') =>
      host.emit('host:audio', new Uint8Array(3200).buffer, {
        age: 0,
        seq,
        stream: side ? 'mic-bbbbbbbb' : 'mic-aaaaaaaa',
        ...(side ? { side } : {}),
      });
    audio(1);
    await next(host, 'captions:ack');
    audio(1, 'you');
    await next(host, 'captions:ack');
    const [call, you] = speech.open();
    expect(speech.open().map((x) => x.target)).toEqual(['en', 'en']);
    call!.events.tokens([
      { text: ' How was the trip?', translation_status: 'none' },
      { text: '<end>' },
    ]);
    you!.events.tokens([
      { text: ' Long, but fine.', translation_status: 'none' },
      { text: '<end>' },
    ]);
    const u = await next<CaptionsUpdate>(
      host,
      'captions',
      (x) => (x.texts.en?.lines.length ?? 0) >= 2,
    );
    expect(u.texts.en!.lines).toEqual(['How was the trip?', 'Long, but fine.']);
    expect(u.texts.en!.speakers).toEqual({ 0: '2', 1: '1' });
    // off: the microphone's streams end
    expect(await ask(host, 'session:bothSides', { on: false })).toEqual({ ok: true });
    expect(speech.open()).toHaveLength(1);
  });
});

describe('audit 36', () => {
  it('the who-said-what switch is limited per session (each switch starts its streams again)', async () => {
    const { person, sock } = await start();
    const host = sock({ cookie: (await person('Marta')).cookie });
    await next<SessionView>(host, 'state:session');
    const results = [];
    for (let i = 0; i < 7; i++)
      results.push(await ask(host, 'session:speakers', { on: i % 2 === 0 }));
    expect(results.slice(0, 6).every((r) => r.ok)).toBe(true);
    expect(results[6]).toEqual({ ok: false, error: 'too-many' });
    // (asking for what is already on costs nothing)
    expect(await ask(host, 'session:speakers', { on: false })).toEqual({ ok: true });
  });
});

describe('audit 31', () => {
  /** Wrong admin logins, each claiming another address: how many got past the brake. */
  const tries = async (url: string) => {
    let refused = 0;
    for (let i = 0; i < 12; i++) {
      const r = await fetch(url + '/admin/login', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: url,
          'x-forwarded-for': `203.0.113.${i}`,
        },
        body: JSON.stringify({ password: 'wrong' }),
      });
      if (r.status === 429) refused++;
    }
    return refused;
  };

  it("only the proxy's own X-Forwarded-For counts; another container's is its own address", async () => {
    const other = await start(fakeSpeech(), 0.36 * EUR, { trustProxy: (a) => a === '10.0.0.99' });
    expect(await tries(other.url)).toBeGreaterThan(0);
    const proxy = await start(fakeSpeech(), 0.36 * EUR, { trustProxy: (a) => a === '127.0.0.1' });
    expect(await tries(proxy.url)).toBe(0);
  });

  it('cookies are Secure whenever the public address is https', async () => {
    const { post } = await start(fakeSpeech(), 0.36 * EUR, {
      publicUrl: 'https://translate.example.com',
    });
    expect((await post('/admin/login', { password: ADMIN })).cookie).toMatch(/;\s*Secure/i);
  });
});

describe('the privacy page', () => {
  it('an invitation request keeps its name and email only while it waits', async () => {
    const { server, post, admin } = await start();
    const rows = () =>
      server.store.db.prepare(`select count(*) n from requests where kind = 'invite'`).get() as {
        n: number;
      };
    await post('/api/invite-request', { name: 'Ola', email: 'ola@example.com' });
    await post('/api/invite-request', { name: 'Ula', email: 'ula@example.com' });
    expect(rows().n).toBe(2);
    const id = (
      server.store.waitingRequests().find((r) => r.email === 'ula@example.com') as {
        id: number;
      }
    ).id;
    await post('/admin/api/decline', { requestId: id }, admin);
    await post('/admin/api/invite', { name: 'Ola', email: 'ola@example.com' }, admin);
    expect(rows().n).toBe(0);
  });

  it('is a page anyone may open; the config names who is responsible', async () => {
    const { get } = await start(fakeSpeech(), 0.36 * EUR, {
      contact: { name: 'A. Example', email: 'privacy@example.com' },
    });
    expect((await get('/api/config')).json.contact).toEqual({
      name: 'A. Example',
      email: 'privacy@example.com',
    });
  });
});

describe("the desktop app's sign-in", () => {
  it('the window asks, the browser signed in says yes with the same digits, the window gets a device', async () => {
    const { post, get, person } = await start();
    const p = await person('Marta');
    const w = await post('/api/app-signin/start', {});
    const { poll, token, digits } = w.json as { poll: string; token: string; digits: string };
    expect(digits).toMatch(/^\d{6}$/);
    // nobody signed in can't see or answer it
    expect((await post('/api/app-signin/ask', { token })).status).toBe(401);
    expect((await post('/api/app-signin/answer', { token, yes: true })).status).toBe(401);
    expect((await post('/api/app-signin/poll', { poll })).json.state).toBe('waiting');
    // the browser: the same digits, then yes (once)
    expect((await post('/api/app-signin/ask', { token }, p.cookie)).json.digits).toBe(digits);
    expect((await post('/api/app-signin/answer', { token, yes: true }, p.cookie)).status).toBe(200);
    expect((await post('/api/app-signin/answer', { token, yes: true }, p.cookie)).status).toBe(404);
    // the window: signed in as her, once; the browser's token alone never signs anyone in
    expect((await post('/api/app-signin/poll', { poll: token })).json.state).toBe('gone');
    const done = await post('/api/app-signin/poll', { poll });
    expect(done.json.state).toBe('yes');
    const cookie = done.cookie.split(';')[0]!;
    expect((await get('/api/me', cookie)).json.name).toBe('Marta');
    expect((await post('/api/app-signin/poll', { poll })).json.state).toBe('gone');
  });

  it('no in the browser: the window is told no; an ask ends after 10 minutes', async () => {
    const { post, person, t } = await start();
    const p = await person('Marta');
    const a = (await post('/api/app-signin/start', {})).json as { poll: string; token: string };
    await post('/api/app-signin/answer', { token: a.token, yes: false }, p.cookie);
    expect((await post('/api/app-signin/poll', { poll: a.poll })).json.state).toBe('no');
    const b = (await post('/api/app-signin/start', {})).json as { poll: string; token: string };
    t.now += 10 * 60_000 + 1;
    expect((await post('/api/app-signin/ask', { token: b.token }, p.cookie)).status).toBe(404);
    expect((await post('/api/app-signin/poll', { poll: b.poll })).json.state).toBe('gone');
  });
});

describe('audit 32', () => {
  /** A POST from a given address (the test server trusts X-Forwarded-For here). */
  const from =
    (url: string) =>
    async (path: string, body: unknown, ip: string, cookie = '') => {
      const r = await fetch(url + path, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: url, cookie, 'x-forwarded-for': ip },
        body: JSON.stringify(body),
      });
      return { status: r.status, json: (await r.json()) as Record<string, unknown> };
    };

  it("a link sent to someone else never signs the sender's app in as them", async () => {
    const { url, person } = await start(fakeSpeech(), 0.36 * EUR, { trustProxy: true });
    const p = await person('Marta');
    const at = from(url);
    const a = (await at('/api/app-signin/start', {}, '198.51.100.7')).json as {
      poll: string;
      token: string;
    };
    // the victim, elsewhere: told so, and a yes is refused; a no still counts
    expect(
      (await at('/api/app-signin/ask', { token: a.token }, '203.0.113.9', p.cookie)).json.elsewhere,
    ).toBe(true);
    expect(
      (await at('/api/app-signin/answer', { token: a.token, yes: true }, '203.0.113.9', p.cookie))
        .status,
    ).toBe(403);
    expect((await at('/api/app-signin/poll', { poll: a.poll }, '198.51.100.7')).json.state).toBe(
      'waiting',
    );
    // the same computer: fine
    expect(
      (await at('/api/app-signin/ask', { token: a.token }, '198.51.100.7', p.cookie)).json
        .elsewhere,
    ).toBe(false);
    expect(
      (await at('/api/app-signin/answer', { token: a.token, yes: true }, '198.51.100.7', p.cookie))
        .status,
    ).toBe(200);
  });

  it('one address can hold only three waiting sign-ins (IPv6 per /48)', async () => {
    const { url } = await start(fakeSpeech(), 0.36 * EUR, { trustProxy: true });
    const at = from(url);
    const codes: number[] = [];
    for (let i = 0; i < 4; i++) {
      codes.push((await at('/api/app-signin/start', {}, `2001:db8:5:${i}::1`)).status);
    }
    expect(codes).toEqual([200, 200, 200, 429]);
    expect((await at('/api/app-signin/start', {}, '2001:db8:6::1')).status).toBe(200);
  });

  it('a browser tab already signed in as them gets no second device', async () => {
    const { post, get, person } = await start();
    const p = await person('Marta');
    const a = (await post('/api/app-signin/start', {})).json as { poll: string; token: string };
    await post('/api/app-signin/answer', { token: a.token, yes: true }, p.cookie);
    const done = await post('/api/app-signin/poll', { poll: a.poll }, p.cookie);
    expect(done.json.state).toBe('yes');
    expect(done.cookie).toBe('');
    expect(((await get('/api/me', p.cookie)).json.devices as unknown[]).length).toBe(1);
  });
});

describe('sessions stop by themselves (as /live did)', () => {
  /** A host with a session running; `words` sends audio (as a microphone does) and words back. */
  const running = async () => {
    const env = await start();
    const p = await env.person('Marta');
    const host = env.sock({ cookie: p.cookie });
    const first = await next<SessionView>(host, 'state:session');
    expect(await ask(host, 'session:start', { lang: 'pl' })).toEqual({ ok: true });
    let seq = 0;
    const audio = async () => {
      host.emit('host:audio', new Uint8Array(3200).buffer, {
        age: 0,
        seq: ++seq,
        stream: 'mic-aaaaaaaa',
      });
      await next(host, 'captions:ack');
    };
    await audio();
    const words = async (text: string) => {
      await audio();
      // (stopped meanwhile: no stream to speak through)
      env.speech
        .open()[0]
        ?.events.tokens([{ text, translation_status: 'translation' }, { text: '<end>' }]);
    };
    return { ...env, host, words, code: first.code! };
  };

  it('15 minutes without words: stopped, and the host is told why', async () => {
    const { server, host, words, t } = await running();
    t.now += 14 * 60_000;
    await words('Jeszcze tu jestem.');
    t.now += 14 * 60_000;
    server.realtime.checkStops();
    t.now += 60_000 + 1;
    const gone = next<SessionView>(host, 'state:session', (v) => !v.running);
    server.realtime.checkStops();
    expect((await gone).stopped).toBe('quiet');
  });

  it('after 4 hours: asked first ("Still listening?"); Keep going gives 4 more; else stopped', async () => {
    const { server, host, words, t } = await running();
    const talk = async (minutes: number) => {
      for (let m = 0; m < minutes; m += 10) {
        t.now += 10 * 60_000;
        await words('Dalej rozmawiamy.');
        server.realtime.checkStops();
      }
    };
    await talk(220); // (3 h 40 min: no question yet)
    const askedAt = next<SessionView>(host, 'state:session', (v) => !!v.stopsAt);
    await talk(10);
    const v = await askedAt;
    expect(v.running).toBe(true);
    expect(v.stopsAt! - t.now).toBeLessThanOrEqual(10 * 60_000);
    const kept = next<SessionView>(host, 'state:session', (x) => x.running && !x.stopsAt);
    expect(await ask(host, 'session:keepGoing')).toEqual({ ok: true });
    await kept;
    await talk(230); // (past the first 4 hours: still running)
    const stopped = next<SessionView>(host, 'state:session', (x) => !x.running);
    await talk(20);
    expect((await stopped).stopped).toBe('hours');
  });

  it('a reader can never keep a session going', async () => {
    const { sock, code } = await running();
    const reader = sock({ code });
    await next(reader, 'state:session');
    expect(await ask(reader, 'session:keepGoing')).toEqual({ ok: false, error: 'not-host' });
  });
});

describe('a language nobody reads stays a while (as /live did)', () => {
  const session = async () => {
    const env = await start();
    const p = await env.person('Marta');
    const host = env.sock({ cookie: p.cookie });
    const first = await next<SessionView>(host, 'state:session');
    expect(await ask(host, 'session:start', { lang: 'tl' })).toEqual({ ok: true });
    host.emit('host:audio', new Uint8Array(3200).buffer, {
      age: 0,
      seq: 1,
      stream: 'mic-aaaaaaaa',
    });
    await next(host, 'captions:ack');
    const reader = async (lang: string) => {
      const r = env.sock({ code: first.code! });
      await next(r, 'state:session');
      expect(await ask(r, 'session:lang', { lang })).toEqual({ ok: true });
      return r;
    };
    const targets = () =>
      env.speech
        .open()
        .map((s) => s.target)
        .sort();
    return { ...env, host, reader, targets, code: first.code! };
  };
  const gone = (s: Socket) =>
    new Promise<void>((ok) => {
      s.once('disconnect', () => setTimeout(ok, 50));
      s.close();
    });

  it('its last reader leaves: kept 10 minutes with its lines, then its stream ends', async () => {
    const { server, reader, targets, speech, sock, t, code } = await session();
    const r = await reader('pl');
    expect(targets()).toEqual(['pl', 'tl']);
    speech
      .open()
      .find((s) => s.target === 'pl')!
      .events.tokens([
        { text: 'Dzień dobry.', translation_status: 'translation' },
        { text: '<end>' },
      ]);
    await gone(r);
    expect(targets()).toEqual(['pl', 'tl']); // (kept)
    // back within the 10 minutes: what was said is there
    t.now += 5 * 60_000;
    const again = sock({ code });
    await next(again, 'state:session');
    const lines = next<{ texts: Record<string, { lines: string[] }> }>(
      again,
      'captions',
      (u) => !!u.texts.pl,
    );
    expect(await ask(again, 'session:lang', { lang: 'pl' })).toEqual({ ok: true });
    expect((await lines).texts.pl!.lines).toEqual(['Dzień dobry.']);
    await gone(again);
    // (someone still talks: the session itself goes on)
    t.now += 6 * 60_000;
    speech
      .open()
      .find((x) => x.target === 'tl')!
      .events.tokens([{ text: 'Kumusta.', translation_status: 'translation' }, { text: '<end>' }]);
    t.now += 4 * 60_000 + 1;
    server.realtime.checkStops();
    expect(targets()).toEqual(['tl']);
  });

  it('a kept language makes room for a new one (three at most)', async () => {
    const { reader, targets } = await session();
    await reader('pl');
    const es = await reader('es');
    await gone(es); // (es kept: three in all)
    expect(targets()).toEqual(['es', 'pl', 'tl']);
    await reader('de');
    expect(targets()).toEqual(['de', 'pl', 'tl']);
  });
});

describe('pages from one address (as /live did)', () => {
  it('50 at most: the next is refused and says so; another address is fine; one closed lets one in', async () => {
    const { url, person } = await start(fakeSpeech(), 0.36 * EUR, { trustProxy: true });
    const p = await person('Marta');
    const open = (ip: string) =>
      new Promise<Socket | string>((ok) => {
        const s: Socket = connect(url, {
          transports: ['websocket'],
          forceNew: true,
          reconnection: false,
          extraHeaders: { origin: url, cookie: p.cookie, 'x-forwarded-for': ip },
        });
        closers.push(() => {
          s.close();
          return Promise.resolve();
        });
        s.once('connect', () => ok(s));
        s.once('connect_error', (e) => ok(e.message));
      });
    const pages: (Socket | string)[] = [];
    for (let i = 0; i < 50; i++) pages.push(await open('198.51.100.7'));
    expect(pages.every((x) => typeof x !== 'string')).toBe(true);
    expect(await open('198.51.100.7')).toBe('too-many-pages');
    expect(typeof (await open('203.0.113.9'))).not.toBe('string');
    (pages[0] as Socket).close();
    await new Promise((r) => setTimeout(r, 100));
    expect(typeof (await open('198.51.100.7'))).not.toBe('string');
  });
});

describe('face to face, two-way (mockups batch 3)', () => {
  it("a host's page reads two languages: both halves' captions come; a reader's other is ignored", async () => {
    const { person, sock, speech } = await start();
    const p = await person('Marta');
    const host = sock({ cookie: p.cookie });
    const first = await next<SessionView>(host, 'state:session');
    expect(await ask(host, 'session:start', { lang: 'en', other: 'pl' })).toEqual({ ok: true });
    host.emit('host:audio', new Uint8Array(3200).buffer, {
      age: 0,
      seq: 1,
      stream: 'mic-aaaaaaaa',
    });
    await next(host, 'captions:ack');
    expect(
      speech
        .open()
        .map((s) => s.target)
        .sort(),
    ).toEqual(['en', 'pl']);
    const both = next<{ texts: Record<string, { lines: string[] }> }>(
      host,
      'captions',
      (u) => !!u.texts.pl?.lines.length && !!u.texts.en?.lines.length,
    );
    for (const [target, text] of [
      ['pl', 'Zostaniecie na weekend?'],
      ['en', 'Are you staying the weekend?'],
    ] as const) {
      speech
        .open()
        .find((s) => s.target === target)!
        .events.tokens([{ text, translation_status: 'translation' }, { text: '<end>' }]);
    }
    const u = await both;
    expect(u.texts.pl!.lines).toEqual(['Zostaniecie na weekend?']);
    expect(u.texts.en!.lines).toEqual(['Are you staying the weekend?']);
    // the host's second page gets both languages back
    const again = sock({ cookie: p.cookie });
    const v = await next<SessionView>(again, 'state:session');
    expect([v.lang, v.other]).toEqual(['en', 'pl']);
    // a reader reads one language: an "other" from a reader does nothing
    const reader = sock({ code: first.code! });
    await next(reader, 'state:session');
    const rv = next<SessionView>(reader, 'state:session');
    expect(await ask(reader, 'session:lang', { lang: 'de', other: 'es' })).toEqual({ ok: true });
    expect((await rv).other).toBeUndefined();
    expect(speech.open().map((s) => s.target)).not.toContain('es');
  });

  it("back to one column: the top half's language goes", async () => {
    const { person, sock, speech } = await start();
    const p = await person('Marta');
    const host = sock({ cookie: p.cookie });
    await next(host, 'state:session');
    await ask(host, 'session:start', { lang: 'en', other: 'pl' });
    host.emit('host:audio', new Uint8Array(3200).buffer, {
      age: 0,
      seq: 1,
      stream: 'mic-aaaaaaaa',
    });
    await next(host, 'captions:ack');
    const v = next<SessionView>(host, 'state:session', (x) => x.other === undefined);
    expect(await ask(host, 'session:lang', { lang: 'en' })).toEqual({ ok: true });
    expect((await v).lang).toBe('en');
    expect(speech.open().map((s) => s.target)).toContain('en');
  });
});

describe('which microphone listens (mockups batch 3)', () => {
  const PHONE_UA =
    'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/131.0 Mobile Safari/537.36';
  const PC_UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36';
  const audio = (s: Socket, seq: number) =>
    s.emit('host:audio', new Uint8Array(3200).buffer, { age: 0, seq, stream: 'mic-' + s.id });

  it('the other pages see where it listens; "Use this one" moves it; gone, nobody listens', async () => {
    const { person, sock, server, t } = await start();
    const p = await person('Marta');
    const phone = sock({ cookie: p.cookie, ua: PHONE_UA });
    const pc = sock({ cookie: p.cookie, ua: PC_UA });
    await Promise.all([next(phone, 'state:session'), next(pc, 'state:session')]);
    const seen = next<SessionView>(pc, 'state:session', (v) => !!v.mic);
    await ask(phone, 'session:start', { lang: 'pl' });
    expect((await seen).mic).toEqual({ here: false, on: 'phone' });
    // the computer takes over: the phone sees it, and its audio no longer counts
    const moved = next<SessionView>(phone, 'state:session', (v) => v.mic?.here === false);
    expect(await ask(pc, 'session:useMic')).toEqual({ ok: true });
    expect((await moved).mic).toEqual({ here: false, on: 'computer' });
    audio(phone, 1); // (not used: the computer listens)
    // the computer's page went quiet: after a while nobody listens, every page says so
    audio(pc, 1);
    await next(pc, 'captions:ack');
    const none = next<SessionView>(phone, 'state:session', (v) => v.running && !v.mic);
    t.now += 11_000;
    server.realtime.checkStops();
    await none;
    // a reader never learns where it listens; a page that closes leaves nobody listening
    const back = next<SessionView>(pc, 'state:session', (v) => !!v.mic);
    audio(phone, 2);
    expect((await back).mic).toEqual({ here: false, on: 'phone' });
    const left = next<SessionView>(pc, 'state:session', (v) => v.running && !v.mic);
    phone.close();
    await left;
  });

  it('a page chosen by "Use this one" keeps it while its microphone opens (audit 33)', async () => {
    const { person, sock, t } = await start();
    const p = await person('Marta');
    const phone = sock({ cookie: p.cookie, ua: PHONE_UA });
    const pc = sock({ cookie: p.cookie, ua: PC_UA });
    await Promise.all([next(phone, 'state:session'), next(pc, 'state:session')]);
    await ask(phone, 'session:start', { lang: 'pl' });
    const moved = next<SessionView>(phone, 'state:session', (v) => v.mic?.here === false);
    await ask(pc, 'session:useMic');
    await moved;
    // 3 s later the computer's microphone still opens; a late chunk from the phone doesn't take it
    t.now += 3_000;
    let back = false;
    phone.on('state:session', (v: SessionView) => {
      if (v.mic?.here) back = true;
    });
    audio(phone, 1);
    audio(pc, 1);
    await next(pc, 'captions:ack');
    expect(back).toBe(false);
  });

  it('a reader may not take the microphone', async () => {
    const { person, sock } = await start();
    const p = await person('Marta');
    const host = sock({ cookie: p.cookie });
    const v = await next<SessionView>(host, 'state:session');
    await ask(host, 'session:start', { lang: 'pl' });
    const reader = sock({ code: v.code });
    const rv = await next<SessionView>(reader, 'state:session');
    expect(rv.mic).toBeUndefined();
    expect(await ask(reader, 'session:useMic')).toEqual({ ok: false, error: 'not-host' });
  });
});

describe('the code and what readers see (mockups batch 3)', () => {
  it('a code lasts a day from the last Start, never out mid-session; always with a letter', async () => {
    const { person, sock, t } = await start();
    const p = await person('Marta');
    const host = sock({ cookie: p.cookie });
    const v = await next<SessionView>(host, 'state:session');
    expect(v.code).toMatch(/[A-Z]/);
    t.now += 23 * 3_600_000;
    const started = next<SessionView>(host, 'state:session', (x) => x.running);
    await ask(host, 'session:start', { lang: 'pl' });
    const s = await started;
    expect(s.code).toBe(v.code);
    expect(s.codeUntil).toBe(t.now + 24 * 3_600_000);
    // 25 h after the code was made, the session still runs: a reader gets in
    t.now += 2 * 3_600_000;
    const reader = sock({ code: v.code });
    expect((await next<SessionView>(reader, 'state:session')).running).toBe(true);
    // stopped, and a day after its last Start: the code no longer lets anyone in
    const stopped = next<SessionView>(reader, 'state:session', (x) => !x.running);
    await ask(host, 'session:stop');
    expect((await stopped).stoppedAt).toBe(t.now);
    t.now += 23 * 3_600_000;
    const late = sock({ code: v.code });
    const err = await new Promise<Error>((res) => late.once('connect_error', res));
    expect(err.message).toBe('no-session');
  });

  it('stopped, a reader of a full session leaves: the others are told (audit 33)', async () => {
    const { person, sock } = await start();
    const p = await person('Marta');
    const host = sock({ cookie: p.cookie });
    const v = await next<SessionView>(host, 'state:session');
    await ask(host, 'session:start', { lang: 'pl' });
    const readers = [sock({ code: v.code }), sock({ code: v.code })];
    await Promise.all(readers.map((r) => next(r, 'state:session')));
    for (const [i, r] of readers.entries()) await ask(r, 'session:lang', { lang: ['en', 'de'][i] });
    const stopped = next<SessionView>(readers[0]!, 'state:session', (x) => !x.running);
    await ask(host, 'session:stop');
    expect((await stopped).full).toBeDefined();
    const freed = next<SessionView>(readers[0]!, 'state:session', (x) => !x.full);
    readers[1]!.close();
    expect((await freed).full).toBeUndefined();
  });

  it('a session with three languages tells its pages which', async () => {
    const { person, sock } = await start();
    const p = await person('Marta');
    const host = sock({ cookie: p.cookie });
    const v = await next<SessionView>(host, 'state:session');
    await ask(host, 'session:start', { lang: 'pl' });
    const a = sock({ code: v.code });
    await next(a, 'state:session');
    await ask(a, 'session:lang', { lang: 'en' });
    const b = sock({ code: v.code });
    await next(b, 'state:session');
    const full = next<SessionView>(b, 'state:session', (x) => !!x.full);
    await ask(a, 'session:lang', { lang: 'de' }); // (still two: en went)
    expect(await ask(b, 'session:lang', { lang: 'es' })).toEqual({ ok: true });
    expect([...(await full).full!].sort()).toEqual(['de', 'es', 'pl']);
    expect(await ask(b, 'session:lang', { lang: 'fr' })).toEqual({
      ok: false,
      error: 'too-many-langs',
    });
  });
});

const TOKEN = 'guest-page-token-0001';

describe('both sides of a call: a guest on the host balance (mockups batch 4)', () => {
  const audio = (s: Socket, seq: number) =>
    s.emit('host:audio', new Uint8Array(3200).buffer, { age: 0, seq, stream: 'mic-' + s.id });
  async function session() {
    const env = await start();
    const p = await env.person('Marta');
    const host = env.sock({ cookie: p.cookie });
    const v = await next<SessionView>(host, 'state:session');
    await ask(host, 'session:start', { lang: 'en' });
    audio(host, 1);
    await next(host, 'captions:ack');
    const guest = env.sock({ code: v.code });
    await next(guest, 'state:session');
    return { ...env, p, host, guest, code: v.code! };
  }

  it('only with the host switch on; then her own stream, her captions only to her', async () => {
    const { host, guest, speech } = await session();
    expect(await ask(guest, 'guest:start', { lang: 'tl', token: TOKEN })).toEqual({
      ok: false,
      error: 'guest-off',
    });
    const allowed = next<SessionView>(guest, 'state:session', (v) => !!v.guestAllowed);
    expect(await ask(host, 'session:guestAllow', { on: true })).toEqual({ ok: true });
    await allowed;
    const told = next<SessionView>(host, 'state:session', (v) => !!v.guestRunning);
    const mine = next<SessionView>(guest, 'state:session', (v) => v.role === 'guest' && v.running);
    expect(await ask(guest, 'guest:start', { lang: 'tl', token: TOKEN })).toEqual({ ok: true });
    await Promise.all([told, mine]);
    // her computer's sound opens her own stream (Tagalog) and goes to it only; her reading
    // language (the host's English) left the host's streams
    const en = speech.open().find((s) => s.target === 'en')!;
    const enBytes = en.bytes;
    audio(guest, 1);
    await next(guest, 'captions:ack');
    expect(speech.open().map((s) => s.target)).toEqual(['en', 'tl']);
    const tl = speech.open().find((s) => s.target === 'tl')!;
    expect(tl.bytes).toBe(3200);
    expect(en.bytes).toBe(enBytes);
    // a host's page never gets her captions; she never gets the host's
    let hostSawTl = false;
    host.on('captions', (u: { texts: Record<string, unknown> }) => {
      if (u.texts.tl) hostSawTl = true;
    });
    tl.events.tokens([{ text: ' Kumusta.', translation_status: 'translation', is_final: true }]);
    const got = await next<{ texts: Record<string, { live: string }> }>(guest, 'captions', (u) =>
      String(u.texts.tl?.live ?? '').includes('Kumusta'),
    );
    expect(got.texts.en).toBeUndefined();
    expect(hostSawTl).toBe(false);
  });

  it('one guest at a time; the host stops hers or the whole session; a new code starts off', async () => {
    const { host, guest, sock, code, speech } = await session();
    await ask(host, 'session:guestAllow', { on: true });
    await ask(guest, 'guest:start', { lang: 'tl', token: TOKEN });
    const other = sock({ code });
    await next(other, 'state:session');
    expect(
      await ask(other, 'guest:start', { lang: 'de', token: 'another-page-token-0002' }),
    ).toEqual({
      ok: false,
      error: 'guest-taken',
    });
    // "Stop theirs": hers ends, the host's goes on
    audio(guest, 1);
    await next(guest, 'captions:ack');
    const ended = next<SessionView>(
      guest,
      'state:session',
      (v) => v.role === 'guest' && !v.running,
    );
    await ask(host, 'session:stopGuest');
    expect((await ended).stoppedAt).toBeDefined();
    expect(speech.open().map((s) => s.target)).toEqual(['en']);
    // she starts again; the host's Stop ends both, and she can't start while it's stopped
    await ask(guest, 'guest:start', { lang: 'tl', token: TOKEN });
    const both = next<SessionView>(guest, 'state:session', (v) => !v.running && !v.hostRunning);
    await ask(host, 'session:stop');
    await both;
    expect(await ask(guest, 'guest:start', { lang: 'tl', token: TOKEN })).toEqual({
      ok: false,
      error: 'host-not-running',
    });
    // a reader is no host: the host's actions stay the host's
    expect(await ask(other, 'session:guestAllow', { on: true })).toEqual({
      ok: false,
      error: 'not-host',
    });
    expect(await ask(other, 'session:stopGuest')).toEqual({ ok: false, error: 'not-host' });
  });

  it('her audio is paid from the host balance, her language named as the guest’s', async () => {
    const { host, guest, get, p, t } = await session();
    await ask(host, 'session:guestAllow', { on: true });
    await ask(guest, 'guest:start', { lang: 'tl', token: TOKEN });
    for (let i = 2; i < 12; i++) audio(guest, i);
    await next(guest, 'captions:ack', (n: number) => n === 11);
    t.now += 60_000;
    await ask(host, 'session:stop');
    const me = await get('/api/me', p.cookie);
    const use = (me.json.history as { kind: string; lang?: string; amount: number }[]).find(
      (h) => h.kind === 'use',
    )!;
    expect(use.lang).toContain('guest:tl');
    expect(use.amount).toBeLessThan(0);
  });

  it('audit 35: her reconnected page takes its place back; her words never keep the session from its quiet stop; stopped, she reads again', async () => {
    const { host, guest, sock, code, server, t } = await session();
    await ask(host, 'session:guestAllow', { on: true });
    expect(await ask(guest, 'guest:start', { lang: 'tl' })).toEqual({
      ok: false,
      error: 'bad-token',
    });
    await ask(guest, 'guest:start', { lang: 'tl', token: TOKEN });
    // a break: her new page (the old one not yet known dead) with the same token
    const again = sock({ code });
    await next(again, 'state:session');
    expect(await ask(again, 'guest:start', { lang: 'tl', token: TOKEN })).toEqual({ ok: true });
    // the old page holds nothing any more (a reader again: its place went with its token)
    expect(await ask(guest, 'guest:stop')).toEqual({ ok: false, error: 'not-guest' });
    // only the host's words count: 16 minutes of hers alone end the session
    for (let i = 1; i <= 3; i++) {
      again.emit('host:audio', new Uint8Array(3200).buffer, {
        age: 0,
        seq: i,
        stream: 'mic-again1',
      });
    }
    t.now += 16 * 60_000;
    const ended = next<SessionView>(host, 'state:session', (v) => !v.running);
    server.realtime.checkStops();
    expect((await ended).stopped).toBe('quiet');
  });

  it('her page closing ends her captions', async () => {
    const { host, guest, speech } = await session();
    await ask(host, 'session:guestAllow', { on: true });
    await ask(guest, 'guest:start', { lang: 'tl', token: TOKEN });
    audio(guest, 1);
    await next(guest, 'captions:ack');
    const gone = next<SessionView>(host, 'state:session', (v) => v.running && !v.guestRunning);
    guest.close();
    await gone;
    expect(speech.open().map((s) => s.target)).toEqual(['en']);
  });
});

/** A fake Soniox for "Use and cost": every call answers nothing unless the test says otherwise. */
function sonioxFake(o: Partial<UsageSource> = {}): UsageSource {
  return {
    summary: () => Promise.resolve([]),
    now: () => Promise.resolve({ current: 0, limit: 10 }),
    peaks: () => Promise.resolve([]),
    ...o,
  };
}

describe('use and cost (mockups batch 5)', () => {
  it('our use per UTC day with its stream-seconds, next to Soniox’s; admins only', async () => {
    const asked: string[][] = [];
    const usage = sonioxFake({
      summary: (from, to) => {
        asked.push([from, to]);
        return Promise.resolve([
          { day: '2027-01-15', costUsd: 0.25, audioMs: 3_600_000, requests: 4 },
        ]);
      },
    });
    const { person, sock, get, admin, t } = await start(fakeSpeech(), 0.36 * EUR, { usage });
    const p = await person('Marta');
    const host = sock({ cookie: p.cookie });
    await next(host, 'state:session');
    // two languages read: every second of audio is two stream-seconds
    await ask(host, 'session:start', { lang: 'en', other: 'pl' });
    // (the test's clock moves with the audio: the engine paces what it sends by it)
    for (let i = 1; i <= 10; i++) {
      host.emit('host:audio', new Uint8Array(3200).buffer, {
        age: 0,
        seq: i,
        stream: 'mic-aaaaaaaa',
      });
      await next(host, 'captions:ack', (n: number) => n === i);
      t.now += 100;
    }
    t.now += 1_000;
    await ask(host, 'session:stop');
    expect((await get('/admin/api/usage?days=7', p.cookie)).status).toBe(401);
    const r = await get('/admin/api/usage?days=7', admin);
    expect(r.status).toBe(200);
    const ours = r.json.ours as {
      day: string;
      sessions: number;
      streamSeconds: number;
      charged: number;
    }[];
    expect(ours).toHaveLength(1);
    expect(ours[0]!.sessions).toBe(1);
    expect(ours[0]!.streamSeconds).toBe(2); // (1 s of audio × 2 streams)
    expect(ours[0]!.charged).toBeGreaterThan(0);
    expect(r.json.soniox).toEqual([
      { day: '2027-01-15', costUsd: 0.25, audioMs: 3_600_000, requests: 4 },
    ]);
    // the window: whole UTC days, today's included
    const [from, to] = asked[0]!;
    expect(Date.parse(to!) - Date.parse(from!)).toBe(7 * 86_400_000);
    expect(to!.endsWith('T00:00:00.000Z')).toBe(true);
  });

  it('Soniox not answering: our side all the same, and why', async () => {
    const usage = sonioxFake({ summary: () => Promise.reject(new Error('401')) });
    const { get, admin } = await start(fakeSpeech(), 0.36 * EUR, { usage });
    const r = await get('/admin/api/usage', admin);
    expect(r.status).toBe(200);
    expect(r.json.days).toBe(30);
    expect(r.json.soniox).toBeNull();
    expect(r.json.sonioxError).toBe('401');
  });
});

describe('Soniox right now (mockups batch 6)', () => {
  it('its count for the whole key next to Kinsay’s own and its share; today’s and the week’s highest', async () => {
    const usage = sonioxFake({
      now: () => Promise.resolve({ current: 7, limit: 10 }),
      peaks: (from, to, period) =>
        Promise.resolve(
          period === 3600
            ? [
                { start: new Date(Date.parse(from) + 3_600_000).toISOString(), max: 10 },
                { start: new Date(Date.parse(to) - 3_600_000).toISOString(), max: 6 },
              ]
            : [],
        ),
    });
    const { person, sock, get, admin, post } = await start(fakeSpeech(), 0.36 * EUR, { usage });
    const p = await person('Marta');
    const host = sock({ cookie: p.cookie });
    await next(host, 'state:session');
    await ask(host, 'session:start', { lang: 'en' });
    host.emit('host:audio', new Uint8Array(3200).buffer, {
      age: 0,
      seq: 1,
      stream: 'mic-aaaaaaaa',
    });
    await next(host, 'captions:ack');
    expect((await get('/admin/api/soniox/now', p.cookie)).status).toBe(401);
    const r = await get('/admin/api/soniox/now', admin);
    expect(r.json.org).toEqual({ current: 7, limit: 10 });
    expect(r.json.translate).toEqual({ used: 1, share: 5 });
    expect(r.json.week).toBe(10);
    expect((r.json.today as { max: number }).max).toBe(6);
    // the share: at once, and saved
    expect((await post('/admin/api/settings', { streamShare: 0 }, admin)).status).toBe(400);
    expect((await post('/admin/api/settings', { streamShare: 3 }, admin)).status).toBe(200);
    expect((await get('/admin/api/soniox/now', admin)).json.translate).toEqual({
      used: 1,
      share: 3,
    });
  });

  it('a share reached: a new language waits, as when Soniox is full', async () => {
    const { person, sock, post, admin, speech } = await start(fakeSpeech(), 0.36 * EUR, {
      usage: sonioxFake(),
    });
    await post('/admin/api/settings', { streamShare: 1 }, admin);
    const p = await person('Marta');
    const host = sock({ cookie: p.cookie });
    await next(host, 'state:session');
    await ask(host, 'session:start', { lang: 'en' });
    host.emit('host:audio', new Uint8Array(3200).buffer, {
      age: 0,
      seq: 1,
      stream: 'mic-aaaaaaaa',
    });
    await next(host, 'captions:ack');
    expect(await ask(host, 'session:lang', { lang: 'en', other: 'pl' })).toEqual({
      ok: false,
      error: 'service-full',
    });
    expect(speech.open()).toHaveLength(1);
  });

  it('the history: hours for a day or a week, days for a month or a year; costs but for a day', async () => {
    const seen: number[] = [];
    const usage = sonioxFake({
      peaks: (_f, _t, period) => {
        seen.push(period);
        return Promise.resolve([{ start: '2027-01-15T00:00:00Z', max: 4 }]);
      },
      summary: () => Promise.resolve([{ day: '2027-01-15', costUsd: 1, audioMs: 1, requests: 1 }]),
    });
    const { get, admin } = await start(fakeSpeech(), 0.36 * EUR, { usage });
    const day = await get('/admin/api/soniox/history?range=day', admin);
    expect(day.json.period).toBe(3600);
    expect(day.json.costs).toBeNull();
    const year = await get('/admin/api/soniox/history?range=year', admin);
    expect(year.json.period).toBe(86400);
    expect(year.json.costs).toHaveLength(1);
    expect(year.json.peaks).toEqual([{ start: '2027-01-15T00:00:00Z', max: 4 }]);
    expect(seen).toEqual([3600, 86400]);
  });

  it('audit 35: a bad setting saves none of the others sent with it', async () => {
    const { post, get, admin } = await start();
    const before = (await get('/admin/api/state', admin)).json.settings as { pricePerHour: number };
    expect(
      (await post('/admin/api/settings', { pricePerHour: 1, streamShare: 0 }, admin)).status,
    ).toBe(400);
    const after = (await get('/admin/api/state', admin)).json.settings as { pricePerHour: number };
    expect(after.pricePerHour).toBe(before.pricePerHour);
  });

  it('no key: Kinsay’s own count all the same', async () => {
    const { get, admin } = await start();
    const r = await get('/admin/api/soniox/now', admin);
    expect(r.json).toMatchObject({ ok: true, error: 'no key', translate: { used: 0, share: 5 } });
  });
});

describe('who said what (mockups batch 8)', () => {
  it('the host’s switch: the streams asked again with speakers, every page told; a reader may not', async () => {
    const asked: (boolean | undefined)[] = [];
    const speech = fakeSpeech();
    const connect: SpeechConnect = (target, events, options) => {
      asked.push(options?.speakers);
      return speech.connect(target, events);
    };
    const { person, sock } = await start({ ...speech, connect });
    const p = await person('Marta');
    const host = sock({ cookie: p.cookie });
    const v = await next<SessionView>(host, 'state:session');
    await ask(host, 'session:start', { lang: 'en' });
    const audio = (seq: number) =>
      host.emit('host:audio', new Uint8Array(3200).buffer, { age: 0, seq, stream: 'mic-aaaaaaaa' });
    audio(1);
    await next(host, 'captions:ack');
    const reader = sock({ code: v.code });
    await next(reader, 'state:session');
    expect(await ask(reader, 'session:speakers', { on: true })).toEqual({
      ok: false,
      error: 'not-host',
    });
    const told = next<SessionView>(reader, 'state:session', (x) => !!x.speakers);
    expect(await ask(host, 'session:speakers', { on: true })).toEqual({ ok: true });
    await told;
    audio(2);
    await next(host, 'captions:ack');
    expect(asked).toEqual([false, true]);
  });
});
