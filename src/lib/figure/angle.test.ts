import { describe, expect, it } from "vitest";
import { normalizeAngle } from "./angle";

describe("normalizeAngle", () => {
  it("leaves angles already in range alone", () => {
    for (const a of [0, 1, 90, -90, 179.5, -179.5, 180]) {
      expect(normalizeAngle(a)).toBeCloseTo(a, 12);
    }
  });

  it("wraps the real case that motivated it: -336 is +24", () => {
    expect(normalizeAngle(-336)).toBeCloseTo(24, 12);
  });

  it("maps the boundary to +180 rather than -180, so 'straight down' reads naturally", () => {
    expect(normalizeAngle(180)).toBe(180);
    expect(normalizeAngle(-180)).toBe(180);
    expect(normalizeAngle(540)).toBe(180);
  });

  it("always lands in (-180, 180] for a wide sweep of inputs", () => {
    for (let a = -1500; a <= 1500; a += 7.3) {
      const n = normalizeAngle(a);
      expect(n).toBeGreaterThan(-180);
      expect(n).toBeLessThanOrEqual(180);
      // and it must be the SAME angle, i.e. differ by a whole number of turns
      const turns = (a - n) / 360;
      expect(Math.abs(turns - Math.round(turns))).toBeLessThan(1e-9);
    }
  });

  it("passes non-finite values through rather than producing NaN games", () => {
    expect(Number.isNaN(normalizeAngle(NaN))).toBe(true);
    expect(normalizeAngle(Infinity)).toBe(Infinity);
  });
});
