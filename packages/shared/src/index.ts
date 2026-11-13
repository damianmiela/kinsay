// What the server and the pages share: the socket's events and the views it sends. Money is in
// micro-euros (1 € = 1,000,000) everywhere: a minute of captions costs a fraction of a cent.

/** A language code the speech service knows (ISO 639-1, e.g. "en", "tl"), or "heard": no translation. */
export type Target = string;
export const HEARD = 'heard';

/**
 * The speech service's languages, every one of them a translation target too (Soniox's list,
 * checked 2026-11-12: docs.soniox.com/stt/concepts/supported-languages). Pages name them with the
 * browser's Intl.DisplayNames.
 */
export const SPEECH_LANGS = [
  'af',
  'sq',
  'ar',
  'az',
  'eu',
  'be',
  'bn',
  'bs',
  'bg',
  'ca',
  'zh',
  'hr',
  'cs',
  'da',
  'nl',
  'en',
  'et',
  'fi',
  'fr',
  'gl',
  'de',
  'el',
  'gu',
  'he',
  'hi',
  'hu',
  'id',
  'it',
  'ja',
  'kn',
  'kk',
  'ko',
  'lv',
  'lt',
  'mk',
  'ms',
  'ml',
  'mr',
  'no',
  'fa',
  'pl',
  'pt',
  'pa',
  'ro',
  'ru',
  'sr',
  'sk',
  'sl',
  'es',
  'sw',
  'sv',
  'tl',
  'ta',
  'te',
  'th',
  'tr',
  'uk',
  'ur',
  'vi',
  'cy',
] as const;
export const isSpeechLang = (v: unknown): v is string =>
  typeof v === 'string' && (SPEECH_LANGS as readonly string[]).includes(v);

/** One text's caption lines: finished ones (numbered from `first`) and the one coming in. */
export interface CaptionText {
  lines: string[];
  /** The number of `lines[0]` since the last clear (a page adds lines up by number). */
  first: number;
  live: string;
}

/** Every finished line's language as heard, by the line's number (the "heard" text only). */
export interface CaptionsUpdate {
  /** "heard" (what was recognized) and the page's language, if it reads one. */
  texts: Partial<Record<Target, CaptionText>>;
  /** The language of the last words heard (a code), while someone speaks. */
  speaking?: string;
  /** "heard": the language each line was heard in, by line number (for the labels). */
  heardLangs?: Record<number, string>;
}

export type ServiceState = 'off' | 'idle' | 'live' | 'error';

/** A session's state as one page sees it. */
export interface SessionView {
  role: 'host' | 'reader';
  /** The code readers join with (the host only). */
  code?: string;
  /** The host's first name (readers see it). */
  hostName: string;
  running: boolean;
  service: ServiceState;
  error?: string;
  /** This page's translation language (null: what is heard only). */
  lang: Target | null;
  /** Face to face (the host's page): the top half's language, the other person's. */
  other?: Target | null;
  /** The host only: credits left, in micro-euros. */
  balance?: number;
  /** Why the session can't go on, for the page to say (see STOP_REASONS). */
  stopped?: StopReason;
  /** The host only, shortly before: the session stops at this time unless they keep it going. */
  stopsAt?: number;
}
/** Why a session stopped: `quiet` no words for a while, `hours` its hours were up (as /live's). */
export type StopReason = 'credits' | 'monthly' | 'global' | 'ended' | 'blocked' | 'quiet' | 'hours';

/** Every socket action answers with this. */
export type Ack = { ok: true } | { ok: false; error: string };
type Action<P = void> = P extends void
  ? (reply: (r: Ack) => void) => void
  : (payload: P, reply: (r: Ack) => void) => void;

export interface AudioMeta {
  /** How long ago it was recorded (ms, the page's clock). */
  age: number;
  /** Its number in the page's stream of audio (confirmed with `captions:ack`). */
  seq: number;
  stream: string;
}

export interface ClientToServerEvents {
  'session:start': Action<{ lang: Target | null; other?: Target | null }>;
  'session:stop': Action;
  /** The host: the session goes on for another few hours ("Still listening?"). */
  'session:keepGoing': Action;
  /** The page's language (host or reader): null = what is heard only. */
  'session:lang': Action<{ lang: Target | null; other?: Target | null }>;
  'host:audio': (chunk: ArrayBuffer, meta: AudioMeta) => void;
}

export interface ServerToClientEvents {
  'state:session': (s: SessionView) => void;
  captions: (u: CaptionsUpdate) => void;
  'captions:ack': (seq: number) => void;
}

/** What a signed-in person sees of their account. */
export interface AccountView {
  name: string;
  balance: number;
  history: {
    at: string;
    kind: LedgerKind;
    amount: number;
    note?: string;
    lang?: string;
    seconds?: number;
  }[];
  requests: { id: number; at: string; amount: number; state: RequestState }[];
  devices: { id: number; label: string; lastSeen: string; current: boolean }[];
}
export type LedgerKind = 'welcome' | 'grant' | 'use' | 'correction';
export type RequestState = 'waiting' | 'granted' | 'declined';

/** Euros for people: "€0.84" (2 decimals; small amounts never show as €0.00 when above zero). */
export function euros(micro: number): string {
  const cents = micro / 10_000;
  const shown = micro > 0 && cents < 1 ? Math.ceil(cents) / 100 : Math.floor(cents) / 100;
  return `€${shown.toFixed(2)}`;
}
export const EUR = 1_000_000;

/** One-tap grants and the "ask for more" amounts (Damian, 2026-11-12). */
export const GRANT_STEPS = [1, 2, 5, 10].map((e) => e * EUR);
export const WELCOME = 1 * EUR;
/** Below this the host's page warns once. */
export const LOW_BALANCE = 50_000;
