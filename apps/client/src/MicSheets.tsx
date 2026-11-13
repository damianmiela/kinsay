// The microphone asked for before the browser asks (mockups batch 3): the first Start ever shows
// one picture and one button, so the browser's own question is no surprise (and "Block" no
// accident). Blocked: this browser's steps to allow it, and it goes on by itself once allowed.
import { useEffect, useRef } from 'react';
import { IconClose, IconMic } from './Bar';
import { Sheet } from './bits';
import { micHelp } from './mic/logic';
import { micPermission } from './mic/permission';
import { t } from './texts';

export function MicAsk({ onAllow, onClose }: { onAllow: () => void; onClose: () => void }) {
  return (
    <Sheet label={t.micNeeded} onClose={onClose}>
      <div className="permit">
        <span className="permit-pic">
          <IconMic size={44} />
        </span>
        <h2 className="t">{t.micNeeded}</h2>
        <button className="btn main big" onClick={onAllow}>
          {t.allowMic}
        </button>
      </div>
    </Sheet>
  );
}

/** "*Microphone*" in a step: what the browser itself shows, as a key. */
const step = (s: string) =>
  s.split('*').map((part, i) =>
    i % 2 ? (
      <span key={i} className="k">
        {part}
      </span>
    ) : (
      part
    ),
  );

export function MicBlocked({ onAllowed, onClose }: { onAllowed: () => void; onClose: () => void }) {
  const done = useRef(false);
  const allowed = useRef(onAllowed);
  useEffect(() => {
    allowed.current = onAllowed;
  });
  // (the browser says when it changes; every 2 s too, as Safari may not)
  useEffect(() => {
    let status: PermissionStatus | null = null;
    const check = (s: PermissionState) => {
      if (s !== 'granted' || done.current) return;
      done.current = true;
      allowed.current();
    };
    navigator.permissions?.query({ name: 'microphone' }).then(
      (s) => {
        status = s;
        s.onchange = () => check(s.state);
      },
      () => {},
    );
    const timer = setInterval(() => {
      void micPermission().then((s) => s && check(s));
    }, 2000);
    return () => {
      clearInterval(timer);
      if (status) status.onchange = null;
    };
  }, []);
  const steps = t.micSteps[micHelp(navigator.userAgent, navigator.maxTouchPoints > 1)];
  return (
    <Sheet label={t.micBlocked} onClose={onClose}>
      <div className="sheet-head">
        <span />
        <button className="ibtn" onClick={onClose} aria-label={t.close}>
          <IconClose />
        </button>
      </div>
      <div className="permit">
        <span className="permit-pic warn">
          <IconMic size={44} />
        </span>
        <h2 className="t">{t.micBlocked}</h2>
        <ol className="steps">
          {steps.map((s) => (
            <li key={s}>{step(s)}</li>
          ))}
        </ol>
        <p className="small">{t.micGoesOn}</p>
        <button className="btn" onClick={onAllowed}>
          {t.tryAgain}
        </button>
      </div>
    </Sheet>
  );
}
