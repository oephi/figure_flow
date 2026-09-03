/**
 * Discovers every pose and track under `poses/` and validates each one.
 *
 * Uses Vite's `import.meta.glob` with `eager: true` rather than a hand-written
 * list of imports. That keeps the property the hand-written list was there for
 * — the JSON is bundled and parsed at build time, so a malformed file fails
 * immediately rather than at runtime — while removing the need to edit this
 * file every time a pose is added. Drop a JSON into poses/ and it appears.
 *
 * `path` on each entry is relative to `poses/` and doubles as the argument to
 * POST /api/save — see editor/lib/api.ts.
 */
import {
  parsePoseDoc,
  parseTrackDoc,
  toKeyframes,
  toPose,
  type PoseDoc,
  type TrackDoc,
} from "../../src/lib/poses/types";
import type { Pose } from "../../src/lib/figure/pose";
import type { BoneName } from "../../src/lib/figure/skeleton";
import type { PoseKeyframe } from "../../src/lib/figure/interpolate";

export interface PoseEntry {
  readonly kind: "pose";
  readonly id: string;
  /** Relative to poses/, e.g. "library/stand.json". Also the save path. */
  readonly path: string;
  readonly doc: PoseDoc;
}

export interface TrackEntry {
  readonly kind: "track";
  readonly id: string;
  readonly path: string;
  readonly doc: TrackDoc;
}

export type LibraryEntry = PoseEntry | TrackEntry;

/** A track has keyframes; a pose has a single pose. That is the whole difference. */
const looksLikeTrack = (value: unknown): boolean =>
  typeof value === "object" && value !== null && "keyframes" in value;

export const entryFromDoc = (value: unknown, path: string): LibraryEntry =>
  looksLikeTrack(value)
    ? { kind: "track", id: path, path, doc: parseTrackDoc(value, path) }
    : { kind: "pose", id: path, path, doc: parsePoseDoc(value, path) };

const modules = import.meta.glob<{ default: unknown }>("../../poses/**/*.json", {
  eager: true,
});

/**
 * Every pose/track on disk, sorted so tracks group after poses and each group
 * is alphabetical — a stable order, so the sidebar does not reshuffle when a
 * file is added.
 */
export const discoverLibrary = (): LibraryEntry[] =>
  Object.entries(modules)
    .map(([absolute, mod]) => {
      const path = absolute.replace("../../poses/", "");
      return entryFromDoc((mod as { default: unknown }).default, path);
    })
    .sort((a, b) =>
      a.kind === b.kind ? a.path.localeCompare(b.path) : a.kind === "pose" ? -1 : 1,
    );

/** The typed, rest-relative angle pose for a PoseEntry's raw doc. */
export const poseFromEntry = (entry: PoseEntry): Pose<BoneName> =>
  toPose(entry.doc.pose, entry.doc.name);

/** The interpolatable keyframe track for a TrackEntry's raw doc. */
export const keyframesFromEntry = (entry: TrackEntry): PoseKeyframe<BoneName>[] =>
  toKeyframes(entry.doc);

/**
 * Turns a display name into a safe file name.
 *
 * The save server independently rejects anything outside [A-Za-z0-9._/-] and
 * anything not ending in .json, so this is about producing a tidy name rather
 * than about safety — never rely on client-side sanitising for that.
 */
export const toPoseFileName = (name: string): string =>
  name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
