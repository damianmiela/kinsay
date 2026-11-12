// /app-signin#t=…: the browser's side of the desktop app's sign-in (mockups batch 2, part 7). The
// window opened this page in the person's own browser; signed in here (as usual, first if needed),
// they see the window's digits and say yes or no. The token waits in this browser's storage while
// they sign in (Google and the code page come back to /, which sends them here again).
import { useEffect, useState } from 'react';
import { api } from './api';
import { Logo } from './bits';
import { SignInPage } from './SignIn';
import { APP_SIGNIN_KEY as KEY, waitingAppSignIn } from './store';
import { appSignIn as a, t } from './texts';

const tokenOf = (hash: string) => /^#t=([A-Za-z0-9_-]{16,64})$/.exec(hash)?.[1];

const forget = () => {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // (nothing kept)
  }
};

export function AppSignInPage() {
  const [token] = useState(() => {
    const t = tokenOf(window.location.hash) ?? waitingAppSignIn();
    try {
      if (t) localStorage.setItem(KEY, t);
    } catch {
      // (not kept: signing in here first then needs the link again)
    }
    return t;
  });
  const [state, setState] = useState<'wait' | 'out' | 'gone' | 'ask' | 'yes' | 'no' | 'offline'>(
    token ? 'wait' : 'gone',
  );
  const [ask, setAsk] = useState<{
    digits: string;
    name: string;
    email: string | null;
    elsewhere: boolean;
  } | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!token) return;
    void api<{ digits: string; name: string; email: string | null; elsewhere: boolean }>(
      '/api/app-signin/ask',
      { token },
    ).then((r) => {
      if (r.ok) {
        setAsk(r);
        setState('ask');
      } else if (r.error === 'signed-out') setState('out');
      else if (r.error === 'gone') {
        forget();
        setState('gone');
      } else setState('offline'); // (a blip: the ask still waits, audit 32)
    });
  }, [token, tick]);
  const answer = async (yes: boolean) => {
    const r = await api('/api/app-signin/answer', { token, yes });
    if (r.ok || r.error === 'gone' || r.error === 'elsewhere') forget();
    setState(
      r.ok
        ? yes
          ? 'yes'
          : 'no'
        : r.error === 'offline' || r.error === 'server'
          ? 'offline'
          : 'gone',
    );
  };

  if (state === 'out') return <SignInPage note={a.first} />;
  return (
    <div className="page">
      <div className="bar">
        <Logo />
      </div>
      <div className="body">
        {state === 'ask' && ask && (
          <>
            <h1 className="t">{a.title}</h1>
            <p className="s">
              {a.body} <b>{ask.email ?? ask.name}</b>.
            </p>
            <p className="app-digits" aria-label={ask.digits.split('').join(' ')}>
              {ask.digits.slice(0, 3)} {ask.digits.slice(3)}
            </p>
            {ask.elsewhere ? (
              <div className="note warn">{a.elsewhere}</div>
            ) : (
              <>
                <p className="s">{a.check}</p>
                <button className="btn main" onClick={() => void answer(true)}>
                  {a.yes}
                </button>
              </>
            )}
            <button className="btn" onClick={() => void answer(false)}>
              {a.no}
            </button>
          </>
        )}
        {state === 'yes' && (
          <div className="note good">
            <b>{a.done}</b> {a.doneBody}
          </div>
        )}
        {state === 'no' && <div className="note">{a.refused}</div>}
        {state === 'gone' && <div className="note warn">{a.gone}</div>}
        {state === 'offline' && (
          <>
            <div className="note bad">{t.offline}</div>
            <button className="btn" onClick={() => setTick((n) => n + 1)}>
              {t.signInAgainHere}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
