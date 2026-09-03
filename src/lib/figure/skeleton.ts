/**
 * The bone hierarchy for a featureless 2D humanoid figure, as pure data.
 *
 * This file has NO behaviour — it just describes bone names, parent/child
 * relationships, bone lengths, and rest angles. `pose.ts` walks this data to
 * produce actual 2D coordinates (forward kinematics); `interpolate.ts` tweens
 * angles between keyframes. Keeping the hierarchy as inert data means the
 * whole rig can be described, tested, and (eventually) re-authored without
 * touching any maths.
 *
 * ---------------------------------------------------------------------------
 * ANGLE CONVENTION (read this before touching restAngle or any pose angle)
 * ---------------------------------------------------------------------------
 *
 * All angles in this module are DEGREES.
 *
 * Screen-space / SVG coordinates are assumed throughout: +X is right, +Y is
 * DOWN the screen (the classic sign-error trap — most people's mental model
 * of "up" is -Y here, not +Y).
 *
 * We define:
 *
 *   0 degrees   = pointing straight UP the screen, i.e. the local direction
 *                 vector (0, -1) before any rotation is applied.
 *   +90 degrees = pointing right (+X).
 *   +180 degrees = pointing straight down the screen (+Y).
 *   +270 degrees = pointing left (-X).
 *
 * i.e. positive angles sweep CLOCKWISE as viewed on screen: up -> right ->
 * down -> left, like the hands of a clock starting at 12.
 *
 * Why "0 = up" rather than "0 = down" or "0 = right"? Because the torso chain
 * (pelvis -> spine -> neck -> head) points up the screen at rest, and giving
 * it restAngle 0 all the way up the chain means the main skeleton reads as
 * "no rotation" in the data, which is the easiest case to eyeball and test.
 * Limbs, which hang down at rest, end up with restAngle ~180 instead — the
 * asymmetry is deliberate, not an oversight.
 *
 * The rotation itself uses the ordinary 2D rotation matrix
 *   [ cos(theta)  -sin(theta) ]
 *   [ sin(theta)   cos(theta) ]
 * applied directly to screen X/Y (no separate Y-flip anywhere). Applying that
 * matrix to the reference vector (0, -1) gives the direction vector actually
 * used in pose.ts:
 *
 *   direction(theta) = (sin(theta), -cos(theta))
 *
 * You can sanity-check the "clockwise" claim from this formula alone:
 * theta=0 -> (0,-1) [up], theta=90 -> (1,0) [right], theta=180 -> (0,1)
 * [down], theta=270 -> (-1,0) [left]. That is 12 -> 3 -> 6 -> 9 o'clock,
 * which is clockwise on a normally-oriented screen. Nothing is flipped to
 * "correct for" Y-down; the matrix is used as-is, and Y-down is exactly what
 * makes the standard CCW-positive matrix read as CW-positive visually. This
 * is the one fact downstream rendering code needs to internalise: do not
 * negate angles "to fix" the Y axis, they are already correct for SVG.
 *
 * A bone's TOTAL angle (used to compute its endpoint) is:
 *
 *   total(bone) = total(bone.parent) + bone.restAngle + pose[bone.name]
 *
 * with total(root) = root's own restAngle + pose[root.name] (no parent to
 * add). Angles accumulate strictly down the chain: rotating a thigh's pose
 * angle rotates its whole subtree (shin, foot) with it, for free, because
 * the shin and foot's totals both add the thigh's total as a base. See
 * pose.ts for the actual walk.
 *
 * ---------------------------------------------------------------------------
 * VIEW / LATERALITY
 * ---------------------------------------------------------------------------
 *
 * This is a side-on (profile) figure, not a front-on one: at rest, both legs
 * hang straight down and overlap (as they would viewed from the side), and
 * both feet point the same way along +X ("forward", i.e. the character
 * faces screen-right). "left" and "right" in bone names are near/far limbs
 * for independent contralateral animation (e.g. a walk cycle drives
 * leftThigh and rightThigh with opposite phase), not anatomical
 * screen-left/screen-right of a front-facing figure. A renderer wanting a
 * front-on figure can still use this rig; it will just need different rest
 * angles (that's a pose concern, not a skeleton concern).
 *
 * ---------------------------------------------------------------------------
 * HIERARCHY
 * ---------------------------------------------------------------------------
 *
 * pelvis (root)
 *  |- spine
 *  |   |- neck
 *  |   |   `- head
 *  |   |- leftUpperArm
 *  |   |   `- leftForearm
 *  |   `- rightUpperArm
 *  |       `- rightForearm
 *  |- leftThigh
 *  |   `- leftShin
 *  |       `- leftFoot
 *  `- rightThigh
 *      `- rightShin
 *          `- rightFoot
 *
 * The pelvis is a short root segment from the rig's translation origin
 * (`root` in pose.ts, e.g. ground/hip anchor) up to a single waist/shoulder
 * junction point. Both the spine and both thighs radiate from wherever the
 * pelvis's own rotation happens to put that point — this is a deliberate
 * simplification (a real hip is a horizontal span, not a point) that keeps
 * the rig a single chain-of-chains, which is all 2D FK needs.
 *
 * Similarly, the arms hang off the TOP of the spine (the same point the neck
 * starts from), standing in for "shoulder height", rather than off a
 * separate shoulder bone. Good enough for a featureless outline figure.
 */

