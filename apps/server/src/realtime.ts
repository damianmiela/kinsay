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
  isTarget,
  type Ack,
  type ClientToServerEvents,
  type DeviceKind,
  deviceKind,
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
  wideBucket,
  isSameOrigin,
  isSessionCode,
  parseCookies,
  type TrustProxy,
} from './auth';
import type { Person, Store } from './db';
import { Engine, StreamPool, type SpeechConnect } from '@translate/engine';

/** A day: a reader's code works this long from the session's first Start. */
export const CODE_MS = 24 * 3_600_000;
/** Translations one session may read at once (each one a stream from the shared pool). */
export const CHANNEL_LANGS_MAX = 3;
/** The ledger row is brought up to date, and the credits checked, this often while audio goes. */
export const FLUSH_MS = 10_000;
/** One microphone at a time: another page of the same host takes over after this much quiet. */
export const MIC_QUIET_MS = 2_000;
/** The listening page sent nothing for this long: nobody listens (checked with the stops). */
const MIC_GONE_MS = 10_000;
/** Language switches a page may make per minute (each opens and closes a paid stream: audit 30). */
export const LANG_SWITCHES_PER_MIN = 10;
/** Wrong reader codes an address may try per 10 minutes (IPv6 per /48: audit 30). */
export const CODE_FAILS_MAX = 20;
/** A channel nobody uses is forgotten after this long (its code with it). */
const IDLE_CHANNEL_MS = 10 * 60_000;
/** No words this long: nobody talks (a phone forgotten in a bag), the session stops (as /live's). */
export const QUIET_STOP_MS = 15 * 60_000;
/** A session stops after this long unless the host keeps it going (a TV keeps words coming). */
export const HOURS_MS = 4 * 3_600_000;
/** "Still listening?" shows this long before that stop. */
export const ASK_MS = 10 * 60_000;
/**
 * A language nobody reads any more stays this long (its stream and its lines): a reader whose phone
 * locked comes back to it at once (as /live's). It makes room when a new language needs it.
 */
export const LANG_KEEP_MS = 10 * 60_000;
/** Pages open at once from one address (IPv6 per /64): a family on one Wi-Fi shares one (as /live's). */
export const PAGES_PER_IP_MAX = 50;
/** The error a page over that gets: it says so and tries again by itself. */
export const TOO_MANY_PAGES = 'too-many-pages';
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
  /** Face to face: the other person's language, the top half's (kept over a reconnect). */
  hostOther: Target | null;
  stopped?: StopReason;
  stoppedAt?: number;
  /** The running session's ledger row, its cost so far, and what of it is written. */
  row?: number;
  cost: number;
  written: number;
  /** The balance at the last write (the credits run out between writes too). */
  balanceAt: number;
  seconds: number;
  flushedAt: number;
  micSocket?: string;
  micAt: number;
  /** What the listening page is on (the other pages say "Listening on your phone"). */
  micKind: DeviceKind;
  /** Chosen (Start, "Use this one") and not yet heard from. */
  micChosen?: boolean;
  /** The last chunk number per audio stream of the page (a resend is confirmed, not used twice). */
  seqs: Map<string, number>;
  /** Its pages, host's and readers' (audit 30: never a scan of every socket). */
  sockets: Set<S>;
  textTimer?: NodeJS.Timeout;
  idleSince: number;
  /** Languages nobody reads now, kept until a while after their last page left (LANG_KEEP_MS). */
  kept: Map<Target, number>;
  /** When words last came (the quiet stop) and when the running session's hours are up. */
  wordsAt: number;
  keepUntil: number;
}

interface Data {
  channel: Channel;
  role: 'host' | 'reader';
  lang: Target | null;
  /** Face to face (the host's page): the top half's language too. */
  other?: Target | null;
  personId?: number;
  deviceId?: number;
  kind: DeviceKind;
}
type S = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, Data>;

export interface RealtimeOptions {
  store: Store;
  speech: SpeechConnect | null;
  streams: number;
  trustProxy: TrustProxy;
  now?: () => number;
  warn?: (m: string) => void;
}

