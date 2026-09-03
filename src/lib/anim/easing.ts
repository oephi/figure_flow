/**
 * Pure easing/shaping functions. No React or Remotion imports on purpose —
 * these take and return plain numbers so they're trivially unit-testable in
 * isolation from any render pipeline.
 *
 * Remotion already ships `interpolate()` (which does the clamping, ranging
 * and array-of-keyframes work) and `spring()` (physically-based motion).
 * Don't reimplement either here. What belongs in this file is the shaping
 * curve you hand to `interpolate(frame, [in, out], [from, to], { easing })`,
 * or a bare 0..1 -> 0..1 curve for our own pose-blend math where a full
 * interpolate() call would be overkill.
 */

/** Identity. Also a useful default/placeholder when wiring up a new tween. */
export const linear = (t: number): number => t;

/** Cubic ease-in: slow start, accelerating. */
export const easeIn = (t: number): number => t * t * t;

/** Cubic ease-out: fast start, decelerating into the landing. */
export const easeOut = (t: number): number => 1 - Math.pow(1 - t, 3);

/** Cubic ease-in-out: slow start and end, fastest through the middle. */
export const easeInOut = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

/** Linear interpolation between a and b at t (t is expected to be 0..1, but isn't clamped). */
export const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
