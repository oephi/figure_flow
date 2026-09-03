import { useCurrentFrame, useVideoConfig } from "remotion";
import { Figure } from "../lib/figure/Figure";
import { interpolatePose } from "../lib/figure/interpolate";
import { loadPose, loadTrack, parseTrackDoc } from "../lib/poses/types";
import sitJson from "../../poses/library/sit-cross-legged.json";
import walkJson from "../../poses/tracks/walk.json";

const INK = "#1b1b1b";
const PAPER = "#f4f1ea";
const SIT = loadPose(sitJson, "sit-cross-legged");
const WALK = loadTrack(parseTrackDoc(walkJson, "walk"));

/** How much rounding at the joints — 0 is the angular stick figure. */
const ROUNDINGS = [0, 3, 6];

/** Compares joint rounding across the seated and a mid-stride walking pose. */
export const OutlineLab: React.FC = () => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();

  return (
    <svg width={width} height={height} style={{ backgroundColor: PAPER }}>
      {ROUNDINGS.map((rounding, i) => (
        <Figure
          key={`sit-${rounding}`}
          frame={frame}
          pose={SIT}
          root={{ x: width * (0.19 + i * 0.28), y: height * 0.34 }}
          scale={2.5}
          ink={INK}
          headScale={1.85}
          curvedLimbs
          lotusLegs
          linkedArms
          limbRounding={rounding}
          strokeWidth={2}
          roughness={0.7}
          seedOffset={i * 40}
        />
      ))}
      {ROUNDINGS.map((rounding, i) => (
        <Figure
          key={`walk-${rounding}`}
          frame={frame}
          pose={interpolatePose(WALK, 6)}
          root={{ x: width * (0.19 + i * 0.28), y: height * 0.68 }}
          scale={2.5}
          ink={INK}
          headScale={1.85}
          limbRounding={rounding}
          strokeWidth={2}
          roughness={0.7}
          seedOffset={200 + i * 40}
        />
      ))}
      {ROUNDINGS.map((rounding, i) => (
        <text
          key={`label-${rounding}`}
          x={width * (0.19 + i * 0.28) - 40}
          y={28}
          fontSize={15}
          fill="#8a8378"
          fontFamily="monospace"
        >
          {`rounding ${rounding}`}
        </text>
      ))}
    </svg>
  );
};
