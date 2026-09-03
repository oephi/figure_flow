/**
 * Wraps an angle in degrees into the canonical half-open range (-180, 180].
 *
 * Both solvers (`aim.ts`, `ik.ts`) work by subtracting a parent's accumulated
 * angle from an absolute one, which routinely lands outside a sensible range —
 * a drag can easily produce -336 degrees where +24 was meant. Geometrically
 * identical, but these values get written into pose JSON that a human reads and
 * edits, and -336 is noise.
 *
 * This does NOT affect interpolation: `interpolatePose` already takes the
 * shortest way around the circle, so a keyframe pair reads the same either way.
 * It is purely about the data being legible.
 */
export const normalizeAngle = (degrees: number): number => {
  if (!Number.isFinite(degrees)) return degrees;
  // ((x + 180) mod 360) can be negative in JS for negative x, hence the double
  // modulo rather than a single one.
  const wrapped = (((degrees + 180) % 360) + 360) % 360;
  // Map the 0 boundary back to 180 so the range is (-180, 180] rather than
  // [-180, 180) — keeps "straight down" reading as 180, not -180.
  return wrapped === 0 ? 180 : wrapped - 180;
};
