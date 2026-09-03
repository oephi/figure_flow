import { normalizeAngle } from "./angle";
import { resolvePose, type Point, type Pose } from "./pose";
import type { Skeleton } from "./skeleton";

/**
 * Direct joint rotation: the angle that points a single bone at a target.
 *
 * This is the counterpart to `solveTwoBoneIk`. Dragging a joint has two useful
 * meanings and the editor offers both:
 *
 *   - AIM (this function): rotate exactly one bone so its far end follows the
 *     pointer. Children come along rigidly. Predictable, and the right default
 *     — grabbing a knee should bend that leg, not silently reshape the hip.
 *   - IK (`ik.ts`): drag a hand or foot and let two bones bend to reach it.
 *     Better for placing an extremity, worse for control.
 */

export interface AimInput<Name extends string> {
  skeleton: Skeleton<Name>;
  pose: Pose<Name>;
  root: Point;
  bone: Name;
  /** Where the bone's far end should point, in resolvePose's coordinate space. */
  target: Point;
}

/**
 * Returns the pose angle (relative to rest) that aims `bone` at `target`.
 *
 * Two conversions to get right, and both are easy to invert by accident:
 *
 * 1. The angle convention is 0 = up, positive = clockwise, with
 *    `direction(theta) = (sin theta, -cos theta)`. Recovering an angle from a
 *    vector is therefore `atan2(dx, -dy)` — NOT the conventional
 *    `atan2(dy, dx)`. See the comment block in skeleton.ts.
 * 2. A pose angle is relative to the bone's rest angle AND its parent's
 *    accumulated total, so
 *    `pose = totalWanted - parentTotal - restAngle`.
 *
 * Bone lengths are never touched, so limb-length invariance holds by
 * construction: this only ever changes an angle.
 */
export const aimBoneAt = <Name extends string>({
  skeleton,
  pose,
  root,
  bone,
  target,
}: AimInput<Name>): number => {
  const definition = skeleton.find((b) => b.name === bone);
  if (!definition) throw new Error(`aimBoneAt: unknown bone "${bone}"`);

  // Resolve the CURRENT pose to find where this bone starts and what its parent's
  // total angle is. Reusing resolvePose rather than recomputing forward kinematics
  // means this can never disagree with the renderer about the joint's position.
  const resolved = resolvePose(skeleton, pose, root);
  const start = resolved[bone].start;

  const dx = target.x - start.x;
  const dy = target.y - start.y;
  // A target exactly on the joint gives no direction; leave the bone as it is
  // rather than snapping it to an arbitrary angle mid-drag.
  if (dx === 0 && dy === 0) return pose[bone] ?? 0;

  const totalWanted = (Math.atan2(dx, -dy) * 180) / Math.PI;
  const parentTotal = definition.parent === null ? 0 : resolved[definition.parent].angle;

  return normalizeAngle(totalWanted - parentTotal - definition.restAngle);
};
