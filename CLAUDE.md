# CLAUDE.md

Instructions for working in this repository.

## What this project is

A local pipeline that turns a narration script and some scene code into a short,
hand-drawn-looking animated video. Everything is authored as code and data: no GUI
animation tool, no timeline to click around in, no GPU.

The human maintaining this is an experienced software engineer and a complete
beginner at animation. Optimise explanations for the second fact, not the first.
Define animation terms the first time they appear — retargeting, boil, on twos,
easing, forward kinematics, root motion.

## Stack

- **Remotion 4.0.520** — a scene is a React component that renders frame N.
  `pnpm dev` opens Studio (hot-reload preview + scrubbable timeline).
- **roughjs 4.6.6** — turns shapes into wobbly pencil strokes.
- **pnpm** — package manager. Node 24.15.0, pinned in `.tool-versions`.
- **whisper.cpp** via `@remotion/install-whisper-cpp` — word-level narration timings.

Official Remotion agent skills are installed (`skills add remotion-dev/skills`).
Prefer them over recalling the Remotion API from memory.

## History: what this project is NOT

An earlier design proposed generating motion with a text-to-motion model
(HY-Motion) → SMPL → BVH → Blender Grease Pencil → MP4. That was abandoned for two
reasons, and should not be reintroduced without discussing it first:

1. It could not run here. It needs an NVIDIA GPU with ~26 GB VRAM; this is an M4 Pro
   with 24 GB of *unified* memory and no CUDA.
2. Most scenes are scenery and abstract shapes, not humanoid motion capture, so a 3D
   skeletal pipeline was a long detour to arrive at flat line art. Its SMPL/AMASS/
   HumanML3D dependencies also carry non-commercial research licences.

Consequently: **no Blender, no `bpy`, no BVH, no SMPL, no PyTorch, no CUDA.**

## Architecture

```
narration.txt  →  draft.wav  →  captions.json  →  scene renders  →  shot.mp4
   (tts.ts)      (transcribe.ts)                  (Remotion)
```

- `src/lib/**` is the library; `src/scenes/**` are the videos; `editor/**` is a local
  browser tool for posing the figure by hand.
- **Pose data lives in `poses/**` as JSON**, not in TypeScript. `poses/library/*.json`
  are single poses, `poses/tracks/*.json` are keyframe animations. Load them through
  `src/lib/poses/types.ts` (`loadPose`, `loadTrack`, `parseTrackDoc`) — never hand-parse.
  This is what makes the pipeline two-way: a pose can be generated from a description,
  opened in the editor, dragged into shape and written back to the same file.
- `src/lib/figure/**` and `src/lib/anim/easing.ts` are **pure TypeScript** — no React,
  no Remotion, no roughjs imports — so they can be unit-tested without a browser.
  Keep it that way; it is the reason the maths is testable at all.
- `src/lib/rough/**` and anything `.tsx` may import React.
- Every `<Composition>` is registered in `src/Root.tsx`.

## Scenes are code; their parameters are data

A scene is a `.tsx` component, but every *tunable* — duration, camera pan, colours,
line weight, boil rate, pose keyframes — lives in typed data beside it, exposed
through `<Composition>` `defaultProps` with a zod schema so it can be edited in
Studio without touching logic.

The rule: **changing how a scene looks must not require editing logic.** If it does,
lift the value into props.

Do not replace this with a YAML shot format. It was considered and rejected: the
space of possible motion-graphics scenes is too large for a declarative schema, and
typed props give the same benefit with type checking.

## Gotchas — these are silently wrong if you guess

- **rough.js seeds must be >= 1.** `Random.next()` in `node_modules/roughjs/bin/math.js`
  reads `if (this.seed) {...} else { return Math.random(); }`, so seed `0` falls back
  to `Math.random()`. Frame 0 would flicker on every render while every other frame
  stayed stable. `boilSeed()` handles this with a `+1`; don't bypass it.
- **Always pass an explicit seed.** Remotion re-renders every frame and may render
  frames in parallel across several browser tabs. An unset seed gives strobing and
  irreproducible renders instead of boil.
- **Shapes sharing a frame need different seeds,** or their wobble moves in lockstep
  and the drawing looks mechanical. Use `boilSeedFor(frame, shapeIndex)`.
- **Use `rough.generator()` + `generator.toPaths()`.** `rough.svg()` and
  `rough.canvas()` mutate the DOM and fight React. Generator output is pure data, so
  it memoises and tests.
- **Interpolate joint angles, never joint positions.** Tweening positions stretches
  and shrinks limbs. Positions are always derived afterwards by `resolvePose()`.
  There is a bone-length-invariance test guarding this; if it fails, the fix is in
  the interpolation, not the test.
- **SVG Y grows downward.** The figure's angle convention is documented in
  `src/lib/figure/skeleton.ts`. Read it before touching pose maths.
- **whisper.cpp requires 16-bit 16 kHz mono WAV.** Convert with ffmpeg rather than
  assuming the input is right; `scripts/transcribe.ts` does this for any input, so the
  same path serves both `say` drafts and real recordings.
- **There is no `--dtw` option on the JS API.** Accurate word-level timestamps come from
  `tokenLevelTimestamps: true` on `transcribe()`, which is what makes the package invoke
  whisper-cli with `--dtw <model>` internally. `toCaptions()` requires it regardless.
- **`cmake` is a build prerequisite** for whisper.cpp (`brew install cmake`), on top of
  ffmpeg. Neither is bundled.
- **pnpm build approvals live in `pnpm-workspace.yaml`** under `allowBuilds` (pnpm 11),
  not `package.json`'s `pnpm` field and not pnpm 10's `onlyBuiltDependencies`. If
  esbuild's build is unapproved, *every* `pnpm exec` and `pnpm run` fails with
  `ERR_PNPM_IGNORED_BUILDS`.
