// The signed-in person's own captions: Home (start, join someone's), then the captions with Stop,
// Invite (or Translate when there is no translation) and the gear for everything else.
import { useState } from 'react';
import { LOW_BALANCE } from '@translate/shared';
import { Balance, Foot, GearButton, Logo, Sheet, Toggle, UiLangRow } from './bits';
import { useStored } from './store';
import { CaptionsView } from './CaptionsView';
import { LangPicker } from './LangPicker';
import { langName } from './langs';
import { useMic } from './mic/useMic';
import { canStayAwake } from './useAwake';
import { Qr } from './Qr';
import { clock, stopText, t, tw } from './texts';
import { ask, useSession } from './useSession';

export function HostPage() {
  const { view, update, error } = useSession();
  const mic = useMic({ voice: true });
  const [lang, setLang] = useStored<string | null>('tr-lang', null);
  const [faceToFace, setFaceToFace] = useStored('tr-face', true);
  const [showHeard, setShowHeard] = useStored('tr-heard', false);
  const [scale, setScale] = useStored('tr-scale', 1);
  const [sheet, setSheet] = useState<null | 'gear' | 'invite' | 'translate'>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [lowSeen, setLowSeen] = useState(false);

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

  const start = async () => {
    setProblem(null);
    const err = await ask('session:start', { lang });
    if (err) return setProblem(err);
    const r = await mic.startSending();
    if (r === 'failed') {
      await ask('session:stop');
      setProblem('mic');
    }
  };
  const stop = async () => {
    mic.stopSending();
    await ask('session:stop');
  };
  const changeLang = async (next: string | null) => {
    setLang(next);
    setSheet(null);
    if (view.running) {
      const err = await ask('session:lang', { lang: next });
      if (err) setProblem(err);
    }
  };

  // (the session runs on the server even when this page's microphone isn't on: after a reload,
  // a second tab; Stop is always in reach, audit 30)
  const running = view.running;
  const resumeMic = async () => {
    setProblem(null);
    if ((await mic.startSending()) === 'failed') setProblem('mic');
  };
  const note = (k: string | null) => {
    if (!k) return null;
    if (k === 'mic')
      return (
        <div className="note bad">
          <b>{t.micProblem}</b>
          {mic.problem}
        </div>
      );
    if (k === 'too-many-langs') return <div className="note bad">{t.tooManyLangs}</div>;
    if (k === 'service-full') return <div className="note warn">{t.serviceFull}</div>;
    if (k === 'offline') return <div className="note bad">{t.offline}</div>;
    const s = stopText(k as never);
    return s ? (
      <div className="note bad">
        <b>{s[0]}</b>
        {s[1]}
      </div>
    ) : null;
  };

  // ---------- Home ----------
  if (!running) {
    const stopped = view.stopped && view.stopped !== 'ended' ? view.stopped : null;
    return (
      <div className="page" style={{ ['--cap-scale' as string]: scale }}>
        <div className="bar">
          <Logo />
          <span className="spacer" />
          {view.balance !== undefined && <Balance micro={view.balance} />}
        </div>
        <div className="body">
          <h1 className="t">{t.startTitle}</h1>
          <p className="s">{t.phoneListens}</p>
          <div>
            <span className="lbl">{t.translateInto}</span>
            <LangPicker value={lang} onChange={setLang} />
            {!lang && (
              <p className="small" style={{ margin: '8px 0 0' }}>
                {t.withoutTranslation}
              </p>
            )}
          </div>
          {note(problem ?? stopped)}
          {(stopped === 'credits' || problem === 'credits') && (
            <a className="btn" href="/account#ask">
              {t.askForMore}
            </a>
          )}
          <button className="btn main" onClick={() => void start()}>
            {t.start}
          </button>
          <div className="or">{t.or}</div>
          <h2 className="t">{t.joinCaptions}</h2>
          <a className="btn" href="/join">
            {t.enterCode}
          </a>
          <Foot />
        </div>
      </div>
    );
  }

  // ---------- the captions ----------
  const service = view.service === 'error' ? t.serviceDown : null;
  const low = (view.balance ?? Infinity) < LOW_BALANCE && !lowSeen;
  return (
    <div className="cap-screen" style={{ ['--cap-scale' as string]: scale }}>
      <div className="bar">
        <span className="live-dot">
          {t.live}
          {lang ? ` · ${langName(lang).own}` : ''}
        </span>
        <span className="spacer" />
        {view.balance !== undefined && <Balance micro={view.balance} />}
      </div>
      <CaptionsView
        update={update}
        lang={lang}
        faceToFace={faceToFace}
        showHeard={showHeard}
        onFaceToFaceOff={() => setFaceToFace(false)}
      />
      <div className="cap-notes">
        {service && (
          <div className="note warn">
            <b>{service[0]}</b>
            {view.error && view.error.startsWith('The translation service is full')
              ? view.error
              : service[1]}
          </div>
        )}
        {low && (
          <div className="note warn" onClick={() => setLowSeen(true)}>
            <b>{t.lowTitle}</b>
            {t.lowBody(Math.max(0, view.balance ?? 0))}
          </div>
        )}
        {!canStayAwake && mic.sending && <div className="note info">{t.keepScreenOn}</div>}
        {view.stopsAt && (
          <div className="note warn">
            <b>{t.stillListening(clock(view.stopsAt))}</b>
            <button
              className="btn main"
              style={{ marginTop: 8 }}
              onClick={() => void ask('session:keepGoing')}
            >
              {t.keepGoing}
            </button>
          </div>
        )}
        {!mic.sending && (
          <div className="note info">
            <b>{t.micOff}</b>
            <button className="btn main" style={{ marginTop: 8 }} onClick={() => void resumeMic()}>
              {t.micOn}
            </button>
          </div>
        )}
        {note(problem)}
      </div>
      <div className="tray">
        <button className="btn stop" onClick={() => void stop()}>
          {t.stop}
        </button>
        {lang ? (
          <button className="btn" onClick={() => setSheet('invite')}>
            {t.invite}
          </button>
        ) : (
          <button className="btn main" onClick={() => setSheet('translate')}>
            {t.translate}
          </button>
        )}
        <GearButton onClick={() => setSheet('gear')} />
      </div>

      {sheet === 'translate' && (
        <Sheet label={t.translate} onClose={() => setSheet(null)}>
          <h2 className="t">{t.translateIntoSet}</h2>
          <LangPicker value={lang} onChange={(l) => void changeLang(l)} startOpen />
        </Sheet>
      )}
      {sheet === 'invite' && view.code && (
        <InviteSheet code={view.code} onClose={() => setSheet(null)} />
      )}
      {sheet === 'gear' && (
        <Sheet label={t.settings} onClose={() => setSheet(null)}>
          <h2 className="t">{t.settings}</h2>
          <div>
            <span className="lbl">{t.translateIntoSet}</span>
            <LangPicker value={lang} onChange={(l) => void changeLang(l)} />
          </div>
          <div className="card" style={{ padding: '4px 16px' }}>
            <div className="list">
              {lang && (
                <div className="li">
                  <span className="what">
                    {t.faceToFace}
                    <small>{t.faceToFaceHint}</small>
                  </span>
                  <Toggle on={faceToFace} onChange={setFaceToFace} label={t.faceToFace} />
                </div>
              )}
              {lang && !faceToFace && (
                <div className="li">
                  <span className="what">{t.showHeard}</span>
                  <Toggle on={showHeard} onChange={setShowHeard} label={t.showHeard} />
                </div>
              )}
              <TextSize scale={scale} setScale={setScale} />
              <UiLangRow />
            </div>
          </div>
          <div className="card" style={{ padding: '4px 16px' }}>
            <div className="list">
              <button className="li link-row" onClick={() => setSheet('invite')}>
                <span className="what">{t.inviteTitle}</span>›
              </button>
              <a className="li link-row" href="/account">
                <span className="what">{t.account}</span>›
              </a>
            </div>
          </div>
          <button className="btn main" onClick={() => setSheet(null)}>
            {t.back}
          </button>
        </Sheet>
      )}
    </div>
  );
}

