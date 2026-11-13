// The signed-in person's own captions (mockups batch 3, approved 2026-11-13). Home: how the captions
// will be read (Just me, the default, or Face to face, in two pictures), the language (face to face:
// the top half's and the bottom half's), Start. The captions: the words, and one dark bar
// (Start/Stop · language · Settings) under them, or face to face between the two halves; Invite is
// the first row of Settings. After Stop the page stays: the words to read again, the same button
// says Start.
import { useState } from 'react';
import { LOW_BALANCE } from '@translate/shared';
import {
  ControlBar,
  GearCb,
  HalfMark,
  IconGear,
  IconMic,
  IconRight,
  IconSwap,
  LangButton,
  StartStop,
  Strip,
} from './Bar';
import { Logo, Sheet } from './bits';
import { CaptionsView } from './CaptionsView';
import { LangPicker, LangSheet } from './LangPicker';
import { barName } from './langs';
import { MicAsk, MicBlocked } from './MicSheets';
import { markMicAsked, micAskedBefore, micPermission } from './mic/permission';
import { useMic } from './mic/useMic';
import { Qr } from './Qr';
import { SettingsSheet, SwitchRow, TextSizeRow } from './Settings';
import { useStored } from './store';
import { clock, stopText, t, tw } from './texts';
import { ui } from './ui';
import { canStayAwake } from './useAwake';
import { ask, useSession } from './useSession';

type SheetName =
  null | 'gear' | 'invite' | 'lang' | 'langs' | 'top' | 'bottom' | 'allow' | 'blocked';

/** While nothing has been said: a microphone whose rings say "it hears you", in no language. */
const Hears = () => (
  <span className="hears" aria-hidden="true">
    <span className="ring">
      <IconMic size={34} />
    </span>
  </span>
);

