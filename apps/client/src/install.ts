// Install Translate as an app (mockups batch 7, approved 2026-11-14): the site is installable (its
// manifest and icons; no service worker, Chrome no longer needs one). Android and computers: the
// browser's own question, kept from `beforeinstallprompt` (it comes once, early: watched from the
// start); iPhone and iPad: no website may ask, so Settings shows Safari's steps; elsewhere the
// browser's menu. Once installed (opened from its icon, or just installed) nothing is offered.
import { useEffect, useState } from 'react';

interface InstallPrompt extends Event {
  prompt(): Promise<void>;
}

let waiting: InstallPrompt | null = null;
let justInstalled = false;
const listeners = new Set<() => void>();
const tell = () => listeners.forEach((l) => l());

/** Called once at the start (main.tsx): the browser's question may come before any page asks. */
export function watchInstall() {
  addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // (asked only when the person taps the row)
    waiting = e as InstallPrompt;
    tell();
  });
  addEventListener('appinstalled', () => {
    waiting = null;
    justInstalled = true;
    tell();
  });
}

/**
 * How this device installs: the browser's question, Safari's steps (`ios-other`: another browser
 * on an iPhone or iPad, its own Share; `mac`: Safari's Add to Dock), the menu, or not at all.
 */
export type InstallWay = 'prompt' | 'iphone' | 'ipad' | 'ios-other' | 'mac' | 'menu' | null;

export function installWay(
  ua: string,
  touch: boolean,
  installed: boolean,
  canPrompt: boolean,
): InstallWay {
  if (installed) return null;
  const ios = /iPhone|iPod|iPad/.test(ua) || (/Macintosh/.test(ua) && touch);
  if (ios && /CriOS|FxiOS|EdgiOS/.test(ua)) return 'ios-other';
  if (/iPhone|iPod/.test(ua)) return 'iphone';
  if (ios) return 'ipad';
  if (canPrompt) return 'prompt';
  if (
    /Macintosh/.test(ua) &&
    /Version\/.*Safari\//.test(ua) &&
    !/Chrome|Chromium|Edg|Firefox/.test(ua)
  )
    return 'mac';
  // (Firefox on a computer can't install a site; on Android it can, from its menu)
  if (/Firefox\//.test(ua) && !/Android/.test(ua)) return null;
  return 'menu';
}

const isInstalled = () =>
  justInstalled ||
  matchMedia('(display-mode: standalone)').matches ||
  (navigator as { standalone?: boolean }).standalone === true;

/** The Settings row's way, kept up to date as the browser's question comes or goes. */
export function useInstall(): { way: InstallWay; ask: () => Promise<void> } {
  const [, redraw] = useState(0);
  useEffect(() => {
    const l = () => redraw((n) => n + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  const way = installWay(
    navigator.userAgent,
    navigator.maxTouchPoints > 1,
    isInstalled(),
    !!waiting,
  );
  return {
    way,
    ask: async () => {
      const p = waiting;
      if (!p) return;
      waiting = null; // (the browser's question can be asked once)
      await p.prompt().catch(() => {});
      tell();
    },
  };
}
