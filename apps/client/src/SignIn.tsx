// Signing in. For now with a code from Damian's admin (6 digits, or its QR link: /signin#t=…);
// the email link and Google come next. Anyone can ask for an invitation.
import { useEffect, useState } from 'react';
import { api } from './api';
import { Logo } from './bits';
import { t } from './texts';

export function SignInPage() {
  const [asking, setAsking] = useState(false);
  return (
    <div className="page">
      <div className="bar">
        <Logo />
      </div>
      <div className="body">
        <h1 className="t">{t.signInTitle}</h1>
        <a className="btn main" href="/signin">
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
      </div>
    </div>
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

/** /signin: six big digits, or the QR code's link (its secret in the address's # part, never sent to a server log). */
const signIn = (body: { digits?: string; link?: string }) =>
  api<{ name: string }>('/api/signin/code', body);

export function CodePage() {
  const link = /^#t=([\w-]{20,100})$/.exec(window.location.hash)?.[1];
  const [digits, setDigits] = useState('');
  // 'idle', 'busy', 'done' or an error code
  const [state, setState] = useState<string>(link ? 'busy' : 'idle');
  const [name, setName] = useState('');
  const done = (r: Awaited<ReturnType<typeof signIn>>) => {
    if (r.ok) {
      setName(r.name);
      setState('done');
      history.replaceState(null, '', '/signin');
      setTimeout(() => window.location.assign('/'), 1500);
    } else setState(r.error);
  };
  const send = (body: { digits: string }) => {
    setState('busy');
    void signIn(body).then(done);
  };
  // (the QR code's link: signed in at once; `done` is the same every time it matters)
  useEffect(() => {
    if (link) void signIn({ link }).then(done);
  }, [link]);
  return (
    <div className="page">
      <div className="bar">
        <Logo />
      </div>
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
        {state === 'done' && (
          <div className="note good">
            <b>{t.signedInAs(name)}</b>
            {t.staysSignedIn}
          </div>
        )}
        {state === 'bad-code' && <div className="note bad">{t.badCode}</div>}
        {state === 'too-many' && <div className="note bad">{t.tooMany}</div>}
        {state === 'offline' && <div className="note bad">{t.offline}</div>}
      </form>
    </div>
  );
}
