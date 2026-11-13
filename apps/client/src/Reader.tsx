// /join: someone else's captions, by their code (/join#K7P2Q from the QR code, or typed). No account
// needed. A reader starts in the host's language and may pick their own (one more stream, paid by
// the host).
import { useState } from 'react';
import { ControlBar, GearCb, LangButton, Strip } from './Bar';
import { Logo } from './bits';
import { useStored } from './store';
import { CaptionsView } from './CaptionsView';
import { LangSheet } from './LangPicker';
import { SettingsSheet, SwitchRow, TextSizeRow } from './Settings';
import { t, tw } from './texts';
import { ask, useSession } from './useSession';

const codeOf = (hash: string) => /^#([A-Za-z2-9]{6})$/.exec(hash)?.[1]?.toUpperCase();

export function ReaderPage() {
  const [code, setCode] = useState(() => codeOf(window.location.hash));
  if (!code) return <CodeForm onCode={setCode} />;
  return <Reading code={code} onBad={() => setCode(undefined)} />;
}

function CodeForm({ onCode, bad }: { onCode: (c: string) => void; bad?: boolean }) {
  const [value, setValue] = useState('');
  return (
    <div className="page">
      <div className="bar">
        <a href="/" style={{ color: 'inherit', textDecoration: 'none' }}>
          <Logo />
        </a>
      </div>
      <form
        className="body"
        onSubmit={(e) => {
          e.preventDefault();
          history.replaceState(null, '', `/join#${value.toUpperCase()}`);
          onCode(value.toUpperCase());
        }}
      >
        <h1 className="t">{t.codeLabel}</h1>
        <p className="s">{t.codeHelp}</p>
        <input
          className="input code"
          maxLength={6}
          autoCapitalize="characters"
          autoComplete="off"
          value={value}
          aria-label={t.codeLabel}
          onChange={(e) => setValue(e.target.value.replace(/[^A-Za-z0-9]/g, ''))}
        />
        <button className="btn main" disabled={value.length !== 6}>
          {t.join}
        </button>
        {bad && <div className="note bad">{t.noSession}</div>}
      </form>
    </div>
  );
}

function Reading({ code, onBad }: { code: string; onBad: () => void }) {
  const { view, update, error } = useSession(code);
  const [showHeard, setShowHeard] = useStored('tr-heard', false);
  const [scale, setScale] = useStored('tr-scale', 1);
  const [sheet, setSheet] = useState<null | 'gear' | 'lang'>(null);
  const [problem, setProblem] = useState<string | null>(null);
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
  const changeLang = async (lang: string | null) => {
    setSheet(null);
    setProblem(await ask('session:lang', { lang }));
  };
  const problemText =
    problem === 'too-many-langs'
      ? t.tooManyLangs
      : problem === 'service-full'
        ? t.serviceFull
        : problem
          ? tw.failed
          : null;
  const bar = (
    <ControlBar
      strips={
        <>
          {problemText && (
            <Strip tone="amber" onClose={() => setProblem(null)}>
              {problemText}
            </Strip>
          )}
          {view.running && view.service === 'error' && (
            <Strip tone="amber">{t.serviceTrying}</Strip>
          )}
        </>
      }
    >
      <div className="cbar-pair">
        <LangButton lang={view.lang} onClick={() => setSheet('lang')} />
        <GearCb onClick={() => setSheet('gear')} />
      </div>
    </ControlBar>
  );
  return (
    <div className="cap-screen" style={{ ['--cap-scale' as string]: scale }}>
      <div className={`who${view.running ? '' : ' off'}`}>
        {t.hostsCaptions(view.hostName)}
        {view.running && <span className="live">{t.live}</span>}
      </div>
      <CaptionsView
        update={update}
        lang={view.lang}
        showHeard={showHeard}
        bar={bar}
        waiting={view.running ? t.waitingReader : t.waitingHost(view.hostName)}
      />
      {sheet === 'lang' && (
        <LangSheet
          title={t.translateIntoSet}
          value={view.lang}
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
          leave={{ label: t.leave, onClick: () => window.location.assign('/') }}
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
