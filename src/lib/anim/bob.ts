/**
 * Vertical bob of the pelvis over a walk cycle, in skeleton units.
 *
 * The body is lowest at the DOWN pose and highest at UP, twice per cycle —
 * hence the 4π. Without this the figure glides; the rise and fall is what sells
 * the weight of each step.
 *
 * Kept here rather than beside the walk data because it is behaviour, not data:
 * the pose keyframes moved to JSON, and a function cannot.
 */
export const pelvisBob = (frame: number, cycleFrames: number, amplitude = 2.2): number =>
  -Math.cos((4 * Math.PI * frame) / cycleFrames) * amplitude;
