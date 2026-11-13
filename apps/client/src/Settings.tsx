// Settings (mockups batch 3): one sheet behind the gear, in fixed groups (Invite first for a host,
// then Captions, Account, App); each page passes only what means something there. While captions
// run it opens at half height so they stay in sight, and nothing in it leaves the page (a page that
// leaves would stop the microphone): Account, Privacy and the Windows app open in a new tab then.
import type { ReactNode } from 'react';
import { euros, LOW_BALANCE } from '@translate/shared';
import { IconClose, IconQr, IconRight } from './Bar';
import { Sheet, Toggle, UiLangSelect } from './bits';
import { download, t, tw } from './texts';

const isWindows = typeof navigator !== 'undefined' && /Windows/.test(navigator.userAgent);

export function SettingsSheet({
  onClose,
  half,
  invite,
  captions,
  account,
  leave,
}: {
  onClose: () => void;
  /** While captions run: half height, links in a new tab. */
  half: boolean;
  /** A host with a session code: the first row. */
  invite?: () => void;
  /** The Captions group's rows. */
  captions: ReactNode;
  /** A signed-in person: their name and balance. */
  account?: { name: string; balance?: number };
  /** A reader: leave these captions (the last row). */
  leave?: { label: string; onClick: () => void };
}) {
  const target = half ? '_blank' : undefined;
  return (
    <Sheet label={t.settings} onClose={onClose} half={half}>
      <div className="sheet-head">
        <h2 className="t">{t.settings}</h2>
        <button className="ibtn" onClick={onClose} aria-label={t.close}>
          <IconClose />
        </button>
      </div>
      {invite && (
        <div className="list">
          <button className="li link-row" onClick={invite}>
            <IconQr />
            <span className="what">{t.inviteTitle}</span>
            <IconRight />
          </button>
        </div>
      )}
      <Group title={t.groupCaptions}>{captions}</Group>
      {account && (
        <Group title={t.groupAccount}>
          <a className="li link-row" href="/account" target={target}>
            <span className="what">{account.name}</span>
            {account.balance !== undefined && (
              <b className={`balance${account.balance < LOW_BALANCE ? ' low' : ''}`}>
                {euros(Math.max(0, account.balance))}
              </b>
            )}
            <IconRight />
          </a>
        </Group>
      )}
      <Group title={t.groupApp}>
        <label className="li">
          <span className="what">{t.pageLang}</span>
          <UiLangSelect />
        </label>
        {isWindows && (
          <a className="li link-row" href="/download" target={target}>
            <span className="what">{download.foot}</span>
            <IconRight />
          </a>
        )}
        <a className="li link-row" href="/privacy" target={target}>
          <span className="what">{t.privacy}</span>
          <IconRight />
        </a>
      </Group>
      {leave && (
        <div className="list">
          <button className="li link-row" onClick={leave.onClick}>
            <span className="what">{leave.label}</span>
          </button>
        </div>
      )}
    </Sheet>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grp">
      <h3 className="grp-h">{title}</h3>
      <div className="list">{children}</div>
    </section>
  );
}

/** A setting that is on or off. */
export function SwitchRow({
  label,
  on,
  onChange,
}: {
  label: string;
  on: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <div className="li">
      <span className="what">{label}</span>
      <Toggle on={on} onChange={onChange} label={label} />
    </div>
  );
}

/** The captions' text size, changed live (the captions stay in sight above a half sheet). */
export function TextSizeRow({ scale, setScale }: { scale: number; setScale: (v: number) => void }) {
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
