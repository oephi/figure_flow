import { describe, expect, it } from "vitest";
import { aimBoneAt } from "./aim";
import { resolvePose, type Point, type Pose } from "./pose";
import { SKELETON, type BoneName } from "./skeleton";

const ORIGIN: Point = { x: 0, y: 0 };
const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const len = (name: BoneName) => SKELETON.find((b) => b.name === name)!.length;

describe("aimBoneAt", () => {
  /**
   * The defining property: aim a bone at a target, apply the result, and the
   * bone must point AT the target — its end lands on the ray from its start
   * toward the target, at exactly its own length along it.
   */
  it("points the bone at the target across many directions, bones and base poses", () => {
    const bones: BoneName[] = ["leftThigh", "leftShin", "leftUpperArm", "spine", "leftFoot"];
    const basePoses: Pose<BoneName>[] = [
      {},
      { spine: 25, leftThigh: -40, leftShin: 30 },
      { spine: -70, leftUpperArm: 110, pelvis: 15 },
    ];
    let checked = 0;
    for (const bone of bones) {
      for (const basePose of basePoses) {
        for (let i = 0; i < 24; i++) {
          const theta = (i / 24) * Math.PI * 2;
          const target: Point = { x: Math.cos(theta) * 37, y: Math.sin(theta) * 37 };
          const angle = aimBoneAt({ skeleton: SKELETON, pose: basePose, root: ORIGIN, bone, target });
          const resolved = resolvePose(SKELETON, { ...basePose, [bone]: angle }, ORIGIN);
          const { start, end } = resolved[bone];

          // end must be colinear with start->target and at the bone's length.
          const toTarget = Math.hypot(target.x - start.x, target.y - start.y);
          const expected: Point = {
            x: start.x + ((target.x - start.x) / toTarget) * len(bone),
            y: start.y + ((target.y - start.y) / toTarget) * len(bone),
          };
          expect(dist(end, expected)).toBeLessThan(1e-9);
          checked++;
        }
      }
    }
    expect(checked).toBe(5 * 3 * 24);
  });

  it("never changes any bone's length", () => {
    const pose = aimBoneAt({
      skeleton: SKELETON,
      pose: { spine: 20 },
      root: ORIGIN,
      bone: "leftThigh",
      target: { x: 50, y: -30 },
    });
    const resolved = resolvePose(SKELETON, { spine: 20, leftThigh: pose }, ORIGIN);
    for (const bone of SKELETON) {
      expect(dist(resolved[bone.name].start, resolved[bone.name].end)).toBeCloseTo(bone.length, 9);
    }
  });

  it("carries children rigidly — aiming a thigh moves the shin and foot with it", () => {
    const before = resolvePose(SKELETON, {}, ORIGIN);
    const angle = aimBoneAt({
      skeleton: SKELETON,
      pose: {},
      root: ORIGIN,
      bone: "leftThigh",
      target: { x: 40, y: 10 },
    });
    const after = resolvePose(SKELETON, { leftThigh: angle }, ORIGIN);
    expect(dist(after.leftShin.end, before.leftShin.end)).toBeGreaterThan(1);
    // ...but the shin's angle RELATIVE to the thigh is untouched.
    expect(after.leftShin.angle - after.leftThigh.angle).toBeCloseTo(
      before.leftShin.angle - before.leftThigh.angle,
      9,
    );
  });

  it("accounts for the parent chain: the same target gives different pose angles under different spines", () => {
    const target: Point = { x: 30, y: -40 };
    const a = aimBoneAt({ skeleton: SKELETON, pose: { spine: 0 }, root: ORIGIN, bone: "leftUpperArm", target });
    const b = aimBoneAt({ skeleton: SKELETON, pose: { spine: 45 }, root: ORIGIN, bone: "leftUpperArm", target });
    expect(a).not.toBeCloseTo(b, 3);
    // Both must still land on target, which is the point of the correction.
    for (const [spine, angle] of [[0, a], [45, b]] as const) {
      const r = resolvePose(SKELETON, { spine, leftUpperArm: angle }, ORIGIN);
      const s = r.leftUpperArm.start;
      const toT = Math.hypot(target.x - s.x, target.y - s.y);
      expect(dist(r.leftUpperArm.end, {
        x: s.x + ((target.x - s.x) / toT) * len("leftUpperArm"),
        y: s.y + ((target.y - s.y) / toT) * len("leftUpperArm"),
      })).toBeLessThan(1e-9);
    }
  });

  it("leaves the bone alone when the target sits exactly on its start joint", () => {
    const resolved = resolvePose(SKELETON, { leftThigh: 33 }, ORIGIN);
    const angle = aimBoneAt({
      skeleton: SKELETON,
      pose: { leftThigh: 33 },
      root: ORIGIN,
      bone: "leftThigh",
      target: resolved.leftThigh.start,
    });
    expect(angle).toBe(33);
  });

  it("throws on an unknown bone", () => {
    expect(() =>
      aimBoneAt({ skeleton: SKELETON, pose: {}, root: ORIGIN, bone: "nope" as BoneName, target: ORIGIN }),
    ).toThrow(/unknown bone/);
  });
});
