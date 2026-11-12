// The pages, chosen by the address (no router needed): / (sign in, or your own captions), /signin
// (a code from the admin), /join (someone's captions by code), /account, /admin, /privacy,
// /window (the subtitles window, the desktop app's page), /app-signin (its sign-in, in the browser).
import { useEffect, useState } from 'react';
import { AccountPage } from './Account';
import { AppSignInPage } from './AppSignIn';
import { waitingAppSignIn } from './store';
import { AdminPage } from './Admin';
import { api } from './api';
import { HostPage } from './Host';
import { PrivacyPage } from './Privacy';
import { ReaderPage } from './Reader';
import { CodePage, SignInPage } from './SignIn';
import { WindowPage } from './Window';
import { t } from './texts';

function Home() {
  const [state, setState] = useState<'wait' | 'in' | 'out' | 'offline'>('wait');
  useEffect(() => {
    void api('/api/me').then((r) =>
      setState(r.ok ? 'in' : r.error === 'signed-out' ? 'out' : 'offline'),
    );
  }, []);
  if (state === 'wait') return <div className="page" />;
  // (signed in for a desktop app's sign-in: back to its question)
  if (state === 'in' && waitingAppSignIn()) {
    window.location.replace('/app-signin');
    return null;
  }
  if (state === 'offline') {
    return (
      <div className="page">
        <div className="body">
          <div className="note bad">{t.offline}</div>
          <button className="btn main" onClick={() => window.location.reload()}>
            OK
          </button>
        </div>
      </div>
    );
  }
  return state === 'in' ? <HostPage /> : <SignInPage />;
}

const path = window.location.pathname;
const Page =
  path === '/signin'
    ? CodePage
    : path === '/join'
      ? ReaderPage
      : path === '/account'
        ? AccountPage
        : path === '/admin'
          ? AdminPage
          : path === '/privacy'
            ? PrivacyPage
            : path === '/window'
              ? WindowPage
              : path === '/app-signin'
                ? AppSignInPage
                : Home;

export function App() {
  return <Page />;
}
