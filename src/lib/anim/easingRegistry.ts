import { easeIn, easeInOut, easeOut, linear } from "./easing";
import type { EasingFn } from "../figure/interpolate";

/**
 * Named easings, so a keyframe stored as JSON can refer to one.
 *
 * JSON cannot hold a function, so the on-disk format stores a NAME and this
 * registry resolves it on load. That indirection is what lets the pose editor
 * offer a dropdown and write a plain string back to the file. Adding an easing
 * means adding it here; `EasingName` is derived from the keys so a typo in a
 * pose file is a type error rather than a silent fallback to linear.
 */
export const EASINGS = { linear, easeIn, easeOut, easeInOut } satisfies Record<string, EasingFn>;

export type EasingName = keyof typeof EASINGS;

export const EASING_NAMES = Object.keys(EASINGS) as EasingName[];

export const isEasingName = (value: unknown): value is EasingName =>
  typeof value === "string" && value in EASINGS;
