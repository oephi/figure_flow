/**
 * Analytic (closed-form) inverse kinematics for a two-bone chain — e.g.
 * `leftUpperArm` -> `leftForearm`, or `leftThigh` -> `leftShin`.
 *
 * Everything else in `src/lib/figure/` is forward kinematics: angles in,
 * positions out (`resolvePose`). This file goes the other way, for a pose
 * editor where the user drags a hand or foot and the limb has to follow:
 * position in, angles out. The two bones this solves for are still expressed
 * as ordinary `Pose` angles (see pose.ts) so the result slots straight back
 * into a `Pose` and re-resolves with `resolvePose` like any other angle —
 * IK is just a different way of *producing* a pose, not a different kind of
 * pose.
 *
 * The maths is the standard law-of-cosines two-bone solve. It is kept
 * closed-form deliberately: an iterative solver (e.g. CCD, FABRIK) would
 * also work, but for exactly two bones the exact solution is cheap, exact,
 * and has no convergence/iteration-count tuning to get wrong — worth
 * preferring whenever the chain length allows it.
 */

import { normalizeAngle } from "./angle";
import type { Point } from "./pose";
import { resolvePose, type Pose } from "./pose";
import type { Skeleton } from "./skeleton";

/** Radians -> degrees, matching pose.ts's convention (angles are degrees;
 * `Math.atan2`/`Math.acos` are radians, so every trig call needs this). */
const toDegrees = (radians: number): number => (radians * 180) / Math.PI;

/**
 * `Math.acos` returns NaN for anything outside [-1, 1], and the law-of-
 * cosines ratios below land just outside that range constantly — not from
 * bad input, but from ordinary floating-point error when a target sits
 * exactly at full stretch or dead-centre. Clamping here is what keeps the
 * whole module NaN-free; it is not an edge case, it is the common case.
 */
const clampToUnit = (x: number): number => Math.min(1, Math.max(-1, x));

/**
 * Guard against dividing by (or aiming from) a zero-length vector. Used both
 * for the aim distance (target may coincide with the shoulder/hip) and,
 * inside the caller, could in principle be used for a zero-length bone —
 * though the rig never defines one; see skeleton.ts's `length >= 0` note.
 */
const EPSILON = 1e-9;

/**
 * Which of the two mirror solutions ("elbow up" vs "elbow down") a two-bone
 * chain should use to reach a target it can reach.
 *
 * A triangle with two fixed side lengths (the bones) and a fixed base (the
 * distance to the target) has exactly two shapes: the third vertex (the
 * elbow/knee) sits on one side of the shoulder-to-target line or the other.
 * Nothing about the target position picks one over the other — they are
 * equally valid FK-consistent solutions, so this is genuinely ambiguous, not
 * under-specified maths that a smarter formula would resolve.
 *
 * An automatic tie-break (e.g. "whichever solution is closer to the current
 * pose") sounds appealing but is wrong for an interactive editor: as the
 * user drags the hand across the shoulder-to-target line, the elbow would
 * suddenly flip sides at the exact moment the two solutions swap which one
 * is "closer", which reads as a glitch. A human dragging a hand expects the
 * elbow to stay on the side they put it, all the way until they explicitly
 * move it past straight-arm and back — i.e. this is a per-drag UI choice,
 * not a per-frame computation, so it has to be a parameter.
 *
 * Sign convention (see skeleton.ts for the angle convention this builds on):
 * +1 rotates the upper bone clockwise-on-screen away from the straight line
 * to the target to open up the elbow; -1 rotates it counter-clockwise. Which
 * one looks like "elbow up" vs "elbow down" depends on which side of the
 * body the aim direction is on, which is exactly why this is a raw sign
 * rather than named "up"/"down" — those labels would be backwards half the
 * time.
 */
export type Bend = 1 | -1;

