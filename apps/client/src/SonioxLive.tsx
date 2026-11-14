// The admin's "Soniox right now" and "History" (mockups batch 6, approved 2026-11-13): Soniox's
// own count at once for the whole key (Translate and the wedding app), Translate's share of it,
// and the history of the most at once and of the costs. English, the admin only.
import { useEffect, useState } from 'react';
import { api } from './api';
import { byMonth, chartBars, type Bar } from './logic';
import { useStored } from './store';

interface Peak {
  start: string;
  max: number;
}
interface Now {
  translate: { used: number; share: number };
  org?: { current: number; limit: number };
  today?: { max: number; at: string } | null;
  week?: number;
  hours?: Peak[];
  error?: string;
}
type Range = 'day' | 'week' | 'month' | 'year';
interface History {
  range: Range;
  period: number;
  peaks: Peak[];
  costs: { day: string; costUsd: number }[] | null;
  charged: { day: string; charged: number }[];
  error?: string;
}

const clockAt = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

/** Bars (a share of the highest each), with their numbers in a tooltip. */
function Bars({ bars, limit, pair }: { bars: Bar[]; limit?: number; pair?: boolean }) {
  const top = Math.max(1, limit ?? 0, ...bars.flatMap((b) => [b.a, b.b ?? 0]));
  return (
    <div className="chart-box">
      {limit !== undefined && (
        <div className="chart-limit" style={{ bottom: `${(limit / top) * 100}%` }}>
          <span>limit {limit}</span>
        </div>
      )}
      <div className="chart-bars">
        {bars.map((b) => (
          <span key={b.key} className="chart-col" title={b.tip}>
            <i
              className={`a${limit !== undefined && b.a >= limit * 0.9 ? ' hi' : ''}`}
              style={{ height: `${(b.a / top) * 100}%` }}
            />
            {pair && <i className="b" style={{ height: `${((b.b ?? 0) / top) * 100}%` }} />}
          </span>
        ))}
      </div>
    </div>
  );
}

