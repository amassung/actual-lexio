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
};

const KEY = (import.meta as any).env?.VITE_ELEVENLABS_API_KEY as string | undefined;
const DEFAULT_VOICE = ((import.meta as any).env?.VITE_ELEVENLABS_VOICE_ID as string | undefined)
  ?? "gwN3hEbGhE9zHBbp2V10"; // Lexio Teacher (fallback if env var missing)
const MODEL_ID = ((import.meta as any).env?.VITE_ELEVENLABS_MODEL_ID as string | undefined)
  ?? "eleven_turbo_v2_5"; // fast + crisp; good for kids' phonics

const blobCache = new Map<string, Promise<Blob>>();
let currentAudio: HTMLAudioElement | null = null;

function cacheKey(text: string, opts: TTSOpts) {
  return `${opts.voiceId ?? DEFAULT_VOICE}|${opts.rate ?? 1}|${text}`;
}

async function fetchElevenLabs(text: string, opts: TTSOpts): Promise<Blob> {
  if (!KEY) throw new Error("VITE_ELEVENLABS_API_KEY not set");
  const voice = opts.voiceId ?? DEFAULT_VOICE;
  const body: Record<string, unknown> = {
    text,
    model_id: MODEL_ID,
    voice_settings: {
      stability: 0.65,        // higher = steadier on sustained sounds
      similarity_boost: 0.85, // stay close to the cloned voice
      style: 0.0,             // neutral tone — best for teaching
      use_speaker_boost: true,
      // Map our rate (0.5–1.5) to ElevenLabs' speed range (~0.7–1.2).
      speed: Math.max(0.7, Math.min(1.2, opts.rate ?? 1)),
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
// Tries to play a recorded phoneme sound from /audio/phonemes/{key}.mp3.
// Resolves with `true` on success; `false` if the file is missing or fails
// to play (caller should fall back to TTS).
//
// Drop human-recorded clips into public/audio/phonemes/ named by the phoneme
// key (lowercase, no symbols): m.mp3, t.mp3, sh.mp3, etc. They'll be used in
// preference to TTS, which is fundamentally limited for isolated phonemes.
const phonemeFileCache = new Map<string, "missing" | "ok">();

export async function playPhonemeFile(key: string): Promise<boolean> {
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
