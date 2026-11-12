// Live captions on a phone (W3), shared by the guests' page and /live, which look the same (Damian,
// 2026-10-11): the note, everything said so far, the newest line at the bottom. Only this box
// scrolls, never the page: an iPhone moves Safari's toolbar with a page that scrolls, the page's
// height changes while it glides, and the lines jumped down and back up with every new line (and the
// "Latest" button came back by itself, 2026-10-08). Following the newest line is a glide of its own
// (scrollIntoView moves the page too) that only ever goes down: a line coming in that gets shorter
// for a moment keeps its room instead of pulling everything back up, and the oldest lines going
// (a phone keeps 400) never move what is on screen. Following ends
// only when the reader scrolls up themselves (a finger dragging and its glide, the wheel, a key)
// and starts again when the newest line is back on screen or "Latest" is tapped. Texts come from
// the page (each page has its own).
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CaptionText } from '@translate/shared';
import { CaptionsFrame, Words } from './captionWords';
import { glideStep } from './captionScroll';
import { prefersReducedMotion } from './motion';
import './captionsList.css';

/** Room under the newest line while following (px; `.cap-scroll`'s padding below). */
const BELOW_NEWEST = 24;
/** How far below its place the newest line may be and still count as "on screen" (px). */
const NEAR = 40;

/** Where a line starts in the list (px, exact: whole pixels would add up as lines go). */
const topIn = (list: HTMLElement, line: HTMLElement) =>
  line.getBoundingClientRect().top - list.getBoundingClientRect().top;

/** How far the scroll must go down to put the newest line in its place (negative: above it). */
const toNewest = (box: HTMLElement, end: HTMLElement) =>
  end.getBoundingClientRect().top - box.getBoundingClientRect().bottom + BELOW_NEWEST;

