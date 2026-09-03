import { useMemo } from "react";
import type { PathInfo } from "roughjs/bin/core";
import { boilSeedFor } from "../rough/boil";
import { RoughPaths } from "../rough/RoughShape";
import { curve, ellipse, linearPath, roughPathsFor, type RoughOptions } from "../rough/useRoughPaths";
import type { BoneName, Skeleton } from "./skeleton";
import { SKELETON } from "./skeleton";
import { resolvePose, type Point, type Pose, type ResolvedPose } from "./pose";
import { strokeOutline, taper } from "./outline";
import { roundCorners } from "./corners";

/**
 * Renders a resolved pose as hand-drawn line art. This is the convergence point
 * of the two independent halves of the rig: `pose.ts` does the maths (pure,
 * tested, no React) and `lib/rough` does the drawing. Nothing else should need
 * to know about both.
 *
 * Note the two `Point` types in play: the figure maths uses `{x, y}` objects,
 * rough.js uses `[x, y]` tuples. This file is the only place that gap is bridged.
 */

/**
 * Limbs are drawn as CONTINUOUS polylines through their joints, not as one
 * stroke per bone. Fourteen separate segments would leave a visible gap and a
 * doubled-up stroke at every joint; a single pencil line through
 * hip -> knee -> ankle -> toe is both cheaper and what a person actually draws.
 */
const CHAINS: readonly BoneName[][] = [
  ["pelvis", "spine", "neck"], // torso, bottom to top
  ["leftUpperArm", "leftForearm"],
  ["rightUpperArm", "rightForearm"],
  ["leftThigh", "leftShin", "leftFoot"],
  ["rightThigh", "rightShin", "rightFoot"],
];

/**
 * Scaling happens on the geometry, not via an SVG transform on a wrapping <g>.
 * That distinction matters: an SVG scale would also multiply rough.js's stroke
 * width and wobble amplitude, so the same figure drawn larger would come out
 * with visibly heavier, wilder linework. Scaling coordinates about the root
 * keeps the pencil line identical at every figure size.
 */
const scaleAbout =
  (root: Point, scale: number) =>
  (p: Point): [number, number] => [
    root.x + (p.x - root.x) * scale,
    root.y + (p.y - root.y) * scale,
  ];

/** A chain's joints: the first bone's start, then every bone's end. */
const chainPoints = (
  resolved: ResolvedPose<BoneName>,
  chain: readonly BoneName[],
  at: (p: Point) => [number, number],
): [number, number][] => [
  at(resolved[chain[0]].start),
  ...chain.map((name) => at(resolved[name].end)),
];

