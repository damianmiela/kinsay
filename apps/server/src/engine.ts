// The speech engine (taken over from the wedding app's captions, 2026-11-12): audio from a host's
// page goes to the speech service (Soniox), one stream per language that is read; what comes back
// becomes caption lines. Nothing is stored: lines live in memory while the session runs.
// What Soniox sends (checked in the wedding's W1): per stream, words as tokens marked "original"
// (heard, another language), "none" (heard, already in this stream's language) or "translation";
// final tokens come once, non-final ones are a preview the next message replaces; "<end>" marks a
// pause. Translations come final only, in chunks. A stream without translation gives what is heard.
import {
  HEARD,
  isSpeechLang,
  type CaptionText,
  type CaptionsUpdate,
  type ServiceState,
  type Target,
} from '@translate/shared';

export interface Token {
  text: string;
  is_final?: boolean;
  translation_status?: string;
  language?: string;
}

/** One live stream to the speech service, translating into one language (or none: HEARD). */
export interface SpeechStream {
  send(chunk: Uint8Array): void;
  /** Ends the stream (what's pending is finished first). */
  end(): void;
  /** The connection is open: audio sent now reaches the service (missing: always, the tests). */
  ready?(): boolean;
  /** Asks the service to finish what it has now (the watchdog's first step). */
  finalize?(): void;
  /** Closes the connection at once, its last words lost. */
  abort?(): void;
}
export interface SpeechEvents {
  tokens(tokens: Token[]): void;
  /** The stream is over: normally (no error) or with the service's error message. */
  closed(error?: string): void;
}
export type SpeechConnect = (target: Target, events: SpeechEvents) => SpeechStream;

const SONIOX_URL = 'wss://stt-rt.soniox.com/transcribe-websocket';
export const TOPIC = [
  { key: 'domain', value: 'Conversation' },
  { key: 'topic', value: 'A conversation among family and friends' },
];

export function sonioxConnect(apiKey: string, url = SONIOX_URL): SpeechConnect {
  return (target, events) => {
    // the key goes with the connection, never in the first message (Soniox refuses that from
    // 15 January 2027)
    const ws = new WebSocket(url, { headers: { Authorization: `Bearer ${apiKey}` } });
    let ending = false;
    let failed: string | undefined;
    // a handshake that never finishes: give up after 15 s (an error, then the usual retry)
    const handshake = setTimeout(() => {
      if (ws.readyState !== WebSocket.CONNECTING) return;
      failed = 'no answer from the speech service';
      ws.close();
    }, 15_000);
    ws.addEventListener('open', () => {
      clearTimeout(handshake);
      ws.send(
        JSON.stringify({
          model: 'stt-rt-v6',
          audio_format: 'pcm_s16le',
          sample_rate: 16000,
          num_channels: 1,
          enable_language_identification: true,
          enable_endpoint_detection: true,
          context: { general: TOPIC },
          ...(target === HEARD
            ? {}
            : { translation: { type: 'one_way', target_language: target } }),
        }),
      );
      if (ending) ws.send(''); // (an empty text frame ends the audio)
    });
    ws.addEventListener('message', ({ data }) => {
      let msg: {
        tokens?: Token[];
        finished?: boolean;
        error_code?: number;
        error_message?: string;
      };
      try {
        msg = JSON.parse(String(data)) as typeof msg;
      } catch {
        return;
      }
      if (!msg || typeof msg !== 'object') return;
      if (msg.error_code) {
        failed = `${msg.error_code} ${msg.error_message ?? ''}`.trim();
        ws.close(1000);
        return;
      }
      if (Array.isArray(msg.tokens) && msg.tokens.length) events.tokens(msg.tokens);
      if (msg.finished) ws.close(1000);
    });
    ws.addEventListener('close', (e) => {
      clearTimeout(handshake);
      events.closed(
        failed ??
          (e.code === 1000
            ? undefined
            : `connection closed (${e.code}${e.reason ? `: ${e.reason}` : ''})`),
      );
    });
    ws.addEventListener('error', () => {
      failed ??= "can't reach the speech service";
    });
    return {
      send(chunk) {
        if (ws.readyState === WebSocket.OPEN) ws.send(chunk);
      },
      ready: () => ws.readyState === WebSocket.OPEN,
      finalize() {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'finalize' }));
      },
      abort() {
        if (ws.readyState !== WebSocket.CLOSED) ws.close();
      },
      end() {
        ending = true;
        if (ws.readyState === WebSocket.OPEN) ws.send('');
        else if (ws.readyState === WebSocket.CONNECTING) ws.close();
      },
    };
  };
}

