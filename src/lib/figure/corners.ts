import type { Point } from "./pose";

/**
 * Replaces the sharp corners of a polyline with circular arcs.
 *
 * The hand-drawn reference figures never show an angular elbow or knee: the
 * line curves *through* the joint, and when a limb folds right back on itself
 * the bend becomes a rounded loop with the two strands bowing apart. Running a
 * spline through the joints (what `curvedLimbs` does) is not the same thing —
 * a spline through a sharp reversal still pinches to a point, because the
 * control points are the joints themselves.
 *
 * Filleting inserts real geometry at the corner, so the bend has an actual
 * radius no matter how tight the fold. Pure, no React or roughjs.
 */

const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
const len = (p: Point) => Math.hypot(p.x, p.y);
const norm = (p: Point): Point => {
  const m = len(p);
  return m === 0 ? { x: 0, y: 0 } : { x: p.x / m, y: p.y / m };
};

/**
 * @param radius Corner radius in the same units as the points.
 * @param segments Points generated per corner arc. More is smoother.
 */
export const roundCorners = (points: Point[], radius: number, segments = 8): Point[] => {
  if (radius <= 0 || points.length < 3) return points;

  const out: Point[] = [points[0]];

  for (let i = 1; i < points.length - 1; i++) {
    const corner = points[i];
    const toPrev = sub(points[i - 1], corner);
    const toNext = sub(points[i + 1], corner);
    const d1 = norm(toPrev);
    const d2 = norm(toNext);

    // The fillet may not eat more than half of either adjacent segment, or
    // consecutive corners on a short bone would overrun each other.
    const maxTangent = Math.min(len(toPrev), len(toNext)) / 2;

    const cosTheta = Math.max(-1, Math.min(1, d1.x * d2.x + d1.y * d2.y));
    const theta = Math.acos(cosTheta); // interior angle at the corner
    const bisector = norm({ x: d1.x + d2.x, y: d1.y + d2.y });

    // Two ends of the angle range both leave the bisector undefined, and they
    // need OPPOSITE treatment — conflating them was a real bug that bowed
    // straight limbs into hooks:
    //
    //   theta near PI  — the joint runs straight through. d1 and d2 are nearly
    //                    opposite so they cancel, but there is no corner here
    //                    at all. Leave it exactly as it is.
    //   theta near 0   — the limb is folded back on itself. d1 and d2 point the
    //                    same way. This is the case that needs opening out.
    const STRAIGHT = 0.02; // radians from PI, about 1 degree
    const FOLDED = 0.08; // radians from 0
    if (theta > Math.PI - STRAIGHT) {
      out.push(corner);
      continue;
    }
    const degenerate = theta < FOLDED;

    if (degenerate) {
      // A fully folded limb is a genuinely different problem from a corner.
      // The incoming and outgoing strands are COLLINEAR, so there is no corner
      // to fillet — an arc would have zero width and the fold stays a crease.
      // The only way to make it read as a loop is to bow the two strands apart,
      // which is what the reference drawings do at a tucked knee. Push the
      // midpoint of each adjacent segment out to opposite sides; drawn as a
      // curve this opens into a lens.
      const perpendicular: Point = { x: -d1.y, y: d1.x };
      const bulge = Math.min(radius, maxTangent);
      const midPrev = {
        x: (points[i - 1].x + corner.x) / 2 + perpendicular.x * bulge,
        y: (points[i - 1].y + corner.y) / 2 + perpendicular.y * bulge,
      };
      const midNext = {
        x: (corner.x + points[i + 1].x) / 2 - perpendicular.x * bulge,
        y: (corner.y + points[i + 1].y) / 2 - perpendicular.y * bulge,
      };
      out.push(midPrev, corner, midNext);
      continue;
    }

    const half = theta / 2;
    const tangent = Math.min(radius / Math.tan(half), maxTangent);
    const effectiveRadius = tangent * Math.tan(half);
    const centreDistance = effectiveRadius / Math.sin(half);

    const p1 = { x: corner.x + d1.x * tangent, y: corner.y + d1.y * tangent };
    const p2 = { x: corner.x + d2.x * tangent, y: corner.y + d2.y * tangent };
    const centre = {
      x: corner.x + bisector.x * centreDistance,
      y: corner.y + bisector.y * centreDistance,
    };

    const a1 = Math.atan2(p1.y - centre.y, p1.x - centre.x);
    const a2 = Math.atan2(p2.y - centre.y, p2.x - centre.x);
    let sweep = a2 - a1;
    while (sweep > Math.PI) sweep -= 2 * Math.PI;
    while (sweep < -Math.PI) sweep += 2 * Math.PI;

    for (let s = 0; s <= segments; s++) {
      const a = a1 + (sweep * s) / segments;
      out.push({
        x: centre.x + Math.cos(a) * effectiveRadius,
        y: centre.y + Math.sin(a) * effectiveRadius,
      });
    }
  }

  out.push(points[points.length - 1]);
  return out;
};
