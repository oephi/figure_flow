import { describe, expect, it } from "vitest";
import { SKELETON } from "./skeleton";

describe("SKELETON", () => {
  it("has exactly one root bone (parent === null)", () => {
    const roots = SKELETON.filter((b) => b.parent === null);
    expect(roots.map((b) => b.name)).toEqual(["pelvis"]);
  });

  it("every non-root bone's parent exists in the skeleton", () => {
    const names = new Set(SKELETON.map((b) => b.name));
    for (const bone of SKELETON) {
      if (bone.parent !== null) {
        expect(names.has(bone.parent)).toBe(true);
      }
    }
  });

  it("has no duplicate bone names", () => {
    const names = SKELETON.map((b) => b.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("has all positive bone lengths", () => {
    for (const bone of SKELETON) {
      expect(bone.length).toBeGreaterThan(0);
    }
  });

  it("contains the expected 14 bones (pelvis, spine, neck, head + 5 left/right pairs)", () => {
    const names = SKELETON.map((b) => b.name).sort();
    expect(names).toEqual(
      [
        "pelvis",
        "spine",
        "neck",
        "head",
        "leftUpperArm",
        "leftForearm",
        "rightUpperArm",
        "rightForearm",
        "leftThigh",
        "leftShin",
        "leftFoot",
        "rightThigh",
        "rightShin",
        "rightFoot",
      ].sort(),
    );
  });
});
