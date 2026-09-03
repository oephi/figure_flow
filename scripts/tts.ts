#!/usr/bin/env node
/**
 * scripts/tts.ts
 *
 * Draft narration synthesis.
 *
 * The pipeline is: write the script as text -> synthesise draft audio so
 * caption/beat timing can be iterated on without recording anything -> later
 * swap in a real voice recording. Either audio ends up going through
 * scripts/transcribe.ts to produce word-level caption timings.
 *
 * This script uses the offline macOS `say` command: no API keys, no network
 * access, good enough fidelity to draft timing. It is intentionally hidden
 * behind the small `TtsProvider` interface below so a higher-quality service
 * (ElevenLabs, Azure Speech, PlayHT, ...) can replace `sayTtsProvider` later
 * without any caller (or this file's CLI surface) having to change.
 *
 * Usage:
 *   node scripts/tts.ts --text "Some narration." --out public/audio/draft.wav
 *   node scripts/tts.ts --file narration.txt --out public/audio/draft.wav [--voice Samantha] [--rate 165]
 */
import { spawn } from 'node:child_process';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';

type TtsOptions = {
  voice?: string;
  /** Words per minute. `say`'s own default is used when omitted. */
  rate?: number;
};

/**
 * Boundary between "how we synthesise speech" and everything else in this
 * script. Swap in a different provider (e.g. a cloud TTS API) by writing a
 * new object that satisfies this interface and using it in `main()` instead
 * of `sayTtsProvider` -- no other code in this file needs to change.
 */
type TtsProvider = {
  name: string;
  synthesizeToAiff: (text: string, outAiffPath: string, opts: TtsOptions) => Promise<void>;
};

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

const sayTtsProvider: TtsProvider = {
  name: 'macos-say',
  synthesizeToAiff: async (text, outAiffPath, opts) => {
    const args: string[] = [];
    if (opts.voice) args.push('-v', opts.voice);
    if (opts.rate) args.push('-r', String(opts.rate));
    args.push('-o', outAiffPath, text);
    await run('say', args);
  },
};

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
 * Synthesises `text` as a draft narration WAV at `outPath`, going through
 * the configured `provider`. The intermediate format `say` produces (AIFF)
 * is converted with ffmpeg to a plain 44.1kHz mono 16-bit PCM WAV -- a
 * generally-playable format. scripts/transcribe.ts independently re-encodes
 * whatever audio it is given to whisper.cpp's required 16kHz format, so the
 * exact format produced here does not need to match that.
 */
async function synthesizeDraftNarration({
  text,
  outPath,
  provider,
  options,
}: {
  text: string;
  outPath: string;
  provider: TtsProvider;
  options: TtsOptions;
}): Promise<void> {
  await mkdir(path.dirname(outPath), { recursive: true });
  const tmpAiff = path.join(tmpdir(), `tts-draft-${Date.now()}-${process.pid}.aiff`);
  try {
    await provider.synthesizeToAiff(text, tmpAiff, options);
    const ffmpeg = await resolveFfmpeg();
    await run(ffmpeg, [
      '-y',
      '-i',
      tmpAiff,
      '-ar',
      '44100',
      '-ac',
      '1',
      '-c:a',
      'pcm_s16le',
      outPath,
    ]);
  } finally {
    await rm(tmpAiff, { force: true });
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      text: { type: 'string' },
      file: { type: 'string' },
      out: { type: 'string' },
      voice: { type: 'string' },
      rate: { type: 'string' },
    },
  });

  if (!values.out) {
    throw new Error('Usage: node scripts/tts.ts (--text "..." | --file script.txt) --out public/audio/draft.wav');
  }
  if (!values.text && !values.file) {
    throw new Error('Provide either --text "..." or --file <path to script text>');
  }

  const text = values.text ?? (await readFile(values.file!, 'utf8'));
  const outPath = path.resolve(values.out);

  console.log(`[tts] provider: ${sayTtsProvider.name}`);
  console.log(`[tts] synthesizing ${text.length} characters -> ${outPath}`);

  await synthesizeDraftNarration({
    text,
    outPath,
    provider: sayTtsProvider,
    options: {
      voice: values.voice,
      rate: values.rate ? Number(values.rate) : undefined,
    },
  });

  console.log(`[tts] wrote ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
