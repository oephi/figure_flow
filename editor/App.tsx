import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FigureCanvas, IK_CHAINS } from "./components/FigureCanvas";
import { JointReadout } from "./components/JointReadout";
import { Timeline } from "./components/Timeline";
import {
  discoverLibrary,
  entryFromDoc,
  toPoseFileName,
  type LibraryEntry,
} from "./lib/library";
import { savePose } from "./lib/api";
import { aimBoneAt } from "../src/lib/figure/aim";
import { solveTwoBoneIk, type Bend } from "../src/lib/figure/ik";
import { interpolatePose } from "../src/lib/figure/interpolate";
import { mirror } from "../src/lib/figure/mirror";
import { POSE_FORMAT_VERSION, toPose, type PoseDoc, type TrackDoc } from "../src/lib/poses/types";
import {
  keyframeAt,
  mirrorSecondHalf,
  removeKeyframe,
  setEasing,
  upsertKeyframe,
  duplicateKeyframe,
} from "../src/lib/poses/trackEdit";
import type { Point, Pose } from "../src/lib/figure/pose";
import { SKELETON, type BoneName } from "../src/lib/figure/skeleton";
import type { EasingName } from "../src/lib/anim/easingRegistry";

type Doc = PoseDoc | TrackDoc;
const isTrack = (doc: Doc): doc is TrackDoc => "keyframes" in doc;

type SaveStatus = { kind: "idle" | "saving" } | { kind: "done" | "error"; message: string };

/** Pose space origin used by the canvas; kept here so drags and render agree. */
const CANVAS = { width: 660, height: 620, scale: 3.6 };
/**
 * Legs hang BELOW the pelvis root (~58 skeleton units), so the root must sit
 * high enough that 58 * scale still fits above the bottom edge. At scale 3.6
 * that is 209px of leg, hence 0.58 rather than something closer to the floor.
 */
const ROOT: Point = { x: CANVAS.width / 2, y: CANVAS.height * 0.58 };

const poseToRaw = (pose: Pose<BoneName>): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const bone of SKELETON) {
    const angle = pose[bone.name];
    if (angle !== undefined) out[bone.name] = angle;
  }
  return out;
};

