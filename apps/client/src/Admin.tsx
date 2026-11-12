// /admin: Damian's. Requests first (they wait for him), then people (invite, grant, sign a device in
// for someone, limits, block) and the settings. In English (only Damian sees it).
import { useEffect, useState, type FormEvent } from 'react';
import { EUR, euros, GRANT_STEPS } from '@translate/shared';
import { api } from './api';
import { Logo, Sheet } from './bits';
import { Qr } from './Qr';
import './admin.css';

interface Person {
  id: number;
  name: string;
  email: string | null;
  created: string;
  blocked: number;
  monthly_limit: number | null;
  balance: number;
  month: number;
  last_seen: string | null;
}
interface Req {
  id: number;
  kind: 'credits' | 'invite';
  amount: number | null;
  email: string | null;
  at: string;
  name: string;
  person_email: string | null;
  person_id: number | null;
  balance: number;
}
interface State {
  requests: Req[];
  people: Person[];
  month: number;
  running: number;
  settings: { pricePerHour: number; monthlyLimit: number; globalLimit: number };
}

const day = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '–';
const short = (micro: number) => euros(micro).replace('.00', '');
/** Euros typed by Damian ("2", "2.50", "2,50") in micro-euros; NaN when it isn't a number. */
const typed = (s: string) => Math.round(Number(s.replace(',', '.')) * EUR);

export function AdminPage() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  useEffect(() => {
    void api('/admin/api/me').then((r) => setAuthed(r.ok));
  }, []);
  if (authed === null) return <div className="page" />;
  return authed ? <Admin /> : <Login onIn={() => setAuthed(true)} />;
}

function Login({ onIn }: { onIn: () => void }) {
  const [pw, setPw] = useState('');
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const r = await api('/admin/login', { password: pw });
    if (r.ok) onIn();
    else
      setError(r.error === 'too-many' ? 'Too many tries: wait a few minutes.' : 'Wrong password.');
  };
  return (
    <div className="page">
      <div className="bar">
        <Logo />
      </div>
      <form className="body" onSubmit={(e) => void submit(e)}>
        <h1 className="t">Admin</h1>
        <input
          className="input"
          type="password"
          autoComplete="current-password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          aria-label="Password"
        />
        <button className="btn main">Sign in</button>
        {error && <div className="note bad">{error}</div>}
      </form>
    </div>
  );
}

type Tab = 'requests' | 'people' | 'settings';

