// Small pieces every page uses.
import { useEffect, type ReactNode } from 'react';
import { euros, LOW_BALANCE } from '@translate/shared';
import { download, t } from './texts';
import { setUi, ui, UI_LANGS, UI_NAMES, type UiLang } from './ui';

export function Logo() {
  return (
    <span className="logo">
      <span className="mark" aria-hidden="true" />
      {t.app}
    </span>
  );
}

export function Balance({ micro }: { micro: number }) {
  return (
    <a
      className={`chip${micro < LOW_BALANCE ? ' low' : ''}`}
      href="/account"
      aria-label={t.account}
    >
      {euros(Math.max(0, micro))}
    </a>
  );
}

export function GearButton({ onClick }: { onClick: () => void }) {
  return (
    <button className="btn icon" onClick={onClick} aria-label={t.settings}>
      <svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
      </svg>
    </button>
  );
}

/** A sheet from the bottom; a tap outside or Escape closes it. */
export function Sheet({
  onClose,
  children,
  label,
  half = false,
}: {
  onClose: () => void;
  children: ReactNode;
  label: string;
  /** Over running captions: half height, no dimming, so they stay in sight. */
  half?: boolean;
}) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);
  return (
    <div
      className={`sheet-back${half ? ' half' : ''}`}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="sheet" role="dialog" aria-modal="true" aria-label={label}>
        {children}
      </div>
    </div>
  );
}

export function Toggle({
  on,
  onChange,
  label,
}: {
  on: boolean;
  onChange: (on: boolean) => void;
  label: string;
}) {
  return (
    <button
      className="toggle"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
    />
  );
}

/** The language of the pages (not the captions'): a choice of the five, each in its own name. */
export function UiLangSelect() {
  return (
    <select
      className="ui-lang"
      value={ui}
      aria-label={t.pageLang}
      onChange={(e) => setUi(e.target.value as UiLang)}
    >
      {UI_LANGS.map((l) => (
        <option key={l} value={l}>
          {UI_NAMES[l]}
        </option>
      ))}
    </select>
  );
}

/** The gear's row for it. */
export function UiLangRow() {
  return (
    <label className="li">
      <span className="what">{t.pageLang}</span>
      <UiLangSelect />
    </label>
  );
}

/** A page's foot: the privacy page and the language switch. */
export function Foot() {
  return (
    <div className="foot">
      <a className="link" href="/privacy">
        {t.privacy}
      </a>
      <a className="link" href="/download">
        {download.foot}
      </a>
      <UiLangSelect />
    </div>
  );
}
