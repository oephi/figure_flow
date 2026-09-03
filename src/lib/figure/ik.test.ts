import { describe, expect, it } from "vitest";
import { SKELETON, type BoneName, type Skeleton } from "./skeleton";
import { resolvePose, type Point, type Pose } from "./pose";
import { solveTwoBoneIk, type Bend } from "./ik";

const ORIGIN: Point = { x: 0, y: 0 };
const BENDS: readonly Bend[] = [1, -1];

const dist = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);

const len = (name: BoneName): number => {
  const bone = SKELETON.find((b) => b.name === name);
  if (!bone) throw new Error(`no bone named ${name}`);
  return bone.length;
};

/**
 * Simple deterministic PRNG (mulberry32) rather than Math.random(), so a
 * failing seed is reproducible when debugging rather than flaking on rerun.
 */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("solveTwoBoneIk — the defining round-trip property", () => {
  // Solve, merge into a pose, resolve with the SAME resolvePose the renderer
  // uses, and check the lower bone's end lands on the target. This is the
  // property that actually matters: everything else is in service of this.
  const rand = mulberry32(12345);
  const chains: readonly [BoneName, BoneName][] = [
    ["leftUpperArm", "leftForearm"],
    ["rightUpperArm", "rightForearm"],
    ["leftThigh", "leftShin"],
    ["rightThigh", "rightShin"],
  ];

  it("lands on a large sample of random reachable targets, both bends, all four limbs, with and without a rotated base pose", () => {
    let checked = 0;
    for (const [upper, lower] of chains) {
      const upperLen = len(upper);
      const lowerLen = len(lower);
      const minReach = Math.abs(upperLen - lowerLen);
      const maxReach = upperLen + lowerLen;

      for (const basePose of [
        {} as Pose<BoneName>,
        // A rotated parent chain (leaned spine / rotated pelvis) so the
        // test actually exercises the parent-offset accounting, not just
        // the zero-rotation base case.
        { spine: 25, pelvis: -15 } as Pose<BoneName>,
      ]) {
        const root: Point = { x: 3, y: -7 };
        const baseline = resolvePose(SKELETON, basePose, root);
        const shoulder = baseline[upper].start;

        for (let i = 0; i < 60; i++) {
          // Sample distance strictly inside the reachable annulus (avoid the
          // exact boundary here — that is covered explicitly below — so
          // this loop is purely about the "ordinary" case).
          const t = 0.02 + rand() * 0.96;
          const r = minReach + t * (maxReach - minReach);
          const theta = rand() * 2 * Math.PI;
          const target: Point = {
            x: shoulder.x + Math.cos(theta) * r,
            y: shoulder.y + Math.sin(theta) * r,
          };

          for (const bend of BENDS) {
            const solved = solveTwoBoneIk({
              skeleton: SKELETON,
              pose: basePose,
              root,
              upper,
              lower,
              target,
              bend,
            });

            const merged: Pose<BoneName> = { ...basePose, [upper]: solved.upper, [lower]: solved.lower };
            const result = resolvePose(SKELETON, merged, root);

            expect(dist(result[lower].end, target)).toBeLessThan(1e-6);
            checked++;
          }
        }
      }
    }
    // Sanity-check the sweep actually ran what it claims: 4 limbs * 2 base
    // poses * 60 targets * 2 bends.
    expect(checked).toBe(4 * 2 * 60 * 2);
  });

  it("does not stretch or shrink either bone: start/end distances always equal bone length", () => {
    const root: Point = { x: 0, y: 0 };
    const pose: Pose<BoneName> = {};
    for (let i = 0; i < 40; i++) {
      const angle = rand() * 2 * Math.PI;
      const r = rand() * 80;
      const target: Point = { x: Math.cos(angle) * r, y: Math.sin(angle) * r };
      for (const bend of BENDS) {
        const solved = solveTwoBoneIk({
          skeleton: SKELETON,
          pose,
          root,
          upper: "leftUpperArm",
          lower: "leftForearm",
          target,
          bend,
        });
        const merged: Pose<BoneName> = {
          ...pose,
          leftUpperArm: solved.upper,
          leftForearm: solved.lower,
        };
        const result = resolvePose(SKELETON, merged, root);
        expect(dist(result.leftUpperArm.start, result.leftUpperArm.end)).toBeCloseTo(
          len("leftUpperArm"),
          9,
        );
        expect(dist(result.leftForearm.start, result.leftForearm.end)).toBeCloseTo(
          len("leftForearm"),
          9,
        );
      }
    }
  });
});