function Admin() {
  const [s, setS] = useState<State | null>(null);
  const [tab, setTab] = useState<Tab>('requests');
  const [open, setOpen] = useState<number | null>(null);
  const [code, setCode] = useState<{
    name: string;
    digits: string;
    link: string;
    expires: number;
  } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    void api<State>('/admin/api/state').then((r) => {
      if (r.ok) setS(r);
    });
  }, [tick]);
  useEffect(() => {
    const every = setInterval(() => setTick((n) => n + 1), 15_000);
    return () => clearInterval(every);
  }, []);
  const [busy, setBusy] = useState(false);
  const act = async (path: string, body: object) => {
    if (busy) return false;
    setBusy(true);
    const r = await api(path, body);
    setBusy(false);
    setMsg(
      r.ok
        ? null
        : r.error === 'request-answered'
          ? 'That request was answered already.'
          : `That didn't work (${r.error}).`,
    );
    setTick((n) => n + 1);
    return r.ok;
  };
  if (!s) return <div className="page" />;
  const grant = (p: { id: number }, amount: number, requestId?: number) =>
    void act('/admin/api/grant', { personId: p.id, amount, ...(requestId ? { requestId } : {}) });
  const other = (p: Person, kind: 'grant' | 'correction') => {
    const v = prompt(
      kind === 'grant'
        ? `Add how many euros to ${p.name}?`
        : `Correction for ${p.name}, in euros (minus takes away):`,
    );
    if (v === null) return;
    const amount = typed(v);
    if (!Number.isFinite(amount) || !amount) return setMsg('Not a number of euros.');
    const note = kind === 'correction' ? (prompt('A note they will see (optional):') ?? '') : '';
    void act('/admin/api/grant', { personId: p.id, amount, kind, note });
  };
  const limit = (p: Person) => {
    const v = prompt(
      `${p.name}'s monthly limit in euros (empty: the default, 0: none):`,
      p.monthly_limit === null ? '' : String(p.monthly_limit / EUR),
    );
    if (v === null) return;
    const amount = v.trim() === '' ? null : typed(v);
    if (amount !== null && !Number.isFinite(amount)) return setMsg('Not a number of euros.');
    void act('/admin/api/person', { id: p.id, monthlyLimit: amount });
  };
  const signInCode = async (p: Person) => {
    const r = await api<{ digits: string; link: string; expires: number }>(
      '/admin/api/signin-code',
      { id: p.id },
    );
    if (r.ok) setCode({ name: p.name, digits: r.digits, link: r.link, expires: r.expires });
    else setMsg(`That didn't work (${r.error}).`);
  };
  const waiting = s.requests.length;

  return (
    <div className={`admin${busy ? ' busy' : ''}`}>
      <nav className="side">
        <Logo />
        {(['requests', 'people', 'settings'] as const).map((k) => (
          <button key={k} className={`nav${tab === k ? ' on' : ''}`} onClick={() => setTab(k)}>
            {k[0]!.toUpperCase() + k.slice(1)}
            {k === 'requests' && waiting > 0 && <span className="n">{waiting}</span>}
          </button>
        ))}
        <button
          className="nav"
          onClick={() => void api('/admin/logout', {}).then(() => window.location.reload())}
        >
          Sign out
        </button>
      </nav>
      <section className="admin-main">
        {msg && <div className="note bad">{msg}</div>}
        {tab === 'requests' && (
          <>
            <h1 className="t">Requests</h1>
            {!waiting && <p className="s">Nothing waiting.</p>}
            {s.requests.map((r) => (
              <div className="card req" key={r.id}>
                <div>
                  <b>{r.name}</b> · {r.person_email ?? r.email ?? 'no email'}
                  <p>
                    {r.kind === 'credits'
                      ? `Asks for ${short(r.amount ?? 0)} · has ${euros(r.balance)} left`
                      : 'Asks for an invitation'}{' '}
                    · {day(r.at)}
                  </p>
                </div>
                <div className="grants">
                  {r.kind === 'credits' && r.person_id ? (
                    <>
                      {GRANT_STEPS.map((a) => (
                        <button
                          key={a}
                          className={`btn sm${a === r.amount ? ' main' : ''}`}
                          onClick={() => grant({ id: r.person_id! }, a, r.id)}
                        >
                          +{short(a)}
                        </button>
                      ))}
                    </>
                  ) : (
                    <button
                      className="btn sm main"
                      onClick={() =>
                        void act('/admin/api/invite', { name: r.name, email: r.email })
                      }
                    >
                      Invite
                    </button>
                  )}
                  <button
                    className="btn sm"
                    onClick={() => void act('/admin/api/decline', { requestId: r.id })}
                  >
                    Decline
                  </button>
                </div>
              </div>
            ))}
            <h2 className="t">This month</h2>
            <div className="stats">
              <div className="stat">
                <b>{euros(s.month)}</b>
                <span>used by everyone</span>
              </div>
              <div className="stat">
                <b>{s.people.length}</b>
                <span>people, {s.running} running now</span>
              </div>
              <div className="stat">
                <b>{s.settings.globalLimit ? euros(s.settings.globalLimit) : 'none'}</b>
                <span>limit for everyone together</span>
              </div>
            </div>
          </>
        )}

        {tab === 'people' && (
          <>
            <h1 className="t">People</h1>
            <InviteForm onInvite={(name, email) => act('/admin/api/invite', { name, email })} />
            <table className="tbl">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th className="n">Left</th>
                  <th className="n">This month</th>
                  <th>Last seen</th>
                </tr>
              </thead>
              <tbody>
                {s.people.map((p) => (
                  <tr
                    key={p.id}
                    className={`${p.blocked ? 'dim' : ''}${open === p.id ? ' open' : ''}`}
                    onClick={() => setOpen(open === p.id ? null : p.id)}
                  >
                    <td>
                      <b>{p.name}</b>{' '}
                      {p.blocked ? <span className="tag declined">Blocked</span> : null}
                    </td>
                    <td>{p.email ?? '–'}</td>
                    <td className="n">{euros(p.balance)}</td>
                    <td className="n">{euros(p.month)}</td>
                    <td>{day(p.last_seen)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {s.people
              .filter((p) => p.id === open)
              .map((p) => (
                <div className="card" key={p.id}>
                  <h2 className="t" style={{ marginTop: 0 }}>
                    {p.name}
                  </h2>
                  <p className="s" style={{ marginBottom: 12 }}>
                    Invited {day(p.created)} · monthly limit{' '}
                    {p.monthly_limit === null
                      ? `${s.settings.monthlyLimit ? euros(s.settings.monthlyLimit) : 'none'} (default)`
                      : p.monthly_limit
                        ? euros(p.monthly_limit)
                        : 'none'}
                  </p>
                  <div className="grants">
                    {GRANT_STEPS.map((a) => (
                      <button key={a} className="btn sm" onClick={() => grant(p, a)}>
                        +{short(a)}
                      </button>
                    ))}
                    <button className="btn sm" onClick={() => other(p, 'grant')}>
                      Other
                    </button>
                    <button className="btn sm" onClick={() => other(p, 'correction')}>
                      Correct
                    </button>
                    <button className="btn sm" onClick={() => limit(p)}>
                      Monthly limit
                    </button>
                    {!p.blocked && (
                      <button className="btn sm main" onClick={() => void signInCode(p)}>
                        Sign in a device
                      </button>
                    )}
                    <button
                      className="btn sm"
                      onClick={() => void act('/admin/api/person', { id: p.id, signOutAll: true })}
                    >
                      Sign out all devices
                    </button>
                    <button
                      className="btn sm"
                      style={{ color: 'var(--bad)' }}
                      onClick={() => {
                        if (
                          p.blocked ||
                          confirm(
                            `Block ${p.name}? Their devices are signed out and their captions stop.`,
                          )
                        ) {
                          void act('/admin/api/person', { id: p.id, blocked: !p.blocked });
                        }
                      }}
                    >
                      {p.blocked ? 'Unblock' : 'Block'}
                    </button>
                  </div>
                </div>
              ))}
          </>
        )}

        {tab === 'settings' && (
          <Settings s={s.settings} onSave={(v) => act('/admin/api/settings', v)} />
        )}
      </section>

      {code && <CodeSheet code={code} onClose={() => setCode(null)} />}
    </div>
  );
}

function InviteForm({
  onInvite,
}: {
  onInvite: (name: string, email: string | null) => Promise<boolean>;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  return (
    <form
      className="card invite"
      onSubmit={(e) => {
        e.preventDefault();
        void onInvite(name, email.trim() || null).then((ok) => {
          if (ok) {
            setName('');
            setEmail('');
          }
        });
      }}
    >
      <input
        className="input"
        placeholder="Name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
        maxLength={80}
        aria-label="Name"
      />
      <input
        className="input"
        type="email"
        placeholder="Email (optional)"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        maxLength={254}
        aria-label="Email"
      />
      <button className="btn main">Invite</button>
    </form>
  );
}

function Settings({
  s,
  onSave,
}: {
  s: State['settings'];
  onSave: (v: object) => Promise<boolean>;
}) {
  const [v, setV] = useState({
    pricePerHour: String(s.pricePerHour / EUR),
    monthlyLimit: String(s.monthlyLimit / EUR),
    globalLimit: String(s.globalLimit / EUR),
  });
  const [saved, setSaved] = useState(false);
  const field = (k: keyof typeof v, label: string, hint: string) => (
    <label>
      <span className="lbl">{label}</span>
      <input
        className="input"
        inputMode="decimal"
        value={v[k]}
        onChange={(e) => setV({ ...v, [k]: e.target.value })}
      />
      <span className="small">{hint}</span>
    </label>
  );
  return (
    <form
      className="card settings"
      onSubmit={(e) => {
        e.preventDefault();
        const out = Object.fromEntries(Object.entries(v).map(([k, x]) => [k, typed(x)]));
        if (Object.values(out).some((x) => !Number.isFinite(x))) return;
        void onSave(out).then(setSaved);
      }}
    >
      <h1 className="t" style={{ marginTop: 0 }}>
        Settings
      </h1>
      {field(
        'pricePerHour',
        'Price per stream-hour (€)',
        'What one language costs per hour of audio, taken from the credits.',
      )}
      {field('monthlyLimit', 'Monthly limit per person (€)', 'Unless set for the person; 0: none.')}
      {field('globalLimit', 'Monthly limit for everyone (€)', 'All use together; 0: none.')}
      <button className="btn main">Save</button>
      {saved && <div className="note good">Saved.</div>}
    </form>
  );
}

function CodeSheet({
  code,
  onClose,
}: {
  code: { name: string; digits: string; link: string; expires: number };
  onClose: () => void;
}) {
  const link = `${window.location.origin}/signin#t=${code.link}`;
  const until = new Date(code.expires).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
  return (
    <Sheet label={`Sign in a device for ${code.name}`} onClose={onClose}>
      <h2 className="t">Sign in a device for {code.name}</h2>
      <p className="s">
        On their phone: scan this, or open Translate, tap "I have a sign-in code" and type the
        numbers.
      </p>
      <Qr text={link} px={220} />
      <div className="digits">
        {code.digits.split('').map((d, i) => (
          <span key={i}>{d}</span>
        ))}
      </div>
      <p className="small">
        Works once, until {until}. The device then stays signed in for a year of use.
      </p>
      <button className="btn main" onClick={onClose}>
        Done
      </button>
    </Sheet>
  );
}