export function CaptionsList({
  text,
  note,
  waiting,
  latest,
  labels,
}: {
  text: CaptionText;
  /** A small label before a line, by its number (what was heard: its language). */
  labels?: Record<number, string>;
  /** Above everything said ("Translated automatically…"). */
  note: string;
  /** While nothing has been said. */
  waiting: string;
  /** The button back to the newest line. */
  latest: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const lines = useRef<HTMLDivElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const [follow, setFollow] = useState(true);
  const following = useRef(true);
  const setFollowing = useCallback((on: boolean) => {
    following.current = on;
    setFollow(on);
  }, []);
  // (the reader's own scrolling, until then: a finger dragging and its glide, the wheel, a key)
  const ownUntil = useRef(0);
  const frame = useRef(0);

  /** Down to the newest line: a glide, or at once (a new size, the first view, "reduce motion"). */
  const catchUp = useCallback((atOnce: boolean) => {
    cancelAnimationFrame(frame.current);
    let last = performance.now();
    const step = (now: number) => {
      const b = box.current;
      const e = end.current;
      if (!b || !e) return;
      const by = toNewest(b, e);
      if (by <= 0.5) return; // there, or the line got shorter: never back up
      const to = b.scrollTop + by;
      if (atOnce || prefersReducedMotion()) {
        b.scrollTop = to;
        return;
      }
      b.scrollTop = glideStep(b.scrollTop, to, Math.min(now - last, 50));
      last = now;
      frame.current = requestAnimationFrame(step);
    };
    if (atOnce) step(last);
    else frame.current = requestAnimationFrame(step);
  }, []);

  // after every change of the text, before it shows: (1) the phone dropped its oldest lines (it
  // keeps 400): what is on screen stays where it is (Safari keeps no scroll anchor, the others'
  // is off: `.cap-scroll`); (2) the text never gets shorter on screen: words the service takes
  // back for a moment (a revised guess, a line finished shorter than its guess) keep their room,
  // so nothing moves up and back down (2026-10-11); (3) text that doesn't go on from what was
  // shown (the first view, a reconnect's history) starts afresh, at the newest line
  const shown = useRef<{ first: number; count: number; n: number; top: number } | null>(null);
  const carry = useRef(0);
  useLayoutEffect(() => {
    const b = box.current;
    const l = lines.current;
    const was = shown.current;
    const goesOn = !!was && text.first >= was.first && text.first <= was.first + was.count;
    if (b && l && was && goesOn && text.first > was.first) {
      const anchor = l.querySelector<HTMLElement>(`[data-n="${was.n}"]`);
      if (anchor) {
        // (a box scrolls by whole pixels: what one correction can't place goes into the next)
        const to = b.scrollTop + topIn(l, anchor) - was.top + carry.current;
        b.scrollTop = to;
        carry.current = to - b.scrollTop;
      }
    }
    if (l) {
      if (!goesOn) l.style.minHeight = '';
      l.style.minHeight = `${l.getBoundingClientRect().height}px`;
      if (!goesOn && following.current) catchUp(true);
    }
    const last = l?.lastElementChild as HTMLElement | null | undefined;
    shown.current = last
      ? {
          first: text.first,
          count: text.lines.length,
          n: Number(last.dataset.n),
          top: topIn(l!, last),
        }
      : null;
  });

  // words come (a line grows, a new one starts) or the box changes size (the phone turned, the
  // offline line, a toolbar): back to the newest line while following; a new size at once, so the
  // newest line never hides under the edge (and the first view starts at the newest line)
  const empty = !text.lines.length && !text.live;
  useEffect(() => {
    const b = box.current;
    if (!b) return;
    const watch = new ResizeObserver((entries) => {
      if (following.current) catchUp(entries.some((entry) => entry.target === b));
    });
    watch.observe(b);
    if (lines.current) watch.observe(lines.current);
    return () => watch.disconnect();
  }, [catchUp, empty]);

  // the reader's own scrolling: up stops following, the newest line back on screen starts it again
  useEffect(() => {
    const b = box.current;
    if (!b) return;
    let lastTop = b.scrollTop;
    const own = () => {
      ownUntil.current = performance.now() + 400;
    };
    // (a finger on the captions: the glide stops at once, it never fights the reader)
    const grab = () => {
      own();
      cancelAnimationFrame(frame.current);
    };
    const onScroll = () => {
      const top = b.scrollTop;
      const theirs = performance.now() < ownUntil.current;
      // (a glide after the finger lifts keeps going as long as the box keeps moving)
      if (theirs) own();
      if (end.current && toNewest(b, end.current) <= NEAR) setFollowing(true);
      else if (theirs && top < lastTop - 2) setFollowing(false);
      lastTop = top;
    };
    b.addEventListener('touchstart', grab, { passive: true });
    b.addEventListener('touchmove', own, { passive: true });
    b.addEventListener('wheel', grab, { passive: true });
    window.addEventListener('keydown', own);
    b.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      b.removeEventListener('touchstart', grab);
      b.removeEventListener('touchmove', own);
      b.removeEventListener('wheel', grab);
      window.removeEventListener('keydown', own);
      b.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(frame.current);
    };
  }, [setFollowing]);

  // the newest lines bright, what came before softer
  const recent = text.lines.length - 2;
  return (
    <div className="cap-view">
      <div className="cap-scroll" ref={box}>
        <p className="cap-note">{note}</p>
        {empty ? (
          <p className="cap-empty">{waiting}</p>
        ) : (
          <CaptionsFrame>
            <div className="cap-lines" ref={lines}>
              {/* keyed by line number: the line coming in keeps its words when it is finished */}
              {text.lines.map((line, i) => (
                <Line
                  key={text.first + i}
                  n={text.first + i}
                  text={line}
                  old={i < recent}
                  label={labels?.[text.first + i]}
                />
              ))}
              {/* the same component as a finished line: finishing it never redraws its words */}
              {text.live && (
                <Line
                  key={text.first + text.lines.length}
                  n={text.first + text.lines.length}
                  text={text.live}
                  old={false}
                  live
                />
              )}
            </div>
          </CaptionsFrame>
        )}
        <div className="cap-end" ref={end} />
      </div>
      {!follow && (
        <button
          className="cap-latest"
          // (the glide down isn't the reader's scrolling, even when the tap moved the finger a
          // little)
          onClick={() => {
            ownUntil.current = 0;
            setFollowing(true);
            catchUp(false);
          }}
        >
          {latest}
        </button>
      )}
    </div>
  );
}

/**
 * One caption line, finished or coming in (memo: a long history isn't redrawn with every new word).
 * Each starts with a mark and a gap, so a reader scrolling back sees where lines begin.
 */
const Line = memo(function Line({
  n,
  text,
  old,
  live = false,
  label,
}: {
  label?: string;
  /** Its number (CaptionText.first counts on). */
  n: number;
  text: string;
  old: boolean;
  live?: boolean;
}) {
  return (
    <p data-n={n} className={`cap-line${old ? ' old' : ''}${live ? ' live' : ''}`}>
      {label && <span className="cap-label">{label}</span>}
      <Words text={text} />
    </p>
  );
});