describe("solveTwoBoneIk — unreachable targets (outer limit)", () => {
  it("stretches straight toward a target beyond upperLength + lowerLength, tip stopping at full reach, without lengthening either bone", () => {
    const root: Point = ORIGIN;
    const pose: Pose<BoneName> = {};
    const maxReach = len("leftUpperArm") + len("leftForearm");
    const baseline = resolvePose(SKELETON, pose, root);
    const shoulder = baseline.leftUpperArm.start;

    for (const bend of BENDS) {
      const farTarget: Point = { x: shoulder.x + 10 * maxReach, y: shoulder.y };
      const solved = solveTwoBoneIk({
        skeleton: SKELETON,
        pose,
        root,
        upper: "leftUpperArm",
        lower: "leftForearm",
        target: farTarget,
        bend,
      });
      const merged: Pose<BoneName> = {
        ...pose,
        leftUpperArm: solved.upper,
        leftForearm: solved.lower,
      };
      const result = resolvePose(SKELETON, merged, root);

      // Tip stops at full reach along the aim direction, not at the
      // (unreachable) target itself.
      expect(dist(shoulder, result.leftForearm.end)).toBeCloseTo(maxReach, 6);
      // Bones did not lengthen to close the gap.
      expect(dist(result.leftUpperArm.start, result.leftUpperArm.end)).toBeCloseTo(
        len("leftUpperArm"),
        9,
      );
      expect(dist(result.leftForearm.start, result.leftForearm.end)).toBeCloseTo(
        len("leftForearm"),
        9,
      );
      // Straight: the chain is fully extended, so upper and lower point the
      // same world direction (the elbow is not bent at all).
      expect(result.leftForearm.angle).toBeCloseTo(result.leftUpperArm.angle, 6);
      // Result is finite, not NaN.
      expect(Number.isFinite(solved.upper)).toBe(true);
      expect(Number.isFinite(solved.lower)).toBe(true);
    }
  });
});

describe("solveTwoBoneIk — unreachable targets (inner dead zone)", () => {
  it("folds as tightly as possible toward a target closer than |upperLength - lowerLength|", () => {
    const root: Point = ORIGIN;
    const pose: Pose<BoneName> = {};
    const upperLen = len("leftThigh");
    const lowerLen = len("leftShin");
    const minReach = Math.abs(upperLen - lowerLen);
    expect(minReach).toBeGreaterThan(0); // otherwise this test proves nothing

    const baseline = resolvePose(SKELETON, pose, root);
    const hip = baseline.leftThigh.start;

    for (const bend of BENDS) {
      // Target strictly inside the dead zone, and — as a boundary case —
      // exactly ON the hip (zero-length aim vector).
      for (const target of [
        { x: hip.x + 0.3, y: hip.y },
        { x: hip.x, y: hip.y + 0.3 },
        hip,
      ]) {
        const solved = solveTwoBoneIk({
          skeleton: SKELETON,
          pose,
          root,
          upper: "leftThigh",
          lower: "leftShin",
          target,
          bend,
        });
        expect(Number.isFinite(solved.upper)).toBe(true);
        expect(Number.isFinite(solved.lower)).toBe(true);

        const merged: Pose<BoneName> = { ...pose, leftThigh: solved.upper, leftShin: solved.lower };
        const result = resolvePose(SKELETON, merged, root);

        // Closest approach possible is exactly minReach from the hip.
        expect(dist(hip, result.leftShin.end)).toBeCloseTo(minReach, 6);
        // Bones did not shrink to close the gap the other way.
        expect(dist(result.leftThigh.start, result.leftThigh.end)).toBeCloseTo(upperLen, 9);
        expect(dist(result.leftShin.start, result.leftShin.end)).toBeCloseTo(lowerLen, 9);
      }
    }
  });
});