export function TextSize({ scale, setScale }: { scale: number; setScale: (v: number) => void }) {
  const step = (d: number) =>
    setScale(Math.min(1.8, Math.max(0.8, Math.round((scale + d) * 10) / 10)));
  return (
    <div className="li">
      <span className="what">{t.textSize}</span>
      <button className="btn sm" onClick={() => step(-0.1)} aria-label={tw.smaller}>
        A−
      </button>
      <button className="btn sm" onClick={() => step(0.1)} aria-label={tw.bigger}>
        A+
      </button>
    </div>
  );
}

function InviteSheet({ code, onClose }: { code: string; onClose: () => void }) {
  const link = `${window.location.origin}/join#${code}`;
  const [copied, setCopied] = useState(false);
  return (
    <Sheet label={t.inviteTitle} onClose={onClose}>
      <h2 className="t">{t.inviteTitle}</h2>
      <p className="s">{t.inviteBody}</p>
      <Qr text={link} px={200} />
      <div className="input code" style={{ display: 'grid', placeItems: 'center' }}>
        {code}
      </div>
      <div className="row2">
        <button
          className="btn"
          onClick={() =>
            void navigator.clipboard?.writeText(link).then(
              () => setCopied(true),
              () => {},
            )
          }
        >
          {copied ? t.copied : t.copyLink}
        </button>
        <button
          className="btn"
          disabled={!('share' in navigator)}
          onClick={() => void navigator.share?.({ url: link }).catch(() => {})}
        >
          {t.share}
        </button>
      </div>
      <p className="small">{t.codeWorks}</p>
      <button className="btn main" onClick={onClose}>
        {t.back}
      </button>
    </Sheet>
  );
}
