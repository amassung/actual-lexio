#!/usr/bin/env node
// scripts/import-recordings.mjs
//
// Convert a folder of phoneme recordings (m4a / wav / aiff / mp3 / ogg) into
// normalized mp3 files in public/audio/phonemes/. Files must be named by
// phoneme key — see RECORDING_GUIDE.md.
//
// Usage:
//   node scripts/import-recordings.mjs [path-to-folder]
//
// Defaults to ./recordings/ relative to the project root.

import { readdir, mkdir, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import url from "node:url";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(PROJECT_ROOT, "public/audio/phonemes");

const VALID_EXT = new Set([".m4a", ".wav", ".aiff", ".aif", ".mp3", ".ogg", ".flac", ".caf"]);
const VALID_KEYS = new Set([
  "m","n","ng","s","z","f","v","h","l","r",
  "t","d","p","b","k","g",
  "sh","ch","th","wh",
  "a","e","i","o","u","y","w",
]);

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    p.stderr?.on("data", d => { stderr += d.toString(); });
    p.on("exit", code => code === 0 ? resolve(true) : reject(new Error(stderr.slice(-400))));
    p.on("error", reject);
  });
}

async function hasFfmpeg() {
  return new Promise(resolve => {
    const p = spawn("ffmpeg", ["-version"], { stdio: "ignore" });
    p.on("error", () => resolve(false));
    p.on("exit", code => resolve(code === 0));
  });
}

async function main() {
  const inputDir = path.resolve(process.argv[2] ?? path.join(PROJECT_ROOT, "recordings"));
  if (!existsSync(inputDir)) {
    console.error(`✗ Folder not found: ${inputDir}`);
    console.error(`  Usage: node scripts/import-recordings.mjs <folder>`);
    process.exit(1);
  }
  if (!(await hasFfmpeg())) {
    console.error("✗ ffmpeg not found on PATH. Install with: brew install ffmpeg");
    process.exit(1);
  }
  await mkdir(OUT_DIR, { recursive: true });

  const entries = await readdir(inputDir);
  const recordings = [];
  for (const f of entries) {
    const ext = path.extname(f).toLowerCase();
    if (!VALID_EXT.has(ext)) continue;
    const key = path.basename(f, ext).toLowerCase().trim();
    if (!VALID_KEYS.has(key)) {
      console.warn(`  ! Skipping ${f} — "${key}" isn't a recognized phoneme key`);
      continue;
    }
    recordings.push({ key, src: path.join(inputDir, f) });
  }

  if (recordings.length === 0) {
    console.error("✗ No valid audio files found.");
    console.error(`  Looked in: ${inputDir}`);
    console.error(`  Expected names: m.m4a, t.m4a, sh.m4a, etc.`);
    process.exit(1);
  }

  console.log(`Importing ${recordings.length} recordings from ${inputDir} →`);
  for (const r of recordings) {
    const dest = path.join(OUT_DIR, `${r.key}.mp3`);
    try {
      // Pipeline: trim leading/trailing silence below -45dB, loudness normalize
      // to broadcast standard, downmix to mono 22kHz 64kbps mp3.
      const filter = [
        "silenceremove=start_periods=1:start_silence=0.05:start_threshold=-45dB:detection=peak",
        "areverse",
        "silenceremove=start_periods=1:start_silence=0.05:start_threshold=-45dB:detection=peak",
        "areverse",
        "loudnorm=I=-16:TP=-1.5:LRA=11",
      ].join(",");
      await run("ffmpeg", [
        "-y", "-i", r.src,
        "-af", filter,
        "-ac", "1", "-ar", "22050", "-b:a", "64k",
        dest,
      ]);
      const size = (await stat(dest)).size;
      console.log(`  ✓ ${r.key.padEnd(3)} → ${path.relative(PROJECT_ROOT, dest)}  (${Math.round(size/1024)}KB)`);
    } catch (e) {
      console.error(`  ✗ ${r.key.padEnd(3)} — ${e.message.split("\n").pop()}`);
    }
  }

  console.log("\nDone. Commit + push to deploy:");
  console.log("  git add public/audio/phonemes/ && git commit -m 'Custom phoneme recordings' && git push");
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });
