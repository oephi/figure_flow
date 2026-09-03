import type { Point } from "./pose";

/**
 * Turns a centreline into a closed outline of varying width.
 *
 * The stick-figure renderer draws each limb as one stroke down its middle. The
 * outlined style instead draws the SILHOUETTE of the limb: up one side, round
 * the tip, back down the other. That is what gives arms and legs real thickness
 * and lets them taper from shoulder to wrist.
 *
 * Pure geometry, no React or roughjs — the caller feeds the resulting polygon
 * to rough.js as a closed curve.
 */

export interface OutlineOptions {
  /** Half-width at each centreline point. Must be the same length as `points`. */
  halfWidths: number[];
  /**
   * Points used to round each end cap. 0 gives a flat, chopped-off end; 6 or so
   * reads as a rounded limb tip. The reference drawings have rounded ends
   * everywhere, which is much of why they look like limbs and not sticks.
   */
  capSegments?: number;
  /**
   * Cap on how far a corner may extend, as a multiple of the half-width.
   *
   * At a sharply bent joint (a folded knee) the two sides of the outline meet
   * at a very acute angle, and the exact mitre point shoots off toward
   * infinity as the angle closes. Without a limit a tightly bent limb grows a
   * long spike. Clamping trades a mathematically exact corner for a blunted
   * one, which is invisible under a sketchy stroke.
   */
  miterLimit?: number;
}

const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
const norm = (p: Point): Point => {
  const m = Math.hypot(p.x, p.y);
  return m === 0 ? { x: 0, y: 0 } : { x: p.x / m, y: p.y / m };
};
/** Left-hand perpendicular. Handedness only has to be consistent, not "correct". */
const perp = (p: Point): Point => ({ x: -p.y, y: p.x });

/**
 * Per-point outward normals, scaled so the corner closes cleanly.
 *
 * At an interior point the normal bisects the two adjacent segment normals, and
 * the offset has to be lengthened by 1/cos(half the turn) for the two straight
 * edges either side to actually meet. That factor is what blows up on a sharp
 * bend, hence the mitre clamp.
 */
const offsetNormals = (points: Point[], miterLimit: number): Point[] => {
  const n = points.length;
  const segmentNormals: Point[] = [];
  for (let i = 0; i < n - 1; i++) {
    segmentNormals.push(perp(norm(sub(points[i + 1], points[i]))));
  }

  return points.map((_, i) => {
    if (i === 0) return segmentNormals[0];
    if (i === n - 1) return segmentNormals[n - 2];
    const a = segmentNormals[i - 1];
    const b = segmentNormals[i];
    const bisector = norm({ x: a.x + b.x, y: a.y + b.y });
    // A perfect 180-degree doubling-back leaves no bisector at all; fall back to
    // one side rather than emitting NaN.
    if (bisector.x === 0 && bisector.y === 0) return a;
    const cos = bisector.x * a.x + bisector.y * a.y;
    const scale = Math.min(1 / Math.max(cos, 1e-6), miterLimit);
    return { x: bisector.x * scale, y: bisector.y * scale };
  });
};

/** A semicircular cap from `from` to `to`, turning about `centre`. */
const cap = (centre: Point, from: Point, to: Point, segments: number): Point[] => {
  if (segments <= 0) return [];
  const a0 = Math.atan2(from.y - centre.y, from.x - centre.x);
  const a1 = Math.atan2(to.y - centre.y, to.x - centre.x);
  const radius = Math.hypot(from.x - centre.x, from.y - centre.y);
  // Always sweep the short way; the long way would fold the cap back over the limb.
  let delta = a1 - a0;
  while (delta > Math.PI) delta -= 2 * Math.PI;
  while (delta < -Math.PI) delta += 2 * Math.PI;
  const out: Point[] = [];
  for (let i = 1; i < segments; i++) {
    const a = a0 + (delta * i) / segments;
    out.push({ x: centre.x + Math.cos(a) * radius, y: centre.y + Math.sin(a) * radius });
  }
  return out;
};

/**
 * Returns a CLOSED polygon (first point repeated at the end) tracing the
 * outline of `points` at the given half-widths.
 */
export const strokeOutline = (points: Point[], options: OutlineOptions): Point[] => {
  const { halfWidths, capSegments = 6, miterLimit = 4 } = options;
  if (points.length < 2) throw new Error("strokeOutline: need at least two points");
  if (halfWidths.length !== points.length) {
    throw new Error(
      `strokeOutline: ${halfWidths.length} half-widths for ${points.length} points`,
    );
  }

  const normals = offsetNormals(points, miterLimit);
  const side = (sign: number): Point[] =>
    points.map((p, i) => ({
      x: p.x + normals[i].x * halfWidths[i] * sign,
      y: p.y + normals[i].y * halfWidths[i] * sign,
    }));

  const left = side(1);
  const right = side(-1);
  const last = points.length - 1;

  return [
    ...left,
    ...cap(points[last], left[last], right[last], capSegments),
    ...right.slice().reverse(),
    ...cap(points[0], right[0], left[0], capSegments),
    left[0], // close
  ];
};

/**
 * A taper: half-widths running from `from` at the first point to `to` at the
 * last, eased so the change is gentle near the wide end and quicker near the tip
 * — limbs narrow mostly toward the extremity, not evenly along their length.
 */
export const taper = (count: number, from: number, to: number): number[] =>
  Array.from({ length: count }, (_, i) => {
    if (count === 1) return from;
    const t = i / (count - 1);
    return from + (to - from) * (t * t);
  });
