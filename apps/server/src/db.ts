// The app's one database (Node's own SQLite, a file in DATA_DIR): people (by invitation), their
// signed-in devices, sign-in codes, the credits ledger (rows are only added: grants, use,
// corrections), requests and settings. Secrets are stored hashed: a copy of the file signs nobody in.
// Money in micro-euros (1 € = 1,000,000).
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { WELCOME, type AccountView, type LedgerKind, type RequestState } from '@translate/shared';

export const sha256 = (s: string) => createHash('sha256').update(s).digest('base64url');
export const token = () => randomBytes(32).toString('base64url');

/** A device stays signed in this long after its last use (Damian: once, for older people). */
export const DEVICE_DAYS = 365;
/** A sign-in code (6 digits or its QR link) works once, for this long. */
export const CODE_MS = 10 * 60_000;
/** Invitation requests waiting at once, at most. */
export const INVITES_WAITING_MAX = 100;
/** An email's sign-in link: once, for this long. */
export const MAIL_LINK_MS = 15 * 60_000;

export interface Person {
  id: number;
  name: string;
  email: string | null;
  created: string;
  blocked: number;
  /** Their own monthly limit (micro-euros); null: the default from the settings. */
  monthly_limit: number | null;
}

export interface Settings {
  /** What one stream costs per hour of audio sent (micro-euros). */
  pricePerHour: number;
  /** Each person's monthly limit unless their own is set (micro-euros; 0: none). */
  monthlyLimit: number;
  /** Everyone's use together per month (micro-euros; 0: none). */
  globalLimit: number;
  /** Translate's share of Soniox's streams at once (the rest of the limit stays the wedding's). */
  streamShare: number;
}

const SCHEMA = `
create table if not exists people (
  id integer primary key autoincrement,
  name text not null,
  email text unique collate nocase,
  created text not null,
  blocked integer not null default 0,
  monthly_limit integer
);
create table if not exists devices (
  id integer primary key,
  person_id integer not null references people(id) on delete cascade,
  token_hash text not null unique,
  label text not null,
  created text not null,
  last_seen text not null
);
create table if not exists codes (
  id integer primary key,
  person_id integer not null references people(id) on delete cascade,
  digits_hash text not null,
  link_hash text not null unique,
  expires integer not null
);
create table if not exists ledger (
  id integer primary key,
  -- (null: a person deleted since: their use still counts for everyone's monthly limit)
  person_id integer references people(id) on delete set null,
  at text not null,
  kind text not null,
  amount integer not null,
  note text,
  lang text,
  seconds integer
);
create index if not exists ledger_person on ledger(person_id, at);
create table if not exists requests (
  id integer primary key,
  person_id integer references people(id) on delete cascade,
  email text,
  name text,
  kind text not null,
  amount integer,
  state text not null default 'waiting',
  at text not null
);
create table if not exists settings (key text primary key, value text not null);
`;