export interface Bone<Name extends string = string> {
  /** Unique bone identifier. */
  readonly name: Name;
  /** Parent bone name, or null for the (single) root bone. */
  readonly parent: Name | null;
  /** Bone length in abstract units. Must be >= 0. */
  readonly length: number;
  /**
   * Rest angle in degrees, relative to the parent's total angle (see the
   * angle convention above). For the root bone this is relative to nothing
   * (parent total is implicitly 0), so it is an absolute angle.
   */
  readonly restAngle: number;
}

export type Skeleton<Name extends string = string> = readonly Bone<Name>[];

/**
 * The bone data itself. Declared as a plain array literal (not yet exported)
 * so that `BoneName` below can be derived from its literal `name` values via
 * `typeof`, and then re-asserted as `Skeleton<BoneName>` — this gets us a
 * closed union of valid bone names without hand-writing it twice.
 */
const SKELETON_DATA = [
  // --- torso chain: restAngle 0 all the way, i.e. "points up, no extra
  // --- rotation" at rest. ---
  { name: "pelvis", parent: null, length: 10, restAngle: 0 },
  { name: "spine", parent: "pelvis", length: 34, restAngle: 0 },
  { name: "neck", parent: "spine", length: 8, restAngle: 0 },
  { name: "head", parent: "neck", length: 15, restAngle: 0 },

  // --- arms: hang straight down (180) from the top of the spine at rest.
  { name: "leftUpperArm", parent: "spine", length: 31, restAngle: 180 },
  { name: "leftForearm", parent: "leftUpperArm", length: 27, restAngle: 0 },
  { name: "rightUpperArm", parent: "spine", length: 31, restAngle: 180 },
  { name: "rightForearm", parent: "rightUpperArm", length: 27, restAngle: 0 },

  // --- legs: hang straight down (180) from the pelvis at rest.
  { name: "leftThigh", parent: "pelvis", length: 30, restAngle: 180 },
  { name: "leftShin", parent: "leftThigh", length: 28, restAngle: 0 },
  // Foot: shin points down (total 180); a standing foot is roughly
  // horizontal, pointing "forward" along +X (total 90). -90 gets it there:
  // 180 + (-90) = 90.
  { name: "leftFoot", parent: "leftShin", length: 12, restAngle: -90 },
  { name: "rightThigh", parent: "pelvis", length: 30, restAngle: 180 },
  { name: "rightShin", parent: "rightThigh", length: 28, restAngle: 0 },
  { name: "rightFoot", parent: "rightShin", length: 12, restAngle: -90 },
] as const satisfies readonly {
  name: string;
  parent: string | null;
  length: number;
  restAngle: number;
}[];

/** Union of every valid bone name in {@link SKELETON}. */
export type BoneName = (typeof SKELETON_DATA)[number]["name"];

/** The rig: pelvis (root), spine/neck/head, and left/right arm and leg chains. */
export const SKELETON: Skeleton<BoneName> = SKELETON_DATA;
