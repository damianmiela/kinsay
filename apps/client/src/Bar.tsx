// The control bar (mockups batch 3, approved 2026-11-13): one dark strip with the same contents on
// every device. The host's: Start/Stop · language · Settings, a quarter, a half and a quarter of the
// width, one height (Damian); at the bottom of the captions, or in face to face as the hinge between
// the two halves. Lines above the buttons (`Strip`) say what is in the way; a message that needs an
// answer takes the buttons' place, so the bar never grows and the halves never jump.
import type { ReactNode } from 'react';
import { barName } from './langs';
import { t } from './texts';

const icon = (d: ReactNode, size = 22) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {d}
  </svg>
);
export const IconGear = () =>
  icon(
    <>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </>,
    24,
  );
export const IconDown = () => icon(<path d="m6 9 6 6 6-6" />, 20);
export const IconRight = () => icon(<path d="m9 6 6 6-6 6" />, 20);
export const IconClose = () => icon(<path d="M6 6l12 12M18 6 6 18" />);
export const IconMic = ({ size = 20 }: { size?: number }) =>
  icon(
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </>,
    size,
  );
export const IconQr = () =>
  icon(
    <>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <path d="M14 14h3v3h-3zM17 17h4v4h-4z" />
    </>,
  );
export const IconSwap = () => icon(<path d="M7 4v16M3 8l4-4 4 4M17 20V4M21 16l-4 4-4-4" />);
const IconStop = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
    <rect x="6.5" y="6.5" width="11" height="11" rx="2" fill="currentColor" />
  </svg>
);
const IconPlay = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M8 5.5v13l10.5-6.5z" fill="currentColor" />
  </svg>
);

/** A little phone with its top or bottom half marked: which half a language is for. */
export function HalfMark({ top }: { top: boolean }) {
  return (
    <svg className="halfmark" width="18" height="28" viewBox="0 0 18 28" aria-hidden="true">
      <rect x="2.5" y={top ? 2.5 : 14} width="13" height="11.5" rx="2" className="halfmark-fill" />
      <rect x="1.5" y="1.5" width="15" height="25" rx="3.5" fill="none" className="halfmark-edge" />
    </svg>
  );
}

export function ControlBar({
  hinge = false,
  strips,
  children,
}: {
  /** Face to face: the bar between the two halves. */
  hinge?: boolean;
  /** Lines above the buttons (what is in the way). */
  strips?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={`cbar${hinge ? ' hinge' : ''}`}>
      {strips}
      <div className="cbar-row">{children}</div>
    </div>
  );
}

export function StartStop({
  running,
  onStart,
  onStop,
}: {
  running: boolean;
  onStart: () => void;
  onStop: () => void;
}) {
  return running ? (
    <button className="cb stop" onClick={onStop}>
      <IconStop />
      {t.stop}
    </button>
  ) : (
    <button className="cb start" onClick={onStart}>
      <IconPlay />
      {t.start}
    </button>
  );
}

/** The language button: one language, or face to face both (the top half's above, as on screen). */
export function LangButton({
  lang,
  other,
  onClick,
}: {
  lang: string | null;
  other?: string | null;
  onClick: () => void;
}) {
  return (
    <button
      className="cb lang"
      onClick={onClick}
      aria-label={other !== undefined ? t.languages : t.translateIntoSet}
    >
      {other !== undefined ? (
        <span className="two">
          <b className="tl">{barName(other)}</b>
          <b>{barName(lang)}</b>
        </span>
      ) : (
        <span className="one">{barName(lang)}</span>
      )}
      <IconDown />
    </button>
  );
}

export function GearCb({ onClick }: { onClick: () => void }) {
  return (
    <button className="cb gear" onClick={onClick} aria-label={t.settings}>
      <IconGear />
    </button>
  );
}

/** A line above the buttons; `tone` amber for what is in the way, `action` its one button. */
export function Strip({
  children,
  tone,
  icon: lead,
  action,
  onClose,
}: {
  children: ReactNode;
  tone?: 'amber';
  icon?: ReactNode;
  action?: { label: string; onClick: () => void };
  onClose?: () => void;
}) {
  return (
    <div className={`strip${tone ? ` ${tone}` : ''}`}>
      {lead}
      <span className="strip-text">{children}</span>
      {action && (
        <button className="mini" onClick={action.onClick}>
          {action.label}
        </button>
      )}
      {onClose && (
        <button className="mini x" onClick={onClose} aria-label={t.back}>
          <IconClose />
        </button>
      )}
    </div>
  );
}
