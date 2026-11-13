// Keeps a phone's screen on while captions run (from the wedding app's), and brings a fresh
// connection at once after the phone was locked or in the background for a while.
import { useEffect } from 'react';
import { socket } from './socket';

/**
 * Can this browser keep the screen on by itself? (Not iPhones before iOS 16.4: there the page asks
 * the person to keep it on, or the listening phone's microphone stops when it locks, as /live did.)
 */
export const canStayAwake = typeof navigator !== 'undefined' && 'wakeLock' in navigator;

interface WakeLock {
  release: () => Promise<void>;
}

/**
 * While `on` (a quiz round, captions to read): keep the screen on (many phones lock after 30 s), and after the phone was locked or in the background for a while, reconnect at once
 * instead of waiting for a stale connection to time out.
 */
export function useAwake(on: boolean) {
  useEffect(() => {
    let lock: WakeLock | null = null;
    const api = (navigator as { wakeLock?: { request: (t: 'screen') => Promise<WakeLock> } })
      .wakeLock;
    const request = () => {
      if (!on || !api || document.visibilityState !== 'visible') return;
      api.request('screen').then(
        (l) => (lock = l),
        () => {}, // not allowed or not supported: the phone just locks as usual
      );
    };
    let hiddenAt = 0;
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now();
        return;
      }
      request(); // the browser drops the wake lock whenever the page is hidden
      if (hiddenAt && Date.now() - hiddenAt > 10_000) {
        socket.disconnect().connect(); // a fresh connection brings the current state at once
      }
      hiddenAt = 0;
    };
    request();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      lock?.release().catch(() => {});
    };
  }, [on]);
}
