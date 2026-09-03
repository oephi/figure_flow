import { describe, expect, it } from "vitest";
import { SKELETON, type BoneName } from "./skeleton";
import { resolvePose, type Point } from "./pose";
import { interpolatePose, easeInOutCubic, linear, type PoseKeyframe } from "./interpolate";

const ORIGIN: Point = { x: 0, y: 0 };
const distance = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);

describe("interpolatePose — boundaries and clamping", () => {
  const keyframes: PoseKeyframe<"leftThigh" | "rightThigh">[] = [
    { frame: 10, pose: { leftThigh: 0, rightThigh: 180 } },
    { frame: 20, pose: { leftThigh: 90, rightThigh: 90 }, easing: easeInOutCubic },
    { frame: 40, pose: { leftThigh: 180, rightThigh: 0 }, easing: linear },
  ];

  it("clamps to the first keyframe's pose before it starts", () => {
    expect(interpolatePose(keyframes, 0)).toEqual(keyframes[0].pose);
    expect(interpolatePose(keyframes, -100)).toEqual(keyframes[0].pose);
  });

  it("clamps to the last keyframe's pose after it ends", () => {
    expect(interpolatePose(keyframes, 40)).toEqual(keyframes[2].pose);
    expect(interpolatePose(keyframes, 1000)).toEqual(keyframes[2].pose);
  });

  it("is exact at every keyframe's own frame, including interior ones", () => {
    for (const kf of keyframes) {
      expect(interpolatePose(keyframes, kf.frame)).toEqual(kf.pose);
    }
  });

  it("is exact at an interior keyframe even when neighbouring poses have different bone sets", () => {
    // leftArm only appears in the middle keyframe; if the implementation
    // interpolated through t=0 instead of special-casing exact hits, this
    // could smuggle in a spurious leftArm: 0 that was never authored.
    const mixed: PoseKeyframe<"leftThigh" | "leftArm">[] = [
      { frame: 0, pose: { leftThigh: 0 } },
      { frame: 10, pose: { leftThigh: 45, leftArm: 20 } },
      { frame: 20, pose: { leftThigh: 90 } },
    ];
    expect(interpolatePose(mixed, 10)).toEqual({ leftThigh: 45, leftArm: 20 });
  });

  it("interpolates linearly partway through a segment", () => {
    const result = interpolatePose(keyframes, 30); // halfway between frame 20 and 40, linear easing
    expect(result.leftThigh).toBeCloseTo(135, 9); // 90 -> 180, halfway = 135
    expect(result.rightThigh).toBeCloseTo(45, 9); // 90 -> 0, halfway = 45
  });

  it("throws on an empty track", () => {
    expect(() => interpolatePose([], 0)).toThrow();
  });

  it("throws if the track is not sorted ascending by frame", () => {
    const unsorted: PoseKeyframe<"leftThigh">[] = [
      { frame: 10, pose: { leftThigh: 0 } },
      { frame: 0, pose: { leftThigh: 90 } },
    ];
    expect(() => interpolatePose(unsorted, 5)).toThrow();
  });
});

