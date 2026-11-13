// What the browser says about the microphone, and whether this device was asked before.
const ASKED_KEY = 'tr-mic-asked';

/** The browser's answer so far; null where it can't tell (then the browser asks if it must). */
export async function micPermission(): Promise<PermissionState | null> {
  try {
    return (await navigator.permissions.query({ name: 'microphone' })).state;
  } catch {
    return null;
  }
}
export function micAskedBefore() {
  try {
    return localStorage.getItem(ASKED_KEY) === '1';
  } catch {
    return true; // (nothing remembered: never ask twice in a row by our own picture)
  }
}
export function markMicAsked() {
  try {
    localStorage.setItem(ASKED_KEY, '1');
  } catch {
    // fine
  }
}
