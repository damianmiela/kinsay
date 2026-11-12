// Signing in: an email link, Google (each only where the server offers it), or a code from Damian's
// admin (6 digits, or its QR link: /signin#t=…). Anyone can ask for an invitation.
import { useEffect, useState } from 'react';
import { api } from './api';
import { Logo } from './bits';
import { t } from './texts';

export function SignInPage() {
  const [ways, setWays] = useState<{ email: boolean; google: boolean } | null>(null);
  const why = window.location.hash;
  const [asking, setAsking] = useState(why === '#not-invited');
  useEffect(() => {
    void api<{ email: boolean; google: boolean }>('/api/config').then((r) =>
      setWays(r.ok ? r : { email: false, google: false }),
    );
  }, []);
  return (
    <div className="page">
      <div className="bar">
        <Logo />
      </div>
      <div className="body">
        <h1 className="t">{t.signInTitle}</h1>
        {why === '#not-invited' && <div className="note warn">{t.googleNotInvited}</div>}
        {why === '#google-failed' && <div className="note bad">{t.googleFailed}</div>}
        {ways?.email && <EmailSignIn />}
        {ways?.email && ways.google && <div className="or">{t.or}</div>}
        {ways?.google && (
          <a className="btn" href="/api/google/start">
            <span className="g" aria-hidden="true" />
            {t.continueGoogle}
          </a>
        )}
        <a className={`btn${ways && !ways.email && !ways.google ? ' main' : ''}`} href="/signin">
          {t.haveCode}
        </a>
        <p className="s">
          {t.joinTitle}{' '}
          <a className="link" href="/join">
            {t.enterTheirCode}
          </a>
        </p>
        <div className="or" />
        {asking ? (
          <AskInvite />
        ) : (
          <button
            className="link"
            style={{ alignSelf: 'flex-start' }}
            onClick={() => setAsking(true)}
          >
            {t.askInvite}
          </button>
        )}
        <a className="link small-link" href="/privacy">
          {t.privacy}
        </a>
      </div>
    </div>
  );
}

function EmailSignIn() {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<string>('idle');
  if (state === 'sent') {
    return (
      <div className="card" style={{ display: 'grid', gap: 12 }}>
        <h2 className="t" style={{ margin: 0 }}>
          {t.checkEmail}
        </h2>
        <p className="s">{t.checkEmailBody(email)}</p>
        <button
          className="link"
          style={{ alignSelf: 'flex-start' }}
          onClick={() => setState('idle')}
        >
          {t.otherEmail}
        </button>
      </div>
    );
  }
  return (
    <form
      style={{ display: 'grid', gap: 12 }}
      onSubmit={(e) => {
        e.preventDefault();
        setState('busy');
        void api('/api/signin/email', { email }).then((r) => setState(r.ok ? 'sent' : r.error));
      }}
    >
      <label>
        <span className="lbl">{t.yourEmail}</span>
        <input
          className="input"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          maxLength={254}
        />
      </label>
      <button className="btn main" disabled={state === 'busy'}>
        {t.sendLink}
      </button>
      {state === 'too-many' && <div className="note bad">{t.tooMany}</div>}
      {state === 'offline' && <div className="note bad">{t.offline}</div>}
      {state === 'bad-email' && <div className="note bad">{t.badEmail}</div>}
    </form>
  );
}

function AskInvite() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  // 'idle', 'busy', 'done' or an error code
  const [state, setState] = useState<string>('idle');
  const send = async () => {
    setState('busy');
    const r = await api('/api/invite-request', { name, email });
    setState(r.ok ? 'done' : r.error);
  };
  if (state === 'done') {
    return (
      <div className="note good">
        <b>{t.asked}</b>
        {t.askedBody(email)}
      </div>
    );
  }
  return (
    <form
      className="card"
      style={{ display: 'grid', gap: 12 }}
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      <h2 className="t" style={{ margin: 0 }}>
        {t.askInviteTitle}
      </h2>
      <p className="s">{t.askInviteBody}</p>
      <label>
        <span className="lbl">{t.yourName}</span>
        <input
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          maxLength={80}
        />
      </label>
      <label>
        <span className="lbl">{t.yourEmail}</span>
        <input
          className="input"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          maxLength={254}
        />
      </label>
      {state === 'too-many' && <div className="note bad">{t.tooMany}</div>}
      {state === 'offline' && <div className="note bad">{t.offline}</div>}
      <button className="btn main" disabled={state === 'busy'}>
        {t.askInvite}
      </button>
    </form>
  );
}

const signIn = (body: { digits?: string; link?: string }) =>
  api<{ name: string }>('/api/signin/code', body);

/**
 * /signin: six big digits, or a link (the QR code's or an email's: its secret in the address's #
 * part, never in a server log). A link asks with one button: a mail scanner that opens links
 * signs nobody in.
 */
export function CodePage() {
  const link = /^#t=([\w-]{20,100})$/.exec(window.location.hash)?.[1];
  const [digits, setDigits] = useState('');
  // 'idle', 'busy', 'done' or an error code
  const [state, setState] = useState<string>('idle');
  const [name, setName] = useState('');
  const send = (body: { digits?: string; link?: string }) => {
    setState('busy');
    void signIn(body).then((r) => {
      if (r.ok) {
        setName(r.name);
        setState('done');
        history.replaceState(null, '', '/signin');
        setTimeout(() => window.location.assign('/'), 1500);
      } else setState(r.error);
    });
  };
  const notes = (
    <>
      {state === 'done' && (
        <div className="note good">
          <b>{t.signedInAs(name)}</b>
          {t.staysSignedIn}
        </div>
      )}
      {state === 'bad-code' && <div className="note bad">{link ? t.badLink : t.badCode}</div>}
      {state === 'too-many' && <div className="note bad">{t.tooMany}</div>}
      {state === 'offline' && <div className="note bad">{t.offline}</div>}
    </>
  );
  return (
    <div className="page">
      <div className="bar">
        <Logo />
      </div>
      {link ? (
        <div className="body">
          <h1 className="t">{t.linkTitle}</h1>
          <p className="s">{t.linkBody}</p>
          <button
            className="btn main"
            disabled={state === 'busy' || state === 'done'}
            onClick={() => send({ link })}
          >
            {t.signIn}
          </button>
          {notes}
          {state === 'bad-code' && (
            <a className="btn" href="/">
              {t.backHome}
            </a>
          )}
        </div>
      ) : (
        <form
          className="body"
          onSubmit={(e) => {
            e.preventDefault();
            send({ digits });
          }}
        >
          <h1 className="t">{t.codeTitle}</h1>
          <p className="s">{t.codeBody}</p>
          <input
            className="input code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={digits}
            aria-label={t.codeTitle}
            onChange={(e) => setDigits(e.target.value.replace(/\D/g, ''))}
          />
          <button className="btn main" disabled={digits.length !== 6 || state === 'busy'}>
            {t.signIn}
          </button>
          {notes}
        </form>
      )}
    </div>
  );
}