export function SonioxLive() {
  const [now, setNow] = useState<Now | null>(null);
  const [share, setShare] = useState('');
  const [saved, setSaved] = useState<string | null>(null);
  // every 5 s while the page is open and in sight (nothing is asked otherwise)
  useEffect(() => {
    let stop = false;
    let asking = false;
    const load = () => {
      if (document.visibilityState !== 'visible' || asking) return;
      asking = true;
      void api<Now>('/admin/api/soniox/now').then((r) => {
        asking = false;
        if (!stop && r.ok) setNow(r);
      });
    };
    load();
    const timer = setInterval(load, 5_000);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, []);
  if (!now) return null;
  const org = now.org;
  const mine = now.translate.used;
  const wedding = org ? Math.max(0, org.current - mine) : 0;
  const limit = org?.limit ?? 0;
  const near = !!org && limit > 0 && org.current >= limit * 0.9;
  const saveShare = async () => {
    const n = Number(share);
    const r = await api('/admin/api/settings', { streamShare: n });
    setSaved(r.ok ? 'Saved.' : 'That number won’t do (1 to 1000).');
    if (r.ok) setNow({ ...now, translate: { ...now.translate, share: n } });
  };
  const pct = (n: number) => `${limit ? Math.min(100, (n / limit) * 100) : 0}%`;
  return (
    <>
      {near && (
        <div className="note warn">
          <b>
            {org.current} of {limit} at Soniox.
          </b>{' '}
          New streams may be refused (Translate’s and the wedding app’s): lower Translate’s share,
          or ask Soniox for a higher limit in its Console.
        </div>
      )}
      <div className="card live-card">
        <div className="live-grid">
          <div>
            <span className="live-tag">Live · every 5 s</span>
            {org ? (
              <>
                <div className="live-big">
                  {org.current} <span>of {limit} at Soniox now</span>
                </div>
                <div className="live-bar" aria-hidden="true">
                  <b className="t" style={{ width: pct(mine) }} />
                  <b className="w" style={{ width: pct(wedding) }} />
                </div>
                <div className="live-legend">
                  <span>
                    <i className="dot t" />
                    Translate <b>{mine}</b>
                  </span>
                  <span>
                    <i className="dot w" />
                    Wedding app <b>{wedding}</b>
                  </span>
                  <span>
                    Free <b>{Math.max(0, limit - org.current)}</b>
                  </span>
                </div>
              </>
            ) : (
              <>
                <div className="live-big">
                  {mine} <span>Translate’s own now</span>
                </div>
                <p className="small">
                  {now.error === 'no key'
                    ? 'No Soniox key on this server.'
                    : `Soniox didn’t answer (${now.error ?? 'no answer'}): Translate’s own count only.`}
                </p>
              </>
            )}
          </div>
          {now.hours && (
            <div>
              <div className="small">
                Highest today:{' '}
                <b>{now.today ? `${now.today.max} at ${clockAt(now.today.at)}` : '0'}</b> · this
                week: <b>{now.week ?? 0}</b>
              </div>
              <Bars
                bars={now.hours.map((p) => ({
                  key: p.start,
                  a: p.max,
                  tip: `${clockAt(p.start)}: ${p.max} at once`,
                }))}
              />
              <div className="small faint">the last 12 hours, the highest per hour</div>
            </div>
          )}
        </div>
        <div className="live-share">
          <label>
            Translate may hold at most
            <input
              className="input"
              inputMode="numeric"
              value={share || String(now.translate.share)}
              aria-label="Translate's share of Soniox's streams"
              onChange={(e) => {
                setShare(e.target.value.replace(/\D/g, ''));
                setSaved(null);
              }}
            />
            {org ? `of Soniox’s ${limit} at once` : 'streams at once'}
          </label>
          <button className="btn small" onClick={() => void saveShare()} disabled={!share}>
            Save
          </button>
          {org && (
            <span className="faint">
              · the other {Math.max(0, limit - now.translate.share)} left for the wedding app (on
              its day: 5 or less here)
            </span>
          )}
          {saved && <span className="small">{saved}</span>}
        </div>
      </div>
    </>
  );
}

export function SonioxHistory() {
  const [range, setRange] = useStored<Range>('tr-admin-history', 'month');
  const [h, setH] = useState<History | null>(null);
  useEffect(() => {
    void api<History>(`/admin/api/soniox/history?range=${range}`).then((r) => {
      if (r.ok) setH(r);
    });
  }, [range]);
  const shown = h?.range === range ? h : null;
  const label = {
    day: 'per hour, today',
    week: 'per hour, the last 7 days',
    month: 'per day, the last 30 days',
    year: 'per month, the last 12 months',
  }[range];
  const peaks = shown ? (range === 'year' ? byMonth(shown.peaks) : shown.peaks) : [];
  const costs = shown?.costs ? chartBars(shown.costs, shown.charged, range === 'year') : null;
  return (
    <div className="card hist-card">
      <div className="hist-top">
        <h2 className="t">History</h2>
        <div className="seg2" role="group" aria-label="History">
          {(['day', 'week', 'month', 'year'] as const).map((r) => (
            <button key={r} className={r === range ? 'on' : ''} onClick={() => setRange(r)}>
              {r[0]!.toUpperCase() + r.slice(1)}
            </button>
          ))}
        </div>
      </div>
      {shown?.error && (
        <p className="small">
          {shown.error === 'no key'
            ? 'No Soniox key on this server: no history.'
            : `Soniox didn’t answer (${shown.error}).`}
        </p>
      )}
      {shown && !shown.error && (
        <>
          <div>
            <div className="chart-title">
              The most at once at Soniox <span>· {label}</span>
            </div>
            <Bars
              bars={peaks.map((p) => ({
                key: p.start,
                a: p.max,
                tip: `${p.start.slice(0, range === 'year' ? 7 : range === 'month' ? 10 : 13).replace('T', ' ')}${range === 'day' || range === 'week' ? ':00' : ''}: ${p.max} at once`,
              }))}
            />
          </div>
          {costs && (
            <div>
              <div className="chart-title">
                Charged and Soniox’s cost{' '}
                <span>
                  · {range === 'year' ? 'per month' : 'per day'} · <i className="dot t" />
                  charged (€) <i className="dot c" />
                  Soniox ($)
                </span>
              </div>
              <Bars bars={costs} pair />
            </div>
          )}
        </>
      )}
    </div>
  );
}