export const App: React.FC = () => {
  /**
   * Seeded from what is on disk at build time, then appended to when a new pose
   * is created. Held in state rather than read from the module each render so a
   * pose created in this session appears immediately, without waiting for Vite
   * to re-scan the glob.
   */
  const [library, setLibrary] = useState<LibraryEntry[]>(() => discoverLibrary());
  const [selectedId, setSelectedId] = useState(library[0].id);
  const [newName, setNewName] = useState("");
  const [newKind, setNewKind] = useState<"pose" | "track">("pose");
  const [newFps, setNewFps] = useState(30);
  const [newDuration, setNewDuration] = useState(24);
  /** Working copies, keyed by library id. Absent means "unmodified". */
  const [drafts, setDrafts] = useState<Record<string, Doc>>({});
  /**
   * Undo history per entry. Every edit pushes the PREVIOUS document, which is
   * cheap because `trackEdit` is immutable — no inverse operations to write.
   */
  const [history, setHistory] = useState<Record<string, Doc[]>>({});
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [mode, setMode] = useState<"aim" | "ik">("aim");
  const [limbRounding, setLimbRounding] = useState(4);
  const [bend, setBend] = useState<Bend>(1);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>({ kind: "idle" });

  const entry: LibraryEntry = useMemo(
    () => library.find((e) => e.id === selectedId) ?? library[0],
    [library, selectedId],
  );
  const doc: Doc = drafts[selectedId] ?? entry.doc;
  const dirty = Boolean(drafts[selectedId]);

  /** Commits a new document, recording the old one for undo. */
  const commit = useCallback(
    (next: Doc) => {
      setHistory((h) => ({ ...h, [selectedId]: [...(h[selectedId] ?? []), doc] }));
      setDrafts((d) => ({ ...d, [selectedId]: next }));
      setSaveStatus({ kind: "idle" });
    },
    [doc, selectedId],
  );

  const undo = useCallback(() => {
    const stack = history[selectedId];
    if (!stack?.length) return;
    const previous = stack[stack.length - 1];
    setHistory((h) => ({ ...h, [selectedId]: stack.slice(0, -1) }));
    setDrafts((d) => {
      const next = { ...d };
      // Popping back to the pristine document should clear the dirty flag, not
      // leave an identical-looking draft that still reports unsaved changes.
      if (previous === entry.doc) delete next[selectedId];
      else next[selectedId] = previous;
      return next;
    });
  }, [entry.doc, history, selectedId]);

  // ---- current pose -----------------------------------------------------
  const keyframes = useMemo(
    () => (isTrack(doc) ? doc.keyframes.map((kf) => ({
      frame: kf.frame,
      pose: toPose(kf.pose, doc.name),
    })) : null),
    [doc],
  );

  const currentPose: Pose<BoneName> = useMemo(() => {
    if (!isTrack(doc)) return toPose(doc.pose, doc.name);
    return interpolatePose(keyframes!, frame);
  }, [doc, keyframes, frame]);

  // ---- playback ---------------------------------------------------------
  const rafRef = useRef<number | null>(null);
  useEffect(() => {
    if (!playing || !isTrack(doc)) return;
    const total = doc.durationInFrames;
    let last = performance.now();
    let current = frame;
    const tick = (now: number) => {
      const elapsed = now - last;
      const perFrame = 1000 / doc.fps;
      if (elapsed >= perFrame) {
        const advance = Math.floor(elapsed / perFrame);
        current = (current + advance) % (total + 1);
        last += advance * perFrame;
        setFrame(current);
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
    // `frame` is intentionally omitted: including it would restart the loop on
    // every tick. Playback reads the frame once on start and drives it locally.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, doc]);

  // ---- editing ----------------------------------------------------------
  /**
   * Applies a pose change to whatever is selected.
   *
   * For a track, editing while parked between keyframes KEYS the current
   * interpolated pose first, then edits that. This is how every animation tool
   * behaves, and the alternative — silently discarding the edit — is worse.
   */
  const applyPose = useCallback(
    (next: Pose<BoneName>) => {
      if (!isTrack(doc)) {
        commit({ ...doc, pose: poseToRaw(next) });
        return;
      }
      commit(upsertKeyframe(doc, frame, poseToRaw(next)));
    },
    [commit, doc, frame],
  );

  const handleDragJoint = useCallback(
    (bone: BoneName, target: Point) => {
      const chain = IK_CHAINS[bone];
      if (mode === "ik" && chain) {
        const solved = solveTwoBoneIk({
          skeleton: SKELETON,
          pose: currentPose,
          root: ROOT,
          upper: chain.upper,
          lower: chain.lower,
          target,
          bend,
        });
        applyPose({ ...currentPose, [chain.upper]: solved.upper, [chain.lower]: solved.lower });
        return;
      }
      const angle = aimBoneAt({ skeleton: SKELETON, pose: currentPose, root: ROOT, bone, target });
      applyPose({ ...currentPose, [bone]: angle });
    },
    [applyPose, bend, currentPose, mode],
  );

  const handleMirrorPose = () => applyPose(mirror(currentPose));

  const handleReset = () => {
    setDrafts((d) => {
      const next = { ...d };
      delete next[selectedId];
      return next;
    });
    setHistory((h) => ({ ...h, [selectedId]: [] }));
    setSaveStatus({ kind: "idle" });
  };

  /**
   * Creates a new pose or track file from whatever is currently on screen, then
   * selects it.
   *
   * Written to disk immediately rather than left dirty: an in-memory-only entry
   * that vanished on reload after ten minutes of posing would be a nasty
   * surprise. The save server independently re-validates the path.
   */
  const handleCreate = async () => {
    const slug = toPoseFileName(newName);
    if (!slug) {
      setSaveStatus({ kind: "error", message: "give it a name first" });
      return;
    }
    const path = newKind === "pose" ? `library/${slug}.json` : `tracks/${slug}.json`;
    if (library.some((e) => e.path === path)) {
      setSaveStatus({ kind: "error", message: `poses/${path} already exists` });
      return;
    }

    const raw = poseToRaw(currentPose);
    const newDoc: Doc =
      newKind === "pose"
        ? {
            version: POSE_FORMAT_VERSION,
            name: slug,
            description: `Created in the pose editor from ${entry.doc.name}.`,
            pose: raw,
          }
        : {
            version: POSE_FORMAT_VERSION,
            name: slug,
            description: `Created in the pose editor from ${entry.doc.name}.`,
            fps: newFps,
            durationInFrames: newDuration,
            // Two identical keyframes rather than one. A single keyframe is
            // technically valid but degenerate — nothing to interpolate between
            // and a timeline with no span. Bookending the duration with the same
            // pose gives a loop-shaped starting point you can immediately key
            // against, and matches how the walk track is built.
            keyframes: [
              { frame: 0, label: "start", pose: raw },
              { frame: newDuration, label: "end", pose: { ...raw } },
            ],
          };

    setSaveStatus({ kind: "saving" });
    const result = await savePose(path, newDoc);
    if (!result.ok) {
      setSaveStatus({ kind: "error", message: result.error ?? "unknown error" });
      return;
    }
    setLibrary((items) =>
      [...items, entryFromDoc(newDoc, path)].sort((a, b) =>
        a.kind === b.kind ? a.path.localeCompare(b.path) : a.kind === "pose" ? -1 : 1,
      ),
    );
    setNewName("");
    setSelectedId(path);
    setFrame(0);
    setPlaying(false);
    setSaveStatus({ kind: "done", message: `created poses/${path}` });
  };

  const handleSave = async () => {
    setSaveStatus({ kind: "saving" });
    const result = await savePose(entry.path, doc);
    setSaveStatus(
      result.ok
        ? { kind: "done", message: `saved poses/${result.path}` }
        : { kind: "error", message: result.error ?? "unknown error" },
    );
  };

  const trackDoc = isTrack(doc) ? doc : null;

  return (
    <div className="app">
      <aside className="sidebar">
        <h1>Pose editor</h1>
        <ul className="library">
          {library.map((item) => (
            <li key={item.id}>
              <button
                className={item.id === selectedId ? "is-selected" : ""}
                onClick={() => {
                  setSelectedId(item.id);
                  setFrame(0);
                  setPlaying(false);
                }}
              >
                <span className="kind">{item.kind}</span>
                {item.doc.name}
                {drafts[item.id] && <span className="dot" title="unsaved changes">●</span>}
              </button>
            </li>
          ))}
        </ul>

        <div className="new-pose">
          <h2>Create new</h2>
          <div className="kind-toggle">
            <label>
              <input
                type="radio"
                checked={newKind === "pose"}
                onChange={() => setNewKind("pose")}
              />
              pose
            </label>
            <label>
              <input
                type="radio"
                checked={newKind === "track"}
                onChange={() => setNewKind("track")}
              />
              track
            </label>
          </div>
          <p className="hint">
            {newKind === "pose"
              ? "Saves the pose currently on screen as a new file."
              : "Starts an animation bookended by the pose currently on screen."}
          </p>
          {newKind === "track" && (
            <div className="track-fields">
              <label>
                fps
                <input
                  type="number"
                  min={1}
                  max={120}
                  value={newFps}
                  onChange={(e) => setNewFps(Math.max(1, Number(e.target.value) || 1))}
                />
              </label>
              <label>
                frames
                <input
                  type="number"
                  min={1}
                  max={3000}
                  value={newDuration}
                  onChange={(e) => setNewDuration(Math.max(1, Number(e.target.value) || 1))}
                />
              </label>
              <span className="hint">
                {(newDuration / newFps).toFixed(2)}s
              </span>
            </div>
          )}
          <div className="new-pose-row">
            <input
              type="text"
              value={newName}
              placeholder={newKind === "pose" ? "e.g. bow forward" : "e.g. slow bow"}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleCreate();
              }}
            />
            <button onClick={() => void handleCreate()} disabled={!toPoseFileName(newName)}>
              Create
            </button>
          </div>
          {newName.trim() && (
            <p className="hint">
              → poses/{newKind === "pose" ? "library" : "tracks"}/{toPoseFileName(newName)}.json
            </p>
          )}
        </div>

        <div className="drag-mode">
          <h2>Joint rounding</h2>
          <label className="slider-row">
            <input
              type="range"
              min={0}
              max={12}
              step={0.5}
              value={limbRounding}
              onChange={(ev) => setLimbRounding(Number(ev.target.value))}
            />
            <span className="slider-value">{limbRounding}</span>
          </label>
          <p className="hint">Rounds elbows and knees. 0 is the angular stick figure.</p>
        </div>

        <div className="drag-mode">
          <h2>Drag mode</h2>
          <label>
            <input type="radio" checked={mode === "aim"} onChange={() => setMode("aim")} />
            Aim — rotate the bone you grab
          </label>
          <label>
            <input type="radio" checked={mode === "ik"} onChange={() => setMode("ik")} />
            IK — drag a hand or shin, two bones bend
          </label>
          {mode === "ik" && (
            <button className="bend" onClick={() => setBend((b) => (b === 1 ? -1 : 1))}>
              flip bend ({bend === 1 ? "elbow ↑" : "elbow ↓"})
            </button>
          )}
        </div>

        <div className="actions">
          <button onClick={handleMirrorPose}>Mirror pose L↔R</button>
          <button onClick={undo} disabled={!history[selectedId]?.length}>
            Undo
          </button>
          <button onClick={handleReset} disabled={!dirty}>
            Revert to file
          </button>
          <button className="primary" onClick={handleSave} disabled={!dirty}>
            Save to poses/
          </button>
          {saveStatus.kind === "saving" && <p className="status">saving…</p>}
          {saveStatus.kind === "done" && <p className="status ok">{saveStatus.message}</p>}
          {saveStatus.kind === "error" && <p className="status bad">{saveStatus.message}</p>}
        </div>
      </aside>

      <main className="stage">
        <FigureCanvas
          pose={currentPose}
          frame={frame}
          width={CANVAS.width}
          height={CANVAS.height}
          root={ROOT}
          scale={CANVAS.scale}
          mode={mode}
          limbRounding={limbRounding}
          onDragJoint={handleDragJoint}
        />
        {trackDoc && (
          <Timeline
            doc={trackDoc}
            frame={frame}
            playing={playing}
            onScrub={(f) => {
              setPlaying(false);
              setFrame(f);
            }}
            onTogglePlay={() => setPlaying((p) => !p)}
            onAddKeyframe={() => commit(upsertKeyframe(trackDoc, frame, poseToRaw(currentPose)))}
            onDeleteKeyframe={(f) => commit(removeKeyframe(trackDoc, f))}
            onDuplicateKeyframe={(from, to) => commit(duplicateKeyframe(trackDoc, from, to))}
            onSetEasing={(f, easing: EasingName) => commit(setEasing(trackDoc, f, easing))}
            onMirrorSecondHalf={() => commit(mirrorSecondHalf(trackDoc))}
          />
        )}
      </main>

      <aside className="inspector">
        <JointReadout pose={currentPose} />
        {trackDoc && (
          <p className="hint">
            {keyframeAt(trackDoc, frame)
              ? `Editing keyframe at frame ${frame}.`
              : `Frame ${frame} is between keyframes — dragging will key it.`}
          </p>
        )}
      </aside>
    </div>
  );
};
