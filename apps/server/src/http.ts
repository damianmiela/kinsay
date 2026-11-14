// The HTTP routes: signing in (a code or a QR link from the admin), the account, asking for more,
// and the admin's API. Captions go over Socket.IO (realtime.ts). Every POST must come from our own
// pages (same origin); every answer is JSON.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { SonioxDay, SonioxPeak, UsageSource } from './usage';
import { EUR, GRANT_STEPS } from '@translate/shared';
import {
  ADMIN_COOKIE,
  ADMIN_DAYS,
  DEVICE_COOKIE,
  RateLimiter,
  adminToken,
  clientIp,
  cookie,
  ipBucket,
  wideBucket,
  isAdmin,
  isSameOrigin,
  parseCookies,
  samePassword,
  type TrustProxy,
} from './auth';
import { DEVICE_DAYS, MAIL_LINK_MS, type Store } from './db';
import {
  GOOGLE_CALLBACK,
  googleFinish,
  googleStart,
  isMailLang,
  type MailLang,
  signInMail,
  type GoogleConfig,
  type Mailer,
} from './signin';
import { AppSignIns } from './appSignIn';
import type { Realtime } from './realtime';

export interface HttpOptions {
  store: Store;
  realtime: () => Realtime;
  adminPassword: string;
  secret: string;
  trustProxy: TrustProxy;
  contact?: { name: string; email: string };
  /** Sign-in links by email (none: not offered). */
  mail?: Mailer;
  /** Google's sign-in (none: not offered). */
  google?: GoogleConfig;
  /** This app's own address (https://…), for the links in emails. */
  publicUrl?: string;
  now?: () => number;
  /** (tests: a fake Google) */
  fetch?: typeof fetch;
  /** Soniox's own numbers for "Use and cost" (none: no key; tests: a fake). */
  usage?: UsageSource;
  warn?: (m: string) => void;
}

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const MAX_GRANT = 100 * EUR;