export type FigureProps = {
  /**
   * Frame number, used only to advance the boil seed.
   *
   * Passed in rather than read from `useCurrentFrame()` so that this component
   * — and with it the whole drawing stack — has no Remotion dependency. The
   * Remotion scenes pass `useCurrentFrame()`; the pose editor passes whatever
   * frame it is previewing. This one prop is the entire difference between a
   * video renderer and an interactive tool.
   */
  frame: number;
  pose: Pose<BoneName>;
  /** Whole-figure translation, kept separate from the pose so a walk cycle can
   *  either play in place or travel across frame (this is "root motion"). */
  root: Point;
  /** Multiplies the figure's size about its root. The skeleton is defined in
   *  abstract units (roughly 110 tall), so scale 1 draws a ~110px figure. */
  scale?: number;
  ink?: string;
  strokeWidth?: number;
  /** rough.js roughness. The figure reads better slightly calmer than scenery:
   *  a wobbly limb looks broken, whereas a wobbly hill just looks drawn. */
  roughness?: number;
  /** Offsets this figure's boil seeds so two figures in one frame don't wobble
   *  in perfect lockstep. */
  seedOffset?: number;
  /**
   * Draw limbs as smooth curves through their joints rather than straight
   * segments. A crossed-leg lotus needs this: the classic yoga stick figure
   * reads as two soft loops, which straight hip->knee->ankle segments render
   * as an angular kite instead. Walking wants the opposite — straight limbs
   * read as bone, curved ones read as rubber.
   */
  curvedLimbs?: boolean;
  /**
   * Corner radius applied at every joint, in skeleton units. 0 leaves the
   * angular stick figure.
   *
   * This is what gives the reference figures their rounded elbows and knees.
   * It is NOT the same as `curvedLimbs`, which runs a spline through the joints
   * — a spline still pinches to a point at a sharp reversal, because the joints
   * themselves are the control points. Filleting inserts real geometry, so the
   * bend has a radius however tight the fold. See corners.ts.
   */
  limbRounding?: number;
  /**
   * "stroke" draws each limb as a single line down its centre — the stick
   * figure. "outline" draws the limb's SILHOUETTE instead, so arms and legs
   * have real thickness and taper from shoulder to wrist. Same pose data,
   * same skeleton; only the drawing changes.
   */
  limbStyle?: "stroke" | "outline";
  /**
   * Base half-width for outlined limbs, in skeleton units (the figure is about
   * 110 tall). Each chain scales its own taper from this, so one number
   * thickens or thins the whole figure.
   */
  limbWidth?: number;
  /**
   * Background colour used to FILL outlined limbs.
   *
   * Without a fill, an outlined arm crossing an outlined torso draws both sets
   * of edges and the figure reads as a tangle of loops. Filling each shape with
   * the paper colour makes nearer limbs occlude further ones, so the separate
   * pieces read as one connected silhouette — which is what the reference
   * drawings look like. Ignored when limbStyle is "stroke".
   */
  paper?: string;
  /**
   * Draw each leg as a CLOSED loop (hip -> knee -> ankle -> back to hip) rather
   * than an open polyline.
   *
   * This is what the reference yoga stick figures actually do, and it is not a
   * stylistic nicety — it is forced by the geometry. The thigh (30 units) and
   * shin (28) are nearly the same length, so folding the shin back toward the
   * centre line lays it almost exactly on top of the thigh, and an open stroke
   * collapses into a flat sliver with no enclosed area. Closing the path back
   * to the hip gives the crossed legs their rounded, open shape.
   */
  loopLegs?: boolean;
  /**
   * Replace the two leg chains with a pair of leaf shapes sweeping out from the
   * hip — the crossed-legs motif used by hand-drawn yoga figures.
   *
   * Worth being explicit about why this is not a pose: the reference lotus
   * cannot be produced by posing this skeleton. Thigh (30 units) and shin (28)
   * are near enough the same length that folding the shin back toward the
   * centre lays it on top of the thigh, leaving a degenerate sliver with no
   * area, whichever angles you choose. The drawn references solve this by not
   * drawing a skeleton at all: the folded leg is a single closed shape. So the
   * rig keeps doing torso, arms and head, and the crossed legs become a motif.
   */
  lotusLegs?: boolean;
  /**
   * Draw both arms as ONE continuous stroke: hand -> elbow -> shoulder ->
   * elbow -> hand.
   *
   * Drawn as two separate strokes they meet at a sharp apex under the head and
   * the figure reads as a tent. The reference drawings sweep a single arc
   * across the shoulders, and that one change is most of what makes them look
   * neat rather than constructed.
   */
  linkedArms?: boolean;
  /**
   * Overrides the spine bone's length, in skeleton units (default 34).
   *
   * Torso length is the proportion that most changes the figure's character:
   * shortening it enlarges the head relative to the body and pulls the hands
   * down toward the knees when seated. Applied by deriving a modified skeleton
   * rather than mutating the shared SKELETON constant, so two figures with
   * different torsos can appear in the same frame.
   */
  torsoLength?: number;
  /**
   * Overrides the neck bone's length (default 8) — the gap between the
   * shoulders and the head, i.e. where the spine attaches to the head.
   */
  neckLength?: number;
  /**
   * Gap between the top of the neck stroke and the head, in skeleton units.
   *
   * The neck cannot simply stop at the head BONE, because the head is drawn as
   * an ellipse scaled by `headScale` — at 1.85 the oval extends well below the
   * bone's base and swallows the top of the neck, so the line appears to pierce
   * the head. Instead the stroke is trimmed to the ellipse's actual edge, and
   * this offsets it from there: 0 meets the outline exactly, positive leaves a
   * visible gap, negative pushes back inside the head.
   *
   * Because it is measured from the computed outline, it stays correct when
   * `headScale` changes.
   */
  neckGap?: number;
  /**
   * Moves the BOTTOM END of the drawn torso stroke, in skeleton units.
   * Positive pushes it down past the hip and into the crossed legs; negative
   * stops it short, leaving the torso floating above them.
   *
   * This is a drawing control, not a bone, and deliberately so. The torso
   * stroke starts at the pelvis root, which is the same point the lotus legs
   * sweep out from, so the two coincide by construction — lengthening the
   * pelvis bone would raise the hip and the leg attachment rather than move
   * the visible end of the line.
   */
  torsoBottomExtend?: number;
  /**
   * Enlarges the head relative to the body. Real proportions are about 1:7.5,
   * but the reference stick figures use a much bigger head, which is what makes
   * them read as a drawn character rather than a diagram.
   */
  headScale?: number;
};

