import { describe, expect, it } from "vitest";
import { SKELETON } from "./skeleton";
import type { BoneName, Skeleton } from "./skeleton";
import { resolvePose, type Point } from "./pose";

const ORIGIN: Point = { x: 0, y: 0 };

const expectPoint = (actual: Point, expected: Point, precision = 9) => {
  expect(actual.x).toBeCloseTo(expected.x, precision);
  expect(actual.y).toBeCloseTo(expected.y, precision);
};

/**
 * Torso landmark heights, derived from SKELETON rather than written out.
 * Bone proportions are a style choice that gets tuned; what these tests pin
 * down is that the chain accumulates upward from the root, not the numbers.
 */
const len = (name: BoneName): number => {
  const bone = SKELETON.find((b) => b.name === name);
  if (!bone) throw new Error(`no bone named ${name}`);
  return bone.length;
};

describe("resolvePose — rest pose", () => {
  // Rest pose = empty pose (every bone at its restAngle, no extra rotation).
  // Root is pinned at the origin so the numbers below are the arithmetic
  // directly off SKELETON's restAngle/length values (see skeleton.ts for the
  // angle convention: 0 = up (0,-1), positive = clockwise on screen, i.e.
  // direction(theta) = (sin(theta), -cos(theta))).
  const resolved = resolvePose(SKELETON, {}, ORIGIN);

  it("pelvis: root, restAngle 0 (up), length 10 -> straight up from origin", () => {
    // direction(0) = (sin 0, -cos 0) = (0, -1)
    // end = (0,0) + 10*(0,-1) = (0,-10)
    expectPoint(resolved.pelvis.start, { x: 0, y: 0 });
    expectPoint(resolved.pelvis.end, { x: 0, y: -10 });
  });

  it("spine/neck/head continue straight up the torso chain", () => {
    // Each has restAngle 0 relative to its parent, whose total is already 0
    // (up), so every total angle in the torso chain is 0: they all just
    // stack upward (decreasing y) by their own length.
    const pelvisTop = -len("pelvis");
    const shoulder = pelvisTop - len("spine");
    const neckTop = shoulder - len("neck");
    const headTop = neckTop - len("head");
    expectPoint(resolved.spine.start, { x: 0, y: pelvisTop });
    expectPoint(resolved.spine.end, { x: 0, y: shoulder });
    expectPoint(resolved.neck.start, { x: 0, y: shoulder });
    expectPoint(resolved.neck.end, { x: 0, y: neckTop });
    expectPoint(resolved.head.start, { x: 0, y: neckTop });
    expectPoint(resolved.head.end, { x: 0, y: headTop });
  });

  it("arms hang straight down from the top of the spine", () => {
    // leftUpperArm: parent total 0 (spine), restAngle 180 -> total 180.
    // direction(180) = (sin 180, -cos 180) = (0, 1) [down], so each arm bone
    // adds its own length to y. Lengths are read from SKELETON rather than
    // written out, because arm proportions are a style choice that gets tuned
    // — what this test is actually pinning down is the direction and the
    // accumulation, not the numbers.
    const shoulder = -len("pelvis") - len("spine");
    const upper = len("leftUpperArm");
    const fore = len("leftForearm");
    expectPoint(resolved.leftUpperArm.start, { x: 0, y: shoulder });
    expectPoint(resolved.leftUpperArm.end, { x: 0, y: shoulder + upper });
    expectPoint(resolved.leftForearm.start, { x: 0, y: shoulder + upper });
    expectPoint(resolved.leftForearm.end, { x: 0, y: shoulder + upper + fore });

    // Right arm has identical rest angles, so it lands on the same points
    // (expected for a profile/side-on rig at rest: near and far limbs
    // overlap when standing neutrally).
    expectPoint(resolved.rightUpperArm.end, { x: 0, y: shoulder + upper });
    expectPoint(resolved.rightForearm.end, { x: 0, y: shoulder + upper + fore });
  });

  it("legs hang straight down from the pelvis end (0,-10), feet turn to point forward (+X)", () => {
    // leftThigh: parent total 0 (pelvis), restAngle 180 -> total 180 (down).
    // start (0,-10), end (0,-10+30) = (0,20).
    // leftShin: restAngle 0 -> total 180, continues down.
    // start (0,20), end (0,20+28) = (0,48).
    // leftFoot: restAngle -90 -> total 180-90=90.
    // direction(90) = (sin 90, -cos 90) = (1, 0) [+X, "forward"].
    // start (0,48), end (0+12, 48) = (12,48).
    expectPoint(resolved.leftThigh.start, { x: 0, y: -10 });
    expectPoint(resolved.leftThigh.end, { x: 0, y: 20 });
    expectPoint(resolved.leftShin.start, { x: 0, y: 20 });
    expectPoint(resolved.leftShin.end, { x: 0, y: 48 });
    expectPoint(resolved.leftFoot.start, { x: 0, y: 48 });
    expectPoint(resolved.leftFoot.end, { x: 12, y: 48 });

    // Right leg mirrors left at rest (side-on rig, both legs overlap when
    // standing straight).
    expectPoint(resolved.rightFoot.end, { x: 12, y: 48 });
  });

  it("root translation offsets the whole figure rigidly", () => {
    // Compare against the untranslated solve rather than absolute coordinates,
    // which makes this a test of rigidity itself: every point must move by
    // exactly the root offset, whatever the bone proportions happen to be.
    const shifted = resolvePose(SKELETON, {}, { x: 100, y: -200 });
    for (const { name } of SKELETON) {
      expectPoint(shifted[name].start, {
        x: resolved[name].start.x + 100,
        y: resolved[name].start.y - 200,
      });
      expectPoint(shifted[name].end, {
        x: resolved[name].end.x + 100,
        y: resolved[name].end.y - 200,
      });
    }
  });
});