const iso = (ms: number) => new Date(ms).toISOString();
const monthStart = (now: number) => {
  const d = new Date(now);
  return iso(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
};

export class Store {
  readonly db: DatabaseSync;

  constructor(
    file: string,
    private readonly defaults: Settings,
    private readonly now: () => number = Date.now,
  ) {
    if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec('pragma journal_mode = wal; pragma foreign_keys = on;');
    this.db.exec(SCHEMA);
    // (each session's stream-seconds: audio × the streams it went to, for "Use and cost", 2026-11-13;
    // older rows have none)
    const cols = this.db.prepare('pragma table_info(ledger)').all() as { name: string }[];
    if (!cols.some((c) => c.name === 'stream_seconds')) {
      this.db.exec('alter table ledger add column stream_seconds integer');
    }
    // (invitation requests answered before answering deleted them, 2026-11-12)
    this.db.exec(`delete from requests where kind = 'invite' and state != 'waiting'`);
  }

  close() {
    this.db.close();
  }

  // ---------- settings ----------
  settings(): Settings {
    const rows = this.db.prepare('select key, value from settings').all() as {
      key: string;
      value: string;
    }[];
    const s = { ...this.defaults };
    for (const r of rows) if (r.key in s) s[r.key as keyof Settings] = Number(r.value);
    return s;
  }
  setSetting(key: keyof Settings, value: number) {
    this.db
      .prepare(
        'insert into settings (key, value) values (?, ?) on conflict(key) do update set value = excluded.value',
      )
      .run(key, String(value));
  }

  // ---------- people ----------
  person(id: number): Person | undefined {
    return this.db.prepare('select * from people where id = ?').get(id) as Person | undefined;
  }
  byEmail(email: string): Person | undefined {
    return this.db.prepare('select * from people where email = ?').get(email.trim()) as
      Person | undefined;
  }
  people(): (Person & { balance: number; month: number; last_seen: string | null })[] {
    return this.db
      .prepare(
        `select p.*, coalesce((select sum(amount) from ledger l where l.person_id = p.id), 0) balance,
          coalesce((select -sum(amount) from ledger l where l.person_id = p.id and kind = 'use' and at >= ?), 0) month,
          (select max(last_seen) from devices d where d.person_id = p.id) last_seen
         from people p order by p.name collate nocase`,
      )
      .all(monthStart(this.now())) as never;
  }

  /** Invites someone (email optional: Damian signs their device in himself). The welcome grant comes with it. */
  invite(name: string, email: string | null): Person {
    const at = iso(this.now());
    const r = this.db
      .prepare('insert into people (name, email, created) values (?, ?, ?)')
      .run(name.trim(), email?.trim() || null, at);
    const id = Number(r.lastInsertRowid);
    this.add(id, 'welcome', WELCOME);
    // a waiting invitation request for this email is answered: gone (its name and email are
    // kept only while it waits; the privacy page says so)
    if (email) {
      this.db
        .prepare(
          `delete from requests where kind = 'invite' and state = 'waiting' and email = ? collate nocase`,
        )
        .run(email.trim());
    }
    return this.person(id)!;
  }

  setPerson(
    id: number,
    change: { blocked?: boolean; monthlyLimit?: number | null; name?: string },
  ) {
    if (change.blocked !== undefined) {
      this.db.prepare('update people set blocked = ? where id = ?').run(change.blocked ? 1 : 0, id);
      if (change.blocked) this.db.prepare('delete from devices where person_id = ?').run(id);
    }
    if (change.monthlyLimit !== undefined) {
      this.db
        .prepare('update people set monthly_limit = ? where id = ?')
        .run(change.monthlyLimit, id);
    }
    if (change.name)
      this.db.prepare('update people set name = ? where id = ?').run(change.name.trim(), id);
  }

  deletePerson(id: number) {
    this.db.prepare('delete from people where id = ?').run(id);
  }

  // ---------- devices (a signed-in browser or app) ----------
  /** Signs a device in: its secret goes into the cookie, only its hash stays here. */
  signIn(personId: number, label: string): string {
    const t = token();
    const at = iso(this.now());
    this.db
      .prepare(
        'insert into devices (person_id, token_hash, label, created, last_seen) values (?, ?, ?, ?, ?)',
      )
      .run(personId, sha256(t), label.slice(0, 80), at, at);
    return t;
  }

  /** The person a device's secret belongs to (a year since its last use at most; blocked: nobody). */
  device(t: string | undefined): { person: Person; deviceId: number } | undefined {
    if (!t) return undefined;
    const d = this.db
      .prepare('select id, person_id, last_seen from devices where token_hash = ?')
      .get(sha256(t)) as { id: number; person_id: number; last_seen: string } | undefined;
    if (!d) return undefined;
    const now = this.now();
    if (now - Date.parse(d.last_seen) > DEVICE_DAYS * 86_400_000) {
      this.db.prepare('delete from devices where id = ?').run(d.id);
      return undefined;
    }
    const person = this.person(d.person_id);
    if (!person || person.blocked) return undefined;
    // (seen: written at most once an hour)
    if (now - Date.parse(d.last_seen) > 3_600_000) {
      this.db.prepare('update devices set last_seen = ? where id = ?').run(iso(now), d.id);
    }
    return { person, deviceId: d.id };
  }

  /** True when that device was signed in (and, with `personId`, theirs). */
  signOut(deviceId: number, personId?: number): boolean {
    const r =
      personId === undefined
        ? this.db.prepare('delete from devices where id = ?').run(deviceId)
        : this.db
            .prepare('delete from devices where id = ? and person_id = ?')
            .run(deviceId, personId);
    return Number(r.changes) > 0;
  }
  signOutAll(personId: number) {
    this.db.prepare('delete from devices where person_id = ?').run(personId);
  }

  // ---------- sign-in codes (Damian signs a device in for someone) ----------
  /** A new code for a person: 6 digits to type, a link for the QR code. Older ones of theirs go. */
  newCode(
    personId: number,
    ms = CODE_MS,
    withDigits = true,
  ): { digits: string; link: string; expires: number } {
    const digits = withDigits ? String(randomInt(0, 1_000_000)).padStart(6, '0') : '';
    const link = token();
    const expires = this.now() + ms;
    // an email's link has no digits to type (they would be more codes to guess, audit 30) and
    // leaves the codes Damian made alone; the admin's new code replaces the person's older ones
    if (withDigits) {
      this.db
        .prepare('delete from codes where person_id = ? or expires < ?')
        .run(personId, this.now());
    } else {
      this.db.prepare('delete from codes where expires < ?').run(this.now());
    }
    this.db
      .prepare('insert into codes (person_id, digits_hash, link_hash, expires) values (?, ?, ?, ?)')
      .run(personId, withDigits ? sha256(digits) : `none.${token()}`, sha256(link), expires);
    return { digits, link, expires };
  }

  /** A code typed or scanned: the person it was for, once (it is used up). */
  useCode(kind: 'digits' | 'link', value: string): Person | undefined {
    const col = kind === 'digits' ? 'digits_hash' : 'link_hash';
    const c = this.db
      .prepare(`select id, person_id from codes where ${col} = ? and expires >= ?`)
      .get(sha256(value), this.now()) as { id: number; person_id: number } | undefined;
    if (!c) return undefined;
    this.db.prepare('delete from codes where id = ?').run(c.id);
    const p = this.person(c.person_id);
    return p && !p.blocked ? p : undefined;
  }

  // ---------- the ledger ----------
  add(
    personId: number,
    kind: LedgerKind,
    amount: number,
    extra: { note?: string; lang?: string; seconds?: number; streamSeconds?: number } = {},
  ): number {
    const r = this.db
      .prepare(
        'insert into ledger (person_id, at, kind, amount, note, lang, seconds, stream_seconds) values (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        personId,
        iso(this.now()),
        kind,
        Math.round(amount),
        extra.note ?? null,
        extra.lang ?? null,
        extra.seconds ?? null,
        extra.streamSeconds === undefined ? null : Math.round(extra.streamSeconds),
      );
    return Number(r.lastInsertRowid);
  }

  /**
   * A session's use: one row per session, brought up to date every minute (a crash loses at most
   * a minute of it). The only row that changes is the running session's own.
   */
  setUse(rowId: number, amount: number, lang: string, seconds: number, streamSeconds: number) {
    this.db
      .prepare(
        `update ledger set amount = ?, lang = ?, seconds = ?, stream_seconds = ? where id = ? and kind = 'use'`,
      )
      .run(-Math.round(amount), lang, Math.round(seconds), Math.round(streamSeconds), rowId);
  }

  /**
   * Everyone's use per UTC day in [from, to) (ISO times; a session counts on the day it began):
   * sessions, what was charged (micro-euros), stream-seconds (null rows: older sessions, counted
   * apart).
   */
  usageByDay(from: string, to: string) {
    return this.db
      .prepare(
        `select substr(at, 1, 10) as day, count(*) as sessions, -sum(amount) as charged,
           coalesce(sum(stream_seconds), 0) as streamSeconds,
           sum(case when stream_seconds is null then 1 else 0 end) as unknown
         from ledger where kind = 'use' and at >= ? and at < ? group by day order by day desc`,
      )
      .all(from, to) as {
      day: string;
      sessions: number;
      charged: number;
      streamSeconds: number;
      unknown: number;
    }[];
  }

  balance(personId: number): number {
    const r = this.db
      .prepare('select coalesce(sum(amount), 0) b from ledger where person_id = ?')
      .get(personId) as {
      b: number;
    };
    return Number(r.b);
  }

  /** Use this month: one person's, or everyone's (micro-euros, a positive number). */
  monthUse(personId?: number): number {
    const start = monthStart(this.now());
    const r = (
      personId === undefined
        ? this.db
            .prepare(
              `select coalesce(-sum(amount), 0) u from ledger where kind = 'use' and at >= ?`,
            )
            .get(start)
        : this.db
            .prepare(
              `select coalesce(-sum(amount), 0) u from ledger where kind = 'use' and at >= ? and person_id = ?`,
            )
            .get(start, personId)
    ) as { u: number };
    return Number(r.u);
  }

  limitOf(p: Person): number {
    return p.monthly_limit ?? this.settings().monthlyLimit;
  }

  // ---------- requests ----------
  askCredits(personId: number, amount: number): boolean {
    const waiting = this.db
      .prepare(
        `select 1 from requests where person_id = ? and kind = 'credits' and state = 'waiting'`,
      )
      .get(personId);
    if (waiting) return false; // (one at a time)
    this.db
      .prepare(`insert into requests (person_id, kind, amount, at) values (?, 'credits', ?, ?)`)
      .run(personId, amount, iso(this.now()));
    return true;
  }

  /** False when too many invitations wait already (anyone can ask: audit 30). */
  askInvite(name: string, email: string): boolean {
    if (this.byEmail(email)) return true;
    const waiting = this.db
      .prepare(
        `select 1 from requests where kind = 'invite' and state = 'waiting' and email = ? collate nocase`,
      )
      .get(email.trim());
    if (waiting) return true;
    const all = this.db
      .prepare(`select count(*) n from requests where kind = 'invite' and state = 'waiting'`)
      .get() as { n: number };
    if (Number(all.n) >= INVITES_WAITING_MAX) return false;
    this.db
      .prepare(`insert into requests (email, name, kind, at) values (?, ?, 'invite', ?)`)
      .run(email.trim(), name.trim(), iso(this.now()));
    return true;
  }

  waitingRequests() {
    return this.db
      .prepare(
        `select r.id, r.kind, r.amount, r.email, r.at, coalesce(p.name, r.name) name, p.email person_email, r.person_id,
          (select coalesce(sum(amount), 0) from ledger l where l.person_id = r.person_id) balance
         from requests r left join people p on p.id = r.person_id where r.state = 'waiting' order by r.at`,
      )
      .all() as {
      id: number;
      kind: 'credits' | 'invite';
      amount: number | null;
      email: string | null;
      at: string;
      name: string;
      person_email: string | null;
      person_id: number | null;
      balance: number;
    }[];
  }

  request(id: number) {
    return this.db.prepare('select * from requests where id = ?').get(id) as
      | {
          id: number;
          person_id: number | null;
          email: string | null;
          name: string | null;
          kind: string;
          amount: number | null;
          state: RequestState;
        }
      | undefined;
  }

  answer(id: number, state: Exclude<RequestState, 'waiting'>) {
    // (an invitation request answered is gone: its name and email are kept only while it waits)
    this.db.prepare(`delete from requests where id = ? and kind = 'invite'`).run(id);
    this.db
      .prepare(`update requests set state = ? where id = ? and state = 'waiting'`)
      .run(state, id);
  }

  // ---------- what a person sees ----------
  account(personId: number, deviceId: number): AccountView {
    const p = this.person(personId)!;
    const history = this.db
      .prepare(
        'select at, kind, amount, note, lang, seconds from ledger where person_id = ? order by id desc limit 100',
      )
      .all(personId) as AccountView['history'];
    const requests = this.db
      .prepare(
        `select id, at, amount, state from requests where person_id = ? and kind = 'credits' order by id desc limit 10`,
      )
      .all(personId) as AccountView['requests'];
    const devices = (
      this.db
        .prepare(
          'select id, label, last_seen from devices where person_id = ? order by last_seen desc',
        )
        .all(personId) as {
        id: number;
        label: string;
        last_seen: string;
      }[]
    ).map((d) => ({ id: d.id, label: d.label, lastSeen: d.last_seen, current: d.id === deviceId }));
    const clean = <T extends object>(o: T) =>
      Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null)) as T;
    return {
      name: p.name,
      balance: this.balance(personId),
      history: history.map(clean),
      requests,
      devices,
    };
  }
}
