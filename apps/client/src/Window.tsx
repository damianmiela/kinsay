// The subtitles window (/window): Translate's captions as a see-through window over a call, in the
// desktop app (desktop/win: it hands the page this computer's sound and the window's own controls,
// `window.liveShell`) or in a browser tab. Mockups batch 1 (the window, from the wedding app's) and
// batch 2 part 7 (its sign-in: the person's own browser, the same digits on both). One language, as
// every page here: the translation, or what is heard without one. Only the captions show; the
// controls appear while the mouse is over it.
import { useEffect, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { HEARD, type CaptionText } from '@translate/shared';
import { api } from './api';
import { UiLangSelect } from './bits';
import { CaptionsList } from './CaptionsList';
import { LangPicker } from './LangPicker';
import { langName } from './langs';
import { useMic } from './mic/useMic';
import { Qr } from './Qr';
import { useStored } from './store';
import { clock, stopText, t, tw } from './texts';
import { ask, useSession } from './useSession';
import './window.css';

/** What the desktop app gives the page (desktop/win's bridge); missing in a browser tab. */
interface LiveShell {
  setOpacity(value: number): void;
  setClickThrough(on: boolean): void;
  resizeBy(dx: number, dy: number, edge: 'left' | 'right'): void;
  resized?(): void;
  close(): void;
}
const shell = (window as { liveShell?: LiveShell }).liveShell;
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
  const { view, update, error } = useSession(code);
  const mic = useMic({ voice: true });
  const [lang, setLang] = useStored<string | null>('tr-window-lang', null);
  const [source, setSource] = useStored<'system' | 'mic'>('tr-window-source', 'system');
  const [size, setSize] = useStored('tr-window-size', 1);
  const [opacity, setOpacity] = useStored('tr-window-opacity', 0.85);
  const [menu, setMenu] = useState(false);
  const [picking, setPicking] = useState(false);
  const [qr, setQr] = useState(false);
  const [locked, setLocked] = useState(false);
  const [quiet, setQuiet] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const { chooseSource } = mic;
  useEffect(() => {
    chooseSource(source);
  }, [chooseSource, source]);
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
  const shown = view.lang;

  const start = async () => {
    setProblem(null);
    const err = await ask('session:start', { lang });
    if (err) return setProblem(err);
    if ((await mic.startSending()) === 'failed') {
      await ask('session:stop');
      setProblem('sound');
    }
  };
  const stop = async () => {
    mic.stopSending();
    await ask('session:stop');
  };
  const resume = async () => {
    setProblem(null);
    if ((await mic.startSending()) === 'failed') setProblem('sound');
  };
  const changeLang = async (next: string | null) => {
    setPicking(false);
    if (host) setLang(next);
    if (view.running || !host) setProblem(await ask('session:lang', { lang: next }));
  };
  const switchSource = () => {
    const next = source === 'system' ? 'mic' : 'system';
    setSource(next);
    mic.chooseSource(next);
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

  // the start panel: a host whose session isn't running
  const panel = host && !view.running;
  const stopped = view.stopped && view.stopped !== 'ended' ? stopText(view.stopped) : null;
  const fromStop = problem ? stopText(problem as never) : null;
  const note =
    problem === 'sound'
      ? { cls: 'bad', head: source === 'system' ? tw.soundProblem : t.micProblem, body: '' }
      : problem === 'offline'
        ? { cls: 'bad', head: tw.offline, body: tw.offlineBody }
        : problem === 'service-full'
          ? { cls: 'warn', head: t.serviceFull, body: '' }
          : problem === 'too-many-langs'
            ? { cls: 'warn', head: t.tooManyLangs, body: '' }
            : fromStop
              ? { cls: 'bad', head: fromStop[0], body: fromStop[1] }
              : problem
                ? { cls: 'bad', head: tw.failed, body: '' }
                : stopped
                  ? { cls: 'bad', head: stopped[0], body: stopped[1] }
                  : view.service === 'error'
                    ? { cls: 'warn', head: t.serviceDown[0], body: t.serviceDown[1] }
                    : quiet && mic.sending
                      ? {
                          cls: '',
                          head: source === 'system' ? tw.waitingSound : tw.waitingVoice,
                          body: source === 'system' ? tw.waitingSoundBody : '',
                        }
                      : null;
  const text: CaptionText = update.texts[shown ?? HEARD] ?? EMPTY;
  // (what is heard: each line with the language it was heard in, as on the website)
  const labels = shown
    ? undefined
    : Object.fromEntries(
        Object.entries(update.heardLangs ?? {}).map(([n, c]) => [n, langName(c).own]),
      );

  return (
    <div
      className={`lw${locked ? ' locked' : ''}${shell ? ' in-app' : ''}`}
      style={{ ['--lw-size' as string]: size, ['--lw-glass' as string]: shell ? 0.72 : 0.9 }}
    >
      {!locked && (
        <div className="lw-ctl">
          <span className="lw-grip" aria-hidden="true" />
          {host && view.running && (
            <button className="stop" onClick={() => void stop()}>
              ■ {t.stop}
            </button>
          )}
          {host && (
            <button onClick={switchSource} aria-label={tw.listenTo}>
              <span className={`lw-dot${mic.sending ? ' on' : ''}`} />
              {source === 'system' ? tw.thisComputer : tw.mic}
            </button>
          )}
          {!panel && (
            <button onClick={() => setPicking((p) => !p)} aria-label={tw.translateInto}>
              {shown ? langName(shown).own : t.noTranslation}
            </button>
          )}
          <span className="lw-gap" />
          <button aria-label={tw.smaller} onClick={() => setSize(step(size, -0.1))}>
            A−
          </button>
          <button aria-label={tw.bigger} onClick={() => setSize(step(size, 0.1))}>
            A+
          </button>
          <button aria-label={tw.menu} className={menu ? 'on' : ''} onClick={() => setMenu(!menu)}>
            ⚙
          </button>
          {shell && (
            <button aria-label={tw.closeWindow} onClick={() => shell.close()}>
              ✕
            </button>
          )}
        </div>
      )}

      {menu && !locked && (
        <div className="lw-menu">
          {shell && (
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
          )}
          {shell && (
            <button
              className="r"
              onClick={() => {
                setMenu(false);
                setLocked(true);
              }}
            >
              {tw.lock}
            </button>
          )}
          {host && view.code && (
            <button
              className="r"
              onClick={() => {
                setMenu(false);
                setQr(true);
              }}
            >
              {tw.showQr}
            </button>
          )}
          <label className="r">
            {t.pageLang}
            <UiLangSelect />
          </label>
          {host ? (
            <button className="r" onClick={() => window.open('/account', '_blank', 'noopener')}>
              {tw.account}
            </button>
          ) : (
            <button className="r" onClick={onLeave}>
              {t.leave}
            </button>
          )}
        </div>
      )}

      {(panel || picking) && !locked && (
        <div className="lw-panel">
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
              </div>
            </div>
          )}
          <div className="lw-row">
            <span className="k">{tw.translateInto}</span>
            {/* (the language and Start side by side: the window's default height holds both rows) */}
            <div className="lw-go-row">
              <LangPicker
                inline
                value={panel ? lang : shown}
                onChange={(l) => (panel ? setLang(l) : void changeLang(l))}
                startOpen={picking && !panel}
              />
              {panel && (
                <button className="lw-go" onClick={() => void start()}>
                  {t.start}
                </button>
              )}
            </div>
          </div>
          {panel && note && <Note note={note} />}
        </div>
      )}

      {/* the whole history, scrolling, following the newest line: the website's own list (Damian) */}
      {!panel && (
        <div className="lw-caps" lang={shown ?? undefined}>
          <CaptionsList
            text={text}
            labels={labels}
            note={shown ? t.note : t.heardNote}
            waiting={view.running ? tw.waitingVoice : t.waitingHost(view.hostName)}
            latest={t.latest}
          />
        </div>
      )}
      {!panel && note && <Note note={note} />}
      {host && view.stopsAt && (
        <div className="lw-note warn">
          <b>{t.stillListening(clock(view.stopsAt))}</b>{' '}
          <button className="lw-small" onClick={() => void ask('session:keepGoing')}>
            {t.keepGoing}
          </button>
        </div>
      )}
      {host && view.running && !mic.sending && (
        <div className="lw-note">
          <b>{tw.resume}</b>{' '}
          <button className="lw-small" onClick={() => void resume()}>
            {t.micOn}
          </button>
        </div>
      )}

      {qr && view.code && (
        <button
          className="lw-qr"
          autoFocus
          aria-label={tw.closeQr}
          onClick={() => setQr(false)}
          onKeyDown={(e) => e.key === 'Escape' && setQr(false)}
        >
          <Qr text={`${window.location.origin}/join#${view.code}`} px={120} />
          <span>
            <b>{tw.readAlong}</b>
            <br />
            {tw.readAlongBody(view.code)}
          </span>
        </button>
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
