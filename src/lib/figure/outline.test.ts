import { describe, expect, it } from "vitest";
import { strokeOutline, taper } from "./outline";
import type { Point } from "./pose";

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/** Shortest distance from p to the polyline through `line`. */
const distanceToPolyline = (p: Point, line: Point[]): number => {
  let best = Infinity;
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i];
    const b = line[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
    best = Math.min(best, dist(p, { x: a.x + dx * t, y: a.y + dy * t }));
  }
  return best;
};

describe("strokeOutline", () => {
  const straight: Point[] = [
    { x: 0, y: 0 },
    { x: 0, y: 30 },
    { x: 0, y: 60 },
  ];

  it("returns a closed polygon", () => {
    const out = strokeOutline(straight, { halfWidths: [5, 5, 5] });
    expect(out.length).toBeGreaterThan(6);
    expect(dist(out[0], out[out.length - 1])).toBeCloseTo(0, 12);
  });

  it("sits at exactly the requested half-width on a straight run", () => {
    const out = strokeOutline(straight, { halfWidths: [5, 5, 5], capSegments: 0 });
    // With flat caps every vertex is an offset point, so all should be 5 away.
    for (const p of out) {
      expect(distanceToPolyline(p, straight)).toBeCloseTo(5, 9);
    }
  });

  it("tapers: the tip is narrower than the base", () => {
    const out = strokeOutline(straight, { halfWidths: [10, 6, 2], capSegments: 0 });
    const nearBase = out.filter((p) => p.y < 5);
    const nearTip = out.filter((p) => p.y > 55);
    for (const p of nearBase) expect(distanceToPolyline(p, straight)).toBeCloseTo(10, 6);
    for (const p of nearTip) expect(distanceToPolyline(p, straight)).toBeCloseTo(2, 6);
  });

  /**
   * The property the mitre limit exists for. A sharply folded limb (a knee bent
   * right back on itself) has an almost-zero interior angle, where the exact
   * mitre point runs away to infinity. Nothing may stray far outside the
   * requested width.
   */
  it("does not grow spikes at a sharply folded joint", () => {
    const folded: Point[] = [
      { x: 0, y: 0 },
      { x: 30, y: 0 },
      { x: 1, y: 3 }, // almost doubled back
    ];
    const halfWidth = 4;
    const out = strokeOutline(folded, { halfWidths: [halfWidth, halfWidth, halfWidth], miterLimit: 4 });
    for (const p of out) {
      expect(distanceToPolyline(p, folded)).toBeLessThanOrEqual(halfWidth * 4 + 1e-6);
    }
  });

  it("survives a fully doubled-back centreline without producing NaN", () => {
    const reversed: Point[] = [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 0, y: 0 },
    ];
    const out = strokeOutline(reversed, { halfWidths: [3, 3, 3] });
    for (const p of out) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
  });

  it("rounds the caps when asked, and not when not", () => {
    const flat = strokeOutline(straight, { halfWidths: [5, 5, 5], capSegments: 0 });
    const round = strokeOutline(straight, { halfWidths: [5, 5, 5], capSegments: 8 });
    expect(round.length).toBeGreaterThan(flat.length);
    // Cap points must still be a half-width from the centreline END, i.e. on the
    // circle around the tip — that is what makes it a round cap and not a bulge.
    const tip = straight[straight.length - 1];
    const capPoints = round.filter((p) => p.y > tip.y + 1e-6);
    expect(capPoints.length).toBeGreaterThan(0);
    for (const p of capPoints) expect(dist(p, tip)).toBeCloseTo(5, 6);
  });

  it("rejects mismatched inputs rather than silently misaligning widths", () => {
    expect(() => strokeOutline(straight, { halfWidths: [1, 2] })).toThrow(/half-widths/);
    expect(() => strokeOutline([{ x: 0, y: 0 }], { halfWidths: [1] })).toThrow(/two points/);
  });
});

describe("taper", () => {
  it("runs from the first width to the last", () => {
    const t = taper(5, 10, 2);
    expect(t[0]).toBeCloseTo(10, 9);
    expect(t[4]).toBeCloseTo(2, 9);
    expect(t).toHaveLength(5);
  });

  it("narrows more toward the tip than the base, as a real limb does", () => {
    const t = taper(5, 10, 2);
    const firstDrop = t[0] - t[1];
    const lastDrop = t[3] - t[4];
    expect(lastDrop).toBeGreaterThan(firstDrop);
  });

  it("handles a single point", () => {
    expect(taper(1, 7, 2)).toEqual([7]);
  });
});