export interface TwoBoneIkInput<Name extends string> {
  readonly skeleton: Skeleton<Name>;
  /** Current full pose — only used for the angles ABOVE `upper` (e.g. the
   * spine bone an arm hangs off), which the solve must match to land the
   * limb correctly in world space. `pose[upper]` / `pose[lower]` are not
   * read; this call is what replaces them. */
  readonly pose: Pose<Name>;
  readonly root: Point;
  /** Chain root, e.g. "leftUpperArm" or "leftThigh". */
  readonly upper: Name;
  /** Chain tip's bone, e.g. "leftForearm" or "leftShin". Must be `upper`'s
   * direct child in `skeleton`. */
  readonly lower: Name;
  /** Desired position of `lower`'s END, in the same space `resolvePose`
   * returns (i.e. already including `root`). */
  readonly target: Point;
  readonly bend: Bend;
}

export interface TwoBoneIkResult {
  /** Pose angle (degrees, relative to restAngle) to assign to `upper`. */
  readonly upper: number;
  /** Pose angle (degrees, relative to restAngle) to assign to `lower`. */
  readonly lower: number;
}

/**
 * Solve a two-bone chain so its tip lands on (or as close as possible to)
 * `target`.
 *
 * Returns POSE angles — i.e. already relative to each bone's `restAngle` and
 * to the accumulated angle of everything above `upper` in the hierarchy —
 * because that is what a `Pose` stores (see pose.ts) and what `resolvePose`
 * expects back. Getting either offset wrong shows up as a constant angular
 * error: the limb reaches a point rotated away from the actual target by
 * whatever offset was dropped, which is easy to misdiagnose as "the maths is
 * wrong" when actually the maths is right and only the frame is wrong. The
 * two offsets, concretely:
 *
 * - `restAngle`: `total(bone) = total(parent) + bone.restAngle + pose[bone]`
 *   (see skeleton.ts), so `pose[bone] = total(bone) - total(parent) -
 *   bone.restAngle`. The world-space angles this function solves for via
 *   the law of cosines are `total(upper)` and `total(lower)`; the rest
 *   angle has to be subtracted back out to store them as a `Pose`.
 * - the parent chain's accumulated angle: `upper` typically hangs off a bone
 *   (e.g. `spine`) whose own total angle depends on the rest of the pose —
 *   a leaning torso rotates where the shoulder points, so the same target
 *   position demands a different `upper` pose angle depending on the
 *   current spine angle. This function gets that angle from `resolvePose`
 *   itself (on the supplied `pose`) rather than re-deriving FK by hand, so
 *   it can never disagree with the renderer about where the shoulder is.
 */
