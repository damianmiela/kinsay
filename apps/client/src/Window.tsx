// The subtitles window (/window): Kinsay's captions as a see-through window over a call, in the
// desktop app (desktop/win: it hands the page this computer's sound and the window's own controls,
// `window.liveShell`) or in a browser tab. Mockups batch 1 (the window, from the wedding app's) and
// batch 2 part 7 (its sign-in: the person's own browser, the same digits on both). One language, as
// every page here: the translation, or what is heard without one. The look: mockups kinsay-3
// (2026-11-15): the words never leave. Captions in a centred column; the bar floats in over the top
// edge while the mouse is on the window; settings, the languages and invite open in one drawer on
// the right, beside the captions; messages as pills at the top centre.
import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { euros, HEARD, type CaptionText } from '@translate/shared';
import { api } from './api';
import { UiLangSelect } from './bits';
import { CaptionsList } from './CaptionsList';
import { langList, langName, MAIN_LANGS, rememberLang, usedBefore } from './langs';
import { useMic } from './mic/useMic';
import { Qr } from './Qr';
import { useStored } from './store';
import { clock, stopText, t, tw } from './texts';
import { ui } from './ui';
import { ask, useSession } from './useSession';
import './window.css';

/** What the desktop app gives the page (desktop/win's bridge); missing in a browser tab. */
interface LiveShell {
  setOpacity(value: number): void;
  setClickThrough(on: boolean): void;
  resizeBy(dx: number, dy: number, edge: 'left' | 'right'): void;
  resized?(): void;
  close(): void;
  /** A new version is in place (the app's own updates): called at once if it already is. */
  onUpdated?(fn: () => void): void;
  /** Closes and starts the new version. */
  restart?(): void;
}
const shell = (window as { liveShell?: LiveShell }).liveShell;

/** The window's icons: one drawn set (24 px grid, a line of 1.8). */
const ICONS = {
  stop: <rect x="6" y="6" width="12" height="12" rx="2.5" fill="currentColor" stroke="none" />,
  play: <path d="M8 5.5v13l10-6.5z" fill="currentColor" stroke="none" />,
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.8 3 2.8 15 0 18M12 3c-2.8 3-2.8 15 0 18" />
    </>
  ),
  down: <path d="M6 9l6 6 6-6" />,
  gear: (
    <>
      <circle cx="12" cy="12" r="6.1" />
      <circle cx="12" cy="12" r="2.3" />
      {[0, 45, 90, 135, 180, 225, 270, 315].map((d) => (
        <path
          key={d}
          d="M12 2.2v3.4"
          strokeWidth="3.6"
          strokeLinecap="butt"
          transform={`rotate(${d} 12 12)`}
        />
      ))}
    </>
  ),
  lock: (
    <>
      <rect x="5" y="11" width="14" height="9" rx="2.5" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </>
  ),
  x: <path d="M6 6l12 12M18 6L6 18" />,
  pc: (
    <>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </>
  ),
  mic: (
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
    </>
  ),
  both: <path d="M4 8h13l-3-3M20 16H7l3 3" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  qr: (
    <>
      <rect x="4" y="4" width="6" height="6" rx="1" />
      <rect x="14" y="4" width="6" height="6" rx="1" />
      <rect x="4" y="14" width="6" height="6" rx="1" />
      <path d="M14 14h2.5v2.5M20 14v6h-3.5M14 20v-1" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8.5" r="3.7" />
      <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4.5 4.5" />
    </>
  ),
  up: <path d="M20 12a8 8 0 1 1-2.6-5.9M20 4v5h-5" />,
  warn: <path d="M12 4l9 15.5H3zM12 10v4.5M12 17.2v.3" />,
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5.5M12 7.6v.3" />
    </>
  ),
} as const;
type IconName = keyof typeof ICONS;
function Icon({ name }: { name: IconName }) {
  return (
    <svg className="lw-i" viewBox="0 0 24 24" aria-hidden="true">
      {ICONS[name]}
    </svg>
  );
}
const SOURCE_ICON = { system: 'pc', mic: 'mic', both: 'both' } as const;
/** This page's own random token as a guest (a reconnected page takes its place back). */
function guestToken(): string {
  try {
    const kept = sessionStorage.getItem('tr-guest-token');
    if (kept) return kept;
    const made = crypto.randomUUID();
    sessionStorage.setItem('tr-guest-token', made);
    return made;
  } catch {
    return (guestToken.made ??= crypto.randomUUID());
  }
}
guestToken.made = undefined as string | undefined;
/** No sound for this long after Start: the window says it is waiting. */
const QUIET_MS = 8_000;
const EMPTY: CaptionText = { lines: [], first: 0, live: '' };
const codeOf = (s: string) => /^[A-Za-z2-9]{6}$/.exec(s)?.[0]?.toUpperCase();

