# Recording your own phoneme audio

This walks you through replacing the academic Wikimedia recordings with your own warmer, kid-friendly versions. Total time: ~15 minutes.

## What you'll need

- **Voice Memos** (built into macOS) — or QuickTime Player, or any audio recorder
- A **quiet room** with soft surfaces (bedroom > kitchen). Echo kills clarity.
- Mic positioned **4–6 inches** from your mouth. Not closer (plosive pops), not further (room echo).
- AirPods Pro / decent USB mic > MacBook built-in mic. Built-in works in a pinch.

## Recording mechanics

1. Open **Voice Memos**.
2. For each phoneme, **hit record → make the sound → stop**. One clip per phoneme.
3. Tap the clip → **Rename** to just the phoneme key (e.g., `t`, `m`, `sh`).
4. Aim for ~50ms for stops, 0.7–1.0s for held sounds. Trim silence aggressively with the built-in edit tool.

When done, **share all 24 clips** to a folder somewhere predictable — e.g., `~/Desktop/lexio-recordings/`. Voice Memos exports as `.m4a` by default; that's fine.

Then run:
```bash
node scripts/import-recordings.mjs ~/Desktop/lexio-recordings
```

It normalizes loudness, trims leading/trailing silence, and writes mp3 files into `public/audio/phonemes/` (overwriting the Wikimedia ones).

## Per-phoneme tips — the important part

### Stops (these are the ones to nail — TTS can't do them)

| Sound | How to make it correctly |
|---|---|
| **/t/** | Tongue tip touches the ridge behind your upper teeth. Release with a sharp puff of breath. **No vowel after.** Think the *t* in "STOP" — clipped. |
| **/p/** | Press lips together. Release with a quick puff. **No "puh".** Think the *p* at the end of "STOP." |
| **/k/** | Back of tongue touches soft palate. Release. **No "kuh".** Think the *c* at the end of "PICK." |
| **/b/** | Same as /p/ but voiced — add a brief throat hum. Still clipped. |
| **/d/** | Same as /t/ but voiced. |
| **/g/** | Same as /k/ but voiced. |

**The whole point of these recordings is to remove the schwa "uh" tail** that TTS adds. If you can hear "uh" after the sound, re-record.

### Continuants (hold them for ~0.7s)

| Sound | How |
|---|---|
| **/m/** | Lips closed, hum from the nose. Like saying "yum" without the *y* or *u*. |
| **/n/** | Tongue tip on ridge behind upper teeth, voice through the nose. |
| **/ng/** | Back of tongue on soft palate, voice through the nose. The end of "sing." |
| **/s/** | Soft hiss. Tongue almost touching the ridge. Like a snake. |
| **/z/** | Same as /s/ but voiced — add throat hum. Like a bee. |
| **/f/** | Top teeth on bottom lip, blow softly. |
| **/v/** | Same as /f/ but voiced. |
| **/h/** | Just a soft breath out. Like fogging a window. |
| **/l/** | Tongue tip on ridge behind upper teeth, voice flows around the sides. Hold the "l" of "love." |
| **/r/** | Tongue curled back slightly. American "r" — the *r* in "red." |

### Digraphs (also held)

| Sound | How |
|---|---|
| **/sh/** | Like shushing a baby. Tongue raised, lips slightly rounded, sustained "shhhh." |
| **/ch/** | Two parts: a /t/ blended into a /sh/. Short, like the start of "CHURCH." Don't sustain. |
| **/th/** | Tongue between teeth, blow softly. Like "THINK" — voiceless. |

### Short vowels (the heart of phonics)

Quick, isolated. **No consonant before or after.** Just the vowel.

| Sound | Word reference |
|---|---|
| **/a/** | "ah" — the *a* in "CAT" |
| **/e/** | "eh" — the *e* in "BED" |
| **/i/** | "ih" — the *i* in "SIT" |
| **/o/** | "ah" — the *o* in "HOT" (American "ah") |
| **/u/** | "uh" — the *u* in "CUP" |

## Filename → phoneme mapping

Name your clips exactly this way (no extension):

```
m  n  ng  s  z  f  v  h  l  r
t  d  p   b  k  g
sh ch th
a  e  i   o  u
```

## After recording

1. Drop the folder somewhere convenient.
2. Run `node scripts/import-recordings.mjs <path-to-folder>` from the project root.
3. The script normalizes + converts each file and drops it into `public/audio/phonemes/`.
4. Commit + push. Vercel rebuilds → your voice is live.

You can re-record any single phoneme later and just drop in the new file — only the ones you replace get updated.
