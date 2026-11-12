// Live captions over Socket.IO. Every signed-in person has one channel: their own captions, their
// own code for readers (6 characters, a day). A host's page sends the audio; every page (the host's
// and the readers') reads one language, or only what is heard. Each language read is one stream,
// paid from the host's credits as the audio goes (one ledger row per session, brought up to date
// every few seconds); no credits or a reached limit stops the session.
import { randomInt } from 'node:crypto';
import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import {
  HEARD,
  type Ack,
  type ClientToServerEvents,
  type ServerToClientEvents,
  type SessionView,
  type StopReason,
  type Target,
} from '@translate/shared';
import {
  CODE_ALPHABET,
  CODE_LENGTH,
  DEVICE_COOKIE,
  RateLimiter,
  clientIp,
  ipBucket,
  isSameOrigin,
  isSessionCode,
  parseCookies,
} from './auth';
import type { Person, Store } from './db';
import { Engine, isTarget, StreamPool, type SpeechConnect } from './engine';

/** A day: a reader's code works this long from the session's first Start. */
export const CODE_MS = 24 * 3_600_000;
/** Translations one session may read at once (each one a stream from the shared pool). */
export const CHANNEL_LANGS_MAX = 3;
/** The ledger row is brought up to date, and the credits checked, this often while audio goes. */
export const FLUSH_MS = 10_000;
/** One microphone at a time: another page of the same host takes over after this much quiet. */
export const MIC_QUIET_MS = 2_000;
/** Language switches a page may make per minute (each opens and closes a paid stream: audit 30). */
export const LANG_SWITCHES_PER_MIN = 10;
/** Wrong reader codes an address may try per 10 minutes (IPv6 per /48: audit 30). */
export const CODE_FAILS_MAX = 20;
/** A channel nobody uses is forgotten after this long (its code with it). */
const IDLE_CHANNEL_MS = 10 * 60_000;
const TEXT_EVERY_MS = 150;
/** Audio streams of a page remembered per channel (their last chunk number; audit 30). */
const SEQS_MAX = 20;

interface Channel {
  personId: number;
  hostName: string;
  code: string;
  codeUntil: number;
  engine: Engine;
  running: boolean;
  /** The host's language (kept over a reconnect; null: what is heard only). */
  hostLang: Target | null;
  stopped?: StopReason;
  /** The running session's ledger row, its cost so far, and what of it is written. */
  row?: number;
  cost: number;
  written: number;
  seconds: number;
  flushedAt: number;
  micSocket?: string;
  micAt: number;
  /** The last chunk number per audio stream of the page (a resend is confirmed, not used twice). */
  seqs: Map<string, number>;
  /** Its pages, host's and readers' (audit 30: never a scan of every socket). */
  sockets: Set<S>;
  textTimer?: NodeJS.Timeout;
  idleSince: number;
}

interface Data {
  channel: Channel;
  role: 'host' | 'reader';
  lang: Target | null;
  personId?: number;
  deviceId?: number;
}
type S = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, Data>;

export interface RealtimeOptions {
  store: Store;
  speech: SpeechConnect | null;
  streams: number;
  trustProxy: boolean;
  now?: () => number;
  warn?: (m: string) => void;
}

/** IPv6 per /48 for reader codes (one home or a provider's block has many /64s). */
function codeBucket(ip: string): string {
  const b = ipBucket(ip);
  if (!b.endsWith('::/64')) return b;
  return `${b.slice(0, -5).split(':').slice(0, 3).join(':')}::/48`;
}