export function WindowPage() {
  const [state, setState] = useState<'wait' | 'in' | 'out'>('wait');
  const [code, setCode] = useState<string | undefined>();
  useEffect(() => {
    void api('/api/me').then((r) => setState(r.ok ? 'in' : 'out'));
  }, []);
  if (state === 'wait') return <Glass />;
  if (code) return <Captions code={code} onLeave={() => setCode(undefined)} />;
  if (state === 'out') return <SignIn onCode={setCode} />;
  return <Captions />;
}

/** The glass with its bar and nothing else yet (while the page finds out who it is, signing in). */
function Glass({ children }: { children?: ReactNode }) {
  return (
    <div
      className={`lw show-bar${shell ? ' in-app' : ''}`}
      style={{ ['--lw-glass' as string]: 0.9 }}
    >
      <div className="lw-bar">
        <span className="lw-brand">
          <img src="/icons/icon.svg" alt="" />
          {tw.title}
        </span>
        <span className="lw-gap" />
        {shell && (
          <button
            className="lw-btn ic ghost"
            aria-label={tw.closeWindow}
            onClick={() => shell.close()}
          >
            <Icon name="x" />
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

/** Part 7: the window asks, the browser signs it in; it asks every 2 s until answered. */
function SignIn({ onCode }: { onCode: (code: string) => void }) {
  const [ask, setAsk] = useState<{ poll: string; digits: string } | null>(null);
  const [state, setState] = useState<'idle' | 'no' | 'offline' | 'too-many'>('idle');
  const [typing, setTyping] = useState(false);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const start = async () => {
    // (one ask at a time: a double click would open two tabs and wait on the wrong one, audit 32)
    setBusy(true);
    const r = await api<{ poll: string; token: string; digits: string }>(
      '/api/app-signin/start',
      {},
    );
    setBusy(false);
    if (!r.ok) return setState(r.error === 'too-many' ? 'too-many' : 'offline');
    setState('idle');
    setAsk({ poll: r.poll, digits: r.digits });
    // (in the desktop app this opens the computer's own browser; in a tab, a new tab)
    window.open(`/app-signin#t=${r.token}`, '_blank', 'noopener');
  };
  useEffect(() => {
    if (!ask) return;
    const timer = setInterval(() => {
      void api<{ state: string }>('/api/app-signin/poll', { poll: ask.poll }).then((r) => {
        if (!r.ok) return; // (offline for a moment: the next ask)
        if (r.state === 'yes') window.location.reload();
        else if (r.state !== 'waiting') {
          setAsk(null);
          setState(r.state === 'no' ? 'no' : 'idle');
        }
      });
    }, 2_000);
    return () => clearInterval(timer);
  }, [ask]);
  return (
    <Glass>
      <div className="lw-card">
        <img className="lw-logo" src="/icons/icon.svg" alt="" />
        <h3>{tw.signInTitle}</h3>
        {ask ? (
          <>
            <p>{tw.signInDigits}</p>
            <p className="lw-digits">
              {ask.digits.slice(0, 3)} {ask.digits.slice(3)}
            </p>
            <p>{tw.signInWaiting}</p>
          </>
        ) : (
          <>
            <p>{tw.signInBody}</p>
            {state === 'no' && <p className="lw-bad">{tw.signInNo}</p>}
            {state === 'offline' && <p className="lw-bad">{t.offline}</p>}
            {state === 'too-many' && <p className="lw-bad">{t.tooMany}</p>}
            <button className="lw-btn go big" disabled={busy} onClick={() => void start()}>
              {state === 'no' ? tw.signInAgain : tw.signInButton}
            </button>
          </>
        )}
        {typing ? (
          <form
            className="lw-codeform"
            onSubmit={(e) => {
              e.preventDefault();
              const c = codeOf(value);
              if (c) onCode(c);
            }}
          >
            <input
              className="lw-input"
              maxLength={6}
              autoFocus
              autoComplete="off"
              placeholder={t.codeLabel}
              aria-label={t.codeLabel}
              value={value}
              onChange={(e) => setValue(e.target.value.replace(/[^A-Za-z0-9]/g, ''))}
            />
            <button className="lw-btn go" disabled={!codeOf(value)}>
              {t.join}
            </button>
          </form>
        ) : (
          <p>
            {tw.readOnly}{' '}
            <button className="lw-link" onClick={() => setTyping(true)}>
              {tw.enterTheirCode}
            </button>
          </p>
        )}
      </div>
    </Glass>
  );
}

/** The languages in the drawer: a search, the ones used lately first, then all, in two columns. */
function Langs({ value, onPick }: { value: string | null; onPick: (lang: string | null) => void }) {
  const [query, setQuery] = useState('');
  const pick = (lang: string | null) => {
    if (lang) rememberLang(lang);
    onPick(lang);
  };
  const row = (code: string | null, wide = false) => {
    const n = code ? langName(code) : null;
    const side = n ? (n.here !== n.own ? n.here : '') : t.noTranslationHint;
    return (
      <button
        key={code ?? '-'}
        role="option"
        aria-selected={value === code}
        className={`lw-lg${wide ? ' wide' : ''}`}
        onClick={() => pick(code)}
      >
        <span>{n ? n.own : t.noTranslation}</span>
        {side && <small>{side}</small>}
        {value === code && <Icon name="check" />}
      </button>
    );
  };
  const first: string[] = [...new Set([...MAIN_LANGS, ...usedBefore()])];
  const list = langList(query);
  return (
    <>
      <label className="lw-search">
        <Icon name="search" />
        <input
          autoFocus
          value={query}
          placeholder={t.searchLang}
          aria-label={t.searchLang}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <div className="lw-langs" role="listbox" aria-label={tw.translateInto}>
        {!query && (
          <>
            {first.map((c) => row(c))}
            {row(null, true)}
            <div className="lw-lhead">{t.otherLangs}</div>
          </>
        )}
        {(query ? list : list.filter((c) => !first.includes(c))).map((c) => row(c))}
        {!list.length && <div className="lw-lhead">{t.noLangFound}</div>}
      </div>
    </>
  );
}

/** The captions: the signed-in person's own session, or (with `code`) someone else's. */
function Captions({ code, onLeave }: { code?: string; onLeave?: () => void }) {
  const { view, update, error, online } = useSession(code);
  const mic = useMic({ voice: true });
  // both sides of a call (batch 9): the microphone too, while this computer's sound is captioned
  const sideMic = useMic({ voice: true, side: true });
  const [lang, setLang] = useStored<string | null>('tr-window-lang', null);
  // what it listens to: this computer, the microphone, or both sides of a call (the host's only)
  const [stored, setStored] = useStored<'system' | 'mic' | 'both'>('tr-window-source', 'system');
  const [size, setSize] = useStored('tr-window-size', 1);
  const [opacity, setOpacity] = useStored('tr-window-opacity', 0.85);
  // (settings, the languages and invite: one drawer on the right, beside the captions)
  const [drawer, setDrawer] = useState<'settings' | 'lang' | 'invite' | null>(null);
  // (Escape closes it wherever the focus is: the button that opened it lies under the drawer)
  useEffect(() => {
    if (!drawer) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDrawer(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawer]);
  const [locked, setLocked] = useState(false);
  const [quiet, setQuiet] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // (✕ while the captions run asks first: closing would stop them)
  const [closing, setClosing] = useState(false);
  // the app updated itself: a quiet note and Restart (asks first while captions run)
  const [updated, setUpdated] = useState(false);
  const [restarting, setRestarting] = useState(false);
  useEffect(() => {
    shell?.onUpdated?.(() => setUpdated(true));
  }, []);
  // (a page that came by the code, the host letting it caption its own side: it chose to only read)
  const [justRead, setJustRead] = useState(false);
  // a guest's captions carry on after a break in her internet (audit 35, M2): she was a guest, her
  // page dropped (not the server ending hers): back with the same token, she starts again by itself
  const wasGuest = useRef(false);
  const resumeGuest = useRef(false);
  useEffect(() => {
    if (view?.role === 'guest' && view.running) wasGuest.current = true;
    else if (online && view?.role === 'reader' && !resumeGuest.current) wasGuest.current = false;
  }, [view, online]);
  useEffect(() => {
    if (!online && wasGuest.current) resumeGuest.current = true;
  }, [online]);
  useEffect(() => {
    if (!online || !resumeGuest.current || view?.role !== 'reader') return;
    if (!view.guestAllowed || !view.running) return;
    resumeGuest.current = false;
    void ask('guest:start', { lang: lang ?? ui, token: guestToken() }).then((err) => {
      if (err) setProblem(err);
    });
  }, [online, view, lang]);
  // her captions ended (by the host, or a stop of the server's): her computer's sound stays
  // here (audit 35, L1); the host's own window likewise when the server ended the session
  useEffect(() => {
    if (!view || !mic.sending || resumeGuest.current) return;
    const runs = view.role === 'host' || view.role === 'guest';
    if (!runs || !view.running) mic.stopSending();
  }, [view, mic]);
  const source = stored === 'both' && view?.role !== 'host' ? 'system' : stored;
  // (only the window chosen here or the one listening sets the server's switch: audit 37, L6)
  const chose = useRef(false);
  const setSource = (next: 'system' | 'mic' | 'both') => {
    chose.current = true;
    setStored(next);
  };
  // (both: the session's sound is this computer's, the microphone goes as its own side)
  const micSource = source === 'mic' ? 'mic' : 'system';
  const both = view?.role === 'host' && source === 'both' && !!view.bothSides;
  // the server's switch follows the choice (its streams for the microphone side)
  const wantBoth = view?.role === 'host' ? source === 'both' : undefined;
  const here = !!view?.mic?.here;
  useEffect(() => {
    if (wantBoth === undefined || !!view?.bothSides === wantBoth) return;
    if (!chose.current && !here) return;
    void ask('session:bothSides', { on: wantBoth }).then((err) => err && setProblem(err));
  }, [wantBoth, view?.bothSides, here]);
  // the microphone side follows the session's sound: on with it, off with it or with the switch
  // (a failed start is not tried again until the choice or the sound changes: audit 37, M1)
  const sideFailed = useRef(false);
  useEffect(() => {
    if (!mic.sending || !both) sideFailed.current = false;
  }, [mic.sending, both]);
  useEffect(() => {
    if (mic.sending && both && !sideMic.sending && !sideMic.open && !sideFailed.current) {
      sideFailed.current = true;
      void sideMic.startSending().then((r) => {
        if (r === 'failed') setProblem('sound');
        else sideFailed.current = false;
      });
    } else if ((!mic.sending || !both) && sideMic.sending) sideMic.stopSending();
  }, [mic.sending, both, sideMic]);
  const { chooseSource } = mic;
  // another of the host's devices took the microphone: the window stops sending
  const elsewhere = !!view?.mic && !view.mic.here;
  useEffect(() => {
    if (elsewhere && mic.sending) mic.stopSending();
  }, [elsewhere, mic]);
  useEffect(() => {
    chooseSource(micSource);
  }, [chooseSource, micSource]);
  useEffect(() => {
    shell?.setOpacity(opacity);
  }, [opacity]);
  // locked: clicks go through to the call below; the badge alone takes the mouse back
  useEffect(() => {
    shell?.setClickThrough(locked);
  }, [locked]);
  // no sound for a while after Start: say so (the level is the input's own, words may lag)
  useEffect(() => {
    if (!mic.sending) return;
    let loudAt = Date.now();
    const timer = setInterval(() => {
      if (mic.levels.get().level > 0.01) loudAt = Date.now();
      setQuiet(Date.now() - loudAt > QUIET_MS);
    }, 1_000);
    return () => {
      clearInterval(timer);
      setQuiet(false);
    };
  }, [mic.sending, mic.levels]);

  if (error === 'no-session' || error === 'too-many') {
    return (
      <Glass>
        <div className="lw-card">
          <p className="lw-bad">{error === 'too-many' ? t.tooMany : t.noSession}</p>
          <button className="lw-btn go big" onClick={onLeave}>
            {t.backHome}
          </button>
        </div>
      </Glass>
    );
  }
  if (!view) {
    return (
      <Glass>
        {error === 'too-many-pages' && (
          <div className="lw-card">
            <p>{t.tooManyPages}</p>
          </div>
        )}
      </Glass>
    );
  }
  const host = view.role === 'host';
  // a guest (mockups batch 4): her own captions of her side of the call, on the host's balance;
  // `offer`: a page that came by the code while the host lets it
  const guest = view.role === 'guest';
  const offer = view.role === 'reader' && !!view.guestAllowed && !justRead;
  const runs = host || guest;
  const shown = view.lang;
  // (a guest's language: the one she picked here, else the app's)
  const guestLang = lang ?? ui;

  const start = async () => {
    setProblem(null);
    const err = await (host
      ? ask('session:start', { lang })
      : ask('guest:start', { lang: guestLang, token: guestToken() }));
    if (err) return setProblem(err);
    if ((await mic.startSending()) === 'failed') {
      await ask(host ? 'session:stop' : 'guest:stop');
      setProblem('sound');
    }
  };
  const stop = async () => {
    mic.stopSending();
    await ask(host ? 'session:stop' : 'guest:stop');
  };
  const resume = async () => {
    setProblem(null);
    if ((await mic.startSending()) === 'failed') setProblem('sound');
  };
  const changeLang = async (next: string | null) => {
    setDrawer(null);
    if (host || guest || offer) setLang(next);
    if (guest) {
      if (view.running) setProblem(await ask('guest:lang', { lang: next }));
    } else if (!offer && (view.running || !host)) {
      setProblem(await ask('session:lang', { lang: next }));
    }
  };
  const switchSource = (next: 'system' | 'mic' | 'both') => {
    setSource(next);
    const nextMic = next === 'mic' ? 'mic' : 'system';
    if (nextMic === micSource) return; // (both ↔ this computer: only the microphone side changes)
    mic.chooseSource(nextMic);
    // (while it runs: the new source at once; one that doesn't start stops the session)
    if (mic.sending) {
      mic.stopSending();
      void mic.startSending().then((r) => {
        if (r === 'failed') {
          setProblem('sound');
          void stop();
        }
      });
    }
  };

  // the start panel: a host's or a guest's captions that don't run, or a page offered them
  const panel = (runs && !view.running) || offer;
  // (a guest may start only while the host's own captions run)
  const hostOn = guest ? !!view.hostRunning : view.running;
  const stopped = view.stopped && view.stopped !== 'ended' ? stopText(view.stopped) : null;
  const fromStop = problem ? stopText(problem as never) : null;
  const note =
    problem === 'sound'
      ? { cls: 'bad', head: micSource === 'system' ? tw.soundProblem : t.micProblem, body: '' }
      : problem === 'offline'
        ? { cls: 'bad', head: tw.offline, body: tw.offlineBody }
        : problem === 'service-full'
          ? { cls: 'warn', head: t.serviceFull, body: '' }
          : problem === 'too-many-langs'
            ? { cls: 'warn', head: t.tooManyLangs, body: '' }
            : fromStop
              ? { cls: 'bad', head: fromStop[0], body: fromStop[1] }
              : (guest || offer) &&
                  problem &&
                  ['credits', 'monthly', 'global', 'blocked'].includes(problem)
                ? { cls: 'bad', head: t.guestCantRun(view.hostName), body: '' }
                : problem === 'guest-taken'
                  ? { cls: 'warn', head: t.guestTaken, body: '' }
                  : problem === 'guest-off'
                    ? { cls: 'warn', head: t.guestOff, body: '' }
                    : problem && problem !== 'host-not-running'
                      ? { cls: 'bad', head: tw.failed, body: '' }
                      : (guest || offer) && !hostOn
                        ? {
                            cls: '',
                            head: view.stoppedAt
                              ? t.hostStopped(clock(view.stoppedAt), view.hostName)
                              : t.waitingHost(view.hostName),
                            body: '',
                          }
                        : stopped
                          ? { cls: 'bad', head: stopped[0], body: stopped[1] }
                          : view.service === 'error'
                            ? { cls: 'warn', head: t.serviceDown[0], body: t.serviceDown[1] }
                            : quiet && mic.sending
                              ? {
                                  cls: '',
                                  head: micSource === 'system' ? tw.waitingSound : tw.waitingVoice,
                                  body: micSource === 'system' ? tw.waitingSoundBody : '',
                                }
                              : null;
  const text: CaptionText = update.texts[shown ?? HEARD] ?? EMPTY;
  // (what is heard: each line's language once more than one was heard, as on the website)
  const labels =
    shown || new Set(Object.values(update.heardLangs ?? {})).size < 2
      ? undefined
      : Object.fromEntries(
          Object.entries(update.heardLangs ?? {}).map(([n, c]) => [n, langName(c).own]),
        );

  const listenHere = async () => {
    setProblem(null);
    const err = await ask('session:useMic');
    if (err) return setProblem(err);
    await resume();
  };
  const close = () => {
    // (only the listening window asks: closing one that only shows the captions stops nothing)
    if (runs && view.running && mic.sending) return setClosing(true);
    shell?.close();
  };
  const where = view.mic && !view.mic.here ? view.mic.on : null;
  const [before, after] = t.listeningOn('|').split('|');
  const sources = host ? (['system', 'mic', 'both'] as const) : (['system', 'mic'] as const);
  const sourceName = { system: tw.thisComputer, mic: tw.mic, both: tw.bothSides };
  const sourceHint = { system: tw.systemHint, mic: tw.micHint, both: tw.bothHint };
  // the language shown or to start with, and what a pick in the drawer does
  const langValue = panel ? (host ? lang : guestLang) : shown;
  const langLabel = langValue ? langName(langValue).own : panel ? t.noTranslation : t.original;
  const pickLang = (l: string | null) => {
    if (!panel) return void changeLang(l);
    setLang(l);
    setDrawer(null);
  };

  // what to listen to: the same three choices before Start and in Settings
  const listenSeg = (
    <div className="lw-seg" role="group" aria-label={tw.listenTo}>
      {sources.map((src) => (
        <button
          key={src}
          className={source === src ? 'sel' : ''}
          aria-pressed={source === src}
          onClick={() => source !== src && switchSource(src)}
        >
          <Icon name={SOURCE_ICON[src]} />
          {src === 'both' ? tw.both : sourceName[src]}
        </button>
      ))}
    </div>
  );

  // the messages, the most pressing first: pills at the top centre, each with its one action
  interface Notice {
    cls: '' | 'warn' | 'bad' | 'good';
    head: ReactNode;
    body?: ReactNode;
    action?: { label: string; run: () => void };
  }
  const notices: Notice[] = [];
  if (!online) {
    notices.push({
      cls: 'warn',
      head: t.noInternet,
      body: host && mic.sending ? t.offlineKept : t.comeBack,
    });
  }
  if (note) notices.push({ cls: note.cls as Notice['cls'], head: note.head, body: note.body });
  if (runs && view.running && !mic.sending && !where) {
    notices.push({
      cls: 'warn',
      head: t.micIsOff,
      action: { label: t.turnItOn, run: () => void resume() },
    });
  }
  if (host && view.running && !mic.sending && where) {
    notices.push({
      cls: '',
      head: (
        <span className="plain">
          {before}
          <b>{t.deviceName[where]}</b>
          {after}
        </span>
      ),
      action: { label: t.useThisOne, run: () => void listenHere() },
    });
  }
  if (host && view.stopsAt) {
    notices.push({
      cls: 'warn',
      head: t.stillListening(clock(view.stopsAt)),
      action: { label: t.keepGoing, run: () => void ask('session:keepGoing') },
    });
  }
  if (host && view.guestRunning) {
    notices.push({
      cls: '',
      head: <span className="plain">{t.guestRunsToo}</span>,
      action: { label: t.stopTheirs, run: () => void ask('session:stopGuest') },
    });
  }
  if (updated) {
    notices.push({
      cls: 'good',
      head: tw.updated,
      action: {
        label: tw.restart,
        run: () => (mic.sending ? setRestarting(true) : shell?.restart?.()),
      },
    });
  }

  return (
    <div
      className={`lw${locked ? ' locked' : ''}${shell ? ' in-app' : ''}${panel || drawer ? ' show-bar' : ''}${drawer ? ' has-drawer' : ''}`}
      style={{ ['--lw-size' as string]: size, ['--lw-glass' as string]: shell ? 0.8 : 0.92 }}
    >
      {/* (a small "Live" that stays while the bar hides: the captions are on) */}
      {view.running && online && <span className="lw-live">{t.live}</span>}

      {!locked && (
        <div className="lw-bar">
          <span className="lw-brand">
            <img src="/icons/icon.svg" alt="" />
            <span>{tw.title}</span>
          </span>
          <span className="lw-state">
            {view.running && online && <span className="lw-on">{t.live}</span>}
            {view.bothSides && !panel && (
              <>
                <span className="lw-key you">{tw.sideYou}</span>
                <span className="lw-key call">{tw.sideCall}</span>
              </>
            )}
          </span>
          <span className="lw-gap" />
          {/* (a drawer open: it lies over this side of the bar; its own ✕ closes it first) */}
          {!drawer && runs && view.running && (
            <button className="lw-btn stop" onClick={() => void stop()}>
              <Icon name="stop" />
              {t.stop}
            </button>
          )}
          {!drawer && !panel && (
            <button
              className="lw-btn lang"
              onClick={() => setDrawer('lang')}
              aria-label={`${tw.translateInto}: ${langLabel}`}
            >
              <Icon name="globe" />
              <span>{langLabel}</span>
              <Icon name="down" />
            </button>
          )}
          {!drawer && (
            <button
              className="lw-btn ic"
              aria-label={tw.menu}
              onClick={() => setDrawer('settings')}
            >
              <Icon name="gear" />
            </button>
          )}
          {!drawer && shell && !panel && (
            <button
              className="lw-btn ic lockb"
              aria-label={tw.lock}
              onClick={() => {
                setDrawer(null);
                setLocked(true);
              }}
            >
              <Icon name="lock" />
            </button>
          )}
          {!drawer && shell && (
            <>
              <span className="lw-sep" aria-hidden="true" />
              <button className="lw-btn ic ghost" aria-label={tw.closeWindow} onClick={close}>
                <Icon name="x" />
              </button>
            </>
          )}
        </div>
      )}

      {notices.length > 0 && !locked && (
        <div className="lw-notices">
          {notices.slice(0, 2).map((n, i) => (
            <div
              key={i}
              className={`lw-notice ${n.cls}`}
              role={n.cls === 'bad' ? 'alert' : 'status'}
            >
              <Icon name={n.cls === 'good' ? 'up' : n.cls ? 'warn' : 'info'} />
              <span>
                {typeof n.head === 'string' ? <b>{n.head}</b> : n.head}
                {n.body && <> {n.body}</>}
              </span>
              {n.action && (
                <button className="lw-btn sm" onClick={n.action.run}>
                  {n.action.label}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* before Start: one centred row (what to listen to, the language, Start) */}
      {panel && !locked && (
        <div className="lw-start" onPointerDown={() => drawer && setDrawer(null)}>
          {!host && (
            <p className="lw-who">
              <b>{t.hostsCaptions(view.hostName)}</b> · {t.onBalance(view.hostName)}
            </p>
          )}
          <div className="lw-frow">
            <div className="lw-field">
              <span>{tw.listenTo}</span>
              {listenSeg}
            </div>
            <div className="lw-field">
              <span>{tw.translateInto}</span>
              <button
                className="lw-pick"
                aria-label={`${tw.translateInto}: ${langLabel}`}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => setDrawer(drawer === 'lang' ? null : 'lang')}
              >
                <Icon name="globe" />
                <span>{langLabel}</span>
                <Icon name="down" />
              </button>
            </div>
            <button
              className="lw-btn go big"
              disabled={!host && !hostOn}
              onClick={() => void start()}
            >
              <Icon name="play" />
              {t.start}
            </button>
          </div>
          <p className="lw-hint">
            <b>{sourceName[source]}:</b> {sourceHint[source]}
          </p>
          {offer && (
            <button className="lw-link" onClick={() => setJustRead(true)}>
              {t.justRead(view.hostName)}
            </button>
          )}
        </div>
      )}

      {/* the whole history, scrolling, following the newest line: the website's own list (Damian) */}
      {!panel && (
        <div
          className="lw-caps"
          lang={shown ?? undefined}
          onPointerDown={() => drawer && setDrawer(null)}
        >
          <CaptionsList
            text={text}
            labels={labels}
            waiting={view.running ? tw.waitingVoice : t.waitingHost(view.hostName)}
            latest={t.latest}
          />
        </div>
      )}

      {drawer && !locked && (
        <aside className="lw-drawer" aria-label={drawerTitle(drawer)}>
          <div className="lw-dhead">
            <h3>{drawerTitle(drawer)}</h3>
            <button
              className="lw-btn ic ghost"
              autoFocus
              aria-label={t.close}
              onClick={() => setDrawer(null)}
            >
              <Icon name="x" />
            </button>
          </div>

          {drawer === 'lang' && <Langs value={langValue} onPick={pickLang} />}

          {drawer === 'settings' && (
            <>
              <div className="lw-dbody">
                {(runs || offer) && (
                  <div className="lw-set">
                    <h4>{tw.listenTo}</h4>
                    {listenSeg}
                    <p className="lw-sethint">
                      <b>{sourceName[source]}:</b> {sourceHint[source]}
                    </p>
                  </div>
                )}
                <div className="lw-set">
                  <h4>{tw.groupWindow}</h4>
                  <div className="lw-two">
                    <label className="lw-range">
                      <span>
                        {t.textSize} <i>{Math.round(size * 100)} %</i>
                      </span>
                      <input
                        type="range"
                        min={0.85}
                        max={2}
                        step={0.05}
                        value={size}
                        onChange={(e) => setSize(Number(e.target.value))}
                      />
                    </label>
                    {shell && (
                      <>
                        <label className="lw-range">
                          <span>
                            {tw.seeThrough} <i>{Math.round(opacity * 100)} %</i>
                          </span>
                          <input
                            type="range"
                            min={0.35}
                            max={1}
                            step={0.05}
                            value={opacity}
                            onChange={(e) => setOpacity(Number(e.target.value))}
                          />
                        </label>
                        <button
                          className="lw-btn"
                          title={tw.lockHint}
                          onClick={() => {
                            setDrawer(null);
                            setLocked(true);
                          }}
                        >
                          <Icon name="lock" />
                          {tw.lock}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
              <div className="lw-dfoot">
                {host && view.code && (
                  <button className="lw-btn ghost" onClick={() => setDrawer('invite')}>
                    <Icon name="qr" />
                    {t.inviteTitle}
                  </button>
                )}
                {host && (
                  <button
                    className="lw-btn ghost"
                    onClick={() => window.open('/account', '_blank', 'noopener')}
                  >
                    <Icon name="user" />
                    <span className="thin">{t.groupAccount}</span>
                    {view.balance !== undefined && euros(Math.max(0, view.balance))}
                  </button>
                )}
                {(guest || offer) && <span className="lw-foot">{t.onBalance(view.hostName)}</span>}
                <label className="lw-btn ghost">
                  <Icon name="globe" />
                  <UiLangSelect />
                </label>
                {!host && (
                  <button className="lw-btn ghost" onClick={onLeave}>
                    {t.leaveNamed(view.hostName)}
                  </button>
                )}
              </div>
            </>
          )}

          {drawer === 'invite' && view.code && (
            <div className="lw-invite">
              <div className="lw-inv">
                <div className="lw-qrbox">
                  <Qr text={`${window.location.origin}/join#${view.code}`} px={120} />
                </div>
                <div>
                  <b>{tw.readAlong}</b>
                  <p>{tw.readAlongType}</p>
                  <div className="lw-code" aria-label={view.code}>
                    {[...view.code].map((c, i) => (
                      <b key={i} aria-hidden="true">
                        {c}
                      </b>
                    ))}
                  </div>
                </div>
              </div>
              <button
                className="lw-opt"
                role="switch"
                aria-checked={!!view.guestAllowed}
                onClick={() => void ask('session:guestAllow', { on: !view.guestAllowed })}
              >
                <span>
                  <b className="thin">{t.guestAllow}</b>
                  <small>{t.guestAllowSmall}</small>
                </span>
                <span className={`lw-tog${view.guestAllowed ? ' on' : ''}`} aria-hidden="true" />
              </button>
            </div>
          )}
        </aside>
      )}

      {(closing || restarting) && (
        <div className="lw-ask" role="dialog" aria-label={closing ? tw.closeAsk : tw.restartAsk}>
          <div>
            <b>{closing ? tw.closeAsk : tw.restartAsk}</b>
            <button
              className="lw-btn stop"
              onClick={() =>
                void stop().then(() => (closing ? shell?.close() : shell?.restart?.()))
              }
            >
              {closing ? tw.stopAndClose : tw.restartNow}
            </button>
            <button
              className="lw-btn"
              onClick={() => {
                setClosing(false);
                setRestarting(false);
              }}
            >
              {tw.keepThem}
            </button>
          </div>
        </div>
      )}

      {locked && (
        <button
          className="lw-lock"
          // (the window lets clicks through while locked; over the badge it takes them again: the
          // app counts the top right 150 x 44 px as the badge, so it stays inside that)
          onPointerEnter={() => shell?.setClickThrough(false)}
          onPointerLeave={() => shell?.setClickThrough(true)}
          onClick={() => setLocked(false)}
        >
          <Icon name="lock" />
          <span>{tw.unlock}</span>
        </button>
      )}

      {shell && !locked && (
        <>
          <span className="lw-corner bl" onPointerDown={(e) => resize(e, 'left')} />
          <span className="lw-corner br" onPointerDown={(e) => resize(e, 'right')} />
        </>
      )}
    </div>
  );
}

const drawerTitle = (d: 'settings' | 'lang' | 'invite') =>
  d === 'settings' ? t.settings : d === 'lang' ? tw.translateInto : t.inviteTitle;

/** A corner dragged: the desktop app grows or shrinks the window (Windows can't, see-through). */
function resize(e: ReactPointerEvent<HTMLSpanElement>, edge: 'left' | 'right') {
  const el = e.currentTarget;
  el.setPointerCapture(e.pointerId);
  let x = e.screenX;
  let y = e.screenY;
  const move = (ev: PointerEvent) => {
    shell?.resizeBy(ev.screenX - x, ev.screenY - y, edge);
    x = ev.screenX;
    y = ev.screenY;
  };
  const up = () => {
    shell?.resized?.();
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', up);
    el.removeEventListener('pointercancel', up);
  };
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
}
