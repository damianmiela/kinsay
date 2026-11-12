import { useState } from 'react';

/** A setting kept on this device (localStorage; a private window: for this visit only). */
export function useStored<T>(key: string, initial: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    try {
      const s = localStorage.getItem(key);
      return s === null ? initial : (JSON.parse(s) as T);
    } catch {
      return initial;
    }
  });
  return [
    v,
    (next: T) => {
      setV(next);
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // not remembered: fine
      }
    },
  ];
}

/** A desktop app's sign-in waiting in this browser (AppSignIn.tsx; Home sends a signed-in page back). */
export const APP_SIGNIN_KEY = 'tr-app-signin';
export function waitingAppSignIn(): string | null {
  try {
    return localStorage.getItem(APP_SIGNIN_KEY);
  } catch {
    return null;
  }
}