describe("resolvePose — angle accumulation", () => {
  it("rotating a parent bone carries its children along with it (minimal 2-bone chain)", () => {
    const mini: Skeleton<"root" | "child"> = [
      { name: "root", parent: null, length: 10, restAngle: 0 },
      { name: "child", parent: "root", length: 5, restAngle: 0 },
    ];

    // Rotate root 90deg (pose angle on top of restAngle 0) -> total 90.
    // direction(90) = (1, 0). root end = (0,0)+10*(1,0) = (10,0).
    // child inherits parentTotal=90, restAngle 0, pose 0 -> total 90 too,
    // so it continues in the same rotated direction from the root's new
    // endpoint: start (10,0), end (10+5, 0) = (15, 0).
    const resolved = resolvePose(mini, { root: 90 }, ORIGIN);
    expectPoint(resolved.root.end, { x: 10, y: 0 });
    expectPoint(resolved.child.start, { x: 10, y: 0 });
    expectPoint(resolved.child.end, { x: 15, y: 0 });
    expect(resolved.child.angle).toBeCloseTo(90, 9);
  });

  it("rotating leftThigh carries leftShin and leftFoot with it, without changing their local (relative) shape", () => {
    const rest = resolvePose(SKELETON, {}, ORIGIN);
    const bent = resolvePose(SKELETON, { leftThigh: 30 }, ORIGIN);

    // The thigh's start point (hip) is unaffected by its own rotation.
    expectPoint(bent.leftThigh.start, rest.leftThigh.start);
    // But its end point (knee) has moved.
    expect(
      Math.hypot(
        bent.leftThigh.end.x - rest.leftThigh.end.x,
        bent.leftThigh.end.y - rest.leftThigh.end.y,
      ),
    ).toBeGreaterThan(1);

    // The shin's start point (knee) must have moved exactly to the thigh's
    // new end point — it is carried, not left behind.
    expectPoint(bent.leftShin.start, bent.leftThigh.end);
    // The shin and foot's own rest-relative shape is unchanged: shin total
    // angle should equal thigh total + shin restAngle (0), i.e. moved by
    // exactly the same 30deg as the thigh.
    expect(bent.leftShin.angle - rest.leftShin.angle).toBeCloseTo(30, 9);
    expect(bent.leftFoot.angle - rest.leftFoot.angle).toBeCloseTo(30, 9);

    // Untouched limbs (e.g. rightThigh) must be completely unaffected.
    expectPoint(bent.rightThigh.end, rest.rightThigh.end);
    expectPoint(bent.rightFoot.end, rest.rightFoot.end);
  });
});

describe("resolvePose — error handling", () => {
  it("throws on an unknown parent reference", () => {
    const broken: Skeleton<"a"> = [{ name: "a", parent: "missing" as "a", length: 1, restAngle: 0 }];
    expect(() => resolvePose(broken, {}, ORIGIN)).toThrow();
  });

  it("throws on a cyclic hierarchy instead of looping forever", () => {
    const cyclic: Skeleton<"a" | "b"> = [
      { name: "a", parent: "b", length: 1, restAngle: 0 },
      { name: "b", parent: "a", length: 1, restAngle: 0 },
    ];
    expect(() => resolvePose(cyclic, {}, ORIGIN)).toThrow(/cycle/i);
  });
});