export function HostPage() {
  const { view, update, error } = useSession();
  const mic = useMic({ voice: true });
  const [mode, setMode] = useStored<'me' | 'face'>('tr-mode', 'me');
  const [lang, setLang] = useStored<string | null>('tr-lang', null);
  const [top, setTop] = useStored<string | null>('tr-top', null);
  const [bottom, setBottom] = useStored<string | null>('tr-bottom', ui);
  const [showHeard, setShowHeard] = useStored('tr-heard', false);
  const [scale, setScale] = useStored('tr-scale', 1);
  const [sheet, setSheet] = useState<SheetName>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [lowSeen, setLowSeen] = useState(false);
  // (this visit started captions: after Stop it stays on them, the same button then says Start)
  const [here, setHere] = useState(false);
  // (the microphone is opening, perhaps asking: "the microphone is off" would be wrong meanwhile)
  const [opening, setOpening] = useState(false);
  // (what the blocked sheet carries on with once the microphone is allowed)
  const [retry, setRetry] = useState<'start' | 'resume'>('start');

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

  const face = mode === 'face';
  const langs = (f = face, tp = top, bt = bottom, l = lang) =>
    f ? { lang: bt, other: tp } : { lang: l };
  /** The page's languages changed: while captions run, the server reads the new ones at once. */
  const send = async (next: { lang: string | null; other?: string | null }) => {
    if (!view.running) return;
    const err = await ask('session:lang', next);
    if (err) setProblem(err);
  };
  const blockedSheet = (from: 'start' | 'resume') => {
    setRetry(from);
    setSheet('blocked');
  };
  const start = async () => {
    // (the microphone asked for with a picture the first time, before the browser asks)
    const p = await micPermission();
    if (p === 'denied') return blockedSheet('start');
    if (p !== 'granted' && !micAskedBefore()) return setSheet('allow');
    await go();
  };
  const go = async () => {
    setSheet(null);
    setProblem(null);
    const err = await ask('session:start', langs());
    if (err) return setProblem(err);
    const wasHere = here;
    setHere(true);
    setOpening(true);
    markMicAsked();
    const r = await mic.startSending();
    setOpening(false);
    if (r === 'failed') {
      await ask('session:stop');
      if (!mic.wasBlocked()) return setProblem('mic');
      setHere(wasHere);
      blockedSheet('start');
    }
  };
  const stop = async () => {
    mic.stopSending();
    await ask('session:stop');
  };
  const resumeMic = async () => {
    setProblem(null);
    setOpening(true);
    const r = await mic.startSending();
    setOpening(false);
    if (r === 'failed') {
      if (mic.wasBlocked()) blockedSheet('resume');
      else setProblem('mic');
    }
  };
  const pick = (which: 'lang' | 'top' | 'bottom') => (l: string | null) => {
    setSheet(face && which !== 'lang' && (view.running || here) ? 'langs' : null);
    if (which === 'lang') {
      setLang(l);
      void send(langs(false, top, bottom, l));
    } else if (which === 'top') {
      setTop(l);
      void send(langs(true, l, bottom));
    } else {
      setBottom(l);
      void send(langs(true, top, l));
    }
  };
  const setFace = (on: boolean) => {
    setMode(on ? 'face' : 'me');
    if (on && !top) return setSheet('top');
    void send(langs(on));
  };
  const settings = (
    <SettingsSheet
      onClose={() => setSheet(null)}
      half={view.running}
      invite={view.code && (view.running || here) ? () => setSheet('invite') : undefined}
      account={{ name: view.hostName, balance: view.balance }}
      captions={
        <>
          <TextSizeRow scale={scale} setScale={setScale} />
          {(view.running || here) && (
            <SwitchRow label={t.faceToFace} on={face} onChange={setFace} />
          )}
          {(view.running || here) && !face && lang && (
            <SwitchRow label={t.showHeard} on={showHeard} onChange={setShowHeard} />
          )}
        </>
      }
    />
  );
  const sheets = (
    <>
      {sheet === 'gear' && settings}
      {sheet === 'invite' && view.code && (
        <InviteSheet code={view.code} onClose={() => setSheet(null)} />
      )}
      {sheet === 'langs' && (
        <LanguagesSheet
          top={top}
          bottom={bottom}
          onTop={() => setSheet('top')}
          onBottom={() => setSheet('bottom')}
          onSwap={() => {
            setTop(bottom);
            setBottom(top);
            void send(langs(true, bottom, top));
          }}
          onClose={() => setSheet(null)}
        />
      )}
      {(sheet === 'lang' || sheet === 'top' || sheet === 'bottom') && (
        <LangSheet
          title={
            sheet === 'top' ? t.topHalf : sheet === 'bottom' ? t.bottomHalf : t.translateIntoSet
          }
          value={sheet === 'top' ? top : sheet === 'bottom' ? bottom : lang}
          onPick={pick(sheet)}
          onClose={() => setSheet(face && (view.running || here) ? 'langs' : null)}
        />
      )}
      {sheet === 'allow' && <MicAsk onAllow={() => void go()} onClose={() => setSheet(null)} />}
      {sheet === 'blocked' && (
        <MicBlocked
          onAllowed={() => {
            setSheet(null);
            void (retry === 'resume' ? resumeMic() : go());
          }}
          onClose={() => setSheet(null)}
        />
      )}
    </>
  );

  // ---------- Home ----------
  if (!view.running && !here) {
    const stopped = view.stopped && view.stopped !== 'ended' ? stopText(view.stopped) : null;
    return (
      <div className="page" style={{ ['--cap-scale' as string]: scale }}>
        <div className="bar">
          <Logo />
          <span className="spacer" />
          <button className="ibtn" onClick={() => setSheet('gear')} aria-label={t.settings}>
            <IconGear />
          </button>
        </div>
        <div className="body">
          <h1 className="t">{t.startTitle}</h1>
          <div className="modes" role="radiogroup" aria-label={t.startTitle}>
            <button
              className={`mode${face ? '' : ' on'}`}
              role="radio"
              aria-checked={!face}
              onClick={() => setMode('me')}
            >
              <JustMePicture />
              {t.justMe}
            </button>
            <button
              className={`mode${face ? ' on' : ''}`}
              role="radio"
              aria-checked={face}
              onClick={() => setMode('face')}
            >
              <FaceToFacePicture />
              {t.faceToFace}
            </button>
          </div>
          {face ? (
            <>
              <div>
                <span className="lbl">{t.topHalf}</span>
                <LangPicker value={top} onChange={setTop} mark="top" title={t.topHalf} />
              </div>
              <div>
                <span className="lbl">{t.bottomHalf}</span>
                <LangPicker
                  value={bottom}
                  onChange={setBottom}
                  mark="bottom"
                  title={t.bottomHalf}
                />
              </div>
            </>
          ) : (
            <div>
              <span className="lbl">{t.translateIntoSet}</span>
              <LangPicker value={lang} onChange={setLang} />
            </div>
          )}
          {(problem || stopped) && (
            <HomeNote problem={problem} stopped={stopped} mic={mic.problem} />
          )}
          {view.balance !== undefined && view.balance < LOW_BALANCE && view.balance > 0 && (
            <div className="note warn">
              <b>{t.lowLeft(view.balance)}</b>
              <a className="link" href="/account#ask">
                {t.askForMore}
              </a>
            </div>
          )}
          <button className="btn main big" onClick={() => void start()}>
            {t.start}
          </button>
          <span className="push" />
          <a className="btn" href="/join">
            {t.joinCaptions}
          </a>
        </div>
        {sheets}
      </div>
    );
  }

  // ---------- the captions ----------
  const low = (view.balance ?? Infinity) < LOW_BALANCE && !lowSeen;
  const stopped = !view.running && view.stopped && view.stopped !== 'ended' ? view.stopped : null;
  const stopLine = stopped ? stopText(stopped) : null;
  const problemText =
    problem === 'mic'
      ? `${t.micProblem} ${mic.problem ?? ''}`
      : problem === 'too-many-langs'
        ? t.tooManyLangs
        : problem === 'service-full'
          ? t.serviceFull
          : problem === 'offline'
            ? t.offline
            : problem && stopText(problem as never)
              ? stopText(problem as never)![0]
              : problem
                ? tw.failed
                : null;
  const strips = (
    <>
      {problemText && (
        <Strip tone="amber" onClose={() => setProblem(null)}>
          {problemText}
        </Strip>
      )}
      {stopLine && (
        <Strip
          tone={stopped === 'quiet' || stopped === 'hours' ? undefined : 'amber'}
          action={
            stopped === 'credits'
              ? { label: t.askForMore, onClick: () => window.location.assign('/account#ask') }
              : undefined
          }
        >
          <b>{stopLine[0]}.</b> {stopLine[1]}
        </Strip>
      )}
      {view.running && !mic.sending && !opening && (
        <Strip
          tone="amber"
          icon={<IconMic />}
          action={{ label: t.turnItOn, onClick: () => void resumeMic() }}
        >
          <b>{t.micIsOff}</b>
        </Strip>
      )}
      {view.running && mic.sending && !canStayAwake && <Strip>{t.keepScreenOnLine}</Strip>}
      {view.running && view.service === 'error' && <Strip tone="amber">{t.serviceTrying}</Strip>}
      {view.running && low && (
        <Strip
          tone="amber"
          action={{
            label: t.askForMore,
            onClick: () => window.open('/account#ask', '_blank', 'noopener'),
          }}
          onClose={() => setLowSeen(true)}
        >
          <b>{t.lowLeft(Math.max(0, view.balance ?? 0))}</b>
        </Strip>
      )}
    </>
  );
  // (a question for the host takes the buttons' place: the bar never grows, the halves never jump)
  const bar = (
    <ControlBar hinge={face} strips={strips}>
      {view.stopsAt ? (
        <div className="cbar-msg">
          <span>
            <b>{t.stillListening(clock(view.stopsAt))}</b>
          </span>
          <button className="cb start" onClick={() => void ask('session:keepGoing')}>
            {t.keepGoing}
          </button>
        </div>
      ) : (
        <>
          <StartStop
            running={view.running}
            onStart={() => void start()}
            onStop={() => void stop()}
          />
          <LangButton
            lang={face ? bottom : lang}
            other={face ? top : undefined}
            onClick={() => setSheet(face ? 'langs' : 'lang')}
          />
          <GearCb onClick={() => setSheet('gear')} />
        </>
      )}
    </ControlBar>
  );
  return (
    <div className="cap-screen" style={{ ['--cap-scale' as string]: scale }}>
      <CaptionsView
        update={update}
        lang={face ? bottom : lang}
        other={face ? top : undefined}
        showHeard={showHeard}
        bar={bar}
        waiting={<Hears />}
      />
      {sheets}
    </div>
  );
}

