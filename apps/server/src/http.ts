// The HTTP routes: signing in (a code or a QR link from the admin), the account, asking for more,
// and the admin's API. Captions go over Socket.IO (realtime.ts). Every POST must come from our own
// pages (same origin); every answer is JSON.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
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
  isAdmin,
  isSameOrigin,
  parseCookies,
  samePassword,
} from './auth';
import { DEVICE_DAYS, type Store } from './db';
import type { Realtime } from './realtime';

export interface HttpOptions {
  store: Store;
  realtime: () => Realtime;
  adminPassword: string;
  secret: string;
  trustProxy: boolean;
  now?: () => number;
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

  const ip = (req: FastifyRequest) => ipBucket(clientIp(req.raw, o.trustProxy));
  const secure = (req: FastifyRequest) =>
    req.protocol === 'https' || (o.trustProxy && req.headers['x-forwarded-proto'] === 'https');
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
    const app = /LiveSubtitles|WebView2/.test(ua)
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
    if (codeIp.blocked(ip(req), t) || codeAll.blocked('all', t))
      return fail(reply, 429, 'too-many');
    const person =
      digits.length === 6
        ? store.useCode('digits', digits)
        : link
          ? store.useCode('link', link)
          : undefined;
    if (!person) {
      codeIp.record(ip(req), t);
      codeAll.record('all', t);
      return fail(reply, 401, 'bad-code');
    }
    const secret = store.signIn(person.id, label(req));
    reply.header('set-cookie', cookie(DEVICE_COOKIE, secret, DEVICE_DAYS * 86_400, secure(req)));
    return { ok: true, name: person.name };
  });

  app.post('/api/signout', async (req, reply) => {
    const d = me(req);
    if (d) store.signOut(d.deviceId);
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
    store.askInvite(name, email);
    return { ok: true };
  });

  // ---------- the account ----------
  app.get('/api/me', async (req, reply) => {
    const d = me(req);
    if (!d) return fail(reply, 401, 'signed-out');
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
      reply.header('set-cookie', cookie(DEVICE_COOKIE, '', 0, secure(req)));
    } else if (Number.isSafeInteger(id)) {
      store.signOut(id, d.person.id);
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
  app.addHook('preHandler', async (req, reply) => {
    if (req.url.startsWith('/admin/api/') && !admin(req)) return fail(reply, 401, 'admin-only');
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
    store.add(personId, kind, amount, { note: text(b.note, 200) || undefined });
    const requestId = Number(b.requestId);
    if (Number.isSafeInteger(requestId)) store.answer(requestId, 'granted');
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
    if (b.signOutAll === true) store.signOutAll(id);
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
    for (const k of ['pricePerHour', 'monthlyLimit', 'globalLimit'] as const) {
      if (b[k] === undefined) continue;
      const v = Math.round(Number(b[k]));
      if (!Number.isSafeInteger(v) || v < 0 || v > 10_000 * EUR)
        return fail(reply, 400, 'bad-setting');
      store.setSetting(k, v);
    }
    return { ok: true, settings: store.settings() };
  });

  app.get('/admin/api/me', async (req, reply) =>
    admin(req) ? { ok: true } : fail(reply, 401, 'admin-only'),
  );
}
