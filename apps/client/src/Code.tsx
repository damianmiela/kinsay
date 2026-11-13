// One door for any code (mockups batch 3): six boxes, no button: the sixth character goes on. Six
// digits are a sign-in code (from Damian's admin); a code with a letter is someone's captions (join
// codes always have one). Letters come out as capitals.
import { useState } from 'react';
import { api } from './api';
import { t } from './texts';

const shape = (v: string) =>
  v
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 6);

export function CodeDoor({ onJoin }: { onJoin: (code: string) => void }) {
  const [value, setValue] = useState('');
  // 'idle', 'busy', 'done' or an error code
  const [state, setState] = useState('idle');
  const go = (code: string) => {
    if (!/^\d{6}$/.test(code)) {
      history.replaceState(null, '', `/join#${code}`);
      return onJoin(code);
    }
    setState('busy');
    void api<{ name: string }>('/api/signin/code', { digits: code }).then((r) => {
      if (r.ok) {
        setState('done');
        window.location.assign('/');
      } else {
        setValue('');
        setState(r.error);
      }
    });
  };
  return (
    <div className="page">
      <div className="bar">
        <a className="link" href="/" style={{ textDecoration: 'none' }}>
          ← {t.backHome}
        </a>
      </div>
      <div className="body">
        <h1 className="t">{t.codeTitle}</h1>
        <p className="s">{t.codeBody}</p>
        <label className="digits">
          <input
            className="digits-in"
            value={value}
            autoFocus
            autoCapitalize="characters"
            autoComplete="one-time-code"
            spellCheck={false}
            maxLength={6}
            aria-label={t.codeTitle}
            disabled={state === 'busy' || state === 'done'}
            onChange={(e) => {
              const v = shape(e.target.value);
              setValue(v);
              if (state !== 'idle') setState('idle');
              if (v.length === 6) go(v);
            }}
          />
          {Array.from({ length: 6 }, (_, i) => (
            <b
              key={i}
              aria-hidden="true"
              className={i < value.length ? 'on' : i === value.length ? 'cur' : ''}
            >
              {value[i] ?? ''}
            </b>
          ))}
        </label>
        {(state === 'busy' || state === 'done') && <p className="s">{t.signingIn}</p>}
        {state === 'bad-code' && <div className="note bad">{t.badCode}</div>}
        {state === 'too-many' && <div className="note bad">{t.tooMany}</div>}
        {state === 'offline' && <div className="note bad">{t.offline}</div>}
      </div>
    </div>
  );
}
