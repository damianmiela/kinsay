// The page's connection to its session: the state and the captions, added up into a history.
import { useEffect, useState } from 'react';
import type { CaptionsUpdate, SessionView } from '@translate/shared';
import { mergeUpdate } from './logic';
import { socket } from './socket';
import { useAwake } from './useAwake';

const EMPTY: CaptionsUpdate = { texts: {} };

/** `code`: a reader's page (the session's code); none: the signed-in host's own session. */
export function useSession(code?: string) {
  const [view, setView] = useState<SessionView | null>(null);
  const [update, setUpdate] = useState<CaptionsUpdate>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  // (this device's own internet: false while the connection is lost, until it comes back)
  const [online, setOnline] = useState(true);
  useEffect(() => {
    socket.auth = code ? { code } : {};
    // (after a stop the words stay to read again: the server empties its text, the page keeps its
    // own until the next start, which begins afresh; mockups batch 3)
    let running = false;
    const onState = (v: SessionView) => {
      setError(null);
      if (v.running && !running) setUpdate(EMPTY);
      running = v.running;
      setView((was) => {
        // (a page that changed its language starts that language's history again)
        if (was && was.lang !== v.lang) setUpdate(EMPTY);
        return v;
      });
    };
    const onCaptions = (u: CaptionsUpdate) => {
      if (running) setUpdate((was) => mergeUpdate(was, u));
    };
    // (too many pages from this connection: it says so and tries again by itself, as /live's)
    let retry: ReturnType<typeof setTimeout> | undefined;
    const onError = (e: Error) => {
      setError(e.message);
      if (e.message === 'too-many-pages') retry = setTimeout(() => socket.connect(), 30_000);
    };
    // (the server closed this page: signed out, blocked, the account or its session gone; Socket.IO
    // never comes back by itself then: the page starts again and shows where it stands, audit 32)
    const onGone = (reason: string) => {
      if (reason === 'io server disconnect') window.location.reload();
      else if (reason !== 'io client disconnect') setOnline(false);
    };
    const onConnect = () => setOnline(true);
    socket.on('state:session', onState);
    socket.on('disconnect', onGone);
    socket.on('connect', onConnect);
    socket.on('captions', onCaptions);
    socket.on('connect_error', onError);
    socket.connect();
    return () => {
      socket.off('state:session', onState);
      socket.off('captions', onCaptions);
      socket.off('connect_error', onError);
      clearTimeout(retry);
      socket.off('disconnect', onGone);
      socket.off('connect', onConnect);
      socket.disconnect();
    };
  }, [code]);
  useAwake(!!view?.running);
  return { view, update, error, online };
}

/** A socket action with a reply in at most 10 s (never a page stuck waiting). */
export function ask(
  event: 'session:start' | 'session:lang',
  payload: { lang: string | null; other?: string | null },
): Promise<string | null>;
export function ask(
  event: 'session:stop' | 'session:keepGoing' | 'session:useMic',
): Promise<string | null>;
export async function ask(event: string, payload?: unknown): Promise<string | null> {
  try {
    const s = socket.timeout(10_000) as unknown as {
      emitWithAck: (e: string, ...a: unknown[]) => Promise<{ ok: boolean; error?: string }>;
    };
    const r = await (payload === undefined ? s.emitWithAck(event) : s.emitWithAck(event, payload));
    return r.ok ? null : (r.error ?? 'failed');
  } catch {
    return 'offline';
  }
}
