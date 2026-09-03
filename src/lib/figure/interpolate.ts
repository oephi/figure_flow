/**
 * Keyframe tweening for {@link Pose}s.
 *
 * The single most important rule in this file: we interpolate ANGLES, never
 * positions. A `Pose` is already angle-only (see pose.ts), so as long as
 * this file only ever produces `Pose` values, it is structurally impossible
 * to accidentally tween a joint's (x, y) and stretch a limb. Positions are
 * always derived afterwards, once, by `resolvePose`.
 *
 * This module deliberately does not import from `src/lib/anim/easing.ts` —
 * that file is owned by another workstream and may not exist yet. Easing
 * functions are accepted as plain `(t: number) => number` values, either
 * via the small defaults exported here (`linear`, `easeInOutCubic`) or
 * injected by the caller (e.g. adapted from the other easing module once it
 * exists).
 */

import type { Pose } from "./pose";

/** A normalised easing function: input and output both range over [0, 1]. */
export type EasingFn = (t: number) => number;

export const linear: EasingFn = (t) => t;

/** Smooth accelerate-then-decelerate; a reasonable default for organic motion. */
export const easeInOutCubic: EasingFn = (t) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

export interface PoseKeyframe<Name extends string = string> {
  readonly frame: number;
  readonly pose: Pose<Name>;
  /**
   * Easing applied to the segment running INTO this keyframe (i.e. from the
   * previous keyframe in the track up to this one). Ignored on the first
   * keyframe of a track, since there is no preceding segment. Defaults to
   * `linear`.
   */
  readonly easing?: EasingFn;
}

/**
 * Shortest signed angular delta from `from` to `to`, in degrees, going the
 * short way around the circle. E.g. shortestAngleDelta(350, 10) === 20 (not
 * -340): interpolating from 350deg to 10deg should sweep forward through
 * 360/0, not backward through 180.
 */
const shortestAngleDelta = (from: number, to: number): number => {
  let delta = (to - from) % 360;
  if (delta > 180) {
    delta -= 360;
  } else if (delta < -180) {
    delta += 360;
  }
  return delta;
};

const assertSorted = <Name extends string>(track: readonly PoseKeyframe<Name>[]): void => {
  for (let i = 1; i < track.length; i++) {
    if (track[i].frame < track[i - 1].frame) {
      throw new Error(
        `interpolatePose: keyframe track must be sorted ascending by frame ` +
          `(frame ${track[i].frame} at index ${i} follows frame ${track[i - 1].frame})`,
      );
    }
  }
};

/**
 * Interpolate a `Pose` at an arbitrary `frame` from a sorted track of
 * {@link PoseKeyframe}s.
 *
 * - Before the first keyframe's frame, and after the last keyframe's frame,
 *   the pose clamps to that keyframe's pose exactly.
 * - At `frame === track[i].frame` exactly, the result equals `track[i].pose`
 *   exactly (no easing/interpolation artefacts at boundaries).
 * - Between two keyframes, each bone's angle is interpolated independently
 *   along the shortest path around the circle, eased by the target
 *   keyframe's `easing` (default `linear`).
 * - A bone angle missing from either endpoint's pose is treated as 0 (rest)
 *   for that endpoint, consistent with how `resolvePose` treats missing
 *   entries.
 *
 * `track` must already be sorted ascending by `frame`; this is checked and
 * throws rather than silently re-sorting, since a caller that thinks its
 * track is sorted but isn't has a bug worth surfacing.
 */
export function interpolatePose<Name extends string>(
  track: readonly PoseKeyframe<Name>[],
  frame: number,
): Pose<Name> {
  if (track.length === 0) {
    throw new Error("interpolatePose: keyframe track must have at least one keyframe");
  }
  assertSorted(track);

  const first = track[0];
  if (frame <= first.frame) {
    return { ...first.pose };
  }

  const last = track[track.length - 1];
  if (frame >= last.frame) {
    return { ...last.pose };
  }

  // Find the segment [a, b] such that a.frame <= frame < b.frame. Track is
  // sorted and frame is strictly between first and last, so this always
  // finds a valid pair.
  let index = 0;
  while (track[index + 1].frame <= frame) {
    index++;
  }
  const a = track[index];
  const b = track[index + 1];

  // Exact hit on an interior keyframe: return it verbatim rather than
  // computing through t=0. Computing through t=0 would give the same
  // *numeric* angles (for any sane easing with ease(0) === 0), but could
  // introduce spurious explicit-zero keys for bones present in `b.pose` but
  // absent from `a.pose` (they'd default to 0 and land at 0 * 0 = 0). Exact
  // frame matches must equal the authored pose object's key set, not a
  // superset of it.
  if (a.frame === frame) {
    return { ...a.pose };
  }

  const span = b.frame - a.frame;
  const t = span === 0 ? 1 : (frame - a.frame) / span;
  const ease = b.easing ?? linear;
  const easedT = ease(t);

  const names = new Set<Name>([
    ...(Object.keys(a.pose) as Name[]),
    ...(Object.keys(b.pose) as Name[]),
  ]);

  const result: Pose<Name> = {};
  for (const name of names) {
    const fromAngle = a.pose[name] ?? 0;
    const toAngle = b.pose[name] ?? 0;
    const delta = shortestAngleDelta(fromAngle, toAngle);
    result[name] = fromAngle + delta * easedT;
  }
  return result;
}
