// Following the newest caption line (2026-10-11): a glide of our own, so every browser moves the
// same way and a target that moves on (new words) is followed without starting again from rest.

/** The glide's time constant (ms): most of the way within a few frames, any distance in a second. */
export const GLIDE_MS = 140;

/**
 * The next scroll position of a glide from `from` down to `to`, `ms` after the last frame: an
 * easing that adapts when the target moves on, at least a pixel a frame (a phone rounds a smaller
 * step away and the glide would never arrive), never past the target.
 */
export function glideStep(from: number, to: number, ms: number): number {
  const next = from + (to - from) * (1 - Math.exp(-ms / GLIDE_MS));
  return Math.min(to, Math.max(next, from + 1));
}