describe("interpolatePose — shortest-path angle wraparound", () => {
  it("interpolates 350deg -> 10deg via +20deg (through 360/0), not the long way via 180", () => {
    const track: PoseKeyframe<"leftThigh">[] = [
      { frame: 0, pose: { leftThigh: 350 } },
      { frame: 10, pose: { leftThigh: 10 } },
    ];
    const halfway = interpolatePose(track, 5).leftThigh!;
    // Expected: 350 + 20*0.5 = 360, i.e. numerically equivalent to 0deg —
    // NOT 350 + (-340)*0.5 = 180, which is what naive (non-wraparound)
    // linear interpolation would produce.
    const normalized = ((halfway % 360) + 360) % 360;
    expect(normalized).toBeCloseTo(0, 9);
    expect(halfway).not.toBeCloseTo(180, 0);
  });

  it("interpolates 10deg -> 350deg via -20deg (through 0/360), the mirror-image case", () => {
    const track: PoseKeyframe<"leftThigh">[] = [
      { frame: 0, pose: { leftThigh: 10 } },
      { frame: 10, pose: { leftThigh: 350 } },
    ];
    const halfway = interpolatePose(track, 5).leftThigh!;
    // Expected: 10 + (-20)*0.5 = 0.
    const normalized = ((halfway % 360) + 360) % 360;
    expect(normalized).toBeCloseTo(0, 9);
    expect(halfway).not.toBeCloseTo(180, 0);
  });

  it("takes the short way even over a full-body pose with several wrapping bones at once", () => {
    const track: PoseKeyframe<"leftThigh" | "rightThigh" | "leftUpperArm">[] = [
      { frame: 0, pose: { leftThigh: 355, rightThigh: 5, leftUpperArm: 179 } },
      { frame: 10, pose: { leftThigh: 5, rightThigh: 355, leftUpperArm: -179 } },
    ];
    const mid = interpolatePose(track, 5);
    // leftThigh: 355 -> 5 is +10 the short way (through 0), landing at 360 (~0).
    expect(((mid.leftThigh! % 360) + 360) % 360).toBeCloseTo(0, 9);
    // rightThigh: 5 -> 355 is -10 the short way, landing at 0.
    expect(((mid.rightThigh! % 360) + 360) % 360).toBeCloseTo(0, 9);
    // leftUpperArm: 179 -> -179 is only 2deg apart the short way (through 180),
    // not 358deg the long way. Landing point ~180 (or equivalently -180).
    const normalizedArm = ((mid.leftUpperArm! % 360) + 360) % 360;
    expect(normalizedArm).toBeCloseTo(180, 0);
  });
});

describe("interpolatePose + resolvePose — bone length invariance", () => {
  // This is the regression test for the single most important correctness
  // property of this module: interpolation must operate on ANGLES, never
  // positions. If someone "optimises" interpolatePose to tween resolved
  // (x, y) points instead, every bone whose start/end aren't collinear with
  // its neighbours at every sampled frame will visibly change length. We
  // sample densely across a segment (including a wraparound case) and
  // assert every bone's resolved length matches its declared length at
  // every single frame.
  const allBoneNames = SKELETON.map((b) => b.name) as BoneName[];
  const boneLength = new Map(SKELETON.map((b) => [b.name, b.length]));

  const keyframeA: PoseKeyframe<BoneName> = {
    frame: 0,
    pose: {
      leftThigh: 350,
      rightThigh: 10,
      leftShin: 40,
      rightShin: -30,
      leftFoot: 5,
      rightFoot: -70,
      leftUpperArm: 179,
      rightUpperArm: -150,
      leftForearm: 60,
      rightForearm: -45,
      spine: 15,
      neck: -10,
      head: 20,
    },
  };
  const keyframeB: PoseKeyframe<BoneName> = {
    frame: 30,
    pose: {
      leftThigh: 10, // wraps 350 -> 10 the short way
      rightThigh: 350, // wraps 10 -> 350 the short way
      leftShin: -40,
      rightShin: 30,
      leftFoot: 175,
      rightFoot: -175, // near 180 wraparound
      leftUpperArm: -170, // near-antipodal to 179, forces a wrap decision
      rightUpperArm: 150,
      leftForearm: -60,
      rightForearm: 45,
      spine: -15,
      neck: 10,
      head: -20,
    },
    easing: easeInOutCubic,
  };
  const track = [keyframeA, keyframeB];

  it("preserves every bone's declared length across densely sampled interpolated frames", () => {
    const root: Point = { x: 3, y: -7 }; // arbitrary non-origin root translation
    for (let frame = 0; frame <= 30; frame++) {
      const pose = interpolatePose(track, frame);
      const resolved = resolvePose(SKELETON, pose, root);
      for (const name of allBoneNames) {
        const seg = resolved[name];
        const actualLength = distance(seg.start, seg.end);
        expect(
          actualLength,
          `frame ${frame}, bone "${name}": expected length ${boneLength.get(name)}, got ${actualLength}`,
        ).toBeCloseTo(boneLength.get(name)!, 9);
      }
    }
  });

  it("also holds for fractional (sub-frame) sampling", () => {
    const root: Point = ORIGIN;
    for (const frame of [0.5, 4.25, 12.75, 20.1, 29.9]) {
      const pose = interpolatePose(track, frame);
      const resolved = resolvePose(SKELETON, pose, root);
      for (const name of allBoneNames) {
        const seg = resolved[name];
        expect(distance(seg.start, seg.end)).toBeCloseTo(boneLength.get(name)!, 9);
      }
    }
  });
});
