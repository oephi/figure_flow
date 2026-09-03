/**
 * src/audio/captions.ts
 *
 * Typed loading and querying for the word-level caption JSON produced by
 * scripts/transcribe.ts. This is the consumer side of the narration
 * pipeline: a scene asks "what frame does the narration say 'settles'?" and
 * drives an animation beat off the answer, instead of hand-tuning frame
 * numbers against a video preview.
 *
 * Deliberately free of React and Remotion imports so it stays plain,
 * synchronous, and unit-testable; components should call `frameToCaptions`
 * / `findSpokenAtFrame` etc. from inside their own hooks (e.g. via
 * `useCurrentFrame()` + `useVideoConfig()`), not the other way around.
 */
import type { Caption } from '@remotion/captions';

export type { Caption };

/** The on-disk shape written by scripts/transcribe.ts. */
export type CaptionsFile = {
  captions: Caption[];
};

/**
 * Parses and minimally validates a captions JSON string (as fetched from
 * `public/captions/*.json` via Remotion's `staticFile()` + `fetch`, or read
 * from disk in a Node script). Throws with a clear message on malformed
 * input rather than returning something callers might misuse.
 */
export function parseCaptionsFile(raw: string): Caption[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Could not parse captions JSON: ${(err as Error).message}`);
  }
  return validateCaptionsFile(parsed);
}

export function validateCaptionsFile(value: unknown): Caption[] {
  if (
    !value ||
    typeof value !== 'object' ||
    !Array.isArray((value as CaptionsFile).captions)
  ) {
    throw new Error('Invalid captions file: expected an object shaped like { captions: Caption[] }');
  }
  return (value as CaptionsFile).captions;
}

/** Converts a millisecond timestamp to a (rounded) frame number at `fps`. */
export function msToFrame(ms: number, fps: number): number {
  return Math.round((ms / 1000) * fps);
}

/** Converts a frame number at `fps` to a millisecond timestamp. */
export function frameToMs(frame: number, fps: number): number {
  return (frame / fps) * 1000;
}

/**
 * Returns every caption whose [startMs, endMs) window contains the given
 * frame -- typically zero or one entries for whisper.cpp's per-word
 * captions, but callers should not assume exactly one.
 */
export function getCaptionsAtFrame(captions: Caption[], frame: number, fps: number): Caption[] {
  const ms = frameToMs(frame, fps);
  return captions.filter((caption) => ms >= caption.startMs && ms < caption.endMs);
}

/** Same as `getCaptionsAtFrame`, but querying directly by millisecond timestamp. */
export function getCaptionsAtMs(captions: Caption[], ms: number): Caption[] {
  return captions.filter((caption) => ms >= caption.startMs && ms < caption.endMs);
}

function normalizeWord(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9']+/g, '');
}

/**
 * Finds the Nth (1-indexed via `occurrence`) caption whose text matches a
 * single word, ignoring case and surrounding punctuation.
 */
export function findWord(captions: Caption[], word: string, occurrence = 1): Caption | null {
  const target = normalizeWord(word);
  if (!target) return null;
  let seen = 0;
  for (const caption of captions) {
    if (normalizeWord(caption.text) === target) {
      seen += 1;
      if (seen === occurrence) return caption;
    }
  }
  return null;
}

/**
 * Finds the Nth (1-indexed via `occurrence`) run of consecutive captions
 * whose text matches a whitespace-separated phrase, ignoring case and
 * surrounding punctuation on each word.
 */
export function findPhrase(captions: Caption[], phrase: string, occurrence = 1): Caption[] | null {
  const words = phrase.trim().split(/\s+/).map(normalizeWord).filter(Boolean);
  if (words.length === 0) return null;
  let seen = 0;
  for (let i = 0; i <= captions.length - words.length; i++) {
    let isMatch = true;
    for (let j = 0; j < words.length; j++) {
      if (normalizeWord(captions[i + j].text) !== words[j]) {
        isMatch = false;
        break;
      }
    }
    if (isMatch) {
      seen += 1;
      if (seen === occurrence) return captions.slice(i, i + words.length);
    }
  }
  return null;
}

/**
 * The core query this whole module exists for: "at what frame does the
 * narration reach this word or phrase?" Accepts either a single word
 * (`"settles"`) or a whitespace-separated phrase (`"gently settles"`);
 * dispatches to `findWord`/`findPhrase` accordingly and returns the frame
 * at which the match *starts* speaking. Returns `null` if no such
 * occurrence exists.
 */
export function findSpokenFrame(
  captions: Caption[],
  text: string,
  fps: number,
  occurrence = 1,
): number | null {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const match =
    words.length <= 1
      ? findWord(captions, text, occurrence)
      : findPhrase(captions, text, occurrence)?.[0] ?? null;
  return match ? msToFrame(match.startMs, fps) : null;
}
