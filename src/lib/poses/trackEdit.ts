import { mirror } from "../figure/mirror";
import type { BoneName } from "../figure/skeleton";
import type { EasingName } from "../anim/easingRegistry";
import type { TrackDoc, TrackKeyframeDoc } from "./types";

/**
 * Editing operations on a keyframe track.
 *
 * Pure and immutable: every function returns a new TrackDoc and never mutates
 * its input. That is what makes undo/redo in the editor a matter of keeping a
 * stack of documents rather than implementing an inverse for each operation.
 *
 * Kept out of the editor UI deliberately — these are the operations that must
 * stay correct, so they live in the library where they can be unit-tested
 * without a browser. The UI should contain no track logic of its own.
 *
 * All functions maintain the invariant that keyframes are sorted ascending by
 * frame with no duplicates, because `parseTrackDoc` enforces it and
 * `interpolatePose` throws on an unsorted track.
 */

const sorted = (keyframes: TrackKeyframeDoc[]): TrackKeyframeDoc[] =>
  [...keyframes].sort((a, b) => a.frame - b.frame);

const withKeyframes = (doc: TrackDoc, keyframes: TrackKeyframeDoc[]): TrackDoc => ({
  ...doc,
  keyframes: sorted(keyframes),
});

export const keyframeAt = (doc: TrackDoc, frame: number): TrackKeyframeDoc | undefined =>
  doc.keyframes.find((kf) => kf.frame === frame);

/** Inserts a keyframe, replacing any existing one on the same frame. */
export const upsertKeyframe = (
  doc: TrackDoc,
  frame: number,
  pose: Record<string, number>,
  extra: Partial<Pick<TrackKeyframeDoc, "easing" | "label">> = {},
): TrackDoc => {
  const existing = keyframeAt(doc, frame);
  const next: TrackKeyframeDoc = {
    frame,
    pose,
    // An explicit undefined in `extra` should not wipe an existing value, so
    // spread the old keyframe first and let defined fields win.
    ...(existing?.easing !== undefined ? { easing: existing.easing } : {}),
    ...(existing?.label !== undefined ? { label: existing.label } : {}),
    ...(extra.easing !== undefined ? { easing: extra.easing } : {}),
    ...(extra.label !== undefined ? { label: extra.label } : {}),
  };
  return withKeyframes(doc, [...doc.keyframes.filter((kf) => kf.frame !== frame), next]);
};

/**
 * Removes a keyframe. Refuses to empty the track: a track with no keyframes
 * cannot be interpolated, and `parseTrackDoc` would reject it on the next load,
 * so failing here names the cause.
 */
export const removeKeyframe = (doc: TrackDoc, frame: number): TrackDoc => {
  const remaining = doc.keyframes.filter((kf) => kf.frame !== frame);
  if (remaining.length === 0) {
    throw new Error(`track "${doc.name}": cannot remove the last keyframe`);
  }
  return withKeyframes(doc, remaining);
};

/** Moves a keyframe to a new frame, replacing anything already there. */
export const moveKeyframe = (doc: TrackDoc, from: number, to: number): TrackDoc => {
  const kf = keyframeAt(doc, from);
  if (!kf) throw new Error(`track "${doc.name}": no keyframe at frame ${from}`);
  if (from === to) return doc;
  const others = doc.keyframes.filter((k) => k.frame !== from && k.frame !== to);
  return withKeyframes(doc, [...others, { ...kf, frame: to }]);
};

export const setEasing = (doc: TrackDoc, frame: number, easing: EasingName): TrackDoc => {
  const kf = keyframeAt(doc, frame);
  if (!kf) throw new Error(`track "${doc.name}": no keyframe at frame ${frame}`);
  return withKeyframes(doc, [...doc.keyframes.filter((k) => k.frame !== frame), { ...kf, easing }]);
};

/** Copies a keyframe's pose to another frame. */
export const duplicateKeyframe = (doc: TrackDoc, from: number, to: number): TrackDoc => {
  const kf = keyframeAt(doc, from);
  if (!kf) throw new Error(`track "${doc.name}": no keyframe at frame ${from}`);
  return upsertKeyframe(doc, to, { ...kf.pose }, { easing: kf.easing });
};

/** Sets one bone's angle on one keyframe — the drag-a-joint operation. */
export const setBoneAngle = (
  doc: TrackDoc,
  frame: number,
  bone: BoneName,
  angle: number,
): TrackDoc => {
  const kf = keyframeAt(doc, frame);
  if (!kf) throw new Error(`track "${doc.name}": no keyframe at frame ${frame}`);
  return upsertKeyframe(doc, frame, { ...kf.pose, [bone]: angle });
};

/**
 * Regenerates the second half of a cyclic track by mirroring the first half.
 *
 * This restores, as an on-demand operation, the property the walk cycle used to
 * get for free when it was code: only half a cycle is authored by hand, so the
 * two halves cannot drift out of step. Moving tracks to JSON materialised both
 * halves, which is what let the editor load them — this is the cost of that,
 * paid back as a button rather than as a constraint.
 *
 * Keyframes in the first half (frame < durationInFrames / 2) are copied to
 * frame + durationInFrames / 2 with left and right swapped. Anything already in
 * the second half is replaced. A keyframe exactly on the final frame is left
 * alone: it closes the loop and should match frame 0, not a mirror of it.
 */
export const mirrorSecondHalf = (doc: TrackDoc): TrackDoc => {
  const half = doc.durationInFrames / 2;
  if (!Number.isInteger(half)) {
    throw new Error(
      `track "${doc.name}": durationInFrames ${doc.durationInFrames} is odd, so it has no exact half to mirror`,
    );
  }
  const firstHalf = doc.keyframes.filter((kf) => kf.frame < half);
  const closing = doc.keyframes.filter((kf) => kf.frame === doc.durationInFrames);
  const mirrored = firstHalf.map((kf) => ({
    ...kf,
    frame: kf.frame + half,
    label: kf.label ? `${kf.label}-mirrored` : undefined,
    pose: mirror(kf.pose as Record<BoneName, number>) as Record<string, number>,
  }));
  return withKeyframes(doc, [...firstHalf, ...mirrored, ...closing]);
};
