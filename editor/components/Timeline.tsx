import { EASING_NAMES, type EasingName } from "../../src/lib/anim/easingRegistry";
import type { TrackDoc } from "../../src/lib/poses/types";

export interface TimelineProps {
  doc: TrackDoc;
  frame: number;
  playing: boolean;
  onScrub: (frame: number) => void;
  onTogglePlay: () => void;
  onAddKeyframe: () => void;
  onDeleteKeyframe: (frame: number) => void;
  onDuplicateKeyframe: (from: number, to: number) => void;
  onSetEasing: (frame: number, easing: EasingName) => void;
  onMirrorSecondHalf: () => void;
}

/**
 * Keyframe timeline.
 *
 * Contains no track logic of its own — every mutation is delegated to the
 * caller, which routes it through `src/lib/poses/trackEdit.ts`. That is
 * deliberate: those operations maintain the sorted-no-duplicates invariant and
 * are unit-tested, so duplicating any of that reasoning in the UI would be a
 * second, untested implementation waiting to disagree.
 */
export const Timeline: React.FC<TimelineProps> = ({
  doc,
  frame,
  playing,
  onScrub,
  onTogglePlay,
  onAddKeyframe,
  onDeleteKeyframe,
  onDuplicateKeyframe,
  onSetEasing,
  onMirrorSecondHalf,
}) => {
  const total = doc.durationInFrames;
  const keyframeHere = doc.keyframes.find((kf) => kf.frame === frame);
  const percent = (f: number) => (total === 0 ? 0 : (f / total) * 100);

  return (
    <div className="timeline">
      <div className="timeline-controls">
        <button onClick={onTogglePlay} title="Play or pause the track">
          {playing ? "❚❚ Pause" : "▶ Play"}
        </button>
        <span className="frame-label">
          frame {frame} / {total}
        </span>
        <button onClick={onAddKeyframe} title="Key the current pose at this frame">
          + Key
        </button>
        <button
          onClick={() => onDeleteKeyframe(frame)}
          disabled={!keyframeHere || doc.keyframes.length <= 1}
          title={
            doc.keyframes.length <= 1
              ? "A track needs at least one keyframe"
              : "Delete the keyframe on this frame"
          }
        >
          − Key
        </button>
        <button
          onClick={() => onDuplicateKeyframe(frame, Math.min(frame + 3, total))}
          disabled={!keyframeHere}
          title="Copy this keyframe 3 frames later"
        >
          Duplicate
        </button>
        <label className="easing-picker">
          easing in
          <select
            value={keyframeHere?.easing ?? "linear"}
            disabled={!keyframeHere}
            onChange={(e) => onSetEasing(frame, e.target.value as EasingName)}
          >
            {EASING_NAMES.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <button
          onClick={onMirrorSecondHalf}
          title="Regenerate the second half of the cycle by mirroring the first"
        >
          Mirror 2nd half
        </button>
      </div>

      <div className="timeline-track">
        {/* Scrubbing is a range input rather than a click-mapped div: it gets
            keyboard arrows, focus handling and touch for free. */}
        <input
          type="range"
          min={0}
          max={total}
          step={1}
          value={frame}
          onChange={(e) => onScrub(Number(e.target.value))}
          aria-label="Current frame"
        />
        <div className="timeline-markers">
          {doc.keyframes.map((kf) => (
            <button
              key={kf.frame}
              className={`keyframe-marker${kf.frame === frame ? " is-current" : ""}`}
              style={{ left: `${percent(kf.frame)}%` }}
              onClick={() => onScrub(kf.frame)}
              title={`${kf.label ? kf.label + " — " : ""}frame ${kf.frame}${
                kf.easing ? ` (${kf.easing})` : ""
              }`}
            >
              <span className="keyframe-diamond" />
              {kf.label && <span className="keyframe-label">{kf.label}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
