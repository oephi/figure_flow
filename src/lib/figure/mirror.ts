import type { Pose } from "./pose";
import type { BoneName } from "./skeleton";

/**
 * Swaps every left-side bone with its right-side twin.
 *
 * Lives in the library rather than beside the walk data because both the
 * renderer and the pose editor need it: authoring half a cycle and mirroring
 * the rest is how a walk stays symmetrical, and the editor offers the same
 * operation as a button.
 */
export const mirror = (pose: Pose<BoneName>): Pose<BoneName> => {
  const out: Pose<BoneName> = {};
  for (const [k, v] of Object.entries(pose) as [BoneName, number][]) {
    const swapped = k.startsWith("left")
      ? (("right" + k.slice(4)) as BoneName)
      : k.startsWith("right")
        ? (("left" + k.slice(5)) as BoneName)
        : k;
    out[swapped] = v;
  }
  return out;
};
