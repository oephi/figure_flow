import { Audio, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { Figure } from "../lib/figure/Figure";
import { interpolatePose } from "../lib/figure/interpolate";
import type { Pose } from "../lib/figure/pose";
import type { BoneName } from "../lib/figure/skeleton";
import { easeInOut, easeOut } from "../lib/anim/easing";
import { pelvisBob } from "../lib/anim/bob";
import { loadPose, loadTrack, parseTrackDoc } from "../lib/poses/types";
import walkTrackJson from "../../poses/tracks/walk.json";
import sitCrossLeggedJson from "../../poses/library/sit-cross-legged.json";
import standJson from "../../poses/library/stand.json";
import crouchJson from "../../poses/library/crouch.json";
import { findSpokenFrame, validateCaptionsFile } from "../audio/captions";
import captionsJson from "../../public/captions/01_meditation.json";
import { zColor } from "@remotion/zod-types";
import { z } from "zod";

const FPS = 30;

/**
 * Every tunable the scene has, exposed so it can be edited in Studio's props
 * panel and saved back to this file — without touching any logic. If you find
 * yourself editing a number in the body of this component to change how the
 * shot looks, that number belongs here instead.
 */
export const meditationFigureSchema = z.object({
  ink: zColor(),
  paper: zColor(),
  figureScale: z.number().min(0.5).max(8).step(0.1),
  headScale: z.number().min(0.5).max(4).step(0.05),
  /** Corner radius at every joint, in skeleton units. 0 = angular stick figure. */
  limbRounding: z.number().min(0).max(14).step(0.5),
  /** Spine length in skeleton units. Shorter = bigger head, hands nearer knees. */
  torsoLength: z.number().min(15).max(60).step(1),
  /** Gap between shoulders and head — where the spine meets the head. */
  neckLength: z.number().min(0).max(30).step(0.5),
  /** Where the neck stroke stops relative to the head outline. 0 = touching. */
  neckGap: z.number().min(-12).max(12).step(0.5),
  /** Moves the bottom end of the torso stroke. Negative stops it short of the legs. */
  torsoBottomExtend: z.number().min(-20).max(20).step(0.5),
  strokeWidth: z.number().min(0.5).max(10).step(0.5),
  roughness: z.number().min(0).max(4).step(0.1),
  /** Where the standing figure's hips sit, as a fraction of frame height. */
  groundLine: z.number().min(0.2).max(0.95).step(0.01),
  /** How far the hips drop between standing and seated, in skeleton units. */
  sinkUnits: z.number().min(0).max(80).step(1),
  /** Spine sway while seated. 0 freezes the figure, which reads as a still. */
  breathAmount: z.number().min(0).max(8).step(0.1),
});

type Props = z.infer<typeof meditationFigureSchema>;

const captions = validateCaptionsFile(captionsJson);

// Parsed once at module scope: validation is not free, and these never change
// at runtime. A bad pose file therefore fails at import rather than mid-render.
const WALK_DOC = parseTrackDoc(walkTrackJson, "poses/tracks/walk.json");
const WALK_TRACK = loadTrack(WALK_DOC);
const WALK_CYCLE_FRAMES = WALK_DOC.durationInFrames;
const SIT_CROSS_LEGGED = loadPose(sitCrossLeggedJson, "sit-cross-legged");
const STAND = loadPose(standJson, "stand");
const CROUCH = loadPose(crouchJson, "crouch");

/**
 * Beats are read from the narration rather than hand-counted. Each is the frame
 * at which a particular word is spoken, so re-recording the voiceover re-times
 * the animation automatically. The fallbacks keep the scene renderable if a
 * word is missing from a future take.
 */
const beat = (word: string, fallback: number) =>
  findSpokenFrame(captions, word, FPS) ?? fallback;

const WALK_START = beat("walks", 18);
const STOP = beat("stops", 86);
const SETTLE = beat("settles", 182);
const SEATED = beat("cross", 228);



export const MeditationFigure: React.FC<Props> = ({
  ink,
  paper,
  figureScale,
  headScale,
  limbRounding,
  torsoLength,
  neckLength,
  neckGap,
  torsoBottomExtend,
  strokeWidth,
  roughness,
  groundLine,
  sinkUnits,
  breathAmount,
}) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();

  const groundY = height * groundLine;
  const restX = width * 0.5;

  // ---- Walking in -------------------------------------------------------
  const walking = frame < STOP;
  const walkProgress = interpolate(frame, [WALK_START, STOP], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const x = interpolate(easeOut(walkProgress), [0, 1], [-120, restX]);
  const cyc = frame % WALK_CYCLE_FRAMES;

  // ---- Settling down ----------------------------------------------------
  // Three overlapping things happen between SETTLE and SEATED: the pose folds
  // into a crouch, the body drops toward the ground, and the figure turns from
  // profile to front-on. The turn is the cheat — a 2D rig cannot rotate, so it
  // cross-fades. Over abstract boiling lines and ~10 frames, that reads as a
  // turn rather than a dissolve.
  const settle = interpolate(frame, [SETTLE, SEATED], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const eased = easeInOut(settle);
  const sink = eased * sinkUnits * figureScale;
  const lotusOpacity = interpolate(settle, [0.55, 1], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const profileOpacity = 1 - lotusOpacity;

  // ---- Breathing --------------------------------------------------------
  // A seated figure that holds perfectly still reads as a frozen frame rather
  // than stillness. A slow spine oscillation is enough to keep it alive.
  const breath = Math.sin((frame - SEATED) / 26) * breathAmount;
  const seatedPose: Pose<BoneName> = {
    ...SIT_CROSS_LEGGED,
    spine: (SIT_CROSS_LEGGED.spine ?? 0) + breath,
  };

  const profilePose = walking
    ? interpolatePose(WALK_TRACK, cyc)
    : interpolatePose(
        [
          { frame: 0, pose: STAND },
          { frame: 1, pose: CROUCH },
        ],
        eased,
      );

  const bob = walking ? pelvisBob(cyc, WALK_CYCLE_FRAMES) * figureScale : 0;

  return (
    <>
      <Audio src={staticFile("audio/01_meditation.wav")} />
      <svg width={width} height={height} style={{ backgroundColor: paper }}>
        {profileOpacity > 0.01 && (
          <g opacity={profileOpacity}>
            <Figure
          frame={frame}
              pose={profilePose}
              root={{ x, y: groundY + bob + sink }}
              scale={figureScale}
              strokeWidth={strokeWidth}
              roughness={roughness}
              ink={ink}
              headScale={headScale}
              limbRounding={limbRounding}
              torsoLength={torsoLength}
              neckLength={neckLength}
              neckGap={neckGap}
              torsoBottomExtend={torsoBottomExtend}
              seedOffset={0}
            />
          </g>
        )}
        {lotusOpacity > 0.01 && (
          <g opacity={lotusOpacity}>
            <Figure
          frame={frame}
              pose={seatedPose}
              root={{ x: restX, y: groundY + sinkUnits * figureScale }}
              scale={figureScale}
              strokeWidth={strokeWidth}
              roughness={roughness}
              ink={ink}
              headScale={headScale}
              limbRounding={limbRounding}
              torsoLength={torsoLength}
              neckLength={neckLength}
              neckGap={neckGap}
              torsoBottomExtend={torsoBottomExtend}
              curvedLimbs
              lotusLegs
              linkedArms
              seedOffset={300}
            />
          </g>
        )}
      </svg>
    </>
  );
};
