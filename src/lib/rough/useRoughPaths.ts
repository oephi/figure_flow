import { useMemo } from "react";
import rough from "roughjs";
import type { Drawable, Options, PathInfo } from "roughjs/bin/core";
import type { Point } from "roughjs/bin/geometry";

/**
 * One generator for the whole process. rough.generator() holds no drawing
 * state of its own (unlike rough.svg()/rough.canvas(), which we deliberately
 * avoid — see RoughShape.tsx) — every method call is a pure function of its
 * arguments, so a single shared instance is correct and cheaper than one per
 * render.
 */
const generator = rough.generator();

/**
 * rough.js's Options.seed is optional, which is how you accidentally end up
 * with Math.random() (see boil.ts). Every shape drawn through this module
 * must carry an explicit seed, so we require it here rather than trusting
 * callers to remember.
 */
export type RoughOptions = Options & { seed: number };

/**
 * Thin, serialisable descriptions of the shapes we actually draw. Kept as
 * plain data (rather than e.g. passing a closure that calls the generator)
 * so useRoughPaths can memoise on content instead of on object identity —
 * Remotion re-renders every frame, and scenes will construct a fresh shape
 * literal each time.
 */
export type ShapeDescriptor =
  | { kind: "circle"; x: number; y: number; diameter: number }
  | { kind: "ellipse"; x: number; y: number; width: number; height: number }
  | { kind: "line"; x1: number; y1: number; x2: number; y2: number }
  | { kind: "linearPath"; points: Point[] }
  | { kind: "polygon"; points: Point[] }
  | { kind: "path"; d: string }
  | { kind: "curve"; points: Point[] | Point[][] };

// Thin helpers so scenes read as "circle(...)" rather than spelling out the
// discriminant object by hand every time.
export const circle = (x: number, y: number, diameter: number): ShapeDescriptor => ({
  kind: "circle",
  x,
  y,
  diameter,
});

export const ellipse = (
  x: number,
  y: number,
  width: number,
  height: number,
): ShapeDescriptor => ({ kind: "ellipse", x, y, width, height });

export const line = (x1: number, y1: number, x2: number, y2: number): ShapeDescriptor => ({
  kind: "line",
  x1,
  y1,
  x2,
  y2,
});

export const linearPath = (points: Point[]): ShapeDescriptor => ({
  kind: "linearPath",
  points,
});

export const polygon = (points: Point[]): ShapeDescriptor => ({ kind: "polygon", points });

export const path = (d: string): ShapeDescriptor => ({ kind: "path", d });

export const curve = (points: Point[] | Point[][]): ShapeDescriptor => ({
  kind: "curve",
  points,
});

/**
 * Maps a ShapeDescriptor to the matching generator call. A pure function of
 * (shape, options) — no state read or written outside its arguments, which
 * is what lets useRoughPaths below memoise safely and what makes this safe
 * to call from frames rendered in parallel across browser tabs.
 */
const drawableFor = (shape: ShapeDescriptor, options: RoughOptions): Drawable => {
  switch (shape.kind) {
    case "circle":
      return generator.circle(shape.x, shape.y, shape.diameter, options);
    case "ellipse":
      return generator.ellipse(shape.x, shape.y, shape.width, shape.height, options);
    case "line":
      return generator.line(shape.x1, shape.y1, shape.x2, shape.y2, options);
    case "linearPath":
      return generator.linearPath(shape.points, options);
    case "polygon":
      return generator.polygon(shape.points, options);
    case "path":
      return generator.path(shape.d, options);
    case "curve":
      return generator.curve(shape.points, options);
  }
};

/**
 * Pure (shape, options) -> PathInfo[] conversion, exported separately from
 * the hook so it can be unit-tested (or reused server-side) without a React
 * render.
 */
export const roughPathsFor = (shape: ShapeDescriptor, options: RoughOptions): PathInfo[] =>
  generator.toPaths(drawableFor(shape, options));

/**
 * Wraps roughPathsFor in useMemo. Scenes build a fresh `shape`/`options`
 * object literal on every render (Remotion re-renders every frame), so
 * memoising on reference identity would never hit. We memoise on a content
 * key instead — cheap here since shape/options are small plain-data objects,
 * and correct because drawableFor is a pure function of that same content.
 * The seed lives inside `options`, so it's covered by the same key.
 */
export const useRoughPaths = (shape: ShapeDescriptor, options: RoughOptions): PathInfo[] => {
  const key = JSON.stringify([shape, options]);
  // `key` is a content hash of both shape and options, so it is the correct
  // dependency; listing the objects themselves would defeat the memo entirely.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => roughPathsFor(shape, options), [key]);
};
