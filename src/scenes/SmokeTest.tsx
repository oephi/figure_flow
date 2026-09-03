import { useMemo } from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import rough from "roughjs";
import { boilSeed } from "../lib/rough/boil";
import { RoughPaths } from "../lib/rough/RoughShape";

const generator = rough.generator();

const INK = "#1b1b1b";
const PAPER = "#f4f1ea";

/**
 * Throwaway. Proves the whole chain works before any rig code exists:
 * Remotion renders frames, rough.js draws sketchy strokes, the seed is stable
 * enough to reproduce, and an MP4 comes out the other end.
 */
export const SmokeTest: React.FC = () => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const seed = boilSeed(frame);

  const paths = useMemo(() => {
    const circle = generator.circle(width / 2, height / 2, 320, {
      seed,
      roughness: 1.8,
      bowing: 1.4,
      stroke: INK,
      strokeWidth: 3,
      disableMultiStroke: false,
    });
    return generator.toPaths(circle);
  }, [seed, width, height]);

  return (
    <svg width={width} height={height} style={{ backgroundColor: PAPER }}>
      <RoughPaths paths={paths} />
    </svg>
  );
};
