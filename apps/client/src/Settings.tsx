// Settings (mockups batch 3): one sheet behind the gear, in fixed groups (Invite first for a host,
// then Captions, Microphone when another device listens, Account, App); each page passes only what
// means something there. While captions run it opens at half height so they stay in sight, and
// nothing in it leaves the page (a page that leaves would stop the microphone): Account opens as a
// sheet of its own, Privacy and the Windows app in a new tab.
import { useEffect, useState, type ReactNode } from 'react';
import { euros, GRANT_STEPS, LOW_BALANCE, type AccountView } from '@translate/shared';
import { api } from './api';
import { IconClose, IconQr, IconRight } from './Bar';
import { Sheet, Toggle } from './bits';
import { download, t, tw } from './texts';
import { setUi, ui, UI_LANGS, UI_NAMES } from './ui';

const isWindows = typeof navigator !== 'undefined' && /Windows/.test(navigator.userAgent);

const IconBack = () => (
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
    <path d="m15 6-6 6 6 6" />
  </svg>
);

/** A sheet's title with ✕, or ‹ back for a page inside it. */
function Head({
  title,
  onClose,
  onBack,
}: {
  title: string;
  onClose: () => void;
  onBack?: () => void;
}) {
  return (
    <div className={`sheet-head${onBack ? ' start' : ''}`}>
      {onBack && (
        <button className="ibtn" onClick={onBack} aria-label={t.backHome}>
          <IconBack />
        </button>
      )}
      <h2 className="t">{title}</h2>
      {!onBack && (
        <button className="ibtn" onClick={onClose} aria-label={t.close}>
          <IconClose />
        </button>
      )}
    </div>
  );
}

export function SettingsSheet({
  onClose,
  half,
  invite,
  captions,
  microphone,
  account,
  leave,
  appLang = true,
}: {
  /** False while this device listens: a new App language reloads the page (audit 33). */
  appLang?: boolean;
  onClose: () => void;
  /** While captions run: half height, Account as a sheet, links in a new tab. */
  half: boolean;
  /** A host with a session code: the first row. */
  invite?: () => void;
  /** The Captions group's rows. */
  captions: ReactNode;
  /** The Microphone group's rows (another device listens: use this one). */
  microphone?: ReactNode;
  /** A signed-in person: their name and balance. */
  account?: { name: string; balance?: number };
  /** A reader: leave these captions (the last row). */
  leave?: { label: string; onClick: () => void };
}) {
  const [page, setPage] = useState<'main' | 'account' | 'lang'>('main');
  const target = half ? '_blank' : undefined;
  if (page === 'account') {
    return (
      <Sheet label={t.groupAccount} onClose={onClose} half={half}>
        <Head title={t.groupAccount} onClose={onClose} onBack={() => setPage('main')} />
        <AccountPart />
      </Sheet>
    );
  }
  if (page === 'lang') {
    return (
      <Sheet label={t.pageLang} onClose={onClose} half={half}>
        <Head title={t.pageLang} onClose={onClose} onBack={() => setPage('main')} />
        <div className="list" role="listbox" aria-label={t.pageLang}>
          {UI_LANGS.map((l) => (
            <button
              key={l}
              className="li link-row lang-row"
              role="option"
              aria-selected={l === ui}
              onClick={() => (l === ui ? setPage('main') : setUi(l))}
            >
              <span className="what">{UI_NAMES[l]}</span>
              {l === ui && <span className="tick">✓</span>}
            </button>
          ))}
        </div>
      </Sheet>
    );
  }
  return (
    <Sheet label={t.settings} onClose={onClose} half={half}>
      <Head title={t.settings} onClose={onClose} />
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
      {microphone && <Group title={t.groupMic}>{microphone}</Group>}
      {account && (
        <Group title={t.groupAccount}>
          {half ? (
            <button className="li link-row" onClick={() => setPage('account')}>
              <AccountRow {...account} />
            </button>
          ) : (
            <a className="li link-row" href="/account">
              <AccountRow {...account} />
            </a>
          )}
        </Group>
      )}
      <Group title={t.groupApp}>
        {appLang && (
          <button className="li link-row" onClick={() => setPage('lang')}>
            <span className="what">{t.pageLang}</span>
            <span className="val">{UI_NAMES[ui]}</span>
            <IconRight />
          </button>
        )}
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

/** Account on its own (Ask for more in the bar while captions run): never leaves the page. */
export function AccountSheet({ onClose }: { onClose: () => void }) {
  return (
    <Sheet label={t.groupAccount} onClose={onClose} half>
      <Head title={t.groupAccount} onClose={onClose} />
      <AccountPart />
    </Sheet>
  );
}

function AccountRow({ name, balance }: { name: string; balance?: number }) {
  return (
    <>
      <span className="what">{name}</span>
      {balance !== undefined && (
        <b className={`balance${balance < LOW_BALANCE ? ' low' : ''}`}>
          {euros(Math.max(0, balance))}
        </b>
      )}
      <IconRight />
    </>
  );
}

/** Account over running captions: the balance and asking for more; the rest on its page. */
function AccountPart() {
  const [me, setMe] = useState<AccountView | null>(null);
  const [amount, setAmount] = useState(GRANT_STEPS[1]!);
  const [tick, setTick] = useState(0);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    void api<AccountView>('/api/me').then((r) => {
      if (r.ok) setMe(r);
    });
  }, [tick]);
  if (!me) return null;
  const waiting = me.requests.some((r) => r.state === 'waiting');
  const send = async () => {
    setBusy(true);
    const r = await api('/api/ask', { amount });
    setBusy(false);
    setFailed(r.ok ? null : r.error === 'offline' ? t.offline : tw.failed);
    setTick((n) => n + 1);
  };
  return (
    <>
      <div className="acct-top">
        <span className="what">{me.name}</span>
        <b className={`acct-bal${me.balance < LOW_BALANCE ? ' low' : ''}`}>
          {euros(Math.max(0, me.balance))}
        </b>
      </div>
      <div>
        <span className="lbl">{t.askTitle}</span>
        <div className="pills">
          {GRANT_STEPS.map((a) => (
            <button
              key={a}
              className={`pill${a === amount ? ' on' : ''}`}
              onClick={() => setAmount(a)}
              disabled={waiting}
            >
              {euros(a).replace('.00', '')}
            </button>
          ))}
        </div>
      </div>
      {waiting ? (
        <p className="small">{t.alreadyAsked}</p>
      ) : (
        <button className="btn main" disabled={busy} onClick={() => void send()}>
          {t.sendRequest}
        </button>
      )}
      {failed && <div className="note bad">{failed}</div>}
      <a className="link acct-more" href="/account" target="_blank" rel="noopener">
        {t.historyDevices}
      </a>
    </>
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