export function routes(app: FastifyInstance, o: HttpOptions) {
  const now = o.now ?? Date.now;
  const { store } = o;
  // a code is 6 digits: tries are few per address and few for everyone together
  const codeIp = new RateLimiter(10, 15 * 60_000);
  const codeAll = new RateLimiter(60, 15 * 60_000);
  const loginIp = new RateLimiter(10, 15 * 60_000);
  const askIp = new RateLimiter(5, 60 * 60_000);
  const mailIp = new RateLimiter(5, 15 * 60_000);
  const mailTo = new RateLimiter(3, 60 * 60_000);
  const warn = o.warn ?? (() => {});
  const GOOGLE_COOKIE = 'tr_google';

  const ip = (req: FastifyRequest) => ipBucket(clientIp(req.raw, o.trustProxy));
  // (Fastify reads X-Forwarded-Proto only from the trusted proxy; an https PUBLIC_URL is always
  // reached through TLS, whatever a header says: audit 31)
  const secure = (req: FastifyRequest) =>
    req.protocol === 'https' || !!o.publicUrl?.startsWith('https://');
  const cookies = (req: FastifyRequest) => parseCookies(req.headers.cookie);
  const me = (req: FastifyRequest) => store.device(cookies(req)[DEVICE_COOKIE]);
  const admin = (req: FastifyRequest) =>
    isAdmin(cookies(req)[ADMIN_COOKIE], o.secret, o.adminPassword, now());
  const body = (req: FastifyRequest) =>
    (typeof req.body === 'object' && req.body !== null ? req.body : {}) as Record<string, unknown>;
  const fail = (reply: FastifyReply, code: number, error: string) =>
    reply.code(code).send({ ok: false, error });

  // every POST from our own pages only
  app.addHook('onRequest', async (req, reply) => {
    if (req.method !== 'POST') return;
    if (!isSameOrigin(req.headers.origin, req.headers.host)) return fail(reply, 403, 'origin');
  });

  // ---------- signing in ----------
  const label = (req: FastifyRequest) => {
    const ua = String(req.headers['user-agent'] ?? '');
    const os = /Android/.test(ua)
      ? 'Android'
      : /iPhone|iPad/.test(ua)
        ? 'iPhone'
        : /Windows/.test(ua)
          ? 'Windows'
          : /Mac/.test(ua)
            ? 'Mac'
            : 'Device';
    const app = /TranslateDesktop/.test(ua)
      ? 'Desktop app'
      : /Edg\//.test(ua)
        ? 'Edge'
        : /Firefox/.test(ua)
          ? 'Firefox'
          : /Chrome/.test(ua)
            ? 'Chrome'
            : /Safari/.test(ua)
              ? 'Safari'
              : 'Browser';
    return `${os} · ${app}`;
  };

  app.post('/api/signin/code', async (req, reply) => {
    const b = body(req);
    const digits = text(b.digits, 12).replace(/\D/g, '');
    const link = text(b.link, 100);
    if (!digits && !link) return fail(reply, 400, 'bad-code');
    const t = now();
    // a link is 32 random bytes: nothing to guess, never held up by the digits' limits (audit 30)
    if (link) {
      const person = store.useCode('link', link);
      if (!person) return fail(reply, 401, 'bad-code');
      return signedIn(req, reply, person);
    }
    if (codeIp.blocked(ip(req), t) || codeAll.blocked('all', t))
      return fail(reply, 429, 'too-many');
    const person = digits.length === 6 ? store.useCode('digits', digits) : undefined;
    if (!person) {
      codeIp.record(ip(req), t);
      codeAll.record('all', t);
      return fail(reply, 401, 'bad-code');
    }
    return signedIn(req, reply, person);
  });

  // ---------- the desktop app's sign-in (appSignIn.ts) ----------
  const appAsks = new AppSignIns(now);
  const appIp = new RateLimiter(10, 15 * 60_000);
  app.post('/api/app-signin/start', (req, reply) => {
    const addr = clientIp(req.raw, o.trustProxy);
    if (!appIp.take(wideBucket(addr), now())) return fail(reply, 429, 'too-many');
    const a = appAsks.start(ipBucket(addr), wideBucket(addr));
    return a ? Promise.resolve({ ok: true, ...a }) : fail(reply, 429, 'too-many');
  });
  app.post('/api/app-signin/ask', (req, reply) => {
    const d = me(req);
    if (!d) return fail(reply, 401, 'signed-out');
    const a = appAsks.waiting(text(body(req).token, 64), ip(req));
    if (!a) return fail(reply, 404, 'gone');
    return Promise.resolve({
      ok: true,
      digits: a.digits,
      elsewhere: a.elsewhere,
      name: d.person.name,
      email: d.person.email,
    });
  });
  app.post('/api/app-signin/answer', (req, reply) => {
    const d = me(req);
    if (!d) return fail(reply, 401, 'signed-out');
    const yes = body(req).yes === true;
    const r = appAsks.answer(text(body(req).token, 64), yes ? d.person.id : null, ip(req));
    if (r === 'gone') return fail(reply, 404, 'gone');
    if (r === 'elsewhere') return fail(reply, 403, 'elsewhere');
    return Promise.resolve({ ok: true });
  });
  app.post('/api/app-signin/poll', (req, reply) => {
    const r = appAsks.poll(text(body(req).poll, 64));
    if (typeof r === 'string') return Promise.resolve({ ok: true, state: r });
    const person = store.person(r.personId);
    if (!person || person.blocked) return Promise.resolve({ ok: true, state: 'no' });
    // (a browser tab already signed in as them (/window in a tab shares the browser's cookie): no
    // second device for the same browser, audit 32)
    if (me(req)?.person.id === person.id) return Promise.resolve({ ok: true, state: 'yes' });
    return { ...signedIn(req, reply, person), state: 'yes' };
  });

  function signedIn(
    req: FastifyRequest,
    reply: FastifyReply,
    person: { id: number; name: string },
  ) {
    const secret = store.signIn(person.id, label(req));
    reply.header('set-cookie', cookie(DEVICE_COOKIE, secret, DEVICE_DAYS * 86_400, secure(req)));
    return { ok: true, name: person.name };
  }

  /** Which ways in this server offers (the sign-in page shows only those). */
  app.get('/api/config', () => ({
    ok: true,
    email: !!o.mail && !!o.publicUrl,
    google: !!o.google,
    contact: o.contact ?? null,
  }));

  /**
   * An email's one-time link. The answer is the same whether the email is on the list or not
   * (nobody learns who is invited); a few a time per address and per email.
   */
  app.post('/api/signin/email', (req, reply) => {
    if (!o.mail || !o.publicUrl) return fail(reply, 404, 'not-offered');
    const email = text(body(req).email, 254).toLowerCase();
    if (!EMAIL.test(email)) return fail(reply, 400, 'bad-email');
    const t = now();
    if (!mailIp.take(ip(req), t)) return fail(reply, 429, 'too-many');
    const person = store.byEmail(email);
    if (person && !person.blocked && mailTo.take(email, t)) {
      const { link } = store.newCode(person.id, MAIL_LINK_MS, false);
      const m = signInMail(
        person.name.split(/\s+/)[0] ?? person.name,
        `${o.publicUrl}/signin#t=${link}`,
        isMailLang(body(req).lang) ? (body(req).lang as MailLang) : 'en',
      );
      // (never awaited: the time of the answer must not tell who is invited, audit 30)
      void o.mail(email, m.subject, m.text, m.html).then((sent) => {
        if (!sent) warn('a sign-in email could not be sent');
      });
    }
    return Promise.resolve({ ok: true });
  });

  // Google: off to Google with a cookie that remembers this sign-in's state, nonce and verifier
  app.get('/api/google/start', (req, reply) => {
    if (!o.google) return fail(reply, 404, 'not-offered');
    const { url, memo } = googleStart(o.google);
    reply.header('set-cookie', cookie(GOOGLE_COOKIE, memo, 600, secure(req)));
    return reply.redirect(url);
  });
  app.get(GOOGLE_CALLBACK, async (req, reply) => {
    if (!o.google) return fail(reply, 404, 'not-offered');
    const r = await googleFinish(
      o.google,
      req.query as Record<string, unknown>,
      cookies(req)[GOOGLE_COOKIE],
      now(),
      o.fetch,
    );
    const cookiesOut = [cookie(GOOGLE_COOKIE, '', 0, secure(req))];
    let to = '/#google-failed';
    if ('email' in r) {
      const person = store.byEmail(r.email);
      if (person && !person.blocked) {
        cookiesOut.push(
          cookie(
            DEVICE_COOKIE,
            store.signIn(person.id, label(req)),
            DEVICE_DAYS * 86_400,
            secure(req),
          ),
        );
        to = '/';
      } else to = '/#not-invited';
    }
    reply.header('set-cookie', cookiesOut);
    return reply.redirect(to);
  });

  app.post('/api/signout', async (req, reply) => {
    const d = me(req);
    if (d) {
      store.signOut(d.deviceId);
      o.realtime().signedOut({ deviceId: d.deviceId });
    }
    reply.header('set-cookie', cookie(DEVICE_COOKIE, '', 0, secure(req)));
    return { ok: true };
  });

  /** Asking for an invitation (anyone; a few times an hour per address). */
  app.post('/api/invite-request', async (req, reply) => {
    const b = body(req);
    const name = text(b.name, 80);
    const email = text(b.email, 254);
    if (!name || !EMAIL.test(email)) return fail(reply, 400, 'bad-request');
    if (!askIp.take(ip(req), now())) return fail(reply, 429, 'too-many');
    if (!store.askInvite(name, email)) return fail(reply, 429, 'too-many');
    return { ok: true };
  });

  // ---------- the account ----------
  app.get('/api/me', async (req, reply) => {
    const d = me(req);
    if (!d) return fail(reply, 401, 'signed-out');
    // (a year from its last use, as the database keeps it: audit 30)
    reply.header(
      'set-cookie',
      cookie(DEVICE_COOKIE, cookies(req)[DEVICE_COOKIE]!, DEVICE_DAYS * 86_400, secure(req)),
    );
    return { ok: true, ...store.account(d.person.id, d.deviceId) };
  });

  app.post('/api/ask', async (req, reply) => {
    const d = me(req);
    if (!d) return fail(reply, 401, 'signed-out');
    const amount = Number(body(req).amount);
    if (!GRANT_STEPS.includes(amount)) return fail(reply, 400, 'bad-amount');
    if (!store.askCredits(d.person.id, amount)) return fail(reply, 409, 'already-asked');
    return { ok: true };
  });

  app.post('/api/devices/signout', async (req, reply) => {
    const d = me(req);
    if (!d) return fail(reply, 401, 'signed-out');
    const id = Number(body(req).id);
    if (body(req).all === true) {
      store.signOutAll(d.person.id);
      o.realtime().signedOut({ personId: d.person.id });
      reply.header('set-cookie', cookie(DEVICE_COOKIE, '', 0, secure(req)));
    } else if (Number.isSafeInteger(id) && store.signOut(id, d.person.id)) {
      o.realtime().signedOut({ deviceId: id, personId: d.person.id });
      if (id === d.deviceId) reply.header('set-cookie', cookie(DEVICE_COOKIE, '', 0, secure(req)));
    }
    return { ok: true };
  });

  app.post('/api/delete-account', async (req, reply) => {
    const d = me(req);
    if (!d) return fail(reply, 401, 'signed-out');
    store.deletePerson(d.person.id);
    o.realtime().personChanged(d.person.id);
    reply.header('set-cookie', cookie(DEVICE_COOKIE, '', 0, secure(req)));
    return { ok: true };
  });

  // ---------- the admin ----------
  app.post('/admin/login', async (req, reply) => {
    if (!loginIp.take(ip(req), now())) return fail(reply, 429, 'too-many');
    if (!samePassword(text(body(req).password, 200), o.adminPassword))
      return fail(reply, 401, 'wrong-password');
    reply.header(
      'set-cookie',
      cookie(
        ADMIN_COOKIE,
        adminToken(o.secret, o.adminPassword, now()),
        ADMIN_DAYS * 86_400,
        secure(req),
      ),
    );
    return { ok: true };
  });
  app.post('/admin/logout', async (req, reply) => {
    reply.header('set-cookie', cookie(ADMIN_COOKIE, '', 0, secure(req)));
    return { ok: true };
  });

  // (every /admin/api route: the admin only)
  // (the route Fastify matched, decoded: "/admin/%61pi/…" is /admin/api/… too, audit 30)
  app.addHook('preHandler', async (req, reply) => {
    const route = req.routeOptions.url ?? '';
    if (route.startsWith('/admin/api/') && !admin(req)) return fail(reply, 401, 'admin-only');
  });

  // "Use and cost" (mockups batch 5): everyone's use per UTC day next to Soniox's own, the last
  // 7, 30 or 90 days (today included)
  app.get('/admin/api/usage', async (req) => {
    const q = req.query as { days?: string };
    const days = [7, 30, 90].includes(Number(q.days)) ? Number(q.days) : 30;
    const t = new Date((o.now ?? Date.now)());
    const end = Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate() + 1);
    const start = end - days * 86_400_000;
    const from = new Date(start).toISOString();
    const to = new Date(end).toISOString();
    let soniox: SonioxDay[] | null = null;
    let peaks: SonioxPeak[] = [];
    let sonioxError: string | undefined;
    if (!o.usage) sonioxError = 'no key';
    else {
      try {
        soniox = await o.usage.summary(from, to);
        // (the day's most at once: a column of the table; never in the way of the rest)
        peaks = await o.usage.peaks(from, to, 86_400).catch(() => []);
      } catch (e) {
        sonioxError = e instanceof Error ? e.message : 'no answer';
        o.warn?.(`Soniox usage: ${sonioxError}`);
      }
    }
    return {
      ok: true,
      days,
      from: from.slice(0, 10),
      ours: o.store.usageByDay(from, to),
      soniox,
      peaks: Object.fromEntries(peaks.map((p) => [p.start.slice(0, 10), p.max])),
      ...(sonioxError ? { sonioxError } : {}),
      pricePerHour: o.store.settings().pricePerHour,
    };
  });

  // Soniox right now (mockups batch 6): its count for the whole key (both apps) and its limit,
  // Translate's own and its share, and the highest of today, this week and the last 12 hours
  app.get('/admin/api/soniox/now', async () => {
    const translate = o.realtime().streams();
    if (!o.usage) return { ok: true, translate, error: 'no key' };
    const t = (o.now ?? Date.now)();
    const day0 = new Date(t);
    const today = Date.UTC(day0.getUTCFullYear(), day0.getUTCMonth(), day0.getUTCDate());
    const hour = Math.floor(t / 3_600_000) * 3_600_000;
    try {
      const now = await o.usage.now();
      // (the week's hours: the last 12 bars, today's and the week's highest, from one answer)
      const week = await o.usage
        .peaks(
          new Date(today - 6 * 86_400_000).toISOString(),
          new Date(hour + 3_600_000).toISOString(),
          3600,
        )
        .catch(() => null);
      const todayPeaks = week?.filter((p) => Date.parse(p.start) >= today) ?? [];
      const best = todayPeaks.reduce<SonioxPeak | null>(
        (a, p) => (!a || p.max > a.max ? p : a),
        null,
      );
      return {
        ok: true,
        translate,
        org: now,
        ...(week
          ? {
              today: best ? { max: best.max, at: best.start } : null,
              week: Math.max(0, ...week.map((p) => p.max)),
              hours: week.slice(-12),
            }
          : {}),
      };
    } catch (e) {
      const error = e instanceof Error ? e.message : 'no answer';
      return { ok: true, translate, error };
    }
  });

  // the history card: the most at once (Day/Week per hour, Month per day, Year per day, made months
  // on the page) and, but for a day, Soniox's cost next to what was charged per day
  app.get('/admin/api/soniox/history', async (req) => {
    const range = String((req.query as { range?: string }).range ?? 'month');
    const t = new Date((o.now ?? Date.now)());
    const end = Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate() + 1);
    const days = range === 'day' ? 1 : range === 'week' ? 7 : range === 'year' ? 366 : 30;
    const period = days <= 7 ? 3600 : 86_400;
    const from = new Date(end - days * 86_400_000).toISOString();
    const to = new Date(end).toISOString();
    const charged = days > 1 ? o.store.usageByDay(from, to) : [];
    if (!o.usage)
      return { ok: true, range, period, peaks: [], costs: null, charged, error: 'no key' };
    try {
      const [peaks, costs] = await Promise.all([
        o.usage.peaks(from, to, period),
        days > 1 ? o.usage.summary(from, to) : Promise.resolve(null),
      ]);
      return { ok: true, range, period, peaks, costs, charged };
    } catch (e) {
      const error = e instanceof Error ? e.message : 'no answer';
      return { ok: true, range, period, peaks: [], costs: null, charged, error };
    }
  });

  app.get('/admin/api/state', () => ({
    ok: true,
    requests: store.waitingRequests(),
    people: store.people(),
    month: store.monthUse(),
    running: o.realtime().running(),
    settings: store.settings(),
  }));

  app.post('/admin/api/invite', async (req, reply) => {
    const b = body(req);
    const name = text(b.name, 80);
    const email = text(b.email, 254) || null;
    if (!name || (email && !EMAIL.test(email))) return fail(reply, 400, 'bad-request');
    if (email && store.byEmail(email)) return fail(reply, 409, 'already-invited');
    return { ok: true, person: store.invite(name, email) };
  });

  app.post('/admin/api/grant', async (req, reply) => {
    const b = body(req);
    const personId = Number(b.personId);
    const amount = Math.round(Number(b.amount));
    const kind = b.kind === 'correction' ? 'correction' : 'grant';
    if (!store.person(personId)) return fail(reply, 404, 'no-person');
    // a grant adds, a correction may take away; never more than €100 at once (a typo's ceiling)
    if (
      !Number.isSafeInteger(amount) ||
      !amount ||
      Math.abs(amount) > MAX_GRANT ||
      (kind === 'grant' && amount < 0)
    ) {
      return fail(reply, 400, 'bad-amount');
    }
    const requestId = b.requestId === undefined ? undefined : Number(b.requestId);
    if (requestId !== undefined) {
      const r = store.request(requestId);
      if (!r || r.state !== 'waiting' || r.kind !== 'credits' || r.person_id !== personId) {
        return fail(reply, 409, 'request-answered');
      }
      store.answer(requestId, 'granted');
    }
    store.add(personId, kind, amount, { note: text(b.note, 200) || undefined });
    o.realtime().personChanged(personId);
    return { ok: true };
  });

  app.post('/admin/api/decline', async (req, reply) => {
    const id = Number(body(req).requestId);
    if (!store.request(id)) return fail(reply, 404, 'no-request');
    store.answer(id, 'declined');
    return { ok: true };
  });

  app.post('/admin/api/person', async (req, reply) => {
    const b = body(req);
    const id = Number(b.id);
    if (!store.person(id)) return fail(reply, 404, 'no-person');
    const limit =
      b.monthlyLimit === null
        ? null
        : b.monthlyLimit === undefined
          ? undefined
          : Math.round(Number(b.monthlyLimit));
    if (
      limit !== undefined &&
      limit !== null &&
      (!Number.isSafeInteger(limit) || limit < 0 || limit > 1000 * EUR)
    ) {
      return fail(reply, 400, 'bad-limit');
    }
    store.setPerson(id, {
      ...(typeof b.blocked === 'boolean' ? { blocked: b.blocked } : {}),
      ...(limit !== undefined ? { monthlyLimit: limit } : {}),
      ...(text(b.name, 80) ? { name: text(b.name, 80) } : {}),
    });
    if (b.signOutAll === true) {
      store.signOutAll(id);
      o.realtime().signedOut({ personId: id });
    }
    o.realtime().personChanged(id);
    return { ok: true };
  });

  app.post('/admin/api/signin-code', async (req, reply) => {
    const id = Number(body(req).id);
    const p = store.person(id);
    if (!p || p.blocked) return fail(reply, 404, 'no-person');
    return { ok: true, ...store.newCode(id) };
  });

  app.post('/admin/api/settings', async (req, reply) => {
    const b = body(req);
    // (every value checked first: a bad one saves none of them, audit 35)
    const next: Partial<
      Record<'pricePerHour' | 'monthlyLimit' | 'globalLimit' | 'streamShare', number>
    > = {};
    for (const k of ['pricePerHour', 'monthlyLimit', 'globalLimit'] as const) {
      if (b[k] === undefined) continue;
      const v = Math.round(Number(b[k]));
      if (!Number.isSafeInteger(v) || v < 0 || v > 10_000 * EUR)
        return fail(reply, 400, 'bad-setting');
      next[k] = v;
    }
    // (Translate's share of Soniox's streams: at once, from now on)
    if (b.streamShare !== undefined) {
      const v = Number(b.streamShare);
      if (!Number.isInteger(v) || v < 1 || v > 1000) return fail(reply, 400, 'bad-setting');
      next.streamShare = v;
    }
    for (const [k, v] of Object.entries(next)) store.setSetting(k as keyof typeof next, v);
    if (next.streamShare !== undefined) o.realtime().setShare(next.streamShare);
    return { ok: true, settings: store.settings() };
  });

  app.get('/admin/api/me', async (req, reply) =>
    admin(req) ? { ok: true } : fail(reply, 401, 'admin-only'),
  );
}
