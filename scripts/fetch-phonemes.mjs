#!/usr/bin/env node
// scripts/fetch-phonemes.mjs
//
// Download CC-BY-SA phoneme recordings from Wikimedia Commons and convert
// them to MP3 for cross-browser playback. Run: `node scripts/fetch-phonemes.mjs`
//
// Requires ffmpeg on PATH for the ogg → mp3 conversion. Install with:
//   brew install ffmpeg
// If ffmpeg is missing the script falls back to saving raw .ogg files and
// prints a warning — those will play in Chrome/Firefox but not Safari.

import { mkdir, writeFile, unlink, access } from "node:fs/promises";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import url from "node:url";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, "../public/audio/phonemes");

// Phoneme key → { url, title, attribution }
// All files licensed CC BY-SA 3.0 from Wikimedia Commons.
const SOURCES = {
  // Continuants — most useful for phonics demos
  m:  { url: "https://upload.wikimedia.org/wikipedia/commons/a/a9/Bilabial_nasal.ogg",                         title: "Bilabial nasal" },
  n:  { url: "https://upload.wikimedia.org/wikipedia/commons/2/29/Alveolar_nasal.ogg",                         title: "Alveolar nasal" },
  ng: { url: "https://upload.wikimedia.org/wikipedia/commons/3/39/Velar_nasal.ogg",                            title: "Velar nasal" },
  s:  { url: "https://upload.wikimedia.org/wikipedia/commons/a/ac/Voiceless_alveolar_sibilant.ogg",            title: "Voiceless alveolar sibilant" },
  z:  { url: "https://upload.wikimedia.org/wikipedia/commons/c/c0/Voiced_alveolar_sibilant.ogg",               title: "Voiced alveolar sibilant" },
  f:  { url: "https://upload.wikimedia.org/wikipedia/commons/3/33/Voiceless_labiodental_fricative.ogg",        title: "Voiceless labiodental fricative" },
  v:  { url: "https://upload.wikimedia.org/wikipedia/commons/8/85/Voiced_labiodental_fricative.ogg",           title: "Voiced labiodental fricative" },
  h:  { url: "https://upload.wikimedia.org/wikipedia/commons/d/da/Voiceless_glottal_fricative.ogg",            title: "Voiceless glottal fricative" },
  l:  { url: "https://upload.wikimedia.org/wikipedia/commons/b/bc/Alveolar_lateral_approximant.ogg",           title: "Alveolar lateral approximant" },
  r:  { url: "https://upload.wikimedia.org/wikipedia/commons/1/1f/Alveolar_approximant.ogg",                   title: "Alveolar approximant" },
  // Stops — TTS can't do these without schwa, real recordings really matter here
  t:  { url: "https://upload.wikimedia.org/wikipedia/commons/0/02/Voiceless_alveolar_plosive.ogg",             title: "Voiceless alveolar plosive" },
  d:  { url: "https://upload.wikimedia.org/wikipedia/commons/0/01/Voiced_alveolar_plosive.ogg",                title: "Voiced alveolar plosive" },
  p:  { url: "https://upload.wikimedia.org/wikipedia/commons/5/51/Voiceless_bilabial_plosive.ogg",             title: "Voiceless bilabial plosive" },
  b:  { url: "https://upload.wikimedia.org/wikipedia/commons/2/2c/Voiced_bilabial_plosive.ogg",                title: "Voiced bilabial plosive" },
  k:  { url: "https://upload.wikimedia.org/wikipedia/commons/e/e3/Voiceless_velar_plosive.ogg",                title: "Voiceless velar plosive" },
  g:  { url: "https://upload.wikimedia.org/wikipedia/commons/b/b4/Voiced_velar_plosive.ogg",                   title: "Voiced velar plosive" },
  // Digraphs
  sh: { url: "https://upload.wikimedia.org/wikipedia/commons/c/cc/Voiceless_palato-alveolar_sibilant.ogg",     title: "Voiceless palato-alveolar sibilant" },
  ch: { url: "https://upload.wikimedia.org/wikipedia/commons/9/97/Voiceless_palato-alveolar_affricate.ogg",    title: "Voiceless palato-alveolar affricate" },
  th: { url: "https://upload.wikimedia.org/wikipedia/commons/8/80/Voiceless_dental_fricative.ogg",             title: "Voiceless dental fricative" },
  // Short vowels (closest IPA matches to General American)
  a:  { url: "https://upload.wikimedia.org/wikipedia/commons/c/c9/Near-open_front_unrounded_vowel.ogg",        title: "Near-open front unrounded vowel" },
  e:  { url: "https://upload.wikimedia.org/wikipedia/commons/7/71/Open-mid_front_unrounded_vowel.ogg",         title: "Open-mid front unrounded vowel" },
  i:  { url: "https://upload.wikimedia.org/wikipedia/commons/4/4c/Near-close_near-front_unrounded_vowel.ogg",  title: "Near-close near-front unrounded vowel" },
  o:  { url: "https://upload.wikimedia.org/wikipedia/commons/0/0a/Open_back_rounded_vowel.ogg",                title: "Open back rounded vowel" },
  u:  { url: "https://upload.wikimedia.org/wikipedia/commons/9/92/Open-mid_back_unrounded_vowel.ogg",          title: "Open-mid back unrounded vowel" },
};

