#!/usr/bin/env node
/**
 * scripts/transcribe.ts
 *
 * Turns a narration audio file -- either a scripts/tts.ts draft or a real
 * voice recording, both paths converge here -- into word-level caption JSON
 * that src/audio/captions.ts (and ultimately scenes) can query, e.g. "start
 * this beat when the narration reaches the word 'settles'".
 *
 * whisper.cpp requires 16-bit 16kHz mono PCM WAV input. We never assume the
 * given file already satisfies that (it usually won't: `say` output is
 * 44.1kHz, and real recordings are all over the map) -- we always re-encode
 * with ffmpeg first.
 *
 * Word-level timestamps come from whisper.cpp's DTW token-timestamp feature.
 * In @remotion/install-whisper-cpp's API this is requested via the
 * `tokenLevelTimestamps: true` option to `transcribe()` -- NOT a standalone
 * "--dtw" flag exposed on the JS API. Passing `tokenLevelTimestamps: true`
 * is what causes the package to invoke whisper-cli with `--dtw <model>`
 * internally (see node_modules/@remotion/install-whisper-cpp/dist/transcribe.js);
 * it's also required by `toCaptions()`'s input type, which demands a
 * transcription produced with token-level timestamps.
 *
 * Usage:
 *   node scripts/transcribe.ts --in public/audio/draft.wav
 *   node scripts/transcribe.ts --in public/audio/draft.wav --out public/captions/draft.json --model small.en
 */
import { spawn } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import {
  downloadWhisperModel,
  installWhisperCpp,
  toCaptions,
  transcribe,
  type WhisperModel,
} from '@remotion/install-whisper-cpp';

const WHISPER_DIR = path.resolve(process.cwd(), 'whisper.cpp');
const WHISPER_VERSION = '1.7.6';
const MODEL_FOLDER = path.join(WHISPER_DIR, 'models');
const DEFAULT_MODEL: WhisperModel = 'medium.en';

function run(bin: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${bin} ${args.join(' ')} exited with code ${code}, signal ${signal}`));
    });
  });
}

async function resolveFfmpeg(): Promise<string> {
  const candidates = ['ffmpeg', '/opt/homebrew/bin/ffmpeg'];
  for (const candidate of candidates) {
    try {
      await run(candidate, ['-version']);
      return candidate;
    } catch {
      // try next candidate
    }
  }
  throw new Error('Could not find an ffmpeg executable on PATH or at /opt/homebrew/bin/ffmpeg');
}

/**
 * whisper.cpp is fussy about its input format. Regardless of where the
 * audio came from (say's AIFF-turned-WAV, or someone's phone recording),
 * always re-encode to 16-bit 16kHz mono PCM WAV before handing it to
 * whisper.cpp.
 */
async function convertToWhisperWav(inputPath: string, outputPath: string): Promise<void> {
  const ffmpeg = await resolveFfmpeg();
  await run(ffmpeg, [
    '-y',
    '-i',
    inputPath,
    '-ar',
    '16000',
    '-ac',
    '1',
    '-c:a',
    'pcm_s16le',
    outputPath,
  ]);
}

async function ensureWhisperCpp(): Promise<void> {
  // Deliberately do NOT pre-create WHISPER_DIR: installWhisperCpp() treats an
  // already-existing target directory as "already installed" (and errors if
  // the expected binary isn't in it yet) -- it does the `git clone` itself,
  // which needs to create the directory.
  console.log(`[transcribe] ensuring whisper.cpp ${WHISPER_VERSION} is installed at ${WHISPER_DIR} (this compiles native code on first run and can take a few minutes)...`);
  const { alreadyExisted } = await installWhisperCpp({
    version: WHISPER_VERSION,
    to: WHISPER_DIR,
    printOutput: true,
  });
  console.log(alreadyExisted ? '[transcribe] whisper.cpp already installed' : '[transcribe] whisper.cpp installed');
}

async function ensureModel(model: WhisperModel): Promise<void> {
  await mkdir(MODEL_FOLDER, { recursive: true });
  console.log(`[transcribe] ensuring model "${model}" is downloaded to ${MODEL_FOLDER} (this can be ~1.5GB for medium.en)...`);
  const { alreadyExisted } = await downloadWhisperModel({
    model,
    folder: MODEL_FOLDER,
    printOutput: true,
    onProgress: (downloaded, total) => {
      if (total > 0) {
        const pct = ((downloaded / total) * 100).toFixed(1);
        process.stdout.write(`\r[transcribe] downloading ${model}: ${pct}%`);
      }
    },
  });
  if (!alreadyExisted) process.stdout.write('\n');
  console.log(alreadyExisted ? `[transcribe] model "${model}" already present` : `[transcribe] model "${model}" downloaded`);
}

async function main() {
  const { values } = parseArgs({
    options: {
      in: { type: 'string' },
      out: { type: 'string' },
      model: { type: 'string' },
      language: { type: 'string' },
    },
  });

  if (!values.in) {
    throw new Error('Usage: node scripts/transcribe.ts --in <audio file> [--out public/captions/name.json] [--model medium.en]');
  }

  const inputPath = path.resolve(values.in);
  const model = (values.model ?? DEFAULT_MODEL) as WhisperModel;
  const language = values.language ?? 'en';
  const baseName = path.basename(inputPath, path.extname(inputPath));
  const outPath = path.resolve(values.out ?? path.join('public', 'captions', `${baseName}.json`));

  await ensureWhisperCpp();
  await ensureModel(model);

  const tmpWav = path.join(tmpdir(), `whisper-in-${Date.now()}-${process.pid}.wav`);
  try {
    console.log(`[transcribe] converting ${inputPath} -> 16kHz mono PCM WAV`);
    await convertToWhisperWav(inputPath, tmpWav);

    console.log(`[transcribe] running whisper.cpp (model=${model}, language=${language}, dtw word timestamps on)`);
    const transcription = await transcribe({
      inputPath: tmpWav,
      whisperPath: WHISPER_DIR,
      whisperCppVersion: WHISPER_VERSION,
      model,
      modelFolder: MODEL_FOLDER,
      tokenLevelTimestamps: true,
      language: language as never,
      printOutput: true,
      onProgress: (progress) => process.stdout.write(`\r[transcribe] progress: ${(progress * 100).toFixed(0)}%`),
    });
    process.stdout.write('\n');

    const { captions } = toCaptions({ whisperCppOutput: transcription });

    await mkdir(path.dirname(outPath), { recursive: true });
    await writeFile(outPath, JSON.stringify({ captions }, null, 2), 'utf8');
    console.log(`[transcribe] wrote ${captions.length} captions -> ${outPath}`);

    console.log('[transcribe] sample captions:');
    for (const caption of captions.slice(0, 12)) {
      console.log(
        `  ${caption.startMs.toString().padStart(6)}ms - ${caption.endMs.toString().padStart(6)}ms  "${caption.text}"`,
      );
    }
  } finally {
    await rm(tmpWav, { force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
