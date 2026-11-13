// Read aloud (mockups batch 3): the device's own voice says each new finished line, from the moment
// it is turned on; when people talk faster than the voice, it skips to the newest line. Never on
// the listening device (its microphone would caption the voice again).
import { useEffect, useRef, useState } from 'react';
import type { CaptionText } from '@translate/shared';

export const canSpeak = typeof window !== 'undefined' && 'speechSynthesis' in window;

/** Where a device adds a voice, in its own words. */
export type VoiceHelp = 'ios' | 'android' | 'windows' | 'mac' | 'other';
export function voiceHelp(ua: string, touch = false): VoiceHelp {
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && touch)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  if (/Windows/.test(ua)) return 'windows';
  if (/Macintosh/.test(ua)) return 'mac';
  return 'other';
}

/** The best voice for a language ("pl": pl-PL; the device's default for it first). */
export function pickVoice(voices: readonly SpeechSynthesisVoice[], lang: string) {
  const of = voices.filter((v) => v.lang.toLowerCase().replace('_', '-').split('-')[0] === lang);
  return of.find((v) => v.default) ?? of.find((v) => v.localService) ?? of[0] ?? null;
}

/** The newest finished line not said yet (the one to say next), or null. */
export const nextLine = (saidUpTo: number, text: CaptionText) => {
  const last = text.first + text.lines.length - 1;
  return last > saidUpTo ? last : null;
};

/** The first tap must start the voice (iPhones say nothing otherwise). */
export function unlockSpeech() {
  if (!canSpeak) return;
  speechSynthesis.cancel();
  speechSynthesis.speak(new SpeechSynthesisUtterance(''));
}

function useVoices() {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>(() =>
    canSpeak ? speechSynthesis.getVoices() : [],
  );
  useEffect(() => {
    if (!canSpeak) return;
    const load = () => setVoices(speechSynthesis.getVoices());
    speechSynthesis.addEventListener('voiceschanged', load);
    return () => speechSynthesis.removeEventListener('voiceschanged', load);
  }, []);
  return voices;
}

/**
 * `lang`: the text's language (null: what is heard, each line in `langOf` its own). Returns the line
 * being said and whether the device has no voice for the language (said only once it lists voices).
 */
export function useReadAloud(
  on: boolean,
  text: CaptionText,
  lang: string | null,
  langOf: (n: number) => string | undefined = () => undefined,
) {
  const voices = useVoices();
  const [saying, setSaying] = useState<number | null>(null);
  const [turn, setTurn] = useState(0);
  const said = useRef(-1);
  // the utterance being said: only its own end counts (a cancelled one's late error, or one the
  // browser dropped without an end, never stops or mixes up the next: audit 33)
  const current = useRef<SpeechSynthesisUtterance | null>(null);
  const watchdog = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const textRef = useRef(text);
  const langOfRef = useRef(langOf);
  useEffect(() => {
    textRef.current = text;
    langOfRef.current = langOf;
  });
  // turned on (or another language): from the next line on; off: silent at once
  useEffect(() => {
    if (!canSpeak) return;
    const t = textRef.current;
    said.current = t.first + t.lines.length - 1;
    return () => {
      current.current = null;
      clearTimeout(watchdog.current);
      speechSynthesis.cancel();
      setSaying(null);
    };
  }, [on, lang]);
  useEffect(() => {
    if (!on || !canSpeak || current.current) return;
    const n = nextLine(said.current, text);
    if (n === null) return;
    said.current = n;
    const line = text.lines[n - text.first];
    const voice = pickVoice(voices, lang ?? langOfRef.current(n) ?? '');
    if (!line || (lang && !voice)) return;
    const u = new SpeechSynthesisUtterance(line);
    if (voice) {
      u.voice = voice;
      u.lang = voice.lang;
    }
    const done = () => {
      if (current.current !== u) return;
      current.current = null;
      clearTimeout(watchdog.current);
      setSaying(null);
      setTurn((x) => x + 1); // (the next line, if one came meanwhile)
    };
    u.onend = done;
    u.onerror = done;
    current.current = u;
    // (an end that never comes: a line takes about 80 ms a character, give it that and 2 s more)
    watchdog.current = setTimeout(done, 2_000 + 80 * line.length);
    setSaying(n);
    speechSynthesis.speak(u);
  }, [on, text, lang, voices, turn]);
  const noVoice = on && !!lang && voices.length > 0 && !pickVoice(voices, lang);
  return { saying, noVoice };
}
