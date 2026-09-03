import { useCurrentFrame, useVideoConfig } from "remotion";
import { Figure } from "../lib/figure/Figure";
import { interpolatePose } from "../lib/figure/interpolate";
import { pelvisBob } from "../lib/anim/bob";
import { loadTrack, parseTrackDoc } from "../lib/poses/types";
import walkTrackJson from "../../poses/tracks/walk.json";

const WALK_DOC = parseTrackDoc(walkTrackJson, "poses/tracks/walk.json");
const WALK_TRACK = loadTrack(WALK_DOC);
const WALK_CYCLE_FRAMES = WALK_DOC.durationInFrames;

const INK = "#1b1b1b";
const PAPER = "#f4f1ea";
const SCALE = 3.2;

/**
 * Two readings of the same cycle. The strip along the top is a contact sheet —
 * every third frame laid out side by side, which is how you check a walk for
 * even spacing without scrubbing. Below it the figure walks for real.
 */
export const WalkCycle: React.FC = () => {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();

  const strip = Array.from({ length: 8 }, (_, i) => i * 3);

  // Travel: one cycle covers two steps. Tuned so the feet look planted rather
  // than skating — too slow and the figure moonwalks, too fast and it slides.
  const travelPerCycle = 78 * SCALE;
  const x = (((frame / WALK_CYCLE_FRAMES) * travelPerCycle + 120) % (width + 240)) - 120;
  const cyc = frame % WALK_CYCLE_FRAMES;

  return (
    <svg width={width} height={height} style={{ backgroundColor: PAPER }}>
      {strip.map((f, i) => (
        <Figure
          frame={frame}
          key={f}
          pose={interpolatePose(WALK_TRACK, f)}
          root={{ x: 110 + i * 145, y: height * 0.34 + pelvisBob(f, WALK_CYCLE_FRAMES) * SCALE }}
          scale={2.1}
          ink={INK}
          headScale={1.9}
          strokeWidth={2}
          roughness={0.7}
          seedOffset={i * 20}
        />
      ))}
      <Figure
          frame={frame}
        pose={interpolatePose(WALK_TRACK, cyc)}
        root={{ x, y: height * 0.66 + pelvisBob(cyc, WALK_CYCLE_FRAMES) * SCALE }}
        scale={SCALE}
        ink={INK}
        headScale={1.9}
          strokeWidth={2}
          roughness={0.7}
        seedOffset={500}
      />
      <text x={20} y={30} fontSize={16} fill="#8a8378" fontFamily="monospace">
        {`frame ${frame}  ·  cycle ${cyc}/${WALK_CYCLE_FRAMES}  ·  ${fps}fps`}
      </text>
    </svg>
  );
};
