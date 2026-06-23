// ─── ElevenLabs TTS adapter ────────────────────────────────────────────────────
// Public surface:
//   playTTS(text, opts) → Promise<void> that resolves when audio finishes
//   cancelTTS()         → stop any current playback
//
// Falls back to browser speechSynthesis when:
//   - VITE_ELEVENLABS_API_KEY is unset (e.g. local dev without .env.local)
//   - The ElevenLabs fetch throws (CORS, network, 4xx/5xx)
//   - The browser blocks the Audio.play() promise (autoplay policy)
//
// Blobs are cached in-memory by request key, so a tap-to-replay is instant
// and doesn't burn additional API quota.

export type TTSOpts = {
  rate?: number;          // 0.5–1.5; maps to ElevenLabs voice_settings.speed
  voiceId?: string;       // overrides VITE_ELEVENLABS_VOICE_ID
  // When true: skip the sentence-form period append AND disable ElevenLabs'
  // automatic text normalization. Use for isolated phoneme spellings like
  // "Sssssss" so the model treats them as the literal sound, not as a name.
  raw?: boolean;
};

const KEY = (import.meta as any).env?.VITE_ELEVENLABS_API_KEY as string | undefined;
const DEFAULT_VOICE = ((import.meta as any).env?.VITE_ELEVENLABS_VOICE_ID as string | undefined)
  ?? "gwN3hEbGhE9zHBbp2V10"; // Lexio Teacher (fallback if env var missing)
const MODEL_ID = ((import.meta as any).env?.VITE_ELEVENLABS_MODEL_ID as string | undefined)
  ?? "eleven_multilingual_v2"; // highest quality — best for sustained sounds & isolated phonemes

const blobCache = new Map<string, Promise<Blob>>();
let currentAudio: HTMLAudioElement | null = null;

function cacheKey(text: string, opts: TTSOpts) {
  return `${opts.voiceId ?? DEFAULT_VOICE}|${opts.rate ?? 1}|${opts.raw ? "raw" : "sent"}|${text}`;
}

// Wrap bare single words / fragments in a period so ElevenLabs treats them
// as a complete utterance. Without this, "mat" gets sent with no prosodic
// context and can come out clipped or with a weird up-inflection ("mat?").
// SSML phoneme tags pass through untouched.
function ensureSentenceForm(text: string): string {
  const t = text.trim();
  if (!t) return t;
  if (t.startsWith("<")) return t; // already SSML / phoneme tag
  if (/[.!?]$/.test(t)) return t;
  return t + ".";
}

async function fetchElevenLabs(text: string, opts: TTSOpts): Promise<Blob> {
  if (!KEY) throw new Error("VITE_ELEVENLABS_API_KEY not set");
  const voice = opts.voiceId ?? DEFAULT_VOICE;
  const body: Record<string, unknown> = {
    text: opts.raw ? text : ensureSentenceForm(text),
    model_id: MODEL_ID,
    // For raw phoneme spellings, kill ElevenLabs' word-normalization pass —
    // otherwise "Sssssss" can be re-read as a name/word and come out garbled.
    ...(opts.raw ? { apply_text_normalization: "off" } : {}),
    voice_settings: {
      stability: 0.8,         // higher = steadier on sustained sounds like "ssssss"
      similarity_boost: 0.95, // stay very close to the cloned voice — kills the "off" sounds
      style: 0.15,            // tiny bit of expressiveness so it doesn't sound flat
      use_speaker_boost: true,
      // Clamp speed tightly — too slow → mushy, too fast → robotic.
      speed: Math.max(0.85, Math.min(1.1, opts.rate ?? 1)),
    },
  };
  const resp = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: {
        "xi-api-key": KEY,
        "Content-Type": "application/json",
        "Accept": "audio/mpeg",
      },
      body: JSON.stringify(body),
    },
  );
  if (!resp.ok) throw new Error(`ElevenLabs ${resp.status}`);
  const blob = await resp.blob();
  if (blob.size < 100) throw new Error("Empty audio response");
  return blob;
}

function getBlob(text: string, opts: TTSOpts): Promise<Blob> {
  const k = cacheKey(text, opts);
  let entry = blobCache.get(k);
  if (!entry) {
    entry = fetchElevenLabs(text, opts).catch(err => {
      // Don't cache failures — next call gets another shot
      blobCache.delete(k);
      throw err;
    });
    blobCache.set(k, entry);
  }
  return entry;
}

