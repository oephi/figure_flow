import { useCurrentFrame, useVideoConfig } from "remotion";
import { boilSeedFor } from "../lib/rough/boil";
import { RoughPaths } from "../lib/rough/RoughShape";
import { circle, curve, line, polygon, useRoughPaths } from "../lib/rough/useRoughPaths";

const INK = "#1b1b1b";
const PAPER = "#f4f1ea";

/**
 * Scratch scene, not part of the pipeline proper. Exists to eyeball several
 * primitives at once — including a hatch fill, which is the option most
 * likely to look wrong from typings alone — and to confirm boilSeedFor keeps
 * independently-seeded shapes from wobbling in lockstep.
 */
export const RoughLab: React.FC = () => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();

  // Each shape gets its own index into boilSeedFor: same frame, different
  // seed, so the boil reads as several independent pencils rather than one
  // drawing jittering as a rigid unit.
  const sun = useRoughPaths(circle(width * 0.16, height * 0.2, 150), {
    seed: boilSeedFor(frame, 0),
    roughness: 1.7,
    bowing: 1.2,
    stroke: INK,
    strokeWidth: 3,
  });

  const hills = useRoughPaths(
    curve([
      [0, height * 0.72],
      [width * 0.22, height * 0.55],
      [width * 0.48, height * 0.7],
      [width * 0.74, height * 0.5],
      [width, height * 0.66],
    ]),
    {
      seed: boilSeedFor(frame, 1),
      roughness: 1.4,
      bowing: 1.4,
      stroke: INK,
      strokeWidth: 2.5,
    },
  );

  // Hachure fill: the option most worth eyeballing since core.d.ts only
  // types fillStyle as `string`, not a union of the known style names.
  const hatchedBox = useRoughPaths(
    polygon([
      [width * 0.55, height * 0.28],
      [width * 0.86, height * 0.28],
      [width * 0.86, height * 0.56],
      [width * 0.55, height * 0.56],
    ]),
    {
      seed: boilSeedFor(frame, 2),
      roughness: 1.3,
      bowing: 1,
      stroke: INK,
      strokeWidth: 2,
      fill: INK,
      fillStyle: "hachure",
      fillWeight: 1.2,
      hachureGap: 6,
    },
  );

  const groundLineLeft = useRoughPaths(line(width * 0.04, height * 0.86, width * 0.36, height * 0.88), {
    seed: boilSeedFor(frame, 3),
    roughness: 1.2,
    bowing: 1,
    stroke: INK,
    strokeWidth: 2,
  });

  const groundLineRight = useRoughPaths(line(width * 0.4, height * 0.9, width * 0.92, height * 0.82), {
    seed: boilSeedFor(frame, 4),
    roughness: 1.2,
    bowing: 1,
    stroke: INK,
    strokeWidth: 2,
  });

  return (
    <svg width={width} height={height} style={{ backgroundColor: PAPER }}>
      <RoughPaths paths={hills} />
      <RoughPaths paths={hatchedBox} />
      <RoughPaths paths={sun} />
      <RoughPaths paths={groundLineLeft} />
      <RoughPaths paths={groundLineRight} />
    </svg>
  );
};
