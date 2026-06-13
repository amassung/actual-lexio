# Phoneme audio clips

Drop recorded clips here named by the phoneme key (lowercase, no punctuation).
The app's `playPhonemeFile()` will use them automatically and skip TTS.

## Naming

| File | Sound | Notes |
|---|---|---|
| `m.mp3` | /m/ | Sustained nasal — held 0.5–1.0s |
| `t.mp3` | /t/ | Clipped, no schwa — ~50ms |
| `s.mp3` | /s/ | Sustained hiss — 0.6s |
| `n.mp3` | /n/ | Sustained nasal |
| `p.mp3` | /p/ | Clipped stop, no "uh" tail |
| `sh.mp3` | /ʃ/ | Sustained "shhh" |
| `ch.mp3` | /tʃ/ | Single short "ch" |
| `th.mp3` | /θ/ | Sustained "thhh" |
| `a.mp3` | /æ/ | Short A — "ah" |
| `e.mp3` | /ɛ/ | Short E — "eh" |
| `i.mp3` | /ɪ/ | Short I — "ih" |
| `o.mp3` | /ɒ/ | Short O — "ah" |
| `u.mp3` | /ʌ/ | Short U — "uh" |

## Recording tips

- **Stops (t, p, k, b, d, g) — most important to record.** TTS engines all add a schwa "uh" tail. Real recordings let you isolate the pure stop with no vowel, which is what phonics teachers actually want.
- **Continuants (m, n, s, f, l, r, sh, th)** — TTS handles these passably with sustained letters, but real recordings are still clearer.
- 44.1 kHz mono MP3 at 128 kbps is more than enough. Keep files under 50 KB each.
- Trim leading/trailing silence aggressively so taps feel snappy.

## How playback resolution works

1. App calls `playPhonemeFile("m")`
2. Service tries `/audio/phonemes/m.mp3` → if it loads + plays → done.
3. If 404 or play error → falls back to Fish Audio TTS with text from `PHONEME_MAP`.
4. If Fish Audio errors (no key, CORS, etc.) → falls back to browser `speechSynthesis`.

So you can ship a recording for just `t.mp3` and `m.mp3` first (the spec's pain points) and let everything else stay on TTS.
