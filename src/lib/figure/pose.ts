/**
 * Forward kinematics: turn a {@link Skeleton} + a {@link Pose} + a root
 * translation into concrete 2D start/end points for every bone.
 *
 * See skeleton.ts for the angle convention (degrees, 0 = up the screen,
 * positive = clockwise on screen). This file is where that convention is
 * actually consumed — `direction()` below is the one place the rotation
 * matrix is applied, deliberately kept tiny so it's easy to audit.
 */

import type { Bone, Skeleton } from "./skeleton";

export interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * A pose is a set of ADDITIONAL angles (degrees), one per bone, layered on
 * top of that bone's restAngle. Bones not present are treated as 0 (i.e.
 * "at rest"). Positions are never stored in a Pose — only angles — so a pose
 * can never itself stretch or shrink a bone; see interpolate.ts for why that
 * matters.
 */
export type Pose<Name extends string = string> = Partial<Record<Name, number>>;

export interface ResolvedBone {
  readonly start: Point;
  readonly end: Point;
  /** Total accumulated angle (degrees) used to draw this bone, for debugging. */
  readonly angle: number;
}

export type ResolvedPose<Name extends string> = Record<Name, ResolvedBone>;

/** Degrees -> radians. */
const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/**
 * Unit direction vector for a total (already-accumulated) angle, per the
 * convention in skeleton.ts: 0 = up (0,-1), positive = clockwise on screen.
 *
 * Derivation: rotating the reference vector (0,-1) by `theta` through the
 * standard rotation matrix [[cos,-sin],[sin,cos]] gives
 * (0*cos - (-1)*sin, 0*sin + (-1)*cos) = (sin(theta), -cos(theta)).
 */
const direction = (totalAngleDegrees: number): Point => {
  const rad = toRadians(totalAngleDegrees);
  return { x: Math.sin(rad), y: -Math.cos(rad) };
};

/**
 * Resolve every bone in `skeleton` to its start/end points and total angle,
 * given a `pose` (per-bone angle offsets from rest) and a `root` translation.
 *
 * `root` is a separate {x, y} translation of the whole figure, kept apart
 * from the pose itself: a walk cycle can reuse the exact same leg/arm pose
 * track while `root` carries the figure across the frame, or leave `root`
 * fixed to play the cycle in place (e.g. for a treadmill-style loop).
 *
 * Bones are resolved via memoised recursion rather than assuming array
 * order, so `skeleton` does not need to list parents before children
 * (though {@link SKELETON} happens to). A bone whose parent chain cycles
 * back on itself throws, rather than infinite-looping.
 */
export function resolvePose<Name extends string>(
  skeleton: Skeleton<Name>,
  pose: Pose<Name>,
  root: Point,
): ResolvedPose<Name> {
  const byName = new Map<Name, Bone<Name>>();
  for (const bone of skeleton) {
    byName.set(bone.name, bone);
  }

  const cache = new Map<Name, { totalAngle: number; start: Point; end: Point }>();
  const visiting = new Set<Name>();

  const resolveBone = (name: Name): { totalAngle: number; start: Point; end: Point } => {
    const cached = cache.get(name);
    if (cached) {
      return cached;
    }

    const bone = byName.get(name);
    if (!bone) {
      throw new Error(`resolvePose: unknown bone "${name}"`);
    }

    if (visiting.has(name)) {
      throw new Error(`resolvePose: cycle detected in bone hierarchy at "${name}"`);
    }
    visiting.add(name);

    let parentTotalAngle = 0;
    let start = root;
    if (bone.parent !== null) {
      const parent = resolveBone(bone.parent);
      parentTotalAngle = parent.totalAngle;
      start = parent.end;
    }

    const poseAngle = pose[name] ?? 0;
    const totalAngle = parentTotalAngle + bone.restAngle + poseAngle;
    const dir = direction(totalAngle);
    const end: Point = {
      x: start.x + bone.length * dir.x,
      y: start.y + bone.length * dir.y,
    };

    visiting.delete(name);
    const result = { totalAngle, start, end };
    cache.set(name, result);
    return result;
  };

  const out = {} as ResolvedPose<Name>;
  for (const bone of skeleton) {
    const { start, end, totalAngle } = resolveBone(bone.name);
    out[bone.name] = { start, end, angle: totalAngle };
  }
  return out;
}
