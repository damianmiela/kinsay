// /join: someone else's captions, by their code (/join#K7P2Q from the QR code, or typed). No account
// needed. A reader starts in the host's language and may pick their own (one more stream, paid by
// the host).
import { useState } from 'react';
import { GearButton, Logo, Sheet, Toggle } from './bits';
import { useStored } from './store';
import { CaptionsView } from './CaptionsView';
import { TextSize } from './Host';
import { LangPicker } from './LangPicker';
import { t } from './texts';
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
  const [faceToFace, setFaceToFace] = useStored('tr-read-face', false);
  const [showHeard, setShowHeard] = useStored('tr-heard', false);
  const [scale, setScale] = useStored('tr-scale', 1);
  const [sheet, setSheet] = useState(false);
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
      </div>
    );
  }
  const changeLang = async (lang: string | null) => {
    setProblem(await ask('session:lang', { lang }));
  };
  return (
    <div className="cap-screen" style={{ ['--cap-scale' as string]: scale }}>
      <div className="bar">
        <span className={`live-dot${view.running ? '' : ' off'}`}>
          {t.hostsCaptions(view.hostName)}
        </span>
      </div>
      {view.running ? (
        <CaptionsView
          update={update}
          lang={view.lang}
          faceToFace={faceToFace && !!view.lang}
          showHeard={showHeard}
          reader
        />
      ) : (
        <div className="body" style={{ justifyContent: 'center' }}>
          <div className="note info">
            <b>{t.waitingHost(view.hostName)}</b>
            {t.waitingHostBody}
          </div>
        </div>
      )}
      <div className="cap-notes">
        {problem === 'too-many-langs' && <div className="note bad">{t.tooManyLangs}</div>}
        {problem === 'service-full' && <div className="note warn">{t.serviceFull}</div>}
        {view.running && view.service === 'error' && (
          <div className="note warn">{t.serviceDown[0]}</div>
        )}
      </div>
      <div className="tray">
        <GearButton onClick={() => setSheet(true)} />
        <a className="btn" href="/">
          {t.leave}
        </a>
      </div>
      {sheet && (
        <Sheet label={t.settings} onClose={() => setSheet(false)}>
          <h2 className="t">{t.settings}</h2>
          <div>
            <span className="lbl">{t.language}</span>
            <LangPicker value={view.lang} onChange={(l) => void changeLang(l)} />
          </div>
          <div className="card" style={{ padding: '4px 16px' }}>
            <div className="list">
              {view.lang && (
                <div className="li">
                  <span className="what">
                    {t.faceToFace}
                    <small>{t.faceToFaceHint}</small>
                  </span>
                  <Toggle on={faceToFace} onChange={setFaceToFace} label={t.faceToFace} />
                </div>
              )}
              {view.lang && !faceToFace && (
                <div className="li">
                  <span className="what">{t.showHeard}</span>
                  <Toggle on={showHeard} onChange={setShowHeard} label={t.showHeard} />
                </div>
              )}
              <TextSize scale={scale} setScale={setScale} />
            </div>
          </div>
          <button className="btn main" onClick={() => setSheet(false)}>
            {t.back}
          </button>
        </Sheet>
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
