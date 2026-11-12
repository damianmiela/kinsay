// The pages, chosen by the address (no router needed): / (sign in, or your own captions), /signin
// (a code from the admin), /join (someone's captions by code), /account, /admin.
import { useEffect, useState } from 'react';
import { AccountPage } from './Account';
import { AdminPage } from './Admin';
import { api } from './api';
import { HostPage } from './Host';
import { ReaderPage } from './Reader';
import { CodePage, SignInPage } from './SignIn';
import { t } from './texts';

function Home() {
  const [state, setState] = useState<'wait' | 'in' | 'out' | 'offline'>('wait');
  useEffect(() => {
    void api('/api/me').then((r) =>
      setState(r.ok ? 'in' : r.error === 'signed-out' ? 'out' : 'offline'),
    );
  }, []);
  if (state === 'wait') return <div className="page" />;
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
          : Home;

export function App() {
  return <Page />;
}
