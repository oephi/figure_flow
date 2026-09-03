import { useMemo, useRef, useState } from "react";
import { Figure } from "../../src/lib/figure/Figure";
import { resolvePose, type Point, type Pose } from "../../src/lib/figure/pose";
import { SKELETON, type BoneName } from "../../src/lib/figure/skeleton";

/** Same paper/ink palette the Remotion scenes use (see MeditationFigure's defaultProps). */
export const PAPER = "#f4f1ea";
export const INK = "#1b1b1b";

/**
 * Bones whose end is a limb tip, mapped to the two-bone chain that reaches it.
 * Dragging one of these in IK mode bends both bones; anything else just rotates
 * the single bone you grabbed.
 *
 * Feet and hands are deliberately absent: a foot hangs off the shin, so its end
 * is the tip of a THREE-bone chain, and `solveTwoBoneIk` only solves two.
 */
export const IK_CHAINS: Partial<Record<BoneName, { upper: BoneName; lower: BoneName }>> = {
  leftForearm: { upper: "leftUpperArm", lower: "leftForearm" },
  rightForearm: { upper: "rightUpperArm", lower: "rightForearm" },
  leftShin: { upper: "leftThigh", lower: "leftShin" },
  rightShin: { upper: "rightThigh", lower: "rightShin" },
};

export interface FigureCanvasProps {
  pose: Pose<BoneName>;
  /** Passed straight through to <Figure frame>; drives boil, nothing else. */
  frame: number;
  width?: number;
  height?: number;
  root?: Point;
  scale?: number;
  /** "aim" rotates the grabbed bone; "ik" bends a two-bone chain to reach. */
  mode?: "aim" | "ik";
  limbRounding?: number;
  /**
   * Called continuously while dragging. `target` is in POSE space (the same
   * coordinates `resolvePose` works in), not screen pixels — the canvas owns
   * the scale transform, so callers never need to know about it.
   */
  onDragJoint?: (bone: BoneName, target: Point) => void;
  onDragEnd?: () => void;
}

export const FigureCanvas: React.FC<FigureCanvasProps> = ({
  pose,
  frame,
  width = 640,
  height = 640,
  root = { x: width / 2, y: height * 0.72 },
  scale = 4,
  mode = "aim",
  limbRounding = 0,
  onDragJoint,
  onDragEnd,
}) => {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [dragging, setDragging] = useState<BoneName | null>(null);
  const [hovered, setHovered] = useState<BoneName | null>(null);

  const resolved = useMemo(() => resolvePose(SKELETON, pose, root), [pose, root]);

  const toScreen = (p: Point): Point => ({
    x: root.x + (p.x - root.x) * scale,
    y: root.y + (p.y - root.y) * scale,
  });

  /**
   * Screen pixels back to pose space. Goes via getScreenCTM rather than
   * subtracting the element's bounding rect, so it stays correct if the SVG is
   * ever scaled by CSS or sits inside a transformed container — the classic
   * cause of a handle that drifts away from the cursor.
   */
  const toPoseSpace = (clientX: number, clientY: number): Point | null => {
    const svg = svgRef.current;
    if (!svg) return null;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const local = pt.matrixTransform(ctm.inverse());
    return {
      x: root.x + (local.x - root.x) / scale,
      y: root.y + (local.y - root.y) / scale,
    };
  };

  const handlePointerDown = (bone: BoneName) => (event: React.PointerEvent) => {
    event.preventDefault();
    // Capture on the handle itself so the drag survives the pointer leaving the
    // small hit circle, which it does immediately at any real drag speed.
    (event.target as Element).setPointerCapture?.(event.pointerId);
    setDragging(bone);
  };

  const handlePointerMove = (event: React.PointerEvent) => {
    if (!dragging || !onDragJoint) return;
    const target = toPoseSpace(event.clientX, event.clientY);
    if (target) onDragJoint(dragging, target);
  };

  const stopDrag = () => {
    if (!dragging) return;
    setDragging(null);
    onDragEnd?.();
  };

  const handleColour = (bone: BoneName): string => {
    if (dragging === bone) return "#e0523f";
    if (hovered === bone) return "#2f7dd1";
    return mode === "ik" && IK_CHAINS[bone] ? "#2f7dd1" : "#8a8378";
  };

  return (
    <svg
      ref={svgRef}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ background: PAPER, display: "block", touchAction: "none" }}
      onPointerMove={handlePointerMove}
      onPointerUp={stopDrag}
      onPointerCancel={stopDrag}
      onPointerLeave={stopDrag}
    >
      <Figure
        frame={frame}
        pose={pose}
        root={root}
        scale={scale}
        ink={INK}
        strokeWidth={2}
        roughness={0.7}
        limbRounding={limbRounding}
      />

      <g data-role="joint-handles">
        {SKELETON.map((bone) => {
          const { x, y } = toScreen(resolved[bone.name].end);
          const active = dragging === bone.name || hovered === bone.name;
          const isIkTip = mode === "ik" && Boolean(IK_CHAINS[bone.name]);
          return (
            <circle
              key={bone.name}
              data-bone={bone.name}
              cx={x}
              cy={y}
              r={active ? 9 : isIkTip ? 7 : 5}
              fill={handleColour(bone.name)}
              fillOpacity={active ? 0.9 : 0.42}
              stroke={active ? handleColour(bone.name) : "none"}
              strokeWidth={2}
              style={{ cursor: "grab" }}
              onPointerDown={handlePointerDown(bone.name)}
              onPointerEnter={() => setHovered(bone.name)}
              onPointerLeave={() => setHovered((h) => (h === bone.name ? null : h))}
            />
          );
        })}
      </g>

      {dragging && (
        <text x={12} y={height - 14} fontSize={13} fill="#8a8378" fontFamily="monospace">
          {mode === "ik" && IK_CHAINS[dragging]
            ? `ik: ${IK_CHAINS[dragging]!.upper} + ${dragging}`
            : `aim: ${dragging}`}
        </text>
      )}
    </svg>
  );
};
