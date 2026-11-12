import { afterEach, describe, expect, it } from 'vitest';
import { EUR } from '@translate/shared';
import { createServer } from './server';
import { GOOGLE_CALLBACK } from './signin';

const ADMIN = 'admin-password-for-tests';
let closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const c of closers.reverse()) await c();
  closers = [];
});

const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');

async function start() {
  const mails: { to: string; text: string }[] = [];
  const google = { clientId: 'client-1', secret: 'secret-1', publicUrl: 'https://tr.example' };
  // Google's token endpoint, faked: it answers with the ID token the test sets
  const fake = { claims: {} as Record<string, unknown>, got: null as URLSearchParams | null };
  const fetchFake = ((_url: string, init: { body: string }) => {
    fake.got = new URLSearchParams(init.body);
    return Promise.resolve(
      new Response(JSON.stringify({ id_token: `h.${enc(fake.claims)}.sig` }), { status: 200 }),
    );
  }) as unknown as typeof fetch;
  const t = { now: 1_800_000_000_000 };
  const server = await createServer({
    adminPassword: ADMIN,
    secret: 's'.repeat(40),
    dbFile: ':memory:',
    speech: null,
    streams: 5,
    defaults: { pricePerHour: 0.2 * EUR, monthlyLimit: 5 * EUR, globalLimit: 20 * EUR },
    trustProxy: false,
    mail: (to, _subject, text) => {
      mails.push({ to, text });
      return Promise.resolve(true);
    },
    google,
    publicUrl: 'https://tr.example',
    fetch: fetchFake,
    now: () => t.now,
  });
  await server.app.listen({ port: 0, host: '127.0.0.1' });
  const addr = server.app.server.address();
  const url = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  closers.push(() => server.close());
  const post = async (path: string, body: unknown) => {
    const r = await fetch(url + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: url },
      body: JSON.stringify(body),
    });
    return {
      status: r.status,
      json: (await r.json()) as Record<string, unknown>,
      cookie: r.headers.get('set-cookie') ?? '',
    };
  };
  server.store.invite('Marta Example', 'marta@example.com');
  return { url, post, mails, fake, t, server };
}

describe('email links', () => {
  it('an invited email gets a one-time link; another gets the same answer and no mail', async () => {
    const { post, mails } = await start();
    expect((await post('/api/signin/email', { email: 'Marta@Example.com' })).json).toEqual({
      ok: true,
    });
    expect((await post('/api/signin/email', { email: 'nobody@example.com' })).json).toEqual({
      ok: true,
    });
    expect(mails).toHaveLength(1);
    expect(mails[0]!.to).toBe('marta@example.com');
    const link = /\/signin#t=([\w-]+)/.exec(mails[0]!.text)![1]!;
    expect(mails[0]!.text).toContain('https://tr.example/signin#t=');
    const signed = await post('/api/signin/code', { link });
    expect(signed.status).toBe(200);
    expect(signed.cookie).toMatch(/^tr_device=/);
    expect((await post('/api/signin/code', { link })).status).toBe(401); // (once)
  });

  it('a link ends after 15 minutes; a few mails an hour per email at most', async () => {
    const { post, mails, t } = await start();
    await post('/api/signin/email', { email: 'marta@example.com' });
    const link = /#t=([\w-]+)/.exec(mails[0]!.text)![1]!;
    t.now += 15 * 60_000 + 1;
    expect((await post('/api/signin/code', { link })).status).toBe(401);
    for (let i = 0; i < 4; i++) await post('/api/signin/email', { email: 'marta@example.com' });
    expect(mails).toHaveLength(3);
  });
});

describe('Google', () => {
  it('signs in an invited, verified email; checks state, nonce and the audience', async () => {
    const { url, fake, t } = await start();
    const startR = await fetch(`${url}/api/google/start`, { redirect: 'manual' });
    expect(startR.status).toBe(302);
    const to = new URL(startR.headers.get('location')!);
    expect(to.origin).toBe('https://accounts.google.com');
    expect(to.searchParams.get('redirect_uri')).toBe(`https://tr.example${GOOGLE_CALLBACK}`);
    expect(to.searchParams.get('code_challenge_method')).toBe('S256');
    const memo = startR.headers.get('set-cookie')!.split(';')[0]!;
    const state = to.searchParams.get('state')!;
    const nonce = to.searchParams.get('nonce')!;
    const back = (query: string, cookie = memo) =>
      fetch(`${url}${GOOGLE_CALLBACK}?${query}`, { redirect: 'manual', headers: { cookie } });

    const good = {
      iss: 'https://accounts.google.com',
      aud: 'client-1',
      exp: t.now / 1000 + 600,
      nonce,
      email: 'marta@example.com',
      email_verified: true,
    };
    // a wrong state: refused before Google is even asked
    fake.claims = good;
    expect((await back(`code=c&state=nope`)).headers.get('location')).toBe('/#google-failed');
    // another app's token, another nonce, an unverified email
    for (const bad of [{ aud: 'other' }, { nonce: 'other' }, { email_verified: false }]) {
      fake.claims = { ...good, ...bad };
      expect((await back(`code=c&state=${state}`)).headers.get('location')).toBe('/#google-failed');
    }
    // not on the list
    fake.claims = { ...good, email: 'nobody@example.com' };
    expect((await back(`code=c&state=${state}`)).headers.get('location')).toBe('/#not-invited');
    // all well: signed in
    fake.claims = good;
    const ok = await back(`code=c&state=${state}`);
    expect(ok.headers.get('location')).toBe('/');
    expect(ok.headers.get('set-cookie')).toMatch(/tr_device=[\w-]{40,}/);
    expect(fake.got!.get('code_verifier')).toBeTruthy();
    expect(fake.got!.get('client_secret')).toBe('secret-1');
  });
});

describe('the sign-in email', () => {
  it("comes in the page's language; anything else is English", async () => {
    const { signInMail, isMailLang } = await import('./signin');
    const pl = signInMail('Ola', 'https://example.com/signin#t=x', 'pl');
    expect(pl.subject).toContain('logowania');
    expect(pl.html).toContain('Zaloguj się do Translate');
    expect(pl.text).toContain('https://example.com/signin#t=x');
    expect(isMailLang('de')).toBe(true);
    expect(isMailLang('toString')).toBe(false);
    expect(signInMail('Ola', 'u').subject).toBe('Your sign-in link for Translate');
  });
});
