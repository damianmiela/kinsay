// /account: credits left (euros only), where they went, asking for more, devices, signing out.
import { useEffect, useState } from 'react';
import { euros, GRANT_STEPS, LOW_BALANCE, type AccountView } from '@translate/shared';
import { api } from './api';
import { Foot, Logo } from './bits';
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
        {/* the balance first, asking for more right under it (a request: Damian adds it) */}
        <div className="card" id="ask" style={{ display: 'grid', gap: 14 }}>
          <div className="acct-top">
            <span className="what">{me.name}</span>
            <b
              className={`acct-bal${me.balance < LOW_BALANCE ? ' low' : ''}`}
              aria-label={`${t.creditsLeft}: ${euros(Math.max(0, me.balance))}`}
            >
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
                  disabled={waiting}
                  onClick={() => setAmount(a)}
                >
                  {euros(a).replace('.00', '')}
                </button>
              ))}
            </div>
          </div>
          {waiting || askState === 'already-asked' ? (
            <p className="small">{t.alreadyAsked}</p>
          ) : (
            <button className="btn main" onClick={() => void send()}>
              {t.sendRequest}
            </button>
          )}
        </div>

        <h2 className="t">{t.history}</h2>
        <div className="card" style={{ padding: '6px 16px' }}>
          <div className="list">
            {me.requests.map((r) => (
              <div className="li" key={`r${r.id}`}>
                <span className="what">
                  {t.yourRequest(euros(r.amount).replace('.00', ''))}
                  <small>
                    {t[`req_${r.state}`]} · {day(r.at)}
                  </small>
                </span>
              </div>
            ))}
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
                <span className="what cap-first">
                  {t.deviceName[/Android|iPhone/.test(d.label) ? 'phone' : 'computer']}
                  <small>
                    {d.current ? `${t.thisOne} · ` : ''}
                    {d.label} · {day(d.lastSeen)}
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
        <Foot />
      </div>
    </div>
  );
}
