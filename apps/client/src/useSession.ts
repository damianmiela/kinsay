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
  useEffect(() => {
    socket.auth = code ? { code } : {};
    const onState = (v: SessionView) => {
      setError(null);
      setView((was) => {
        // (a page that changed its language starts that language's history again)
        if (was && was.lang !== v.lang) setUpdate(EMPTY);
        return v;
      });
    };
    const onCaptions = (u: CaptionsUpdate) => setUpdate((was) => mergeUpdate(was, u));
    const onError = (e: Error) => setError(e.message);
    socket.on('state:session', onState);
    socket.on('captions', onCaptions);
    socket.on('connect_error', onError);
    socket.connect();
    return () => {
      socket.off('state:session', onState);
      socket.off('captions', onCaptions);
      socket.off('connect_error', onError);
      socket.disconnect();
    };
  }, [code]);
  useAwake(!!view?.running);
  return { view, update, error };
}

/** A socket action with a reply in at most 10 s (never a page stuck waiting). */
export function ask(
  event: 'session:start' | 'session:lang',
  payload: { lang: string | null },
): Promise<string | null>;
export function ask(event: 'session:stop'): Promise<string | null>;
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