function HomeNote({
  problem,
  stopped,
  mic,
}: {
  problem: string | null;
  stopped: readonly [string, string] | null;
  mic: string | null;
}) {
  if (problem === 'mic') {
    return (
      <div className="note bad">
        <b>{t.micProblem}</b>
        {mic}
      </div>
    );
  }
  if (problem === 'too-many-langs') return <div className="note bad">{t.tooManyLangs}</div>;
  if (problem === 'service-full') return <div className="note warn">{t.serviceFull}</div>;
  if (problem === 'offline') return <div className="note bad">{t.offline}</div>;
  const s = (problem && stopText(problem as never)) || stopped;
  return s ? (
    <div className="note bad">
      <b>{s[0]}</b>
      {s[1]}
      {problem === 'credits' && (
        <a className="link" href="/account#ask">
          {t.askForMore}
        </a>
      )}
    </div>
  ) : null;
}

/** Face to face's languages: each half on its own, and Swap (the phone turned, the people moved). */
function LanguagesSheet({
  top,
  bottom,
  onTop,
  onBottom,
  onSwap,
  onClose,
}: {
  top: string | null;
  bottom: string | null;
  onTop: () => void;
  onBottom: () => void;
  onSwap: () => void;
  onClose: () => void;
}) {
  return (
    <Sheet label={t.languages} onClose={onClose}>
      <h2 className="t">{t.languages}</h2>
      <div className="list">
        <button className="li link-row" onClick={onTop}>
          <HalfMark top />
          <span className="what">{t.topHalf}</span>
          <b>{top === null ? t.chooseLang : barName(top)}</b>
          <IconRight />
        </button>
        <button className="li link-row" onClick={onBottom}>
          <HalfMark top={false} />
          <span className="what">{t.bottomHalf}</span>
          <b>{barName(bottom)}</b>
          <IconRight />
        </button>
      </div>
      <button className="btn" onClick={onSwap}>
        <IconSwap />
        {t.swapHalves}
      </button>
    </Sheet>
  );
}