function hasFfmpeg() {
  return new Promise(resolve => {
    const p = spawn("ffmpeg", ["-version"], { stdio: "ignore" });
    p.on("error", () => resolve(false));
    p.on("exit", code => resolve(code === 0));
  });
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    p.stderr?.on("data", d => { err += d.toString(); });
    p.on("exit", code => code === 0 ? resolve(true) : reject(new Error(err.slice(-300))));
    p.on("error", reject);
  });
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function download(srcUrl, destPath, attempt = 1) {
  const resp = await fetch(srcUrl, {
    headers: {
      // Wikimedia explicitly requires a descriptive UA with contact info
      "User-Agent": "Lexio-phoneme-fetcher/1.0 (https://github.com/amassung/actual-lexio; educational)",
      Accept: "audio/ogg, audio/*",
    },
  });
  if (resp.status === 429) {
    if (attempt > 4) throw new Error("HTTP 429 (rate limited after retries)");
    const wait = 3000 * attempt;
    console.log(`     ↻ 429 — backing off ${wait}ms (attempt ${attempt})`);
    await sleep(wait);
    return download(srcUrl, destPath, attempt + 1);
  }
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const buf = Buffer.from(await resp.arrayBuffer());
  await writeFile(destPath, buf);
  return buf.length;
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const ffmpegOk = await hasFfmpeg();
  if (!ffmpegOk) {
    console.warn("⚠️  ffmpeg not on PATH — saving raw .ogg files (Safari won't play these).");
    console.warn("   Run: brew install ffmpeg && node scripts/fetch-phonemes.mjs");
  }

  const results = [];
  let first = true;
  for (const [key, src] of Object.entries(SOURCES)) {
    // Be a good Wikimedia citizen — pause between requests
    if (!first) await sleep(900);
    first = false;
    const oggPath = path.join(OUT_DIR, `${key}.ogg`);
    const mp3Path = path.join(OUT_DIR, `${key}.mp3`);
    const finalPath = ffmpegOk ? mp3Path : oggPath;
    if (existsSync(finalPath)) {
      console.log(`  · ${key.padEnd(3)} already present — skipping`);
      results.push({ key, ...src, status: "skipped" });
      continue;
    }
    try {
      const size = await download(src.url, oggPath);
      if (ffmpegOk) {
        // Convert to a tight mp3 — 64 kbps mono is plenty for a phoneme clip
        await run("ffmpeg", ["-y", "-i", oggPath, "-ac", "1", "-ar", "22050", "-b:a", "64k", mp3Path]);
        await unlink(oggPath);
        console.log(`  ✓ ${key.padEnd(3)} ${src.title}  (${Math.round(size / 1024)}KB → mp3)`);
      } else {
        console.log(`  ✓ ${key.padEnd(3)} ${src.title}  (${Math.round(size / 1024)}KB ogg)`);
      }
      results.push({ key, ...src, status: "ok" });
    } catch (e) {
      console.error(`  ✗ ${key.padEnd(3)} ${src.title}  — ${e.message}`);
      results.push({ key, ...src, status: "failed", error: e.message });
    }
  }

  // Write attribution file
  const attribLines = [
    "# Phoneme audio attributions",
    "",
    "Recorded phoneme clips in this directory were sourced from Wikimedia Commons",
    "and are licensed under [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/).",
    "",
    "| Key | Title | Source |",
    "| --- | --- | --- |",
    ...results.filter(r => r.status !== "failed").map(r => {
      const page = "https://commons.wikimedia.org/wiki/File:" + r.title.replace(/ /g, "_") + ".ogg";
      return `| \`${r.key}\` | ${r.title} | [Commons](${page}) |`;
    }),
    "",
    "Each contributor retains the right to attribution under CC BY-SA. If you",
    "redistribute these clips, preserve the credits above.",
    "",
  ];
  await writeFile(path.join(OUT_DIR, "ATTRIBUTIONS.md"), attribLines.join("\n"));

  const ok = results.filter(r => r.status === "ok").length;
  const skipped = results.filter(r => r.status === "skipped").length;
  const failed = results.filter(r => r.status === "failed").length;
  console.log(`\nDone — ${ok} fetched, ${skipped} skipped, ${failed} failed.`);
  if (failed) process.exit(1);
}

main().catch(e => {
  console.error("Fatal:", e);
  process.exit(1);
});
