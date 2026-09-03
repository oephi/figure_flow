import { describe, expect, it } from "vitest";
import { parseTrackDoc, POSE_FORMAT_VERSION, type TrackDoc } from "./types";
import {
  duplicateKeyframe,
  keyframeAt,
  mirrorSecondHalf,
  moveKeyframe,
  removeKeyframe,
  setBoneAngle,
  setEasing,
  upsertKeyframe,
} from "./trackEdit";

const track = (): TrackDoc => ({
  version: POSE_FORMAT_VERSION,
  name: "test",
  fps: 30,
  durationInFrames: 24,
  keyframes: [
    { frame: 0, label: "a", pose: { leftThigh: 10, rightThigh: -10 } },
    { frame: 6, pose: { leftThigh: 20, rightThigh: -20 }, easing: "easeInOut" },
    { frame: 24, label: "close", pose: { leftThigh: 10, rightThigh: -10 } },
  ],
});

/** Every operation must leave a doc that parseTrackDoc still accepts. */
const expectValid = (doc: TrackDoc) => {
  expect(() => parseTrackDoc(doc)).not.toThrow();
  return doc;
};

describe("trackEdit — immutability", () => {
  it("never mutates the input document", () => {
    const original = track();
    const snapshot = JSON.stringify(original);
    upsertKeyframe(original, 12, { leftThigh: 5 });
    removeKeyframe(original, 6);
    moveKeyframe(original, 6, 9);
    setEasing(original, 6, "linear");
    setBoneAngle(original, 0, "leftShin", 42);
    mirrorSecondHalf(original);
    expect(JSON.stringify(original)).toBe(snapshot);
  });
});

describe("trackEdit — ordering invariant", () => {
  it("keeps keyframes sorted after an out-of-order insert", () => {
    const doc = expectValid(upsertKeyframe(track(), 3, { leftThigh: 15 }));
    expect(doc.keyframes.map((k) => k.frame)).toEqual([0, 3, 6, 24]);
  });

  it("keeps keyframes sorted after a move that jumps position", () => {
    const doc = expectValid(moveKeyframe(track(), 6, 20));
    expect(doc.keyframes.map((k) => k.frame)).toEqual([0, 20, 24]);
  });
});

describe("trackEdit — upsert", () => {
  it("replaces the pose on an existing frame rather than duplicating it", () => {
    const doc = expectValid(upsertKeyframe(track(), 6, { leftThigh: 99 }));
    expect(doc.keyframes.filter((k) => k.frame === 6)).toHaveLength(1);
    expect(keyframeAt(doc, 6)?.pose).toEqual({ leftThigh: 99 });
  });

  it("preserves an existing easing and label when not overridden", () => {
    const doc = upsertKeyframe(track(), 6, { leftThigh: 99 });
    expect(keyframeAt(doc, 6)?.easing).toBe("easeInOut");
    expect(keyframeAt(upsertKeyframe(track(), 0, {}), 0)?.label).toBe("a");
  });
});

describe("trackEdit — removal guards", () => {
  it("refuses to remove the last keyframe, which would make the track unusable", () => {
    let doc = removeKeyframe(track(), 6);
    doc = removeKeyframe(doc, 24);
    expect(() => removeKeyframe(doc, 0)).toThrow(/last keyframe/);
  });

  it("throws when addressing a frame that has no keyframe", () => {
    expect(() => moveKeyframe(track(), 5, 7)).toThrow(/no keyframe/);
    expect(() => setEasing(track(), 5, "linear")).toThrow(/no keyframe/);
    expect(() => setBoneAngle(track(), 5, "leftThigh", 0)).toThrow(/no keyframe/);
  });
});

describe("trackEdit — setBoneAngle", () => {
  it("changes one bone and leaves the rest of the pose alone", () => {
    const doc = expectValid(setBoneAngle(track(), 6, "leftShin", 42));
    expect(keyframeAt(doc, 6)?.pose).toEqual({ leftThigh: 20, rightThigh: -20, leftShin: 42 });
  });
});

describe("trackEdit — duplicate", () => {
  it("copies the pose by value, so editing the copy leaves the source untouched", () => {
    let doc = expectValid(duplicateKeyframe(track(), 0, 12));
    doc = setBoneAngle(doc, 12, "leftThigh", 77);
    expect(keyframeAt(doc, 12)?.pose.leftThigh).toBe(77);
    expect(keyframeAt(doc, 0)?.pose.leftThigh).toBe(10);
  });
});

describe("trackEdit — mirrorSecondHalf", () => {
  it("regenerates the back half with left and right swapped", () => {
    const doc = expectValid(mirrorSecondHalf(track()));
    // frames 0 and 6 are the authored half; 12 and 18 are their mirrors.
    expect(doc.keyframes.map((k) => k.frame)).toEqual([0, 6, 12, 18, 24]);
    expect(keyframeAt(doc, 12)?.pose).toEqual({ rightThigh: 10, leftThigh: -10 });
    expect(keyframeAt(doc, 18)?.pose).toEqual({ rightThigh: 20, leftThigh: -20 });
  });

  it("leaves the closing keyframe alone, since it matches frame 0 rather than its mirror", () => {
    const doc = mirrorSecondHalf(track());
    expect(keyframeAt(doc, 24)?.pose).toEqual(keyframeAt(doc, 0)?.pose);
    expect(keyframeAt(doc, 24)?.label).toBe("close");
  });

  it("is idempotent — mirroring twice changes nothing further", () => {
    const once = mirrorSecondHalf(track());
    expect(mirrorSecondHalf(once)).toEqual(once);
  });

  it("refuses an odd duration, which has no exact half", () => {
    expect(() => mirrorSecondHalf({ ...track(), durationInFrames: 25 })).toThrow(/odd/);
  });
});

describe("trackEdit — matches the real walk track", () => {
  it("reproduces walk.json's mirrored half from its authored half", async () => {
    const walk = parseTrackDoc(
      (await import("../../../poses/tracks/walk.json")).default,
      "walk.json",
    );
    const regenerated = mirrorSecondHalf(walk);
    // This is the property the walk cycle had when it was code: the second half
    // IS the mirror of the first. If this fails, the two halves have drifted.
    for (const frame of [12, 15, 18, 21]) {
      expect(keyframeAt(regenerated, frame)?.pose).toEqual(keyframeAt(walk, frame)?.pose);
    }
  });
});