- **Scale the figure's geometry, not the SVG.** `Figure` takes a `scale` prop that
  multiplies coordinates about the root. Do not swap this for a `<g transform="scale()">`:
  an SVG scale also multiplies rough.js's stroke width and wobble amplitude, so the
  same figure drawn larger comes out with heavier, wilder linework.
- **`tsc` does not gate rendering.** Remotion's bundler strips types without checking
  them, so `remotion render` succeeds on code that fails `tsc --noEmit`. Run the
  typecheck explicitly; a green render proves nothing about types.
- **`whisper.cpp/` must stay out of `tsconfig.json`'s include.** CMake generates
  dependency-timestamp files literally named `compiler_depend.ts`, which `tsc` tries
  to compile and reports hundreds of syntax errors on. Already handled via `exclude`.
- **Never let a whisper model download outlive the process that started it.** An
  orphaned background download leaves a truncated `.bin` that looks present but is
  short, and the failure only surfaces at the first transcribe. `downloadWhisperModel`
  validates byte size and tells you to delete the file — do that rather than retrying.
- **`scripts/*.ts` run under node's native type stripping** and emit a
  `MODULE_TYPELESS_PACKAGE_JSON` warning because the package has no `"type"` field.
  Harmless; it reparses as ESM. Adding `"type": "module"` would silence it but touches
  every config file, so it has been left alone deliberately.
- **A misspelled bone name in a pose file is invisible without validation.** A missing
  bone defaults to angle 0, which IS the rest angle, so a typo applies no rotation and
  produces no error. `toPose()` rejects unknown bone names for exactly this reason;
  don't bypass it by casting.
- **Easings are stored as names, not functions.** JSON cannot hold a function, so
  keyframes carry a string resolved through `src/lib/anim/easingRegistry.ts`. Add new
  easings there; `EasingName` is derived from its keys so a bad name is a type error.
- **Node's ESM loader needs explicit `.ts` extensions**, but the codebase uses
  extensionless imports (correct for the bundlers and for `tsc`'s Bundler resolution).
  So a script that imports from `src/lib/**` cannot run under plain `node` — run it with
  `pnpm dlx tsx`. Scripts that only use node built-ins are fine under `node` directly.
- **`tsx` compiles to CJS here** because the package has no `"type": "module"`, so
  top-level `await` fails. Wrap script bodies in an async `main()`.
- **Node only resolves inside this directory.** The global `~/.tool-versions` pins an
  uninstalled node version, so `node`/`pnpm` fail from elsewhere. Always work from the
  project root. Don't "fix" the global pin; it belongs to other projects.

## The figure

- **Style target** is the hand-drawn yoga stick figure: single-stroke limbs, oval
  head, drawn motifs where a pose cannot express something.
- **The lotus is a motif, not a pose.** The crossed legs are drawn as two leaf
  shapes (`lotusLegs`), because posing them is geometrically impossible: thigh (30
  units) and shin (28) are near enough equal that folding the shin back to the
  centre lays it on the thigh, leaving a sliver with no area at any angle. Do not
  "fix" this by trying harder with angles — three attempts are recorded in the
  history and all collapse the same way.
- **Trim the neck to the head ELLIPSE, not the head bone.** `headScale` makes the
  oval extend well below the head bone base, so a neck stroke that stops at the
  bone appears to pierce the head. `Figure` trims it to the computed outline and
  `neckGap` offsets from there, which stays correct when `headScale` changes.
- **The rig is not really profile-only.** `skeleton.ts` describes it as side-on,
  but the bones are plain 2D angles and know nothing about a camera, so front-on
  poses are authorable with the same rig. The walk is profile; the lotus is front-on.
- **The turn is a cross-fade,** because a 2D rig cannot rotate. Over boiling lines
  and ~10 frames it reads as a turn. This is a standard 2D cheat, not a bug.
- **A walk is four poses** — contact, down, passing, up — mirrored for the second
  step by `mirror()`, so only half a cycle is hand-authored and the halves cannot
  drift apart. The pelvis bob is what sells the weight; without it the figure glides.
- **`Figure` takes `frame` as a prop and must never call `useCurrentFrame()`.** That one
  prop is the entire reason the drawing stack has no Remotion dependency and can render
  inside the editor. Check with:
  `grep -rl '"remotion"' src/lib` — it should return nothing.
- **Scene beats are read from the narration** via `findSpokenFrame()`, not
  hand-counted. Re-recording the voiceover re-times the animation.

## Conventions

- TypeScript throughout. `pnpm lint` runs eslint and `tsc`.
- Commit only when asked.
- Render output goes in `out/` and is gitignored.
- Prefer one finished scene over a general framework. Extract shared primitives into
  `src/lib/scenery/` only after they have appeared in a real scene — not before.

## Definition of done for a scene

- `pnpm exec tsc --noEmit` clean and `pnpm test` passing.
- `pnpm exec remotion render <Id> out/<id>.mp4` produces the video with no manual steps.
- **Determinism check:** render the same still twice and compare `shasum`. Identical
  hashes mean the seeds are under control. Then confirm two frames in different boil
  steps *differ*, proving boil is actually happening. Both must hold.
- Watch it: limbs stay a constant length, the figure travels rather than sliding in
  place, lines boil steadily rather than strobing, and the motion lands on the
  narration beats.

## Licensing

Clean for public non-commercial use. Remotion's free licence covers individuals
(commercial included); roughjs is MIT. If this ever becomes client or commercial work,
raise it — the answer is probably still fine, but check rather than assume.
