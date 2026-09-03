import { useCurrentFrame, useVideoConfig } from "remotion";
import { Figure } from "../lib/figure/Figure";
import type { BoneName } from "../lib/figure/skeleton";
import type { Pose } from "../lib/figure/pose";
import { loadPose } from "../lib/poses/types";
import sitCrossLeggedJson from "../../poses/library/sit-cross-legged.json";

const SIT_CROSS_LEGGED = loadPose(sitCrossLeggedJson, "sit-cross-legged");

const INK = "#1b1b1b";
const PAPER = "#f4f1ea";

/** Profile walking pose — straight limbs, because straight reads as bone. */
const STRIDE: Pose<BoneName> = {
  leftThigh: 25,
  leftShin: -30,
  rightThigh: -20,
  rightShin: -10,
  leftUpperArm: -25,
  leftForearm: -30,
  rightUpperArm: 20,
  rightForearm: -35,
  spine: -4,
};

export const FigureCheck: React.FC = () => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();

  return (
    <svg width={width} height={height} style={{ backgroundColor: PAPER }}>
      <Figure
        frame={frame}
        pose={STRIDE}
        root={{ x: width * 0.27, y: height * 0.4 }}
        scale={4}
        strokeWidth={2}
        roughness={0.35}
        ink={INK}
        headScale={1.9}
        seedOffset={0}
      />
      <Figure
        frame={frame}
        pose={SIT_CROSS_LEGGED}
        root={{ x: width * 0.7, y: height * 0.55 }}
        scale={4}
        strokeWidth={2}
        roughness={0.35}
        ink={INK}
        headScale={1.9}
        curvedLimbs
        lotusLegs
        seedOffset={60}
      />
    </svg>
  );
};
