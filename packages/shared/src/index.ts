// What the server and the pages share: the socket's events and the views it sends. Money is in
// micro-euros (1 € = 1,000,000) everywhere: a minute of captions costs a fraction of a cent.

// The captions' own words come from the engine (one definition): a Target is a language code the
// speech service knows (ISO 639-1, e.g. "en", "tl"), or HEARD: no translation.
export {
  HEARD,
  type CaptionText,
  type CaptionsUpdate,
  type ServiceState,
  type Target,
} from '@translate/engine/types';
import {
  HEARD,
  type CaptionsUpdate,
  type ServiceState,
  type Target,
} from '@translate/engine/types';

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
/** A language code as the speech service names them, or HEARD for none. */
export const isTarget = (v: unknown): v is Target => v === HEARD || isSpeechLang(v);

export const isSpeechLang = (v: unknown): v is string =>
  typeof v === 'string' && (SPEECH_LANGS as readonly string[]).includes(v);

/** A session's state as one page sees it. */
export interface SessionView {
  /** `guest`: a page that came by the code and captions its own side of a call (mockups batch 4). */
  role: 'host' | 'reader' | 'guest';
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
  /** The host only, while it runs: which page's microphone listens (`here`: this one) and on what. */
  mic?: { here: boolean; on: DeviceKind };
  /** The host only: when the code stops letting new readers in (a day after the last Start). */
  codeUntil?: number;
  /** Not running: when it last stopped ("Marta stopped at 18:40"). */
  stoppedAt?: number;
  /** The session reads as many languages as it may: these (a reader picks one of them). */
  full?: Target[];
  /** The host lets a page with the code caption its own side of a call, on the host's balance. */
  guestAllowed?: boolean;
  /** The host only: a guest's captions run now (on this balance). */
  guestRunning?: boolean;
  /** A guest only: the host's own captions run (a guest may start only then). */
  hostRunning?: boolean;
  /** Who said what is shown (a colour per person, mockups batch 8): the host's switch. */
  speakers?: boolean;
  /** Both sides of a call: the window's microphone in its own colour (mockups batch 9). */
  bothSides?: boolean;
}

/** A device as people name it: "your phone", "your tablet", "your computer". */
export type DeviceKind = 'phone' | 'tablet' | 'computer';
/** From the browser's user agent (an iPad that says it is a Mac counts as a computer). */
export function deviceKind(ua: string): DeviceKind {
  if (/iPad|Tablet|Android(?!.*Mobile)/.test(ua)) return 'tablet';
  if (/Mobi|iPhone|iPod|Android/.test(ua)) return 'phone';
  return 'computer';
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
  /** Both sides of a call: this chunk is the window's microphone (the session's own sound otherwise). */
  side?: 'you';
}

export interface ClientToServerEvents {
  'session:start': Action<{ lang: Target | null; other?: Target | null }>;
  'session:stop': Action;
  /** The host: the session goes on for another few hours ("Still listening?"). */
  'session:keepGoing': Action;
  /** The host: this page's microphone listens from now on (the other page's stops). */
  'session:useMic': Action;
  /** The host: a page with the code may caption its own side of the call (off by default). */
  'session:guestAllow': Action<{ on: boolean }>;
  /** The host: the guest's captions end (the host's own go on). */
  'session:stopGuest': Action;
  /** The host: who said what on or off (the session's streams start again). */
  'session:speakers': Action<{ on: boolean }>;
  /** The host: both sides of a call on or off (the microphone's own streams). */
  'session:bothSides': Action<{ on: boolean }>;
  /** A page that came by the code: captions of its own sound, on the host's balance. */
  /** `token`: the page's own random token (its reconnected page takes its place back). */
  'guest:start': Action<{ lang: Target | null; token: string }>;
  'guest:lang': Action<{ lang: Target | null }>;
  'guest:stop': Action;
  /** The page's language (host or reader): null = what is heard only. */
  'session:lang': Action<{ lang: Target | null; other?: Target | null }>;
  'host:audio': (chunk: ArrayBuffer, meta: AudioMeta) => void;
}

export interface ServerToClientEvents {
  'state:session': (s: SessionView) => void;
  captions: (u: CaptionsUpdate) => void;
  /** A chunk came (`stream`: which of the page's audio streams: both sides send two). */
  'captions:ack': (seq: number, stream?: string) => void;
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
export const LOW_BALANCE = 500_000;
