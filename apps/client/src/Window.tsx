// The subtitles window (/window): Kinsay's captions as a see-through window over a call, in the
// desktop app (desktop/win: it hands the page this computer's sound and the window's own controls,
// `window.liveShell`) or in a browser tab. Mockups batch 1 (the window, from the wedding app's) and
// batch 2 part 7 (its sign-in: the person's own browser, the same digits on both). One language, as
// every page here: the translation, or what is heard without one. Only the captions show; the
// controls appear while the mouse is over it.
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
import { LangPicker } from './LangPicker';
import { langName } from './langs';
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

/** The empty glass (while the page finds out who it is). */
function Glass({ children }: { children?: ReactNode }) {
  return (
    <div className={`lw${shell ? ' in-app' : ''}`} style={{ ['--lw-glass' as string]: 0.9 }}>
      <div className="lw-ctl" style={{ opacity: 1 }}>
        <span className="lw-grip" aria-hidden="true" />
        <span className="lw-gap" />
        {shell && (
          <button aria-label={tw.closeWindow} onClick={() => shell.close()}>
            ✕
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
      <div className="lw-panel">
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
            {state === 'no' && <p className="lw-note bad">{tw.signInNo}</p>}
            {state === 'offline' && <p className="lw-note bad">{t.offline}</p>}
            {state === 'too-many' && <p className="lw-note bad">{t.tooMany}</p>}
            <button className="lw-go" disabled={busy} onClick={() => void start()}>
              {state === 'no' ? tw.signInAgain : tw.signInButton}
            </button>
          </>
        )}
        {typing ? (
          <form
            className="lw-row"
            onSubmit={(e) => {
              e.preventDefault();
              const c = codeOf(value);
              if (c) onCode(c);
            }}
          >
            <span className="k">{t.codeLabel}</span>
            <input
              className="input code"
              maxLength={6}
              autoFocus
              autoComplete="off"
              aria-label={t.codeLabel}
              value={value}
              onChange={(e) => setValue(e.target.value.replace(/[^A-Za-z0-9]/g, ''))}
            />
            <button className="lw-go" disabled={!codeOf(value)}>
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

/** The captions: the signed-in person's own session, or (with `code`) someone else's. */
function Captions({ code, onLeave }: { code?: string; onLeave?: () => void }) {
  const { view, update, error, online } = useSession(code);
  const mic = useMic({ voice: true });
  // both sides of a call (batch 9): the microphone too, while this computer's sound is captioned
  const sideMic = useMic({ voice: true, side: true });
  const [lang, setLang] = useStored<string | null>('tr-window-lang', null);
  // what it listens to: this computer, the microphone, or both sides of a call (the host's only)
  const [stored, setSource] = useStored<'system' | 'mic' | 'both'>('tr-window-source', 'system');
  const [size, setSize] = useStored('tr-window-size', 1);
  const [opacity, setOpacity] = useStored('tr-window-opacity', 0.85);
  const [menu, setMenu] = useState(false);
  const [picking, setPicking] = useState(false);
  const [qr, setQr] = useState(false);
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
  // (both: the session's sound is this computer's, the microphone goes as its own side)
  const micSource = source === 'mic' ? 'mic' : 'system';
  const both = view?.role === 'host' && source === 'both' && !!view.bothSides;
  // the server's switch follows the choice (its streams for the microphone side)
  const wantBoth = view?.role === 'host' ? source === 'both' : undefined;
  useEffect(() => {
    if (wantBoth === undefined || !!view?.bothSides === wantBoth) return;
    void ask('session:bothSides', { on: wantBoth }).then((err) => err && setProblem(err));
  }, [wantBoth, view?.bothSides]);
  // the microphone side follows the session's sound: on with it, off with it or with the switch
  useEffect(() => {
    if (mic.sending && both && !sideMic.sending && !sideMic.open) {
      void sideMic.startSending().then((r) => r === 'failed' && setProblem('sound'));
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
        <div className="lw-panel">
          <p className="lw-note bad">{error === 'too-many' ? t.tooMany : t.noSession}</p>
          <button className="lw-go" onClick={onLeave}>
            {t.backHome}
          </button>
        </div>
      </Glass>
    );
  }
  if (!view) {
    return (
      <Glass>
        {error === 'too-many-pages' && <div className="lw-note warn">{t.tooManyPages}</div>}
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
    setPicking(false);
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

  return (
    <div
      className={`lw${locked ? ' locked' : ''}${shell ? ' in-app' : ''}`}
      style={{ ['--lw-size' as string]: size, ['--lw-glass' as string]: shell ? 0.72 : 0.9 }}
    >
      {/* (a small "Live" that stays while the strip hides: the captions are on) */}
      {view.running && online && <span className="lw-live">{t.live}</span>}
      {!locked && !closing && !restarting && (
        <div className="lw-ctl">
          <span className="lw-grip" aria-hidden="true" />
          {updated && (
            <span className="lw-upd">
              {tw.updated}
              <button onClick={() => (mic.sending ? setRestarting(true) : shell?.restart?.())}>
                {tw.restart}
              </button>
            </span>
          )}
          {/* the phone's bar: Stop (or Start) · the language · Settings; then the window's own */}
          {runs && view.running && (
            <button className="stop" onClick={() => void stop()}>
              ■ {t.stop}
            </button>
          )}
          {!panel && (
            <button
              className="lang"
              onClick={() => setPicking((p) => !p)}
              aria-label={`${tw.translateInto}: ${shown ? langName(shown).own : t.original}`}
            >
              {shown ? langName(shown).own : t.original} ▾
            </button>
          )}
          <button aria-label={tw.menu} className={menu ? 'on' : ''} onClick={() => setMenu(!menu)}>
            ⚙
          </button>
          <span className="lw-gap" />
          {!panel && (
            <>
              <button aria-label={tw.smaller} onClick={() => setSize(step(size, -0.1))}>
                A−
              </button>
              <button aria-label={tw.bigger} onClick={() => setSize(step(size, 0.1))}>
                A+
              </button>
            </>
          )}
          {shell && (
            <>
              <span className="lw-sep" aria-hidden="true" />
              <button aria-label={tw.closeWindow} onClick={close}>
                ✕
              </button>
            </>
          )}
        </div>
      )}

      {closing && (
        <div className="lw-ask">
          <b>{tw.closeAsk}</b>
          <button
            className="stop"
            onClick={() => {
              void stop().then(() => shell?.close());
            }}
          >
            {tw.stopAndClose}
          </button>
          <button onClick={() => setClosing(false)}>{tw.keepThem}</button>
        </div>
      )}

      {restarting && (
        <div className="lw-ask">
          <b>{tw.restartAsk}</b>
          <button className="stop" onClick={() => void stop().then(() => shell?.restart?.())}>
            {tw.restartNow}
          </button>
          <button onClick={() => setRestarting(false)}>{tw.keepThem}</button>
        </div>
      )}

      {menu && !locked && (
        <div className="lw-menu">
          {host && view.code && (
            <button
              className="r"
              onClick={() => {
                setMenu(false);
                setQr(true);
              }}
            >
              {t.inviteTitle}
            </button>
          )}
          {(runs || offer) && (
            <>
              <h6>{t.groupMic}</h6>
              {(host ? (['system', 'mic', 'both'] as const) : (['system', 'mic'] as const)).map(
                (src) => (
                  <button
                    key={src}
                    className={`r${source === src ? ' sel' : ''}`}
                    aria-pressed={source === src}
                    onClick={() => source !== src && switchSource(src)}
                  >
                    {src === 'system' ? tw.thisComputer : src === 'mic' ? tw.mic : tw.bothSides}
                    {source === src && <span aria-hidden="true">✓</span>}
                  </button>
                ),
              )}
            </>
          )}
          {shell && (
            <>
              <h6>{tw.groupWindow}</h6>
              <label className="r">
                {tw.seeThrough}
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
                className="r"
                onClick={() => {
                  setMenu(false);
                  setLocked(true);
                }}
              >
                {tw.lock}
              </button>
            </>
          )}
          {host && (
            <>
              <h6>{t.groupAccount}</h6>
              <button className="r" onClick={() => window.open('/account', '_blank', 'noopener')}>
                {view.hostName}
                {view.balance !== undefined && <span>{euros(Math.max(0, view.balance))} ›</span>}
              </button>
            </>
          )}
          {(guest || offer) && (
            <>
              <h6>{t.groupAccount}</h6>
              <span className="r">{t.onBalance(view.hostName)}</span>
            </>
          )}
          <h6>{t.groupApp}</h6>
          <label className="r">
            {t.pageLang}
            <UiLangSelect />
          </label>
          {!host && (
            <button className="r" onClick={onLeave}>
              {t.leaveNamed(view.hostName)}
            </button>
          )}
        </div>
      )}

      {(panel || picking) && !locked && (
        <div className="lw-panel">
          {panel && !host && (
            <p className="lw-who">
              <b>{t.hostsCaptions(view.hostName)}</b> · {t.onBalance(view.hostName)}
            </p>
          )}
          {panel && (
            <div className="lw-row">
              <span className="k">{tw.listenTo}</span>
              <div className="lw-seg">
                <button
                  className={source === 'system' ? 'sel' : ''}
                  onClick={() => setSource('system')}
                >
                  {tw.system} <small>{tw.systemHint}</small>
                </button>
                <button className={source === 'mic' ? 'sel' : ''} onClick={() => setSource('mic')}>
                  {tw.mic} <small>{tw.micHint}</small>
                </button>
                {host && (
                  <button
                    className={source === 'both' ? 'sel' : ''}
                    onClick={() => setSource('both')}
                  >
                    {tw.both} <small>{tw.bothHint}</small>
                  </button>
                )}
              </div>
            </div>
          )}
          <div className="lw-row">
            <span className="k">{tw.translateInto}</span>
            {/* (the language and Start side by side: the window's default height holds both rows) */}
            <div className="lw-go-row">
              <LangPicker
                inline
                value={panel ? (host ? lang : guestLang) : shown}
                onChange={(l) => (panel ? setLang(l) : void changeLang(l))}
                startOpen={picking && !panel}
              />
              {panel && (
                <button className="lw-go" disabled={!host && !hostOn} onClick={() => void start()}>
                  {t.start}
                </button>
              )}
            </div>
          </div>
          {offer && (
            <button className="lw-link" onClick={() => setJustRead(true)}>
              {t.justRead(view.hostName)}
            </button>
          )}
          {panel && note && <Note note={note} />}
        </div>
      )}

      {/* the whole history, scrolling, following the newest line: the website's own list (Damian) */}
      {!panel && (
        <div className="lw-caps" lang={shown ?? undefined}>
          {view.bothSides && (
            <p className="lw-sides">
              <span className="you">{tw.sideYou}</span>
              <span className="call">{tw.sideCall}</span>
            </p>
          )}
          <CaptionsList
            text={text}
            labels={labels}
            waiting={view.running ? tw.waitingVoice : t.waitingHost(view.hostName)}
            latest={t.latest}
          />
        </div>
      )}
      {!online && (
        <div className="lw-note warn">
          <b>{t.noInternet}</b> {host && mic.sending ? t.offlineKept : t.comeBack}
        </div>
      )}
      {!panel && note && <Note note={note} />}
      {host && view.guestRunning && (
        <div className="lw-note">
          {t.guestRunsToo}{' '}
          <button className="lw-small" onClick={() => void ask('session:stopGuest')}>
            {t.stopTheirs}
          </button>
        </div>
      )}
      {host && view.stopsAt && (
        <div className="lw-note warn">
          <b>{t.stillListening(clock(view.stopsAt))}</b>{' '}
          <button className="lw-small" onClick={() => void ask('session:keepGoing')}>
            {t.keepGoing}
          </button>
        </div>
      )}
      {host && view.running && !mic.sending && where && (
        <div className="lw-note">
          {before}
          <b>{t.deviceName[where]}</b>
          {after}{' '}
          <button className="lw-small" onClick={() => void listenHere()}>
            {t.useThisOne}
          </button>
        </div>
      )}
      {runs && view.running && !mic.sending && !where && (
        <div className="lw-note warn">
          <b>{t.micIsOff}</b>{' '}
          <button className="lw-small" onClick={() => void resume()}>
            {t.turnItOn}
          </button>
        </div>
      )}

      {qr && view.code && (
        <div
          className="lw-qr"
          role="dialog"
          aria-label={tw.readAlong}
          onKeyDown={(e) => e.key === 'Escape' && setQr(false)}
        >
          <Qr text={`${window.location.origin}/join#${view.code}`} px={120} />
          <span>
            <b>{tw.readAlong}</b>
            <br />
            {tw.readAlongBody(view.code)}
            <button
              className="lw-guest"
              role="switch"
              aria-checked={!!view.guestAllowed}
              onClick={() => void ask('session:guestAllow', { on: !view.guestAllowed })}
            >
              <span>
                {t.guestAllow}
                <small>{t.guestAllowSmall}</small>
              </span>
              <span className={`lw-tog${view.guestAllowed ? ' on' : ''}`} aria-hidden="true" />
            </button>
          </span>
          <button
            className="lw-qr-x"
            autoFocus
            aria-label={tw.closeQr}
            onClick={() => setQr(false)}
          >
            ✕
          </button>
        </div>
      )}

      {locked && (
        <button
          className="lw-lock"
          aria-label={tw.unlock}
          // (the window lets clicks through while locked; over the badge it takes them again)
          onPointerEnter={() => shell?.setClickThrough(false)}
          onPointerLeave={() => shell?.setClickThrough(true)}
          onClick={() => setLocked(false)}
        >
          🔒 <span>{tw.unlock}</span>
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

function Note({ note }: { note: { cls: string; head: string; body: string } }) {
  return (
    <div className={`lw-note ${note.cls}`}>
      <b>{note.head}</b>
      {note.body && <br />}
      {note.body}
    </div>
  );
}

// (0.85 at the least: the older lines stay 16 px, audit 32)
const step = (v: number, by: number) => Math.round(Math.min(2, Math.max(0.85, v + by)) * 100) / 100;

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
