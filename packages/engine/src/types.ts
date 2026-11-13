// The engine's words for what it makes: its own, so it needs neither app's shared code (it is
// copied into the wedding app as it is: scripts/sync-engine.mjs there). Plain types and one
// constant: pages may import them without the engine itself.

/** A language code as the speech service names them ("en", "pt", "zh"), or HEARD. */
export type Target = string;
/** What was heard, in the language it was said in (a stream without translation). */
export const HEARD = 'heard';

/** One text's lines: finished lines by number, and the line coming in. */
export interface CaptionText {
  lines: string[];
  /** The number of `lines[0]` since the last clear (a page adds lines up by number). */
  first: number;
  live: string;
}

/** What a page gets: its texts' last lines. */
export interface CaptionsUpdate {
  /** "heard" (what was recognized) and the page's language, if it reads one. */
  texts: Partial<Record<Target, CaptionText>>;
  /** The language of the last words heard (a code), while someone speaks. */
  speaking?: string;
  /** "heard": the language each line was heard in, by line number (for the labels). */
  heardLangs?: Record<number, string>;
}

/** The speech service as the engine sees it. */
export type ServiceState = 'off' | 'idle' | 'live' | 'error';
