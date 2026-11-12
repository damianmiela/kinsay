// Live captions (W3): words that arrive appear one after another, like a reply being written, and
// older lines glide up when a new one comes (Damian, 2026-10-06: calm and easy to read). Shared by
// the phone and the big screen. What is already there when the captions appear (a reconnect, a
// phone's history) shows still; "reduce motion" turns it all off.
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { prefersReducedMotion } from './motion';
import './captionWords.css';

const Ready = createContext<{ current: boolean }>({ current: true });

/** Wraps the captions: words rendered in its first pass appear still, later ones fade in. */
export function CaptionsFrame({ children }: { children: ReactNode }) {
  const ready = useRef(false);
  useEffect(() => {
    ready.current = true;
  }, []);
  return <Ready.Provider value={ready}>{children}</Ready.Provider>;
}

/** Time between two new words appearing; a long chunk goes faster, so it is all there in time. */
const WORD_STEP_MS = 110;
const CHUNK_MAX_MS = 1_600;

/**
 * A line's words. Keys are word positions, so a word keeps its place, and a line that is finished
 * keeps its words (no second fade): render each line under a key that stays the same (its number)
 * and the same component, the line coming in included. Words that came in one chunk appear one
 * after another instead of all at once.
 */
export function Words({ text }: { text: string }) {
  const parts = text.split(/(\s+)/);
  const words = parts.filter((p) => !/^\s*$/.test(p)).length;
  // how many words this line had at the last render: the ones after them are new (a line that
  // appears with the captions already open is all new; one in the history is all old)
  const ready = useContext(Ready);
  const [had, setHad] = useState(() => (ready.current ? 0 : words));
  const [before, setBefore] = useState(had);
  if (words !== had) {
    // (state from the last render, updated while rendering: React renders again at once)
    setBefore(Math.min(had, words));
    setHad(words);
  }
  const added = Math.max(0, words - before);
  const step = added ? Math.min(WORD_STEP_MS, CHUNK_MAX_MS / added) : 0;
  let n = 0;
  return (
    <>
      {parts.map((part, i) => {
        if (/^\s*$/.test(part)) return part;
        const index = n++;
        return <Word key={i} text={part} delay={Math.max(0, index - before) * step} />;
      })}
    </>
  );
}

function Word({ text, delay }: { text: string; delay: number }) {
  const ready = useContext(Ready);
  // decided once, when the word appears: later renders never replay it
  const [style] = useState(() =>
    ready.current && !prefersReducedMotion() ? { animationDelay: `${delay}ms` } : undefined,
  );
  return (
    <span className={style ? 'w-in' : undefined} style={style}>
      {text}
    </span>
  );
}