export const Figure: React.FC<FigureProps> = ({
  frame,
  pose,
  root,
  scale = 1,
  ink = "#1b1b1b",
  strokeWidth = 3,
  roughness = 1.1,
  seedOffset = 0,
  curvedLimbs = false,
  limbRounding = 0,
  limbStyle = "stroke",
  limbWidth = 3.4,
  paper,
  loopLegs = false,
  lotusLegs = false,
  linkedArms = false,
  torsoLength,
  neckLength,
  neckGap = 0,
  torsoBottomExtend = 0,
  headScale = 1,
}) => {
  const skeleton = useMemo<Skeleton<BoneName>>(() => {
    const overrides: Partial<Record<BoneName, number>> = {
      spine: torsoLength,
      neck: neckLength,
    };
    return SKELETON.map((bone) => {
      const length = overrides[bone.name];
      return length === undefined ? bone : { ...bone, length };
    });
  }, [torsoLength, neckLength]);

  const paths = useMemo<PathInfo[]>(() => {
    const resolved = resolvePose(skeleton, pose, root);
    const at = scaleAbout(root, scale);

    const base = (index: number): RoughOptions => ({
      seed: boilSeedFor(frame, seedOffset + index),
      roughness,
      bowing: 0.8,
      stroke: ink,
      strokeWidth,
    });

    const stroke = curvedLimbs ? curve : linearPath;

    /**
     * Half-widths along each chain, in screen units.
     *
     * The torso is widest across the chest and narrows to the neck; limbs taper
     * toward the extremity. These proportions are what make the outline read as
     * a body rather than as pipes of uniform bore.
     */
    const widthsFor = (chain: readonly BoneName[], count: number): number[] => {
      const u = limbWidth * scale;
      if (chain[0] === "pelvis") {
        // hip, waist, chest, neck
        return [u * 1.25, u * 1.5, u * 1.35, u * 0.6].slice(0, count);
      }
      if (chain[0].endsWith("UpperArm")) return taper(count, u * 0.95, u * 0.45);
      return taper(count, u * 1.3, u * 0.5);
    };

    const asPoints = (pts: [number, number][]): Point[] =>
      pts.map(([x, y]) => ({ x, y }));
    const asTuples = (pts: Point[]): [number, number][] =>
      pts.map((p) => [p.x, p.y]);
    const isLeg = (chain: readonly BoneName[]) => chain[0].endsWith("Thigh");

    /** A leaf: out from the hip to a tip, bulging either side of that axis. */
    const leaf = (
      hip: [number, number],
      angleDeg: number,
      length: number,
      width: number,
    ): [number, number][] => {
      const a = (angleDeg * Math.PI) / 180;
      const dir: [number, number] = [Math.sin(a), -Math.cos(a)];
      const perp: [number, number] = [-dir[1], dir[0]];
      const tip: [number, number] = [hip[0] + dir[0] * length, hip[1] + dir[1] * length];
      const bulge = (side: number, along: number): [number, number] => [
        hip[0] + dir[0] * length * along + perp[0] * width * side,
        hip[1] + dir[1] * length * along + perp[1] * width * side,
      ];
      return [hip, bulge(1, 0.45), tip, bulge(-1, 0.45), hip];
    };

    const isArm = (chain: readonly BoneName[]) => chain[0].endsWith("UpperArm");
    const isTorso = (chain: readonly BoneName[]) => chain[0] === "pelvis";

    // The head is an ellipse spanning the head bone rather than a stroke along
    // it. An egg shape rather than a circle: every hand-drawn stick figure
    // reference uses a taller-than-wide head, and it reads as a face turned
    // toward the viewer in a way a circle does not.
    const headBone = resolved.head;
    const [hx1, hy1] = at(headBone.start);
    const [hx2, hy2] = at(headBone.end);
    const headHeight = Math.hypot(hx2 - hx1, hy2 - hy1) * headScale;
    const headCentre: [number, number] = [(hx1 + hx2) / 2, (hy1 + hy2) / 2];
    const head = roughPathsFor(
      ellipse(headCentre[0], headCentre[1], headHeight * 0.82, headHeight),
      {
        ...base(CHAINS.length),
        // Filled in outline mode and drawn last, so the top of the neck is
        // hidden behind the head instead of showing through it.
        ...(limbStyle === "outline" && paper ? { fill: paper, fillStyle: "solid" } : {}),
      },
    );

    /**
     * Where the neck stroke should stop: on the head outline, measured from the
     * head's centre back down the neck's own axis, so it stays right when the
     * spine is tilted rather than assuming the head sits straight up.
     */
    const collar = (): [number, number] => {
      const dx = hx1 - headCentre[0];
      const dy = hy1 - headCentre[1];
      const mag = Math.hypot(dx, dy) || 1;
      const out = headHeight / 2 + neckGap * scale;
      return [headCentre[0] + (dx / mag) * out, headCentre[1] + (dy / mag) * out];
    };

    const limbs = CHAINS.flatMap((chain, i) => {
      let pts = chainPoints(resolved, chain, at);
      if (lotusLegs && isLeg(chain)) return [];
      if (linkedArms && isArm(chain)) return [];
      if (isTorso(chain)) {
        // The torso stroke is drawn bottom-up: its first point is the hip end,
        // its last is the top of the neck.
        if (torsoBottomExtend !== 0) {
          const [bx, by] = pts[0];
          pts = [[bx, by + torsoBottomExtend * scale], ...pts.slice(1)];
        }
        pts = [...pts.slice(0, -1), collar()];
      }
      if (limbStyle === "outline") {
        // A limb with every joint at the same spot has no direction to offset
        // along; fall back to the stroke rather than emitting a degenerate shape.
        const distinct = pts.filter(
          (p, i) => i === 0 || Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) > 1e-6,
        );
        if (distinct.length >= 2) {
          const outline = strokeOutline(asPoints(distinct), {
            halfWidths: widthsFor(chain, distinct.length),
            capSegments: 7,
          });
          return roughPathsFor(curve(asTuples(outline)), {
            ...base(i),
            ...(paper ? { fill: paper, fillStyle: "solid" } : {}),
          });
        }
      }
      if (limbRounding > 0 && pts.length > 2) {
        pts = asTuples(roundCorners(asPoints(pts), limbRounding * scale));
      }
      if (loopLegs && isLeg(chain)) {
        // Repeat the hip at the end to close the loop. rough.js's curve has no
        // "closed" flag, so returning to the first point is how the shape is
        // sealed; the sketchy stroke hides the seam.
        return roughPathsFor(curve([...pts, pts[0]]), base(i));
      }
      return roughPathsFor(stroke(pts), base(i));
    });

    // The two loops start on OPPOSITE sides of the centre line and sweep across
    // it, so they overlap in the middle. That crossing is what reads as legs
    // folded over one another; leaves meeting at a single hip point read as a
    // bow tie instead.
    const hip = at(resolved.pelvis.start);
    const legBoneLength = (name: BoneName) =>
      skeleton.find((b) => b.name === name)?.length ?? 0;
    const legSpan =
      (legBoneLength("leftThigh") + legBoneLength("leftShin")) * 0.92 * scale;
    // Stagger the two loops VERTICALLY rather than horizontally. Offsetting
    // them sideways moved their sharp inner points apart and drew a small
    // diamond at the centre; a vertical stagger overlaps them so one reads as
    // passing over the other, with no artefact.
    const stagger = 2.5 * scale;
    const lotus = lotusLegs
      ? [
          ...roughPathsFor(
            curve(leaf([hip[0], hip[1] - stagger], 262, legSpan, 13 * scale)),
            base(CHAINS.length + 1),
          ),
          ...roughPathsFor(
            curve(leaf([hip[0], hip[1] + stagger], 98, legSpan, 13 * scale)),
            base(CHAINS.length + 2),
          ),
        ]
      : [];

    const armChain: [number, number][] = [
      at(resolved.leftForearm.end),
      at(resolved.leftForearm.start),
      at(resolved.leftUpperArm.start),
      at(resolved.rightForearm.start),
      at(resolved.rightForearm.end),
    ];
    const arms = linkedArms
      ? roughPathsFor(
          curve(
            limbRounding > 0
              ? asTuples(roundCorners(asPoints(armChain), limbRounding * scale))
              : armChain,
          ),
          base(CHAINS.length + 3),
        )
      : [];

    return [...limbs, ...arms, ...lotus, ...head];
  }, [pose, root, scale, frame, ink, strokeWidth, roughness, seedOffset, curvedLimbs, limbRounding, limbStyle, limbWidth, paper, loopLegs, lotusLegs, linkedArms, headScale, skeleton, torsoBottomExtend]);

  return <RoughPaths paths={paths} />;
};
