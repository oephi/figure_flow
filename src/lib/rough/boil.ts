/**
 * "Boil" is the shimmer of hand-drawn animation: the same shape redrawn slightly
 * differently on each drawing. rough.js gives us that for free, but only if we
 * control the seed ourselves.
 *
 * Two reasons the seed must be explicit:
 *
 *  1. Left unset, rough.js re-randomises on every call. Remotion re-renders every
 *     frame and may render frames in parallel across several browser tabs, so you
 *     get strobing rather than boil — and renders that never reproduce.
 *
 *  2. Seed 0 is NOT a valid seed. rough.js's Random.next() reads:
 *         if (this.seed) { ...deterministic... } else { return Math.random(); }
 *     so a seed of 0 falls through to Math.random(). Frame 0 would flicker on
 *     every render while every other frame stayed stable. Hence the +1.
 *
 * Holding each drawing for several frames is how hand-drawn animation is actually
 * made ("on twos" / "on threes"). At 30fps, 4 frames per step reads as a lively
 * pencil line; 1 would be frantic, 12 nearly static.
 */
export const FRAMES_PER_BOIL_STEP = 4;

export const boilSeed = (
  frame: number,
  framesPerStep: number = FRAMES_PER_BOIL_STEP,
): number => Math.floor(frame / framesPerStep) + 1;

/**
 * When several shapes share a frame they must not share a seed, or their wobble
 * moves in lockstep and the drawing looks mechanically uniform. Offset per shape.
 */
export const boilSeedFor = (
  frame: number,
  shapeIndex: number,
  framesPerStep: number = FRAMES_PER_BOIL_STEP,
): number => boilSeed(frame, framesPerStep) + shapeIndex * 1000;