const codeBucket = wideBucket;

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
      // (always with a letter: six digits are a sign-in code, the one door tells them apart)
      if (!byCode.has(code) && /[A-Z]/.test(code)) return code;
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
      hostOther: null,
      cost: 0,
      written: 0,
      balanceAt: 0,
      seconds: 0,
      flushedAt: now(),
      micAt: 0,
      micKind: 'phone',
      seqs: new Map(),
      sockets: new Set(),
      idleSince: now(),
      wordsAt: 0,
      keepUntil: 0,
      kept: new Map(),
      engine: undefined as unknown as Engine,
    };
    ch.engine = new Engine(o.speech, {
      onText: () => {
        ch.wordsAt = now();
        textSoon(ch);
      },
      onStatus: () => stateAll(ch),
      onSent: (ms, streams) => sent(ch, ms, streams),
      now,
      warn,
      pool,
    });
    byPerson.set(p.id, ch);
    byCode.set(code, ch);
    return ch;
  }

  /** The languages a channel's pages read now: the host's first (its stream also gives what is heard). */
  function readNow(c: Channel): Target[] {
    const all = [
      c.hostLang,
      c.hostOther,
      ...[...c.sockets].flatMap((s) => [s.data.lang, s.data.other ?? null]),
    ].filter((l): l is Target => !!l && l !== HEARD);
    return [...new Set(all)];
  }

  /** What the channel captions: the languages read now and those kept a while after. */
  function langsOf(c: Channel): Target[] {
    const read = readNow(c);
    return [...read, ...[...c.kept.keys()].filter((l) => !read.includes(l))];
  }

  /**
   * Pages changed what they read (one left, switched, or came): a language read before and not now
   * is kept (LANG_KEEP_MS), one read now is no longer only kept; then the streams follow.
   */
  function readersChanged(c: Channel, before: readonly Target[]) {
    const read = readNow(c);
    for (const l of before) if (!read.includes(l)) c.kept.set(l, now());
    for (const l of read) c.kept.delete(l);
    c.engine.setLangs(langsOf(c));
    fullChanged(c, before);
  }

  /** Full, or no longer: the pages' language lists say which three (running or not, audit 33). */
  function fullChanged(c: Channel, before: readonly Target[]) {
    const full = (l: readonly Target[]) =>
      l.length >= CHANNEL_LANGS_MAX ? [...l].sort().join() : '';
    if (full(before) !== full(readNow(c))) stateAll(c);
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
      ...(s.data.other !== undefined ? { other: s.data.other } : {}),
      ...(c.stopped ? { stopped: c.stopped } : {}),
      ...(!c.running && c.stoppedAt ? { stoppedAt: c.stoppedAt } : {}),
    };
    const read = readNow(c);
    if (read.length >= CHANNEL_LANGS_MAX) v.full = read;
    if (s.data.role === 'host') {
      v.code = c.code;
      v.codeUntil = c.codeUntil;
      v.balance = o.store.balance(c.personId) - (c.cost - c.written);
      if (c.running && now() >= c.keepUntil - ASK_MS) v.stopsAt = c.keepUntil;
      if (c.running && c.micSocket) v.mic = { here: c.micSocket === s.id, on: c.micKind };
    }
    return v;
  }

  function stateAll(c: Channel) {
    for (const s of c.sockets) s.emit('state:session', view(s));
  }

  function textSoon(c: Channel) {
    c.textTimer ??= setTimeout(() => {
      c.textTimer = undefined;
      for (const s of c.sockets) {
        s.emit('captions', c.engine.update(s.data.lang, false, s.data.other));
      }
    }, TEXT_EVERY_MS);
  }

  /** Audio went to the speech service: its cost counts now, written every FLUSH_MS. Never throws. */
  function sent(c: Channel, ms: number, streams: number) {
    try {
      const price = o.store.settings().pricePerHour;
      c.cost += (ms * streams * price) / 3_600_000;
      c.seconds += ms / 1000;
      // (written every FLUSH_MS, and at once when the credits run out: never minutes past zero)
      if (now() - c.flushedAt >= FLUSH_MS || c.balanceAt - (c.cost - c.written) <= 0) flush(c);
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
    c.balanceAt = o.store.balance(c.personId);
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
    if (c.running) c.stoppedAt = now();
    c.running = false;
    c.stopped = why;
    c.row = undefined;
    c.cost = 0;
    c.written = 0;
    c.seconds = 0;
    c.seqs.clear();
    c.kept.clear();
    c.micSocket = undefined;
    asked.delete(c);
    c.engine.discard();
    c.idleSince = now();
    stateAll(c);
    textSoon(c);
  }

  /** A channel goes for good: its pages are closed, its code no longer lets anyone in. */
  function drop(c: Channel) {
    stop(c, 'blocked', false);
    asked.delete(c);
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
    c.balanceAt = o.store.balance(personId); // (a grant or a correction: the new balance)
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

  /**
   * Sessions that run without anyone: no words for QUIET_STOP_MS, or their hours are up; the
   * host's pages are asked first ("Still listening?") from ASK_MS before (as /live's).
   */
  const asked = new Set<Channel>();
  function checkStops() {
    for (const c of byPerson.values()) {
      if (!c.running) continue;
      const t = now();
      // (kept languages nobody came back to: their streams end)
      let dropped = false;
      for (const [l, at] of c.kept) {
        if (t - at < LANG_KEEP_MS) continue;
        c.kept.delete(l);
        dropped = true;
      }
      if (dropped) c.engine.setLangs(langsOf(c));
      // (the listening page went quiet: nobody listens, every page says so)
      if (c.micSocket && t - c.micAt >= MIC_GONE_MS) {
        c.micSocket = undefined;
        stateAll(c);
      }
      if (t - c.wordsAt >= QUIET_STOP_MS) stop(c, 'quiet');
      else if (t >= c.keepUntil) stop(c, 'hours');
      else if (t >= c.keepUntil - ASK_MS && !asked.has(c)) {
        asked.add(c);
        stateAll(c);
      }
    }
  }
  const stops = setInterval(checkStops, 15_000);
  stops.unref();

  // forget channels nobody uses
  const tidy = setInterval(() => {
    for (const c of byPerson.values()) {
      if (c.running || c.sockets.size) {
        c.idleSince = now();
        continue;
      }
      if (now() - c.idleSince < IDLE_CHANNEL_MS) continue;
      asked.delete(c);
      c.engine.close();
      byPerson.delete(c.personId);
      byCode.delete(c.code);
    }
  }, 60_000);
  tidy.unref();

  // pages open per address (PAGES_PER_IP_MAX)
  const perIp = new Map<string, number>();
  const addressOf = (s: S) =>
    ipBucket(clientIp({ headers: s.handshake.headers, socket: s.request.socket }, o.trustProxy));

  io.use((s, next) => {
    if ((perIp.get(addressOf(s)) ?? 0) >= PAGES_PER_IP_MAX) return next(new Error(TOO_MANY_PAGES));
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
      // (a running session lets its readers back in, however old its code: audit, the review)
      if (!c || (c.codeUntil < now() && !c.running)) {
        codeFails.record(ip, now());
        return next(new Error('no-session'));
      }
      s.data = { channel: c, role: 'reader', lang: null, kind: 'phone' };
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
      kind: deviceKind(s.handshake.headers['user-agent'] ?? ''),
    };
    next();
  });

  io.on('connection', (s) => {
    const address = addressOf(s);
    perIp.set(address, (perIp.get(address) ?? 0) + 1);
    s.once('disconnect', () => {
      const n = (perIp.get(address) ?? 1) - 1;
      if (n > 0) perIp.set(address, n);
      else perIp.delete(address);
    });
    const c = s.data.channel;
    // (a channel dropped while this socket was being let in)
    if (byPerson.get(c.personId) !== c) return void s.disconnect(true);
    c.sockets.add(s);
    // (a host gets their own languages back; a reader starts in the host's)
    s.data.lang = c.hostLang;
    if (s.data.role === 'host' && c.hostOther) s.data.other = c.hostOther;
    s.emit('state:session', view(s));
    s.emit('captions', c.engine.update(s.data.lang, true, s.data.other));

    const reply = (cb: unknown, r: Ack) => {
      if (typeof cb === 'function') (cb as (r: Ack) => void)(r);
    };
    const host = () => s.data.role === 'host' && s.data.personId === c.personId;

    const asLang = (v: unknown): Target | null | undefined =>
      v === null || v === HEARD ? null : isTarget(v) ? v : undefined;

    /**
     * A page's languages: its own (null or HEARD = what is heard only) and, face to face (the host's
     * page only), the top half's (`other`; left out = one column).
     */
    function setLang(p: unknown): Ack {
      const o = (typeof p === 'object' && p ? p : {}) as { lang?: unknown; other?: unknown };
      const next = asLang(o.lang ?? null);
      const two = host() && o.other !== undefined;
      const nextOther = two ? asLang(o.other) : undefined;
      if (next === undefined || (two && nextOther === undefined)) {
        return { ok: false, error: 'bad-lang' };
      }
      if (next === s.data.lang && nextOther === s.data.other) return { ok: true };
      if (!langSwitches.take(s.id, now())) return { ok: false, error: 'too-many' };
      const langs = new Set(langsOf(c));
      const added = [...new Set([next, nextOther])].filter(
        (l): l is Target => !!l && !langs.has(l),
      );
      for (const l of added) {
        // (a kept language nobody reads makes room first: the oldest)
        const oldest = [...c.kept.entries()].sort((a, b) => a[1] - b[1])[0]?.[0];
        if (langs.size >= CHANNEL_LANGS_MAX && oldest) {
          c.kept.delete(oldest);
          langs.delete(oldest);
        }
        if (langs.size >= CHANNEL_LANGS_MAX) return { ok: false, error: 'too-many-langs' };
        langs.add(l);
      }
      if (added.length && c.running && !c.engine.canAdd(added.length)) {
        return { ok: false, error: 'service-full' };
      }
      const before = readNow(c);
      s.data.lang = next;
      if (two) s.data.other = nextOther;
      else delete s.data.other;
      if (host()) {
        c.hostLang = next;
        c.hostOther = two ? (nextOther ?? null) : null;
      }
      // (a page sees a language new to the channel from now on: its history starts there; a kept
      // one comes back with its lines)
      for (const l of added) c.engine.clearText(l);
      readersChanged(c, before);
      s.emit('state:session', view(s));
      s.emit('captions', c.engine.update(next, true, s.data.other));
      return { ok: true };
    }

    s.on('session:lang', (p, cb) => reply(cb, setLang(p)));

    s.on('session:start', (p, cb) => {
      if (!host()) return reply(cb, { ok: false, error: 'not-host' });
      const why = cannotRun(c.personId);
      if (why) {
        c.stopped = why;
        stateAll(c);
        return reply(cb, { ok: false, error: why });
      }
      const r = setLang(p);
      if (!r.ok) return reply(cb, r);
      // (a new session: no language left over from pages gone since)
      if (!c.running) c.kept.clear();
      c.engine.setLangs(langsOf(c));
      if (!c.running) {
        c.running = true;
        c.stopped = undefined;
        c.wordsAt = now();
        c.keepUntil = now() + HOURS_MS;
        asked.delete(c);
        c.flushedAt = now();
        c.balanceAt = o.store.balance(c.personId);
        // (a new day: a new code, the old one no longer lets anyone in)
        if (c.codeUntil < now()) {
          byCode.delete(c.code);
          c.code = newCode();
          byCode.set(c.code, c);
        }
        // (the code lasts a day from the last Start: never out an hour into a session)
        c.codeUntil = now() + CODE_MS;
      }
      listenHere();
      reply(cb, { ok: true });
    });

    /** This page's microphone is the one that listens (the others stop sending theirs). */
    /** `chosen`: by Start or "Use this one": kept until it sends, however slow its microphone. */
    function listenHere(chosen = true) {
      c.micSocket = s.id;
      c.micAt = now();
      c.micChosen = chosen;
      c.micKind = s.data.kind;
      stateAll(c);
    }

    s.on('session:useMic', (cb) => {
      if (!host() || !c.running) return reply(cb, { ok: false, error: 'not-host' });
      listenHere();
      reply(cb, { ok: true });
    });

    s.on('session:stop', (cb) => {
      if (!host()) return reply(cb, { ok: false, error: 'not-host' });
      stop(c, 'ended');
      reply(cb, { ok: true });
    });

    s.on('session:keepGoing', (cb) => {
      if (!host() || !c.running) return reply(cb, { ok: false, error: 'not-host' });
      c.keepUntil = now() + HOURS_MS;
      asked.delete(c);
      stateAll(c);
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
      // (one chosen by Start or "Use this one" waits for its own audio, up to MIC_GONE_MS, audit 33)
      const quiet = c.micChosen ? MIC_GONE_MS : MIC_QUIET_MS;
      if (c.micSocket !== s.id && now() - c.micAt < quiet) return;
      if (c.micSocket !== s.id) listenHere(false);
      c.micChosen = false;
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
      const before = readNow(c);
      c.sockets.delete(s);
      if (c.micSocket === s.id) {
        c.micSocket = undefined;
        stateAll(c);
      }
      // (a language nobody reads any more: kept a while, then its stream ends)
      if (c.running) readersChanged(c, before);
      else {
        c.engine.setLangs(langsOf(c));
        fullChanged(c, before);
      }
      c.idleSince = now();
    });
  });

  return {
    io,
    personChanged,
    signedOut,
    /** The automatic stops, at once (tests; the server checks every 15 s). */
    checkStops,
    /** For the admin: sessions running now. */
    running: () => [...byPerson.values()].filter((c) => c.running).length,
    close() {
      clearInterval(tidy);
      clearInterval(stops);
      for (const c of byPerson.values()) {
        if (c.running) flush(c, false);
        c.engine.close();
      }
      io.engine.close();
    },
  };
}
export type Realtime = ReturnType<typeof attachRealtime>;
