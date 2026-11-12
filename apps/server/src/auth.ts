// Cookies, the admin's login and rate limits (the limiter and the address helpers as in the wedding app).
import { createHmac, timingSafeEqual } from 'node:crypto';

/** The signed-in device's secret (random; only its hash is in the database). */
export const DEVICE_COOKIE = 'tr_device';
/** The admin's login: signed, with the admin password mixed in (a new password signs the admin out). */
export const ADMIN_COOKIE = 'tr_admin';
export const ADMIN_DAYS = 30;

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (!k) continue;
    try {
      out[k] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      // (a broken cookie is no cookie)
    }
  }
  return out;
}

export function cookie(name: string, value: string, maxAgeSec: number, secure: boolean): string {
  return [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.max(0, Math.floor(maxAgeSec))}`,
    ...(secure ? ['Secure'] : []),
  ].join('; ');
}

const sign = (key: string, data: string) =>
  createHmac('sha256', key).update(data).digest('base64url');

export function adminToken(secret: string, password: string, now: number): string {
  const end = now + ADMIN_DAYS * 86_400_000;
  return `a.${end}.${sign(secret + password, `admin.${end}`)}`;
}

export function isAdmin(
  value: string | undefined,
  secret: string,
  password: string,
  now: number,
): boolean {
  const m = /^a\.(\d+)\.([\w-]+)$/.exec(value ?? '');
  if (!m || Number(m[1]) < now) return false;
  const want = Buffer.from(sign(secret + password, `admin.${m[1]}`));
  const got = Buffer.from(m[2]!);
  return want.length === got.length && timingSafeEqual(want, got);
}

export function samePassword(a: string, b: string): boolean {
  const x = createHmac('sha256', 'pw').update(a).digest();
  const y = createHmac('sha256', 'pw').update(b).digest();
  return timingSafeEqual(x, y);
}

/** IPv6 addresses per /64 (one home or phone has a whole /64): one key for limits. */
export function ipBucket(ip: string): string {
  const v4 = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  if (v4) return v4[1]!;
  if (!ip.includes(':')) return ip;
  const addr = ip.split('%')[0]!.toLowerCase();
  const [head = '', tail] = addr.split('::');
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  const groups =
    tail === undefined ? h : [...h, ...Array<string>(8 - h.length - t.length).fill('0'), ...t];
  return `${groups
    .slice(0, 4)
    .map((g) => (parseInt(g, 16) || 0).toString(16))
    .join(':')}::/64`;
}

const RATE_LIMIT_MAX_KEYS = 10_000;

/** At most `max` events per key within the window. Memory-bounded: the least active keys go first. */
export class RateLimiter {
  private byKey = new Map<string, number[]>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  blocked(key: string, now: number): boolean {
    const recent = (this.byKey.get(key) ?? []).filter((t) => now - t < this.windowMs);
    return recent.length >= this.max;
  }

  record(key: string, now: number): void {
    const times = [...(this.byKey.get(key) ?? []), now].filter((t) => now - t < this.windowMs);
    this.byKey.delete(key);
    this.byKey.set(key, times.slice(-this.max));
    for (const oldest of this.byKey.keys()) {
      if (this.byKey.size <= RATE_LIMIT_MAX_KEYS) break;
      this.byKey.delete(oldest);
    }
  }

  take(key: string, now: number): boolean {
    if (this.blocked(key, now)) return false;
    this.record(key, now);
    return true;
  }
}

/**
 * The client's address: the last X-Forwarded-For entry behind a trusted proxy (the proxy adds it;
 * the first one is whatever the client wrote), else the socket's.
 */
export function clientIp(
  req: {
    headers: Record<string, string | string[] | undefined>;
    socket: { remoteAddress?: string };
  },
  trustProxy: boolean,
): string {
  const remote = req.socket.remoteAddress ?? '';
  const forwarded = req.headers['x-forwarded-for'];
  const last = trustProxy
    ? (Array.isArray(forwarded) ? forwarded.join(',') : (forwarded ?? '')).split(',').at(-1)?.trim()
    : undefined;
  return last || remote || 'unknown';
}

/** A request from another site is refused (a hidden form elsewhere posting here). */
export function isSameOrigin(origin: string | undefined, host: string | undefined): boolean {
  // same-site GETs and non-browser clients send none; a browser on another site always does
  if (origin === undefined) return true;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** Readers' session codes: 6 characters without 0/O/1/I/L (887 million: audit 30). */
export const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const CODE_LENGTH = 6;
export const isSessionCode = (v: unknown): v is string =>
  typeof v === 'string' && new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`).test(v);
