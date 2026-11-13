// The admin's "Use and cost" (mockups batch 5, approved 2026-11-13): what everyone was charged per
// UTC day next to what Soniox billed (its own usage API, asked by the server), and Soniox's real
// cost per hour of audio, to set the price. English, the admin only.
import { useEffect, useState } from 'react';
import { euros } from '@translate/shared';
import { api } from './api';
import { lowestPrice, windowDays } from './logic';
import { useStored } from './store';

interface OurDay {
  day: string;
  sessions: number;
  charged: number;
  streamSeconds: number;
  /** Sessions from before stream-seconds were kept. */
  unknown: number;
}
interface SonioxDay {
  day: string;
  costUsd: number;
  audioMs: number;
  requests: number;
}
interface Usage {
  days: number;
  from: string;
  ours: OurDay[];
  soniox: SonioxDay[] | null;
  sonioxError?: string;
  pricePerHour: number;
}

const hours = (s: number) => `${(s / 3600).toFixed(2)} h`;
const usd = (v: number, places = 2) => `$${v.toFixed(places)}`;
/** A day's name ("Fri 13 Nov") from its UTC date. */
const dayName = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });

export function UsagePage() {
  const [days, setDays] = useStored<7 | 30 | 90>('tr-admin-days', 30);
  const [rate, setRate] = useStored('tr-admin-rate', '0.93');
  const [margin, setMargin] = useStored('tr-admin-margin', '30');
  const [loaded, setU] = useState<Usage | null>(null);
  const [failed, setFailed] = useState(false);
  // (another window: the last one's numbers never show under its name while it loads)
  const u = loaded?.days === days ? loaded : null;
  useEffect(() => {
    void api<Usage>(`/admin/api/usage?days=${days}`).then((r) => {
      if (r.ok) setU(r);
      else setFailed(true);
    });
  }, [days]);

  const ours = new Map((u?.ours ?? []).map((d) => [d.day, d]));
  const soniox = new Map((u?.soniox ?? []).map((d) => [d.day, d]));
  const sum = (f: (d: OurDay) => number) => (u?.ours ?? []).reduce((a, d) => a + f(d), 0);
  const charged = sum((d) => d.charged);
  const streamSeconds = sum((d) => d.streamSeconds);
  const sessions = sum((d) => d.sessions);
  const unknown = sum((d) => d.unknown);
  const sCost = (u?.soniox ?? []).reduce((a, d) => a + d.costUsd, 0);
  const sAudio = (u?.soniox ?? []).reduce((a, d) => a + d.audioMs, 0) / 1000;
  const sRequests = (u?.soniox ?? []).reduce((a, d) => a + d.requests, 0);
  const perHour = sAudio > 0 ? sCost / (sAudio / 3600) : null;
  const lowest = lowestPrice(
    perHour,
    Number(rate.replace(',', '.')),
    Number(margin.replace(',', '.')),
  );

  return (
    <>
      <div className="usage-top">
        <h1 className="t">Use and cost</h1>
        <div className="seg2" role="group" aria-label="Days">
          {([7, 30, 90] as const).map((d) => (
            <button key={d} className={d === days ? 'on' : ''} onClick={() => setDays(d)}>
              {d} days
            </button>
          ))}
        </div>
      </div>
      {failed && <div className="note bad">That didn&apos;t load. Reload the page.</div>}
      {u?.sonioxError ? (
        <div className="note warn">
          {u.sonioxError === 'no key'
            ? 'No Soniox key on this server: our side only.'
            : `Soniox didn't answer (${u.sonioxError}). Our side only below; try again later.`}
        </div>
      ) : (
        <div className="note info">
          Soniox&apos;s numbers are the whole key&apos;s: they include the wedding app (the same
          key). Its cost per hour holds all the same.
        </div>
      )}
      {u && (
        <>
          <div className="stats four">
            <div className="stat">
              <b>{euros(charged)}</b>
              <span>charged to everyone</span>
              <small>
                {(streamSeconds / 3600).toFixed(2)} stream-hours
                {unknown ? ` (+${unknown} older sessions)` : ''}
              </small>
            </div>
            <div className="stat">
              <b>{u.soniox ? usd(sCost) : '–'}</b>
              <span>Soniox&apos;s cost</span>
              {u.soniox && (
                <small>
                  {hours(sAudio)} of audio, {sRequests} streams
                </small>
              )}
            </div>
            <div className="stat">
              <b>{perHour === null ? '–' : usd(perHour, 3)}</b>
              <span>Soniox per hour of audio</span>
              <small>its cost ÷ its own audio hours</small>
            </div>
            <div className="stat">
              <b>{euros(u.pricePerHour)}</b>
              <span>your price per stream-hour</span>
              <small>Settings</small>
            </div>
          </div>
          <div className="card price">
            <label>
              $1 = €
              <input
                className="input"
                inputMode="decimal"
                value={rate}
                aria-label="Euros for a dollar"
                onChange={(e) => setRate(e.target.value)}
              />
            </label>
            <label>
              margin
              <input
                className="input"
                inputMode="decimal"
                value={margin}
                aria-label="Margin in percent"
                onChange={(e) => setMargin(e.target.value)}
              />
              %
            </label>
            <span>
              Charge at least <b className="out">{lowest === null ? '–' : euros(lowest)}</b> per
              stream-hour
            </span>
          </div>
          <table className="tbl usage">
            <thead>
              <tr>
                <th>Day (UTC)</th>
                <th className="n">Sessions</th>
                <th className="n">Stream-hours</th>
                <th className="n">Charged</th>
                <th className="n">Soniox audio</th>
                <th className="n">Soniox cost</th>
                <th className="n">Per hour</th>
              </tr>
            </thead>
            <tbody>
              {windowDays(u.from, u.days).map((d) => {
                const o = ours.get(d);
                const s = soniox.get(d);
                const sH = s ? s.audioMs / 3_600_000 : 0;
                // (Soniox heard more than 10 % over what we counted: the wedding, or a look)
                const apart =
                  !!s && sH > 0 && !o?.unknown && sH * 3600 > (o?.streamSeconds ?? 0) * 1.1;
                return (
                  <tr key={d} className={o || s?.costUsd ? '' : 'dim'}>
                    <td>{dayName(d)}</td>
                    <td className="n">{o?.sessions ?? 0}</td>
                    <td className="n">
                      {o && !o.unknown
                        ? hours(o.streamSeconds)
                        : o
                          ? `${hours(o.streamSeconds)}+`
                          : '–'}
                    </td>
                    <td className="n">{o ? euros(o.charged) : '–'}</td>
                    <td className={`n${apart ? ' gap' : ''}`}>
                      {s && sH ? hours(s.audioMs / 1000) : '–'}
                    </td>
                    <td className={`n${apart ? ' gap' : ''}`}>
                      {s && s.costUsd ? usd(s.costUsd) : '–'}
                    </td>
                    <td className="n">{s && sH ? usd(s.costUsd / sH, 3) : '–'}</td>
                  </tr>
                );
              })}
              <tr className="sum">
                <td>{u.days} days</td>
                <td className="n">{sessions}</td>
                <td className="n">{hours(streamSeconds)}</td>
                <td className="n">{euros(charged)}</td>
                <td className="n">{u.soniox ? hours(sAudio) : '–'}</td>
                <td className="n">{u.soniox ? usd(sCost) : '–'}</td>
                <td className="n">{perHour === null ? '–' : usd(perHour, 3)}</td>
              </tr>
            </tbody>
          </table>
        </>
      )}
    </>
  );
}