export function attachRealtime(http: HttpServer, o: RealtimeOptions) {
  const now = o.now ?? Date.now;
  const warn = o.warn ?? (() => {});
  const pool = new StreamPool(o.streams);
  const io = new Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, Data>(
    http,
    {
      pingInterval: 10_000,
      pingTimeout: 5_000,
      maxHttpBufferSize: 256_000,
      allowRequest: (req, cb) => cb(null, isSameOrigin(req.headers.origin, req.headers.host)),
    },
  );
  const byPerson = new Map<number, Channel>();
  const byCode = new Map<string, Channel>();
  const codeFails = new RateLimiter(CODE_FAILS_MAX, 10 * 60_000);
  const langSwitches = new RateLimiter(LANG_SWITCHES_PER_MIN, 60_000);

  function newCode(): string {
    for (;;) {
      let code = '';
      for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
      if (!byCode.has(code)) return code;
    }
  }

  function channelOf(p: Person): Channel {
    const c = byPerson.get(p.id);
    if (c) {
      c.hostName = p.name.split(/\s+/)[0] ?? p.name;
      return c;
    }
    const code = newCode();
    const ch: Channel = {
      personId: p.id,
      hostName: p.name.split(/\s+/)[0] ?? p.name,
      code,
      codeUntil: now() + CODE_MS,
      running: false,
      hostLang: null,
      cost: 0,
      written: 0,
      seconds: 0,
      flushedAt: now(),
      micAt: 0,
      seqs: new Map(),
      sockets: new Set(),
      idleSince: now(),
      engine: undefined as unknown as Engine,
    };
    ch.engine = new Engine(
      o.speech,
      () => textSoon(ch),
      () => stateAll(ch),
      (ms, streams) => sent(ch, ms, streams),
      now,
      warn,
      pool,
    );
    byPerson.set(p.id, ch);
    byCode.set(code, ch);
    return ch;
  }

  /** The languages a channel's pages read: the host's first (its stream also gives what is heard). */
  function langsOf(c: Channel): Target[] {
    const all = [c.hostLang, ...[...c.sockets].map((s) => s.data.lang)].filter(
      (l): l is Target => !!l && l !== HEARD,
    );
    return [...new Set(all)];
  }

  function view(s: S): SessionView {
    const c = s.data.channel;
    const v: SessionView = {
      role: s.data.role,
      hostName: c.hostName,
      running: c.running,
      service: c.engine.service,
      ...(c.engine.error ? { error: c.engine.error } : {}),
      lang: s.data.lang,
      ...(c.stopped ? { stopped: c.stopped } : {}),
    };
    if (s.data.role === 'host') {
      v.code = c.code;
      v.balance = o.store.balance(c.personId) - (c.cost - c.written);
    }
    return v;
  }

  function stateAll(c: Channel) {
    for (const s of c.sockets) s.emit('state:session', view(s));
  }

  function textSoon(c: Channel) {
    c.textTimer ??= setTimeout(() => {
      c.textTimer = undefined;
      for (const s of c.sockets) s.emit('captions', c.engine.update(s.data.lang));
    }, TEXT_EVERY_MS);
  }

  /** Audio went to the speech service: its cost counts now, written every FLUSH_MS. Never throws. */
  function sent(c: Channel, ms: number, streams: number) {
    try {
      const price = o.store.settings().pricePerHour;
      c.cost += (ms * streams * price) / 3_600_000;
      c.seconds += ms / 1000;
      if (now() - c.flushedAt >= FLUSH_MS) flush(c);
    } catch (e) {
      warn(`credits: ${String(e)}`);
    }
  }

  /**
   * Writes the session's use so far; `check`: and stops it when it may not go on. A write that
   * fails (the person was deleted meanwhile) ends the session, never the server (audit 30).
   */
  function flush(c: Channel, check = true) {
    c.flushedAt = now();
    if (c.cost) {
      try {
        const lang = langsOf(c).join(', ') || HEARD;
        if (!c.row) c.row = o.store.add(c.personId, 'use', -c.cost, { lang, seconds: c.seconds });
        else o.store.setUse(c.row, c.cost, lang, c.seconds);
        c.written = c.cost;
      } catch (e) {
        warn(`credits: the use could not be written (${String(e)})`);
        if (check) return stop(c, 'blocked', false);
      }
    }
    if (!check) return;
    const why = cannotRun(c.personId);
    if (why) stop(c, why);
    else stateAll(c);
  }

  /** Why a person's session may not run now (none: it may). */
  function cannotRun(personId: number): StopReason | undefined {
    const p = o.store.person(personId);
    if (!p || p.blocked) return 'blocked';
    if (o.store.balance(personId) <= 0) return 'credits';
    const limit = o.store.limitOf(p);
    if (limit > 0 && o.store.monthUse(personId) >= limit) return 'monthly';
    const global = o.store.settings().globalLimit;
    if (global > 0 && o.store.monthUse() >= global) return 'global';
    return undefined;
  }

  function stop(c: Channel, why?: StopReason, write = true) {
    if (c.running && write) flush(c, false);
    c.running = false;
    c.stopped = why;
    c.row = undefined;
    c.cost = 0;
    c.written = 0;
    c.seconds = 0;
    c.seqs.clear();
    c.engine.discard();
    c.idleSince = now();
    stateAll(c);
    textSoon(c);
  }

  /** A channel goes for good: its pages are closed, its code no longer lets anyone in. */
  function drop(c: Channel) {
    stop(c, 'blocked', false);
    for (const s of [...c.sockets]) s.disconnect(true);
    c.engine.close();
    byPerson.delete(c.personId);
    byCode.delete(c.code);
  }

  /**
   * A person changed (credits, limits, blocked, deleted). Blocked or deleted: their channel goes,
   * every page of it closed (audit 30: a socket outlived the person); else it is told the news.
   */
  function personChanged(personId: number) {
    const c = byPerson.get(personId);
    if (!c) return;
    const p = o.store.person(personId);
    if (!p || p.blocked) return drop(c);
    const why = cannotRun(personId);
    if (c.running && why) stop(c, why);
    else stateAll(c);
  }

  /** Devices were signed out (one, or all of a person's): their host pages are closed at once. */
  function signedOut(which: { deviceId?: number; personId?: number }) {
    const c = which.personId !== undefined ? byPerson.get(which.personId) : undefined;
    const all = c ? [...c.sockets] : [...byPerson.values()].flatMap((ch) => [...ch.sockets]);
    for (const s of all) {
      if (s.data.role !== 'host') continue;
      if (which.deviceId !== undefined && s.data.deviceId !== which.deviceId) continue;
      if (which.personId !== undefined && s.data.personId !== which.personId) continue;
      s.disconnect(true);
    }
  }

  // forget channels nobody uses
  const tidy = setInterval(() => {
    for (const c of byPerson.values()) {
      if (c.running || c.sockets.size) {
        c.idleSince = now();
        continue;
      }
      if (now() - c.idleSince < IDLE_CHANNEL_MS) continue;
      c.engine.close();
      byPerson.delete(c.personId);
      byCode.delete(c.code);
    }
  }, 60_000);
  tidy.unref();

  io.use((s, next) => {
    const cookies = parseCookies(s.handshake.headers.cookie);
    const auth = (s.handshake.auth ?? {}) as { code?: unknown };
    const code = typeof auth.code === 'string' ? auth.code.toUpperCase() : undefined;
    if (code !== undefined) {
      const ip = codeBucket(
        clientIp({ headers: s.handshake.headers, socket: s.request.socket }, o.trustProxy),
      );
      // only wrong codes count (readers reconnect often, many share one address: audit 30)
      if (codeFails.blocked(ip, now())) return next(new Error('too-many'));
      const c = isSessionCode(code) ? byCode.get(code) : undefined;
      if (!c || c.codeUntil < now()) {
        codeFails.record(ip, now());
        return next(new Error('no-session'));
      }
      s.data = { channel: c, role: 'reader', lang: null };
      return next();
    }
    const d = o.store.device(cookies[DEVICE_COOKIE]);
    if (!d) return next(new Error('signed-out'));
    s.data = {
      channel: channelOf(d.person),
      role: 'host',
      lang: null,
      personId: d.person.id,
      deviceId: d.deviceId,
    };
    next();
  });

  io.on('connection', (s) => {
    const c = s.data.channel;
    // (a channel dropped while this socket was being let in)
    if (byPerson.get(c.personId) !== c) return void s.disconnect(true);
    c.sockets.add(s);
    // (a host gets their own language back; a reader starts in the host's)
    s.data.lang = c.hostLang;
    s.emit('state:session', view(s));
    s.emit('captions', c.engine.update(s.data.lang, true));

    const reply = (cb: unknown, r: Ack) => {
      if (typeof cb === 'function') (cb as (r: Ack) => void)(r);
    };
    const host = () => s.data.role === 'host' && s.data.personId === c.personId;

    /** A page's language: null or HEARD = what is heard only. */
    function setLang(lang: unknown): Ack {
      const next = lang === null || lang === HEARD ? null : lang;
      if (next !== null && !isTarget(next)) return { ok: false, error: 'bad-lang' };
      if (next === s.data.lang) return { ok: true };
      if (!langSwitches.take(s.id, now())) return { ok: false, error: 'too-many' };
      const langs = new Set(langsOf(c));
      if (next && !langs.has(next)) {
        if (langs.size >= CHANNEL_LANGS_MAX) return { ok: false, error: 'too-many-langs' };
        if (c.running && !c.engine.canAdd(1)) return { ok: false, error: 'service-full' };
      }
      s.data.lang = next;
      if (host()) c.hostLang = next;
      // (a switched page sees its new language from now on: its history starts again)
      if (next && !langs.has(next)) c.engine.clearText(next);
      c.engine.setLangs(langsOf(c));
      s.emit('state:session', view(s));
      s.emit('captions', c.engine.update(next, true));
      return { ok: true };
    }

    s.on('session:lang', (p, cb) =>
      reply(cb, setLang((p as { lang?: unknown } | undefined)?.lang ?? null)),
    );

    s.on('session:start', (p, cb) => {
      if (!host()) return reply(cb, { ok: false, error: 'not-host' });
      const why = cannotRun(c.personId);
      if (why) {
        c.stopped = why;
        stateAll(c);
        return reply(cb, { ok: false, error: why });
      }
      const r = setLang((p as { lang?: unknown } | undefined)?.lang ?? null);
      if (!r.ok) return reply(cb, r);
      // (the languages as the pages read them now: none left over from pages gone since)
      c.engine.setLangs(langsOf(c));
      if (!c.running) {
        c.running = true;
        c.stopped = undefined;
        c.flushedAt = now();
        // (a new day: a new code, the old one no longer lets anyone in)
        if (c.codeUntil < now()) {
          byCode.delete(c.code);
          c.code = newCode();
          c.codeUntil = now() + CODE_MS;
          byCode.set(c.code, c);
        }
      }
      c.micSocket = s.id;
      c.micAt = now();
      stateAll(c);
      reply(cb, { ok: true });
    });

    s.on('session:stop', (cb) => {
      if (!host()) return reply(cb, { ok: false, error: 'not-host' });
      stop(c, 'ended');
      reply(cb, { ok: true });
    });

    s.on('host:audio', (chunk, meta) => {
      if (!host()) return;
      const m = (typeof meta === 'object' && meta ? meta : {}) as Record<string, unknown>;
      const seq = Number.isSafeInteger(m.seq) ? (m.seq as number) : 0;
      // (stopped: confirmed all the same, so the page never sends it again)
      if (!c.running) {
        if (seq) s.emit('captions:ack', seq);
        return;
      }
      if (!(chunk instanceof Buffer || chunk instanceof ArrayBuffer)) return;
      const stream =
        typeof m.stream === 'string' && /^[\w-]{8,40}$/.test(m.stream) ? m.stream : s.id;
      const age =
        typeof m.age === 'number' && Number.isFinite(m.age)
          ? Math.min(Math.max(m.age, 0), 600_000)
          : 0;
      // one microphone at a time: another page takes over once the first has been quiet a while
      if (c.micSocket !== s.id && now() - c.micAt < MIC_QUIET_MS) return;
      c.micSocket = s.id;
      c.micAt = now();
      if (seq) {
        s.emit('captions:ack', seq);
        if (seq <= (c.seqs.get(stream) ?? 0)) return; // (sent again after a break: it came already)
        c.seqs.delete(stream);
        c.seqs.set(stream, seq);
        for (const oldest of c.seqs.keys()) {
          if (c.seqs.size <= SEQS_MAX) break;
          c.seqs.delete(oldest);
        }
      }
      const bytes = chunk instanceof Buffer ? chunk : new Uint8Array(chunk);
      if (bytes.length % 2) return;
      c.engine.audio(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.length), now() - age);
    });

    s.on('disconnect', () => {
      c.sockets.delete(s);
      // (a language nobody reads any more: its stream ends; never one left for the next Start)
      c.engine.setLangs(langsOf(c));
      c.idleSince = now();
    });
  });

  return {
    io,
    personChanged,
    signedOut,
    /** For the admin: sessions running now. */
    running: () => [...byPerson.values()].filter((c) => c.running).length,
    close() {
      clearInterval(tidy);
      for (const c of byPerson.values()) {
        if (c.running) flush(c, false);
        c.engine.close();
      }
      io.engine.close();
    },
  };
}
export type Realtime = ReturnType<typeof attachRealtime>;
