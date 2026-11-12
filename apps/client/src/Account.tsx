// /account: credits left (euros only), where they went, asking for more, devices, signing out.
import { useEffect, useState } from 'react';
import { euros, GRANT_STEPS, type AccountView } from '@translate/shared';
import { api } from './api';
import { Logo } from './bits';
import { langName } from './langs';
import { duration, t } from './texts';

const day = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

export function AccountPage() {
  const [me, setMe] = useState<AccountView | null>(null);
  const [out, setOut] = useState(false);
  const [amount, setAmount] = useState(GRANT_STEPS[1]!);
  const [askState, setAskState] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const load = () => setTick((n) => n + 1);
  useEffect(() => {
    void api<AccountView>('/api/me').then((r) => {
      if (r.ok) setMe(r);
      else if (r.error === 'signed-out') setOut(true);
    });
  }, [tick]);
  if (out) {
    window.location.replace('/');
    return null;
  }
  if (!me) return <div className="page" />;
  const waiting = me.requests.some((r) => r.state === 'waiting');
  const send = async () => {
    const r = await api('/api/ask', { amount });
    setAskState(r.ok ? 'sent' : r.error);
    load();
  };
  const signOut = async (body: object) => {
    await api('/api/devices/signout', body);
    load();
  };
  const what = (h: AccountView['history'][number]) =>
    h.kind === 'use'
      ? t.captionsIn(
          (h.lang ?? '')
            .split(', ')
            .map((c) => (c === 'heard' ? t.noTranslation : langName(c).own))
            .join(', '),
        )
      : h.kind === 'welcome'
        ? t.welcome
        : h.kind === 'grant'
          ? t.fromAdmin
          : t.correction;
  return (
    <div className="page">
      <div className="bar">
        <a className="link" href="/" style={{ textDecoration: 'none' }}>
          ← {t.back}
        </a>
        <span className="spacer" />
        <Logo />
      </div>
      <div className="body">
        <div className="card">
          <span className="small">{t.creditsLeft}</span>
          <div className="big" style={{ margin: '6px 0' }}>
            {euros(Math.max(0, me.balance))}
          </div>
        </div>

        <div className="card" id="ask">
          <h2 className="t" style={{ marginTop: 0 }}>
            {t.askTitle}
          </h2>
          <span className="lbl">{t.howMuch}</span>
          <div className="pills" style={{ marginBottom: 12 }}>
            {GRANT_STEPS.map((a) => (
              <button
                key={a}
                className={`pill${a === amount ? ' on' : ''}`}
                onClick={() => setAmount(a)}
              >
                {euros(a).replace('.00', '')}
              </button>
            ))}
          </div>
          <button
            className="btn main"
            style={{ width: '100%' }}
            disabled={waiting}
            onClick={() => void send()}
          >
            {t.send}
          </button>
          {(waiting || askState === 'already-asked') && <p className="small">{t.alreadyAsked}</p>}
          {me.requests.length > 0 && (
            <div className="list" style={{ marginTop: 10 }}>
              {me.requests.map((r) => (
                <div className="li" key={r.id}>
                  <span className="what">
                    {euros(r.amount).replace('.00', '')} · {day(r.at)}
                  </span>
                  <span className={`tag ${r.state}`}>{t[`req_${r.state}`]}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card" style={{ padding: '6px 16px' }}>
          <div className="list">
            {me.history.map((h, i) => (
              <div className="li" key={i}>
                <span className="what">
                  {what(h)}
                  <small>
                    {day(h.at)}
                    {h.seconds ? ` · ${duration(h.seconds)}` : ''}
                    {h.note ? ` · ${h.note}` : ''}
                  </small>
                </span>
                <span className={`amt${h.amount > 0 ? ' plus' : ''}`}>
                  {h.amount > 0 ? '+' : '−'}
                  {euros(Math.abs(h.amount))}
                </span>
              </div>
            ))}
          </div>
        </div>

        <h2 className="t">{t.devices}</h2>
        <div className="card" style={{ padding: '6px 16px' }}>
          <div className="list">
            {me.devices.map((d) => (
              <div className="li" key={d.id}>
                <span className="what">
                  {d.current ? t.thisDevice : d.label}
                  <small>
                    {d.current ? `${d.label} · ` : ''}
                    {day(d.lastSeen)}
                  </small>
                </span>
                {!d.current && (
                  <button className="btn sm" onClick={() => void signOut({ id: d.id })}>
                    {t.signOut}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
        <button
          className="btn"
          onClick={() => void api('/api/signout', {}).then(() => window.location.replace('/'))}
        >
          {t.signOutHere}
        </button>
        <button
          className="btn"
          onClick={() => void signOut({ all: true }).then(() => window.location.replace('/'))}
        >
          {t.signOutAll}
        </button>
        <button
          className="link"
          style={{ color: 'var(--bad)', alignSelf: 'flex-start', marginTop: 20 }}
          onClick={() => {
            if (confirm(t.deleteSure))
              void api('/api/delete-account', {}).then(() => window.location.replace('/'));
          }}
        >
          {t.deleteAccount}
        </button>
        <a className="link small-link" href="/privacy">
          {t.privacy}
        </a>
      </div>
    </div>
  );
}
