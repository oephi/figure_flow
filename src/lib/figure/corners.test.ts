import { describe, expect, it } from "vitest";
import { roundCorners } from "./corners";
import type { Point } from "./pose";

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/** Largest gap between consecutive points — a proxy for "is this smooth". */
const maxStep = (pts: Point[]) => {
  let m = 0;
  for (let i = 1; i < pts.length; i++) m = Math.max(m, dist(pts[i - 1], pts[i]));
  return m;
};

/** Sharpest turn in the polyline, in degrees. 180 = straight through. */
const sharpestTurn = (pts: Point[]): number => {
  let sharpest = 180;
  for (let i = 1; i < pts.length - 1; i++) {
    const a = { x: pts[i - 1].x - pts[i].x, y: pts[i - 1].y - pts[i].y };
    const b = { x: pts[i + 1].x - pts[i].x, y: pts[i + 1].y - pts[i].y };
    const ma = Math.hypot(a.x, a.y);
    const mb = Math.hypot(b.x, b.y);
    if (ma === 0 || mb === 0) continue;
    const cos = Math.max(-1, Math.min(1, (a.x * b.x + a.y * b.y) / (ma * mb)));
    sharpest = Math.min(sharpest, (Math.acos(cos) * 180) / Math.PI);
  }
  return sharpest;
};

describe("roundCorners", () => {
  const rightAngle: Point[] = [
    { x: 0, y: 0 },
    { x: 40, y: 0 },
    { x: 40, y: 40 },
  ];

  it("keeps the endpoints exactly where they were", () => {
    const out = roundCorners(rightAngle, 10);
    expect(dist(out[0], rightAngle[0])).toBeCloseTo(0, 12);
    expect(dist(out[out.length - 1], rightAngle[2])).toBeCloseTo(0, 12);
  });

  it("replaces a sharp corner with a much gentler turn", () => {
    expect(sharpestTurn(rightAngle)).toBeCloseTo(90, 6);
    expect(sharpestTurn(roundCorners(rightAngle, 12))).toBeGreaterThan(150);
  });

  /**
   * The case that matters: a limb folded right back on itself. A spline through
   * the joints pinches to a point here, which is why bent knees looked creased.
   * The fillet must open it into a rounded loop instead.
   */
  it("turns a fully folded limb into a rounded loop, not a crease", () => {
    const folded: Point[] = [
      { x: 0, y: 0 },
      { x: 30, y: 0 },
      { x: 0.5, y: 0 }, // doubled straight back
    ];
    expect(sharpestTurn(folded)).toBeLessThan(2);
    const out = roundCorners(folded, 6);
    for (const p of out) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
    // The two strands must separate — that separation IS the loop. Filleting
    // cannot achieve it (the strands are collinear, so an arc has zero width),
    // so the implementation bows the segments to opposite sides instead.
    const above = Math.max(...out.map((p) => p.y));
    const below = Math.min(...out.map((p) => p.y));
    expect(above).toBeGreaterThan(3);
    expect(below).toBeLessThan(-3);
  });

  it("never eats more than half of the shorter adjacent segment", () => {
    // A radius far larger than the bones should be clamped, not overshoot.
    const short: Point[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ];
    const out = roundCorners(short, 500);
    for (const p of out) {
      expect(p.x).toBeGreaterThanOrEqual(-1e-6);
      expect(p.x).toBeLessThanOrEqual(10 + 1e-6);
      expect(p.y).toBeGreaterThanOrEqual(-1e-6);
      expect(p.y).toBeLessThanOrEqual(10 + 1e-6);
    }
  });

  it("produces a smooth arc rather than a couple of chords", () => {
    const out = roundCorners(rightAngle, 12, 12);
    expect(out.length).toBeGreaterThan(rightAngle.length + 8);
    // Measure the ARC only. The straight runs either side are legitimately long,
    // so including them would just be measuring the bone length.
    const arc = out.filter((p) => p.x > 26 && p.y < 14);
    expect(arc.length).toBeGreaterThan(6);
    expect(maxStep(arc)).toBeLessThan(6);
  });

  /**
   * Regression: a nearly STRAIGHT joint also has a vanishing bisector, because
   * the two directions are almost opposite and cancel. An earlier version
   * lumped it in with the folded-limb case and bowed straight limbs sideways,
   * which put a visible hook in the figure's neck.
   */
  it("leaves a nearly straight joint untouched instead of bowing it", () => {
    const almostStraight: Point[] = [
      { x: 0, y: 0 },
      { x: 0, y: 40 },
      { x: 0.2, y: 80 },
    ];
    const out = roundCorners(almostStraight, 8);
    for (const p of out) {
      // Nothing may wander sideways off the line.
      expect(Math.abs(p.x)).toBeLessThan(1);
    }
  });

  it("still rounds a normal bend after that straight-joint guard", () => {
    const bend: Point[] = [
      { x: 0, y: 0 },
      { x: 0, y: 40 },
      { x: 30, y: 60 },
    ];
    expect(sharpestTurn(roundCorners(bend, 8))).toBeGreaterThan(sharpestTurn(bend) + 20);
  });

  it("is a no-op for a zero radius or a two-point line", () => {
    expect(roundCorners(rightAngle, 0)).toEqual(rightAngle);
    const two: Point[] = [{ x: 0, y: 0 }, { x: 5, y: 5 }];
    expect(roundCorners(two, 10)).toEqual(two);
  });

  it("rounds every corner of a multi-joint chain", () => {
    const leg: Point[] = [
      { x: 0, y: 0 },
      { x: 20, y: 20 },
      { x: 0, y: 40 },
      { x: 15, y: 50 },
    ];
    expect(sharpestTurn(roundCorners(leg, 6))).toBeGreaterThan(sharpestTurn(leg));
  });
});