function playSpeechSynthesis(text: string, opts: TTSOpts): Promise<void> {
  return new Promise(resolve => {
    if (typeof window === "undefined" || !window.speechSynthesis) {
      resolve();
      return;
    }
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = opts.rate ?? 0.75;
      u.pitch = 1.1;
      u.lang = "en-US";
      const voices = window.speechSynthesis.getVoices();
      const preferred =
        voices.find(v => /en-(US|GB)/.test(v.lang) && /(Samantha|Karen|Google US English|Microsoft Aria)/i.test(v.name)) ||
        voices.find(v => v.lang.startsWith("en"));
      if (preferred) u.voice = preferred;
      u.onend = () => resolve();
      u.onerror = () => resolve();
      window.speechSynthesis.speak(u);
    } catch {
      resolve();
    }
  });
}

export function cancelTTS() {
  try {
    currentAudio?.pause();
    currentAudio = null;
  } catch {}
  try {
    window.speechSynthesis?.cancel();
  } catch {}
}

export async function playTTS(text: string, opts: TTSOpts = {}): Promise<void> {
  cancelTTS();

  // No key → use browser fallback immediately. Keeps local dev working.
  if (!KEY) return playSpeechSynthesis(text, opts);

  let blob: Blob;
  try {
    blob = await getBlob(text, opts);
  } catch (e) {
    // Network/CORS/4xx — fall back without throwing to caller
    if (typeof console !== "undefined") console.warn("[Lexio TTS] ElevenLabs failed, falling back:", (e as Error).message);
    return playSpeechSynthesis(text, opts);
  }

  return new Promise<void>(resolve => {
    let url: string | null = null;
    try {
      url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      currentAudio = audio;
      const cleanup = () => {
        if (url) URL.revokeObjectURL(url);
        if (currentAudio === audio) currentAudio = null;
        resolve();
      };
      audio.onended = cleanup;
      audio.onerror = cleanup;
      const playPromise = audio.play();
      if (playPromise && typeof playPromise.catch === "function") {
        playPromise.catch(() => {
          // Autoplay blocked or other play() rejection — fall back to browser TTS
          cleanup();
          playSpeechSynthesis(text, opts).then(resolve);
        });
      }
    } catch {
      if (url) URL.revokeObjectURL(url);
      resolve();
    }
  });
}

// ─── Phoneme audio files ──────────────────────────────────────────────────────
// DISABLED: We now use the ElevenLabs cloned voice ("Lexio Teacher") for ALL
// audio — including isolated phonemes — so the voice is consistent everywhere.
//
// The old recordings in public/audio/phonemes/ were made by a different
// speaker and would clash with the cloned voice if mixed in. To re-enable
// the phoneme-file shortcut later (e.g. after regenerating the clips IN the
// cloned voice for extra crispness), delete the early-return below.
const phonemeFileCache = new Map<string, "missing" | "ok">();

export async function playPhonemeFile(_key: string): Promise<boolean> {
  // Force TTS path so every sound comes from the cloned voice.
  return false;
}

// Keep the original implementation around (dead code) so we can flip it back
// on quickly if we record new phonemes in the cloned voice. To re-enable,
// rename this to playPhonemeFile and delete the stub above.
async function _playPhonemeFileImpl(key: string): Promise<boolean> {
  const k = key.toLowerCase();
  if (phonemeFileCache.get(k) === "missing") return false;
  const url = `/audio/phonemes/${k}.mp3`;
  return new Promise<boolean>(resolve => {
    cancelTTS();
    try {
      const audio = new Audio(url);
      currentAudio = audio;
      const cleanup = (ok: boolean) => {
        if (currentAudio === audio) currentAudio = null;
        phonemeFileCache.set(k, ok ? "ok" : "missing");
        resolve(ok);
      };
      audio.onended = () => cleanup(true);
      audio.onerror = () => cleanup(false);
      const p = audio.play();
      if (p && typeof p.catch === "function") {
        p.catch(() => cleanup(false));
      }
    } catch {
      phonemeFileCache.set(k, "missing");
      resolve(false);
    }
  });
}

// Play multiple TTS segments sequentially with optional gaps between.
// Items: a string utterance, or a number (ms pause).
export async function playSequence(items: Array<string | number>, opts: TTSOpts = {}): Promise<void> {
  for (const item of items) {
    if (typeof item === "number") {
      await new Promise(r => setTimeout(r, item));
    } else {
      await playTTS(item, opts);
    }
  }
}

export const ttsConfig = {
  hasKey: !!KEY,
  voice: DEFAULT_VOICE ?? null,
};