/** Home's pictures: one person with a phone, and the same phone between two people. */
function JustMePicture() {
  return (
    <svg className="mode-pic" viewBox="0 0 120 86" aria-hidden="true">
      <circle cx="60" cy="13" r="9" fill="currentColor" />
      <rect
        x="49"
        y="31"
        width="22"
        height="36"
        rx="4.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
      />
      <line
        x1="56"
        y1="61"
        x2="64"
        y2="61"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
function FaceToFacePicture() {
  return (
    <svg className="mode-pic" viewBox="0 0 120 86" aria-hidden="true">
      <circle cx="60" cy="11" r="9" fill="currentColor" />
      <rect
        x="49"
        y="25"
        width="22"
        height="36"
        rx="4.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
      />
      <line
        x1="56"
        y1="55"
        x2="64"
        y2="55"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <circle cx="60" cy="75" r="9" fill="currentColor" />
    </svg>
  );
}

function InviteSheet({ code, onClose }: { code: string; onClose: () => void }) {
  const link = `${window.location.origin}/join#${code}`;
  const [copied, setCopied] = useState(false);
  return (
    <Sheet label={t.inviteTitle} onClose={onClose}>
      <h2 className="t">{t.inviteTitle}</h2>
      <Qr text={link} px={220} />
      <div className="invite-code">{code}</div>
      <div className="row2">
        <button
          className="btn"
          disabled={!('share' in navigator)}
          onClick={() => void navigator.share?.({ url: link }).catch(() => {})}
        >
          {t.share}
        </button>
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
      </div>
      <p className="small">{t.codeWorks}</p>
    </Sheet>
  );
}
