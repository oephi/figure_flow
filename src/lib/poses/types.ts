import { EASINGS, isEasingName, type EasingName } from "../anim/easingRegistry";
import type { PoseKeyframe } from "../figure/interpolate";
import type { Pose } from "../figure/pose";
import { SKELETON, type BoneName } from "../figure/skeleton";

/**
 * On-disk format for poses and animations.
 *
 * Poses used to live in TypeScript modules, which meant only code could author
 * them. Moving them to JSON makes the pipeline two-way: a pose can be generated
 * from a description, opened in the editor, dragged into shape, and written back
 * to the same file. Nothing in the chain is one-directional.
 */

/** Bumped only on a breaking change, so an old file fails loudly not silently. */
export const POSE_FORMAT_VERSION = 1;

export interface PoseDoc {
  version: number;
  name: string;
  description?: string;
  /** Bone name -> angle in degrees, relative to that bone's rest angle. */
  pose: Record<string, number>;
}

export interface TrackKeyframeDoc {
  frame: number;
  pose: Record<string, number>;
  /** Easing into this keyframe. See the easing registry. */
  easing?: EasingName;
  /** Free-text note such as "contact" — preserved through editor round-trips. */
  label?: string;
}

export interface TrackDoc {
  version: number;
  name: string;
  description?: string;
  fps: number;
  durationInFrames: number;
  keyframes: TrackKeyframeDoc[];
}

const BONE_NAMES = new Set<string>(SKELETON.map((b) => b.name));

/**
 * Converts a raw pose record into a typed Pose, rejecting unknown bone names.
 *
 * This check matters more than it looks. A missing bone defaults to 0, which is
 * the rest angle — so a misspelled bone name would apply no rotation and be
 * completely invisible in the output. Failing loudly here turns a silent visual
 * bug into an error at load.
 */
export const toPose = (raw: Record<string, number>, context: string): Pose<BoneName> => {
  const out: Pose<BoneName> = {};
  for (const [name, angle] of Object.entries(raw)) {
    if (!BONE_NAMES.has(name)) {
      throw new Error(
        `${context}: unknown bone "${name}". Known bones: ${[...BONE_NAMES].join(", ")}`,
      );
    }
    if (typeof angle !== "number" || !Number.isFinite(angle)) {
      throw new Error(`${context}: bone "${name}" has non-finite angle ${String(angle)}`);
    }
    out[name as BoneName] = angle;
  }
  return out;
};

export const parsePoseDoc = (value: unknown, context = "pose"): PoseDoc => {
  const doc = value as PoseDoc;
  if (!doc || typeof doc !== "object") throw new Error(`${context}: not an object`);
  if (doc.version !== POSE_FORMAT_VERSION) {
    throw new Error(`${context}: unsupported version ${String(doc.version)}`);
  }
  if (typeof doc.name !== "string" || !doc.name) throw new Error(`${context}: missing name`);
  if (!doc.pose || typeof doc.pose !== "object") throw new Error(`${context}: missing pose`);
  toPose(doc.pose, `${context} "${doc.name}"`); // validate eagerly
  return doc;
};

export const parseTrackDoc = (value: unknown, context = "track"): TrackDoc => {
  const doc = value as TrackDoc;
  if (!doc || typeof doc !== "object") throw new Error(`${context}: not an object`);
  if (doc.version !== POSE_FORMAT_VERSION) {
    throw new Error(`${context}: unsupported version ${String(doc.version)}`);
  }
  if (!Array.isArray(doc.keyframes) || doc.keyframes.length === 0) {
    throw new Error(`${context}: needs at least one keyframe`);
  }
  let previous = -Infinity;
  for (const kf of doc.keyframes) {
    if (typeof kf.frame !== "number") throw new Error(`${context}: keyframe missing frame`);
    // interpolatePose() requires ascending order and throws otherwise; catching
    // it here names the file instead of failing deep inside a render.
    if (kf.frame <= previous) {
      throw new Error(`${context} "${doc.name}": keyframes must ascend by frame (saw ${kf.frame} after ${previous})`);
    }
    previous = kf.frame;
    if (kf.easing !== undefined && !isEasingName(kf.easing)) {
      throw new Error(`${context} "${doc.name}": unknown easing "${String(kf.easing)}"`);
    }
    toPose(kf.pose, `${context} "${doc.name}" frame ${kf.frame}`);
  }
  return doc;
};

/** Resolves a validated TrackDoc into the keyframes `interpolatePose` expects. */
export const toKeyframes = (doc: TrackDoc): PoseKeyframe<BoneName>[] =>
  doc.keyframes.map((kf) => ({
    frame: kf.frame,
    pose: toPose(kf.pose, `track "${doc.name}" frame ${kf.frame}`),
    easing: kf.easing ? EASINGS[kf.easing] : undefined,
  }));

/** Loads a pose straight from an imported JSON module. */
export const loadPose = (value: unknown, context?: string): Pose<BoneName> => {
  const doc = parsePoseDoc(value, context);
  return toPose(doc.pose, doc.name);
};

/** Loads a track straight from an imported JSON module. */
export const loadTrack = (value: unknown, context?: string): PoseKeyframe<BoneName>[] =>
  toKeyframes(parseTrackDoc(value, context));
