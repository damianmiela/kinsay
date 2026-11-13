// /join: someone else's captions, by their code (/join#K7P2QX from the QR code, or typed at the one
// code door). No account needed. A reader starts in the host's language and may pick their own (one
// more stream, paid by the host). Their bar (mockups batch 3): the language, Read aloud, Settings.
import { useState } from 'react';
import { ControlBar, GearCb, LangButton, Strip } from './Bar';
import { Logo } from './bits';
import { CaptionsView } from './CaptionsView';
import { CodeDoor } from './Code';
import { LangSheet } from './LangPicker';
import { langName } from './langs';
import { canSpeak, unlockSpeech, useReadAloud, voiceHelp } from './readAloud';
import { SettingsSheet, SwitchRow, TextSizeRow } from './Settings';
import { useStored } from './store';
import { clock, t, tw } from './texts';
import { ask, useSession } from './useSession';

const codeOf = (hash: string) => /^#([A-Za-z0-9]{6})$/.exec(hash)?.[1]?.toUpperCase();
const EMPTY = { lines: [], first: 0, live: '' };
const EARPHONES_KEY = 'tr-earphones-seen';

const seenEarphones = () => {
  try {
    return localStorage.getItem(EARPHONES_KEY) === '1';
  } catch {
    return true;
  }
};

export function ReaderPage() {
  const [code, setCode] = useState(() => codeOf(window.location.hash));
  // (after Leave: a page of its own, never the sign-in page: a reader has no account)
  const [left, setLeft] = useState<string | null>(null);
  if (left !== null && code) {
    return (
      <div className="page">
        <div className="bar">
          <Logo />
        </div>
        <div className="body">
          <h1 className="t">{t.leftTitle(left)}</h1>
          <button className="btn main big" onClick={() => setLeft(null)}>
            {t.joinAgain}
          </button>
          <button
            className="btn"
            onClick={() => {
              history.replaceState(null, '', '/join');
              setLeft(null);
              setCode(undefined);
            }}
          >
            {t.typeAnother}
          </button>
        </div>
      </div>
    );
  }
  if (!code) return <CodeDoor onJoin={setCode} />;
  return <Reading code={code} onBad={() => setCode(undefined)} onLeave={setLeft} />;
}

const IconSpeaker = ({ off = false }: { off?: boolean }) => (
  <svg
    width="22"
    height="22"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M11 5 6 9H3v6h3l5 4z" />
    {off ? (
      <path d="m16 9 5 6M21 9l-5 6" />
    ) : (
      <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />
    )}
  </svg>
);
const IconCheck = () => (
  <svg
    width="22"
    height="22"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.4"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="m5 12 5 5 9-10" />
  </svg>
);