export function solveTwoBoneIk<Name extends string>(
  input: TwoBoneIkInput<Name>,
): TwoBoneIkResult {
  const { skeleton, pose, root, upper, lower, target, bend } = input;

  const byName = new Map(skeleton.map((bone) => [bone.name, bone]));
  const upperBone = byName.get(upper);
  const lowerBone = byName.get(lower);
  if (!upperBone) {
    throw new Error(`solveTwoBoneIk: unknown bone "${upper}"`);
  }
  if (!lowerBone) {
    throw new Error(`solveTwoBoneIk: unknown bone "${lower}"`);
  }
  if (lowerBone.parent !== upper) {
    throw new Error(
      `solveTwoBoneIk: "${lower}" must be a direct child of "${upper}" (found parent ` +
        `"${String(lowerBone.parent)}")`,
    );
  }

  const upperLength = upperBone.length;
  const lowerLength = lowerBone.length;
  if (upperLength <= 0 || lowerLength <= 0) {
    // Both offsets below (rest angle, aim direction) are undefined for a
    // zero-length bone — there is no meaningful "direction" for a point.
    // The skeleton never defines one (see skeleton.ts), so this is a caller
    // error, not a real case to solve gracefully.
    throw new Error("solveTwoBoneIk: both bones must have positive length");
  }

  // Resolve the CURRENT pose purely to read off where the chain starts
  // (`shoulder`, i.e. upper's start point — the parent's end point) and how
  // much the parent chain above it is already rotated (`parentTotalAngle`).
  // pose[upper]/pose[lower] themselves are irrelevant here: we are about to
  // replace both, and neither one affects its own start point or the
  // ancestors above it.
  const resolved = resolvePose(skeleton, pose, root);
  const shoulder = resolved[upper].start;
  const parentTotalAngle = upperBone.parent === null ? 0 : resolved[upperBone.parent].angle;

  // Aim vector from the chain's start to the target, in the same screen
  // space resolvePose uses (+X right, +Y down).
  const dx = target.x - shoulder.x;
  const dy = target.y - shoulder.y;
  const distance = Math.hypot(dx, dy);

  const maxReach = upperLength + lowerLength;
  const minReach = Math.abs(upperLength - lowerLength);
  // Clamp the triangle's base to what the two bones can actually span.
  // Beyond maxReach the chain straightens out fully; below minReach (the
  // "inner dead zone" — e.g. a 30-unit thigh and 28-unit shin can never
  // bring the ankle closer than 2 units to the hip) it folds back on itself
  // as tightly as it can. Floor at EPSILON too: the law-of-cosines division
  // below is by (2 * length * clampedDistance), and minReach itself is 0
  // whenever the two bone lengths are equal, which would otherwise divide by
  // zero exactly at the dead-zone centre.
  const clampedDistance = Math.max(Math.min(distance, maxReach), minReach, EPSILON);

  // Aim angle: the total (world) angle whose direction() (see pose.ts)
  // points from `shoulder` toward `target`. direction(theta) = (sin theta,
  // -cos theta), so sin theta = dx/distance and cos theta = -dy/distance;
  // atan2(sin, cos) recovers theta. When the target sits exactly on the
  // shoulder (distance ~ 0) the aim direction is undefined — fall back to
  // 0 (straight up) so the result is stable and deterministic rather than
  // NaN from atan2(0, 0) or a direction that spins with float noise.
  const aimAngle = distance < EPSILON ? 0 : toDegrees(Math.atan2(dx, -dy));

  // Law of cosines. `shoulderOffset` is the angle at the shoulder between
  // the aim direction and the upper bone; `elbowInterior` is the angle at
  // the elbow between the upper bone (reversed) and the lower bone, i.e.
  // 180 degrees when the chain is fully straight and 0 degrees when it is
  // fully folded back on itself.
  const shoulderOffset = toDegrees(
    Math.acos(
      clampToUnit(
        (upperLength * upperLength + clampedDistance * clampedDistance - lowerLength * lowerLength) /
          (2 * upperLength * clampedDistance),
      ),
    ),
  );
  const elbowInterior = toDegrees(
    Math.acos(
      clampToUnit(
        (upperLength * upperLength + lowerLength * lowerLength - clampedDistance * clampedDistance) /
          (2 * upperLength * lowerLength),
      ),
    ),
  );

  // `bend` picks which side of the aim line the elbow opens toward; the
  // elbow's turn away from "continue straight" (180 - elbowInterior) must
  // open to the SAME side for the triangle to close — the opposite sign
  // lands the tip on the aim line's mirror image, not on the target. (Only
  // the round-trip test in ik.test.ts checks this now; verified numerically
  // against thousands of random targets while deriving the formula.)
  const upperTotalAngle = aimAngle + bend * shoulderOffset;
  const lowerTotalAngle = upperTotalAngle - bend * (180 - elbowInterior);

  // Normalised so a drag cannot write values like -336 into a pose file; see
  // angle.ts. Geometrically identical, and interpolation is unaffected.
  return {
    upper: normalizeAngle(upperTotalAngle - parentTotalAngle - upperBone.restAngle),
    lower: normalizeAngle(lowerTotalAngle - upperTotalAngle - lowerBone.restAngle),
  };
}