describe("solveTwoBoneIk — the two-solution ambiguity", () => {
  it("bend=1 and bend=-1 both reach the same reachable target but bend the elbow to opposite sides", () => {
    const root: Point = ORIGIN;
    const pose: Pose<BoneName> = {};
    const baseline = resolvePose(SKELETON, pose, root);
    const shoulder = baseline.leftUpperArm.start;
    // A target that is reachable but not on the straight-arm line, so the
    // two solutions are genuinely distinct (not both degenerately straight).
    const target: Point = { x: shoulder.x + 20, y: shoulder.y + 30 };

    const solvedA = solveTwoBoneIk({
      skeleton: SKELETON,
      pose,
      root,
      upper: "leftUpperArm",
      lower: "leftForearm",
      target,
      bend: 1,
    });
    const solvedB = solveTwoBoneIk({
      skeleton: SKELETON,
      pose,
      root,
      upper: "leftUpperArm",
      lower: "leftForearm",
      target,
      bend: -1,
    });

    const resultA = resolvePose(
      SKELETON,
      { ...pose, leftUpperArm: solvedA.upper, leftForearm: solvedA.lower },
      root,
    );
    const resultB = resolvePose(
      SKELETON,
      { ...pose, leftUpperArm: solvedB.upper, leftForearm: solvedB.lower },
      root,
    );

    // Both reach the target.
    expect(dist(resultA.leftForearm.end, target)).toBeLessThan(1e-6);
    expect(dist(resultB.leftForearm.end, target)).toBeLessThan(1e-6);
    // But the elbow (upper bone's end) sits at genuinely different points —
    // this is the "elbow up" vs "elbow down" mirror, not the same solution
    // twice.
    expect(dist(resultA.leftUpperArm.end, resultB.leftUpperArm.end)).toBeGreaterThan(1);
  });

  it("is stable across the straight-arm line: does not flip which side the elbow is on as the target sweeps past it", () => {
    // With bend fixed, the elbow offset angle should vary continuously (no
    // sign flip / discontinuity) as the target sweeps through the direction
    // directly away from the shoulder.
    const root: Point = ORIGIN;
    const pose: Pose<BoneName> = {};
    const baseline = resolvePose(SKELETON, pose, root);
    const shoulder = baseline.leftUpperArm.start;
    const maxReach = len("leftUpperArm") + len("leftForearm");
    const r = maxReach * 0.6;

    const elbowPositions: Point[] = [];
    for (let deg = -20; deg <= 20; deg += 2) {
      const theta = (deg * Math.PI) / 180;
      // Sweep around "straight down" (a direction reachable at this radius).
      const target: Point = {
        x: shoulder.x + Math.sin(theta) * r,
        y: shoulder.y + Math.cos(theta) * r,
      };
      const solved = solveTwoBoneIk({
        skeleton: SKELETON,
        pose,
        root,
        upper: "leftUpperArm",
        lower: "leftForearm",
        target,
        bend: 1,
      });
      const result = resolvePose(
        SKELETON,
        { ...pose, leftUpperArm: solved.upper, leftForearm: solved.lower },
        root,
      );
      elbowPositions.push(result.leftUpperArm.end);
    }

    // Consecutive elbow positions should move a bounded, small amount per
    // 2-degree step; a flip would show up as a large jump.
    for (let i = 1; i < elbowPositions.length; i++) {
      expect(dist(elbowPositions[i - 1], elbowPositions[i])).toBeLessThan(5);
    }
  });
});

describe("solveTwoBoneIk — error handling", () => {
  it("throws if `lower` is not a direct child of `upper`", () => {
    expect(() =>
      solveTwoBoneIk({
        skeleton: SKELETON,
        pose: {},
        root: ORIGIN,
        upper: "leftUpperArm",
        lower: "leftShin",
        target: { x: 0, y: 0 },
        bend: 1,
      }),
    ).toThrow();
  });

  it("throws on an unknown bone name", () => {
    expect(() =>
      solveTwoBoneIk({
        skeleton: SKELETON,
        pose: {},
        root: ORIGIN,
        upper: "notABone" as BoneName,
        lower: "leftForearm",
        target: { x: 0, y: 0 },
        bend: 1,
      }),
    ).toThrow();
  });

  it("throws for a zero-length bone rather than dividing by zero", () => {
    const degenerate: Skeleton<"root" | "zero"> = [
      { name: "root", parent: null, length: 10, restAngle: 0 },
      { name: "zero", parent: "root", length: 0, restAngle: 0 },
    ];
    expect(() =>
      solveTwoBoneIk({
        skeleton: degenerate,
        pose: {},
        root: ORIGIN,
        upper: "root",
        lower: "zero",
        target: { x: 5, y: 5 },
        bend: 1,
      }),
    ).toThrow();
  });
});