function Reading({
  code,
  onBad,
  onLeave,
}: {
  code: string;
  onBad: () => void;
  onLeave: (hostName: string) => void;
}) {
  const { view, update, error, online } = useSession(code);
  const [showHeard, setShowHeard] = useStored('tr-heard', false);
  const [scale, setScale] = useStored('tr-scale', 1);
  const [aloud, setAloud] = useStored('tr-aloud', false);
  const [sheet, setSheet] = useState<null | 'gear' | 'lang'>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [earphones, setEarphones] = useState(false);
  const [voiceSeen, setVoiceSeen] = useState(false);
  const lang = view?.lang ?? null;
  const text = (lang ? update.texts[lang] : update.texts.heard) ?? EMPTY;
  const { saying, noVoice } = useReadAloud(
    aloud && !!view?.running,
    text,
    lang,
    (n) => update.heardLangs?.[n],
  );
  if (error === 'no-session' || error === 'too-many') {
    return <BadCode onRetry={onBad} tooMany={error === 'too-many'} />;
  }
  if (!view) {
    return (
      <div className="page">
        <div className="bar">
          <Logo />
        </div>
        {error === 'too-many-pages' && (
          <div className="body">
            <div className="note warn">{t.tooManyPages}</div>
          </div>
        )}
      </div>
    );
  }
  const changeLang = async (next: string | null) => {
    setSheet(null);
    setVoiceSeen(false);
    setProblem(await ask('session:lang', { lang: next }));
  };
  const toggleAloud = () => {
    if (!aloud) {
      unlockSpeech();
      if (!seenEarphones()) {
        setEarphones(true);
        try {
          localStorage.setItem(EARPHONES_KEY, '1');
        } catch {
          // fine
        }
      }
    } else setEarphones(false);
    setVoiceSeen(false);
    setAloud(!aloud);
  };
  const problemText =
    problem === 'too-many-langs'
      ? t.tooManyLangs
      : problem === 'service-full'
        ? t.serviceFull
        : problem
          ? tw.failed
          : null;
  const help = voiceHelp(navigator.userAgent, navigator.maxTouchPoints > 1);
  const bar = (
    <ControlBar
      strips={
        <>
          {!online && (
            <Strip tone="amber">
              <b>{t.noInternet}</b> {t.comeBack}
            </Strip>
          )}
          {problemText && (
            <Strip tone="amber" onClose={() => setProblem(null)}>
              {problemText}
            </Strip>
          )}
          {online && view.running && view.service === 'error' && (
            <Strip tone="amber">{t.serviceTrying}</Strip>
          )}
          {online && !view.running && view.stoppedAt && (
            <Strip>{t.hostStopped(clock(view.stoppedAt), view.hostName)}</Strip>
          )}
          {noVoice && !voiceSeen && lang && (
            <Strip tone="amber" onClose={() => setVoiceSeen(true)}>
              <b>{t.noVoice(langName(lang).own)}</b> {t.addVoice[help]}
            </Strip>
          )}
          {earphones && aloud && !noVoice && view.running && <Strip>{t.earphones}</Strip>}
        </>
      }
    >
      <div className={`cbar-pair${canSpeak ? ' three' : ''}`}>
        <LangButton lang={view.lang} onClick={() => setSheet('lang')} />
        {canSpeak && (
          <button
            className={`cb aloud${aloud && !noVoice ? ' on' : ''}${noVoice ? ' dim' : ''}`}
            aria-pressed={aloud}
            onClick={toggleAloud}
          >
            {aloud && !noVoice ? <IconCheck /> : <IconSpeaker off={noVoice} />}
            {aloud && !noVoice ? t.reading : t.readAloud}
          </button>
        )}
        <GearCb onClick={() => setSheet('gear')} />
      </div>
    </ControlBar>
  );
  return (
    <div className="cap-screen" style={{ ['--cap-scale' as string]: scale }}>
      <div className={`who${view.running && online ? '' : ' off'}`}>
        {t.hostsCaptions(view.hostName)}
        {view.running && online && <span className="live">{t.live}</span>}
      </div>
      <CaptionsView
        update={update}
        lang={view.lang}
        showHeard={showHeard}
        bar={bar}
        saying={saying}
        waiting={view.running ? t.waitingReader : t.waitingHost(view.hostName)}
      />
      {sheet === 'lang' && (
        <LangSheet
          title={t.translateIntoSet}
          value={view.lang}
          full={view.full && { langs: view.full, note: t.fullLangs(view.hostName) }}
          onPick={(l) => void changeLang(l)}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === 'gear' && (
        <SettingsSheet
          onClose={() => setSheet(null)}
          half={view.running}
          captions={
            <>
              <TextSizeRow scale={scale} setScale={setScale} />
              {view.lang && (
                <SwitchRow label={t.showHeard} on={showHeard} onChange={setShowHeard} />
              )}
            </>
          }
          leave={{ label: t.leaveNamed(view.hostName), onClick: () => onLeave(view.hostName) }}
        />
      )}
    </div>
  );
}

function BadCode({ onRetry, tooMany }: { onRetry: () => void; tooMany: boolean }) {
  return (
    <div className="page">
      <div className="bar">
        <Logo />
      </div>
      <div className="body">
        <div className="note bad">{tooMany ? t.tooMany : t.noSession}</div>
        <button
          className="btn main"
          onClick={() => {
            history.replaceState(null, '', '/join');
            onRetry();
          }}
        >
          {t.enterCode}
        </button>
      </div>
    </div>
  );
}