/** The streams the whole app may hold at once (Soniox counts them per organization). */
export class StreamPool {
  used = 0;
  constructor(readonly size: number) {}
  get free(): number {
    return this.size - this.used;
  }
}
/** A full pool for this long: said. */
export const FULL_WARN_MS = 5_000;
/** A stream we ended that hasn't closed after this long is closed by us and gives its place back. */
export const RELEASE_MS = 4_000;
/** While no stream can open, audio older than this goes. */
const FULL_KEEP_MS = 5_000;
/** The watchdog: words heard but nothing in the stream's language for this long: finalize, then restart. */
export const STALL_MS = 12_000;
export const STALL_PAUSE_MS = 3_000;
export const FINALIZE_WAIT_MS = 4_000;
export const STALL_GAP_MS = 30_000;
/** Finished lines kept per language: a page that comes gets them (its history). */
export const LINES_KEPT = 200;
/** Lines sent with every update. */
export const LINES_SENT = 6;
/** No audio for this long: the streams end (nothing is paid for silence). */
export const IDLE_MS = 10_000;
export const CLOSED_AT_ONCE_MS = 5_000;
/** Soniox caps a stream at 300 minutes: fresh streams well before. */
export const STREAM_MAX_MS = 280 * 60_000;
/** Audio kept while it can't go to the service (a break in the internet). */
export const BACKLOG_MAX_MS = 5 * 60_000;
export const CATCH_UP = 2;
const BUDGET_MAX_MS = 400;
/** 16 kHz 16-bit mono PCM. */
export const BYTES_PER_MS = 32;
const SENTENCE_MIN = 40;
const LINE_MAX = 160;
const CLAUSE_MIN = 50;
/** A preview word is shown to readers once it has stayed the same this long. */
export const SETTLE_MS = 1_200;

/** Where a too-long text is cut: after the last clause break, else at the last space. */
export function cutAt(text: string): number {
  const head = text.slice(0, LINE_MAX + 1);
  const clause = Math.max(
    ...[', ', '; ', ': ', ' – ', ' — '].map((b) => {
      const i = head.lastIndexOf(b);
      return i >= 0 ? i + b.trimEnd().length : -1;
    }),
  );
  if (clause >= CLAUSE_MIN) return clause;
  const space = head.lastIndexOf(' ', LINE_MAX);
  return space > 0 ? space : LINE_MAX;
}
const SENTENCE_END = /[.!?…]["»”)]?(?=\s|$)/g;
const isMarker = (text: string) => /^<.+>$/.test(text);

/** The caption lines of one text: finished lines, the line in progress, and a preview. */
export class LineBuilder {
  lines: string[] = [];
  count = 0;
  current = '';
  private words: { word: string; since: number }[] = [];
  private lead = '';
  private rawPreview = '';
  /** Called with each finished line and its number. */
  onLine?: (line: string, n: number) => void;

  constructor(private readonly now: () => number = Date.now) {}

  get preview(): string {
    return this.rawPreview;
  }
  set preview(text: string) {
    this.rawPreview = text;
    this.lead = /^\s*/.exec(text)![0];
    const next = text.match(/\S+\s*/g) ?? [];
    const now = this.now();
    let same = 0;
    while (
      same < next.length &&
      same < this.words.length &&
      next[same]!.trim() === this.words[same]!.word.trim()
    ) {
      same++;
    }
    this.words = next.map((word, i) => ({ word, since: i < same ? this.words[i]!.since : now }));
  }

  settledPreview(): string {
    const until = this.now() - SETTLE_MS;
    let out = '';
    for (const w of this.words) {
      if (w.since > until) break;
      out += w.word;
    }
    return out ? this.lead + out : '';
  }

  get settling(): boolean {
    const until = this.now() - SETTLE_MS;
    return this.words.some((w) => w.since > until);
  }

  add(final: string, endOfSpeech = false) {
    this.current += final;
    const done = final.match(/\S+/g)?.length ?? 0;
    this.words = this.words.slice(done);
    if (endOfSpeech) return this.finish();
    const end = [...this.current.matchAll(SENTENCE_END)].at(-1);
    const at = end ? end.index + end[0].length : 0;
    if (at >= SENTENCE_MIN) {
      this.push(this.current.slice(0, at));
      this.current = this.current.slice(at);
    }
    while (this.current.trim().length > LINE_MAX) {
      this.current = this.current.trimStart();
      const at = cutAt(this.current);
      this.push(this.current.slice(0, at));
      this.current = this.current.slice(at);
    }
  }

  finish() {
    this.push(this.current);
    this.current = '';
  }

  private push(line: string) {
    let text = line.trim();
    while (text.length > LINE_MAX) {
      const at = cutAt(text);
      this.store(text.slice(0, at).trim());
      text = text.slice(at).trim();
    }
    this.store(text);
  }

  private store(text: string) {
    if (!text) return;
    this.lines.push(text);
    this.count++;
    if (this.lines.length > LINES_KEPT) this.lines.splice(0, this.lines.length - LINES_KEPT);
    this.onLine?.(text, this.count - 1);
  }

  clear() {
    this.lines = [];
    this.count = 0;
    this.current = '';
    this.preview = '';
  }

  /** The last `n` finished lines and the line coming in (readers get only settled preview words). */
  view(n = LINES_SENT, preview = false): CaptionText {
    const lines = this.lines.slice(-n);
    return {
      lines,
      first: this.count - lines.length,
      live: `${this.current}${preview ? this.preview : this.settledPreview()}`.trim(),
    };
  }
}

/** Turns one stream's tokens into its text (`own`) and, from one stream, what was heard. */
export function applyTokens(
  tokens: readonly Token[],
  own: LineBuilder,
  heard?: LineBuilder,
): string | undefined {
  let spoken: string | undefined;
  let ownFinal = '';
  let ownPreview = '';
  let heardFinal = '';
  let heardPreview = '';
  let end = false;
  for (const t of tokens) {
    if (!t.text) continue;
    if (isMarker(t.text)) {
      if (t.is_final !== false) end = true;
      continue;
    }
    const final = t.is_final !== false;
    if (t.translation_status !== 'original') {
      if (final) ownFinal += t.text;
      else ownPreview += t.text;
    }
    if (t.translation_status !== 'translation') {
      if (t.language && t.text.trim()) spoken = t.language;
      if (final) heardFinal += t.text;
      else heardPreview += t.text;
    }
  }
  if (ownFinal || end) own.add(ownFinal, end);
  own.preview = ownPreview;
  if (heard && heard !== own) {
    if (heardFinal || end) heard.add(heardFinal, end);
    heard.preview = heardPreview;
  }
  return spoken;
}

/** A language code as the speech service names them (e.g. "en", "pt", "zh"); HEARD for none. */
export const isTarget = (v: unknown): v is Target => v === HEARD || isSpeechLang(v);

/**
 * One session's captions: a stream per language read (the first also gives what was heard; a
 * session nobody reads a translation of has one stream without translation), opened with the
 * first audio and ended after IDLE_MS without any. Audio that can't go at once is kept and caught
 * up at twice real time. `onSent` counts each stream's audio for the credits.
 */
export class Engine {
  readonly heard: LineBuilder;
  readonly texts = new Map<Target, LineBuilder>();
  /** The language each heard line was heard in, by its number (recent lines only). */
  readonly heardLangs = new Map<number, string>();
  speaking: string | undefined;
  service: ServiceState;
  error?: string;
  private streams = new Map<Target, SpeechStream>();
  private openedAt = 0;
  private idleTimer: NodeJS.Timeout | undefined;
  private settleTimer: NodeJS.Timeout | undefined;
  private closed = false;
  private retryAt = 0;
  private backlog: { chunk: Uint8Array; at: number }[] = [];
  private backlogMs = 0;
  private budget = BUDGET_MAX_MS;
  private budgetAt = 0;
  private pumpTimer: NodeJS.Timeout | undefined;
  private sentMs = 0;
  private failures = 0;
  private generation = 0;
  private wanted: Target[] = [HEARD];
  private dropped = new WeakSet<SpeechStream>();
  private failureLoggedAt = 0;
  private held = new Map<SpeechStream, () => void>();
  private fullSince = 0;
  private stallRestartAt = -Infinity;

  constructor(
    private readonly connect: SpeechConnect | null,
    /** Some text changed (the caller sends it out, throttled). */
    private readonly onText: () => void,
    /** The service's state changed. */
    private readonly onStatus: () => void,
    /** Audio sent: `ms` to each of `streams` streams (the credits). */
    private readonly onSent: (ms: number, streams: number) => void = () => {},
    private readonly now: () => number = Date.now,
    private readonly warn: (message: string) => void = () => {},
    private readonly pool: StreamPool | null = null,
  ) {
    this.service = connect ? 'idle' : 'off';
    this.heard = new LineBuilder(now);
    this.heard.onLine = (_, n) => {
      if (this.speaking) this.heardLangs.set(n, this.speaking);
      for (const k of this.heardLangs.keys()) {
        if (k > n - LINES_KEPT) break;
        this.heardLangs.delete(k);
      }
    };
  }

  /** The texts' builder for a language (HEARD: what was heard). */
  text(target: Target): LineBuilder {
    if (target === HEARD) return this.heard;
    let t = this.texts.get(target);
    if (!t) {
      t = new LineBuilder(this.now);
      this.texts.set(target, t);
    }
    return t;
  }

  /** What a page reading `target` gets (`all`: every kept line, a page that just came). */
  update(target: Target | null, all = false): CaptionsUpdate {
    const n = all ? Infinity : LINES_SENT;
    const heard = this.heard.view(n);
    const texts: CaptionsUpdate['texts'] = { [HEARD]: heard };
    if (target && target !== HEARD) texts[target] = this.text(target).view(n);
    const heardLangs: Record<number, string> = {};
    for (let i = heard.first; i < heard.first + heard.lines.length; i++) {
      const l = this.heardLangs.get(i);
      if (l) heardLangs[i] = l;
    }
    return { texts, heardLangs, ...(this.speaking ? { speaking: this.speaking } : {}) };
  }

  /** Audio from the host's page (16 kHz 16-bit mono PCM), recorded at `recordedAt`. */
  audio(chunk: Uint8Array, recordedAt = this.now()): void {
    if (!this.connect || this.closed) return;
    this.backlog.push({ chunk: chunk.slice(), at: recordedAt });
    this.backlogMs += chunk.length / BYTES_PER_MS;
    const keep = this.fullSince ? FULL_KEEP_MS : BACKLOG_MAX_MS;
    while (this.backlogMs > keep && this.backlog.length > 1) {
      this.backlogMs -= this.backlog.shift()!.chunk.length / BYTES_PER_MS;
    }
    this.armIdle();
    this.pump();
  }

  private armIdle() {
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      if (this.backlog.length) return this.armIdle();
      this.endStreams();
    }, IDLE_MS);
  }

  private pump() {
    clearTimeout(this.pumpTimer);
    this.pumpTimer = undefined;
    if (this.closed) return;
    const now = this.now();
    this.budget = Math.min(BUDGET_MAX_MS, this.budget + (now - this.budgetAt) * CATCH_UP);
    this.budgetAt = now;
    let sent = false;
    while (this.backlog.length) {
      if (
        this.streams.size &&
        (now - this.openedAt > STREAM_MAX_MS || this.sentMs > STREAM_MAX_MS)
      ) {
        this.endStreams();
      }
      if (!this.streams.size) {
        if (now < this.retryAt) {
          this.pumpLater(this.retryAt - now);
          break;
        }
        this.open();
        if (!this.streams.size) {
          this.pumpLater(Math.max(1, this.retryAt - now));
          break;
        }
      }
      if (![...this.streams.values()].every((st) => st.ready?.() ?? true)) {
        this.pumpLater(100);
        break;
      }
      const next = this.backlog[0]!;
      const ms = next.chunk.length / BYTES_PER_MS;
      if (this.budget < Math.min(ms, BUDGET_MAX_MS)) {
        this.pumpLater((Math.min(ms, BUDGET_MAX_MS) - this.budget) / CATCH_UP);
        break;
      }
      this.backlog.shift();
      this.backlogMs -= ms;
      this.budget -= ms;
      this.sentMs += ms;
      for (const s of this.streams.values()) s.send(next.chunk);
      this.onSent(ms, this.streams.size);
      sent = true;
    }
    if (sent) {
      this.armIdle();
      if (this.service !== 'live') this.setService('live');
    }
  }

  private pumpLater(ms: number) {
    this.pumpTimer ??= setTimeout(() => this.pump(), Math.max(1, Math.ceil(ms)));
  }

  private open() {
    if (this.pool && this.pool.free < this.wanted.length) return this.full();
    this.fullSince = 0;
    if (this.error === SERVICE_FULL) this.setService('idle');
    this.openedAt = this.now();
    this.sentMs = 0;
    this.wanted.forEach((t, i) => this.openStream(t, i === 0));
  }

  private full() {
    const now = this.now();
    this.retryAt = now + 300;
    if (this.held.size) {
      this.fullSince = 0;
      return;
    }
    this.fullSince ||= now;
    if (now - this.fullSince >= FULL_WARN_MS && this.error !== SERVICE_FULL) {
      this.setService('error', SERVICE_FULL);
      this.warn('captions: no free stream to the speech service (its limit is reached)');
    }
  }

  private ending(stream: SpeechStream) {
    stream.end();
    const release = this.held.get(stream);
    if (!release) return;
    setTimeout(() => {
      if (!this.held.has(stream)) return;
      stream.abort?.();
      release();
    }, RELEASE_MS).unref();
  }

  /** Room for `n` more streams. */
  canAdd(n: number): boolean {
    return !this.pool || this.pool.free >= n;
  }

  private openStream(target: Target, heardToo: boolean): boolean {
    const connect = this.connect!;
    const generation = this.generation;
    const openedAt = this.now();
    const pool = this.pool;
    if (pool) {
      if (!pool.free) return false;
      pool.used++;
    }
    let released = !pool;
    const release = () => {
      if (released) return;
      released = true;
      pool!.used--;
      this.held.delete(stream);
    };
    let heardSince = 0;
    let finalizedAt = 0;
    let lastHeardAt = 0;
    const stream: SpeechStream = connect(target, {
      tokens: this.guarded((tokens: Token[]) => {
        if (generation !== this.generation || this.dropped.has(stream)) return;
        const own = this.text(target);
        const heard = heardToo ? this.heard : undefined;
        const current = this.streams.get(target) === stream;
        const previews = [own.preview, heard?.preview ?? ''] as const;
        // (the language first: a line finished by these very tokens is labelled with it)
        const spokenNow = tokens.findLast(
          (t) =>
            t.translation_status !== 'translation' &&
            !!t.language &&
            !!t.text.trim() &&
            !isMarker(t.text),
        )?.language;
        if (current && heardToo && spokenNow) this.speaking = spokenNow;
        const spoken = applyTokens(tokens, own, heard);
        if (this.failures) {
          this.failures = 0;
          this.warn('captions: the speech service works again');
        }
        if (!current) {
          own.preview = previews[0];
          if (heard && heard !== own) heard.preview = previews[1];
        } else if (spoken && heardToo) {
          this.speaking = spoken;
        }
        this.onText();
        this.settleSoon();
        if (!current || target === HEARD) return;
        const words = (own: boolean) =>
          tokens.some(
            (t) =>
              t.is_final !== false &&
              !!t.text.trim() &&
              !isMarker(t.text) &&
              t.translation_status !== (own ? 'original' : 'translation'),
          );
        const now = this.now();
        if (words(true)) {
          heardSince = 0;
          finalizedAt = 0;
        } else if (words(false)) {
          if (now - lastHeardAt > STALL_PAUSE_MS) {
            heardSince = now;
            finalizedAt = 0;
          }
          lastHeardAt = now;
          if (!finalizedAt && now - heardSince >= STALL_MS) {
            finalizedAt = now;
            stream.finalize?.();
          } else if (
            finalizedAt &&
            now - finalizedAt >= FINALIZE_WAIT_MS &&
            now - this.stallRestartAt >= STALL_GAP_MS
          ) {
            this.stallRestartAt = now;
            this.warn(`captions: words heard but nothing in ${target}: the streams start again`);
            this.endStreams();
          }
        }
      }),
      closed: this.guarded((error?: string) => {
        release();
        if (generation !== this.generation) return;
        if (this.streams.get(target) !== stream) {
          if (!error && !this.streams.size) {
            for (const t of heardToo ? [this.text(target), this.heard] : [this.text(target)]) {
              t.finish();
              t.preview = '';
            }
            this.speaking = undefined;
            this.onText();
          }
          return;
        }
        this.streams.delete(target);
        if (error) this.failed(error);
        else if (this.now() - openedAt < CLOSED_AT_ONCE_MS) {
          this.failed('the speech service closed the connection at once');
        } else if (this.streams.size) this.endStreams();
        else if (this.service === 'live') this.setService('idle');
      }),
    });
    if (!released) this.held.set(stream, release);
    this.streams.set(target, stream);
    return true;
  }

  get langs(): readonly Target[] {
    return this.wanted;
  }

  /**
   * The languages read now (HEARD alone: nobody reads a translation). A new one gets its stream at
   * once while streams run; one no longer read ends, its lines kept, its late words dropped.
   */
  setLangs(targets: readonly Target[]): void {
    const translated = [...new Set(targets.filter((t) => t !== HEARD))];
    const next = translated.length ? translated : [HEARD];
    const added = next.filter((t) => !this.wanted.includes(t));
    const gone = this.wanted.filter((t) => !next.includes(t));
    // the first stream also gives what was heard: when it changes, every stream starts again
    const firstChanged = next[0] !== this.wanted[0];
    this.wanted = next;
    if (firstChanged) {
      if (this.streams.size) this.endStreams();
      return;
    }
    for (const t of gone) {
      const stream = this.streams.get(t);
      if (stream) {
        this.dropped.add(stream);
        this.streams.delete(t);
        this.ending(stream);
      }
      const text = this.text(t);
      text.finish();
      text.preview = '';
    }
    if (this.streams.size && !this.closed) for (const t of added) this.openStream(t, false);
  }

  private failed(error: string) {
    this.endStreams();
    this.failures++;
    const pause = /^40[123]\b/.test(error)
      ? 60_000
      : Math.min(60_000, 5_000 * 2 ** (this.failures - 1));
    this.retryAt = this.now() + pause;
    this.setService('error', error);
    if (this.now() - this.failureLoggedAt > 30_000) {
      this.failureLoggedAt = this.now();
      this.warn(
        `captions: the speech service failed (${error}); trying again in ${pause / 1000} s`,
      );
    }
  }

  private endStreams() {
    clearTimeout(this.idleTimer);
    this.fullSince = 0;
    const streams = [...this.streams.values()];
    this.streams.clear();
    for (const s of streams) this.ending(s);
    for (const t of [...this.texts.values(), this.heard]) {
      t.finish();
      t.preview = '';
    }
    if (this.service === 'live') this.setService('idle');
    this.speaking = undefined;
    this.onText();
  }

  /** A speech-service callback that can never take the server down. */
  private guarded<A extends unknown[]>(run: (...args: A) => void): (...args: A) => void {
    return (...args) => {
      try {
        run(...args);
      } catch (e) {
        this.warn(`captions: ${String(e)}`);
      }
    };
  }

  private settleSoon() {
    if (this.closed || this.settleTimer) return;
    if (![...this.texts.values(), this.heard].some((t) => t.settling)) return;
    this.settleTimer = setTimeout(() => {
      this.settleTimer = undefined;
      this.onText();
      this.settleSoon();
    }, SETTLE_MS / 3);
  }

  private setService(service: ServiceState, error?: string) {
    this.service = service;
    this.error = error;
    this.onStatus();
  }

  /** One language's lines from now on only (a page switched to it: its history starts again). */
  clearText(target: Target): void {
    this.text(target).clear();
  }

  /** The session's end: everything goes at once, the late words dropped. */
  discard(): void {
    this.generation++;
    this.backlog = [];
    this.backlogMs = 0;
    clearTimeout(this.pumpTimer);
    this.pumpTimer = undefined;
    this.endStreams();
    if (this.service === 'error') this.setService('idle');
    for (const t of [...this.texts.values(), this.heard]) t.clear();
    this.heardLangs.clear();
  }

  close(): void {
    this.discard();
    this.closed = true;
    clearTimeout(this.idleTimer);
    clearTimeout(this.settleTimer);
    clearTimeout(this.pumpTimer);
  }
}

export const SERVICE_FULL = 'The translation service is full right now. Try again in a minute.';
