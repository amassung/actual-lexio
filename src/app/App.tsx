import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { motion } from "motion/react";
import { DndProvider, useDrag, useDrop } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import { TouchBackend } from "react-dnd-touch-backend";
import { useStore, type LessonResult, pickWord, WORD_BANK, tierForAge } from "../store";
import { playTTS, playSequence, cancelTTS, playPhonemeFile } from "../services/tts";
import { TraceLetter } from "../components/TraceLetter";

const isTouch = typeof window !== "undefined" && ("ontouchstart" in window || (navigator as any).maxTouchPoints > 0);
const DndBackend = isTouch ? TouchBackend : HTML5Backend;
const DND_TYPE = "phoneme-tile";
import {
  Volume2, Mic, Flame, ChevronRight, Trophy, BarChart2,
  User, Home, BookOpen, Gift, Lock, Check, ArrowRight,
  Sparkles, Zap, Shield, Award, Target, Clock,
  ChevronLeft, Settings, Star, RefreshCw, Heart, TrendingUp, Play
} from "lucide-react";

// ─── Color palette ────────────────────────────────────────────────────────────
const C = {
  bg: "#FFFDF5",
  primary: "#6C47FF",
  primaryDark: "#553AC9",
  primarySoft: "#EFE9FF",
  teal: "#5DCAA5",
  tealSoft: "#E1F5EC",
  amber: "#F4A261",
  amberSoft: "#FEF3E8",
  sky: "#7FB8E0",
  skySoft: "#E8F4FD",
  blush: "#F4B4C8",
  blushSoft: "#FDE8EF",
  yellow: "#FFCC00",
  yellowSoft: "#FFF8E1",
  ink: "#1A1A2E",
  muted: "#6B6B8A",
  white: "#FFFFFF",
  lexi: "#C4B0FF",
  lexiDark: "#9B7EFF",
  glow: "#FFD166",
  glowDark: "#F0BB30",
  echoDark: "#3DB88A",
};

// ─── Typography helpers ───────────────────────────────────────────────────────
const dyslexicFont = "'OpenDyslexic', 'Comic Sans MS', cursive";
const uiFont = "'Lexend', sans-serif";

// ─── Speech helpers ───────────────────────────────────────────────────────────
// Public surface kept identical to the previous speechSynthesis-only
// implementation, so existing callers don't need to change. Internals now
// delegate to services/tts.ts, which prefers Fish Audio and falls back to
// browser speechSynthesis when the key is missing or the API errors.
type SpeakOpts = { rate?: number; pitch?: number };
function speak(text: string, opts: SpeakOpts = {}) {
  // Fire-and-forget; promise is intentionally not awaited.
  void playTTS(text, { rate: opts.rate });
}
// Map a written phoneme to a TTS-friendly sustained or pulsed sound.
//
// Phonetics reality: TTS engines (Fish, ElevenLabs, browser) are trained on
// real speech and will always add a vowel tail to isolated stop consonants.
// For stops (t, p, k, b, d, g) we pair with a short "i" instead of schwa
// "uh" — closer to phonics-correct drilling. For continuants (m, n, s, f, l,
// r, sh, th) we draw the sound out with repeated letters.
//
// Better still: drop a recorded clip at public/audio/phonemes/{key}.mp3 and
// playPhonemeFile() picks it up automatically, bypassing TTS entirely.
// PHONEME_MAP — spellings sent to ElevenLabs to produce isolated phonics
// sounds. KEEP ALL-LOWERCASE for continuants — uppercase initial letters can
// trick the model into reading them as letter names ("Ess", "Em").
const PHONEME_MAP: Record<string, { text: string; rate: number }> = {
  // Digraphs / blends
  sh: { text: "shhhhhhh", rate: 0.4 },
  ch: { text: "ch, ch, ch", rate: 0.5 },
  th: { text: "thhhhhhh", rate: 0.4 },
  wh: { text: "wh, wh", rate: 0.5 },
  // Vowels — short sounds
  a: { text: "ahh", rate: 0.5 },
  e: { text: "ehh", rate: 0.5 },
  i: { text: "ih", rate: 0.55 },
  o: { text: "ahh", rate: 0.5 },
  u: { text: "uhh", rate: 0.55 },
  // Continuants — sustained / drawn out
  m: { text: "mmmmmmmm", rate: 0.35 },
  n: { text: "nnnnnnnn", rate: 0.35 },
  s: { text: "ssssssss", rate: 0.4 },
  f: { text: "ffffffff", rate: 0.4 },
  l: { text: "llllllll", rate: 0.4 },
  r: { text: "rrrrrrrr", rate: 0.45 },
  z: { text: "zzzzzzzz", rate: 0.4 },
  v: { text: "vvvvvvvv", rate: 0.4 },
  // Stops — pair with short "i" rather than schwa "uh"
  t: { text: "ti, ti, ti", rate: 0.55 },
  p: { text: "pi, pi, pi", rate: 0.55 },
  k: { text: "ki, ki, ki", rate: 0.55 },
  b: { text: "bi, bi, bi", rate: 0.55 },
  d: { text: "di, di, di", rate: 0.55 },
  g: { text: "gi, gi, gi", rate: 0.55 },
  // Long vowels — used in CVCe (Magic E) lessons
  a_e: { text: "ayyy", rate: 0.45 }, // long A as in "cake"
  i_e: { text: "iyyy", rate: 0.45 }, // long I as in "bike"
  o_e: { text: "ohhh", rate: 0.4 },  // long O as in "hope"
  u_e: { text: "yooo", rate: 0.45 }, // long U as in "cute"
};
function speakPhoneme(letters: string) {
  const key = letters.toLowerCase();
  // Prefer a recorded clip if present; only TTS as fallback.
  void playPhonemeFile(key).then(played => {
    if (played) return;
    const entry = PHONEME_MAP[key] ?? { text: letters, rate: 0.55 };
    // raw:true → skip sentence-period append AND disable ElevenLabs text
    // normalization, so spellings like "ssssssss" stay literal instead of
    // being re-read as a name/word.
    void playTTS(entry.text, { rate: entry.rate, raw: true });
  });
}
// Sound out a phoneme + word: "shh… shh… ship". Chained as a real sequence
// so the next segment only starts after the previous audio finishes.
function speakLesson(phoneme: string, word: string) {
  const phonemeText = PHONEME_MAP[phoneme.toLowerCase()]?.text ?? phoneme;
  void playSequence(
    [phonemeText, 220, phonemeText, 260, word],
    { rate: 0.6 }
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────
type Screen = "splash" | "onboard" | "home" | "learn" | "games" | "lesson" | "progress" | "rewards" | "profile" | "parent";
type LessonStep = "hear" | "see" | "trace" | "say" | "build" | "win";
type Tab = "home" | "learn" | "progress" | "rewards" | "profile";
type MicState = "idle" | "listening" | "processing" | "encourage";
type WinVariant = "small" | "streak" | "level";

// ─── Lesson Data ──────────────────────────────────────────────────────────────
type LessonData = {
  id: string;
  phoneme: string;
  word: string;
  wordEmoji: string;
  tipText: string;
  phonemeParts: { letters: string; label: string; highlight: boolean }[];
  traceStrokes: string[];
  traceViewBox: string;
  sayAccept: RegExp;
  buildSlots: string[];
  buildTiles: string[];
  xpReward: number;
  isBoss?: boolean;
};

// ─── Word pools for the new mini-games ────────────────────────────────────────
// All three new games (Flashcards, Listen Up, Fill the Blank) need a list of
// "words that teach this phoneme". The existing LessonData only carries one
// word per lesson, which is enough for Trace/Build but not for variety in
// repeat-play games. Pools are keyed by lesson id; if a lesson has no pool the
// fallback is just the lesson's single word + emoji.
// Audit principle: every emoji should be a literal, recognizable visual of
// the word. Abstract / approximation emojis ("mat" → 🟫 brown square, "red"
// → 🟥 red square, "ink" → 🖋️ pen) are dropped because kids can't infer the
// word from them in image-only games. Each pool has 5 entries so games have
// enough variety to draw unique targets across rounds with no repeats.
const WORD_POOLS: Record<string, { word: string; emoji: string }[]> = {
  "m-sound":   [{ word: "moon", emoji: "🌙" }, { word: "monkey", emoji: "🐒" }, { word: "milk", emoji: "🥛" }, { word: "map", emoji: "🗺️" }, { word: "mouse", emoji: "🐭" }],
  "s-sound":   [{ word: "sun", emoji: "☀️" }, { word: "snake", emoji: "🐍" }, { word: "seal", emoji: "🦭" }, { word: "sock", emoji: "🧦" }, { word: "star", emoji: "⭐" }],
  "t-sound":   [{ word: "tiger", emoji: "🐯" }, { word: "turtle", emoji: "🐢" }, { word: "ten", emoji: "🔟" }, { word: "tree", emoji: "🌳" }, { word: "taco", emoji: "🌮" }],
  "short-a":   [{ word: "apple", emoji: "🍎" }, { word: "ant", emoji: "🐜" }, { word: "cat", emoji: "🐱" }, { word: "bag", emoji: "👜" }, { word: "axe", emoji: "🪓" }],
  "p-sound":   [{ word: "pig", emoji: "🐷" }, { word: "panda", emoji: "🐼" }, { word: "pizza", emoji: "🍕" }, { word: "pumpkin", emoji: "🎃" }, { word: "popcorn", emoji: "🍿" }],
  "n-sound":   [{ word: "nose", emoji: "👃" }, { word: "nest", emoji: "🪺" }, { word: "nine", emoji: "9️⃣" }, { word: "nut", emoji: "🥜" }, { word: "needle", emoji: "🪡" }],
  "short-i":   [{ word: "fish", emoji: "🐟" }, { word: "pin", emoji: "📌" }, { word: "ring", emoji: "💍" }, { word: "lips", emoji: "👄" }, { word: "pig", emoji: "🐷" }],
  "short-e":   [{ word: "egg", emoji: "🥚" }, { word: "bed", emoji: "🛏️" }, { word: "hen", emoji: "🐔" }, { word: "leg", emoji: "🦵" }, { word: "ten", emoji: "🔟" }],
  "short-o":   [{ word: "octopus", emoji: "🐙" }, { word: "fox", emoji: "🦊" }, { word: "log", emoji: "🪵" }, { word: "frog", emoji: "🐸" }, { word: "dog", emoji: "🐶" }],
  "short-u":   [{ word: "umbrella", emoji: "☂️" }, { word: "bug", emoji: "🐛" }, { word: "cup", emoji: "☕" }, { word: "duck", emoji: "🦆" }, { word: "drum", emoji: "🥁" }],
  "sh-sound":  [{ word: "ship", emoji: "🚢" }, { word: "shell", emoji: "🐚" }, { word: "fish", emoji: "🐟" }, { word: "sheep", emoji: "🐑" }, { word: "shoe", emoji: "👟" }],
  "ch-sound":  [{ word: "cheese", emoji: "🧀" }, { word: "cherry", emoji: "🍒" }, { word: "chair", emoji: "🪑" }, { word: "cheetah", emoji: "🐆" }, { word: "chick", emoji: "🐥" }],
  "th-sound":  [{ word: "thumb", emoji: "👍" }, { word: "three", emoji: "3️⃣" }, { word: "bath", emoji: "🛁" }, { word: "teeth", emoji: "🦷" }, { word: "thread", emoji: "🧵" }],
  // ── Level 5: Action Words (verbs in context) ───────────────────────────────
  "action-play": [{ word: "play", emoji: "🎮" }, { word: "paint", emoji: "🎨" }, { word: "push", emoji: "🤚" }, { word: "pull", emoji: "💪" }, { word: "plant", emoji: "🌱" }],
  "action-eat":  [{ word: "eat", emoji: "🍽️" }, { word: "drink", emoji: "🥤" }, { word: "chew", emoji: "😋" }, { word: "sip", emoji: "🥛" }, { word: "snack", emoji: "🍪" }],
  "action-sing": [{ word: "sing", emoji: "🎤" }, { word: "shout", emoji: "📢" }, { word: "smile", emoji: "😊" }, { word: "talk", emoji: "💬" }, { word: "wave", emoji: "👋" }],
  "action-nap":   [{ word: "nap", emoji: "😴" }, { word: "rest", emoji: "🛌" }, { word: "yawn", emoji: "🥱" }, { word: "stretch", emoji: "🧘" }, { word: "dream", emoji: "💭" }],
  "action-run":   [{ word: "run", emoji: "🏃" }, { word: "jog", emoji: "🚶" }, { word: "hop", emoji: "🦘" }, { word: "skip", emoji: "👯" }, { word: "race", emoji: "🏁" }],
  "action-jump":  [{ word: "jump", emoji: "🤸" }, { word: "leap", emoji: "🐸" }, { word: "fly", emoji: "🕊️" }, { word: "climb", emoji: "🧗" }, { word: "swim", emoji: "🏊" }],
  "action-look":  [{ word: "look", emoji: "👀" }, { word: "see", emoji: "👁️" }, { word: "watch", emoji: "📺" }, { word: "read", emoji: "📖" }, { word: "find", emoji: "🔍" }],
  "action-make":  [{ word: "make", emoji: "🛠️" }, { word: "build", emoji: "🏗️" }, { word: "fix", emoji: "🔧" }, { word: "draw", emoji: "✏️" }, { word: "paint", emoji: "🎨" }],
  "action-help":  [{ word: "help", emoji: "🤝" }, { word: "share", emoji: "🎁" }, { word: "hug", emoji: "🤗" }, { word: "smile", emoji: "😊" }, { word: "wave", emoji: "👋" }],
  "action-clean": [{ word: "clean", emoji: "🧼" }, { word: "wash", emoji: "🚿" }, { word: "brush", emoji: "🪥" }, { word: "sweep", emoji: "🧹" }, { word: "dry", emoji: "🌬️" }],
  // ── Sight Words (Dolch Pre-K) — abstract words get evocative emoji ─────────
  "sight-pk-1": [{ word: "see", emoji: "👁️" }, { word: "I", emoji: "🙋" }, { word: "can", emoji: "💪" }, { word: "you", emoji: "👉" }, { word: "look", emoji: "👀" }],
  "sight-pk-2": [{ word: "the", emoji: "📘" }, { word: "a", emoji: "🅰️" }, { word: "is", emoji: "🟰" }, { word: "and", emoji: "➕" }, { word: "to", emoji: "➡️" }],
  "sight-pk-3": [{ word: "me", emoji: "🙋" }, { word: "my", emoji: "🫴" }, { word: "we", emoji: "👫" }, { word: "in", emoji: "📥" }, { word: "it", emoji: "👇" }],
  "sight-pk-4": [{ word: "come", emoji: "👋" }, { word: "go", emoji: "🚀" }, { word: "here", emoji: "📍" }, { word: "find", emoji: "🔍" }, { word: "help", emoji: "🤝" }],
  "sight-pk-5": [{ word: "jump", emoji: "🤸" }, { word: "big", emoji: "🐘" }, { word: "little", emoji: "🐜" }, { word: "up", emoji: "⬆️" }, { word: "down", emoji: "⬇️" }],
  "sight-pk-6": [{ word: "red", emoji: "🔴" }, { word: "blue", emoji: "🔵" }, { word: "yellow", emoji: "🟡" }, { word: "one", emoji: "1️⃣" }, { word: "two", emoji: "2️⃣" }],
  // ── Sight Words (Dolch Primer) ─────────────────────────────────────────────
  "sight-prim-1": [{ word: "she", emoji: "👩" }, { word: "he", emoji: "👨" }, { word: "they", emoji: "👬" }, { word: "was", emoji: "⏪" }, { word: "are", emoji: "🟰" }],
  "sight-prim-2": [{ word: "have", emoji: "✋" }, { word: "do", emoji: "🛠️" }, { word: "did", emoji: "☑️" }, { word: "will", emoji: "🎯" }, { word: "must", emoji: "❗" }],
  "sight-prim-3": [{ word: "came", emoji: "🚶" }, { word: "went", emoji: "🏃" }, { word: "saw", emoji: "👀" }, { word: "ate", emoji: "🍽️" }, { word: "ran", emoji: "🏃" }],
  "sight-prim-4": [{ word: "this", emoji: "👇" }, { word: "that", emoji: "👈" }, { word: "there", emoji: "📍" }, { word: "what", emoji: "❓" }, { word: "who", emoji: "🤔" }],
  "sight-prim-5": [{ word: "new", emoji: "✨" }, { word: "black", emoji: "⚫" }, { word: "brown", emoji: "🟫" }, { word: "white", emoji: "⚪" }, { word: "pretty", emoji: "🌸" }],
  "sight-prim-6": [{ word: "like", emoji: "❤️" }, { word: "want", emoji: "🙏" }, { word: "good", emoji: "👍" }, { word: "please", emoji: "🥺" }, { word: "yes", emoji: "✅" }],
  // ── Magic E (CVCe) ─────────────────────────────────────────────────────────
  "cvce-a": [{ word: "cake", emoji: "🎂" }, { word: "bake", emoji: "🍞" }, { word: "snake", emoji: "🐍" }, { word: "game", emoji: "🎲" }, { word: "plate", emoji: "🍽️" }],
  "cvce-i": [{ word: "bike", emoji: "🚲" }, { word: "kite", emoji: "🪁" }, { word: "smile", emoji: "😊" }, { word: "time", emoji: "⏰" }, { word: "five", emoji: "5️⃣" }],
  "cvce-o": [{ word: "rope", emoji: "🪢" }, { word: "nose", emoji: "👃" }, { word: "home", emoji: "🏠" }, { word: "bone", emoji: "🦴" }, { word: "stone", emoji: "🪨" }],
  "cvce-u": [{ word: "cube", emoji: "🧊" }, { word: "tube", emoji: "🧪" }, { word: "flute", emoji: "🎶" }, { word: "mule", emoji: "🫏" }, { word: "prune", emoji: "🍇" }],
};

function wordsForLesson(lesson: LessonData): { word: string; emoji: string }[] {
  const pool = WORD_POOLS[lesson.id];
  if (pool && pool.length) return pool;
  return [{ word: lesson.word, emoji: lesson.wordEmoji }];
}

// Take `n` items from `arr` with no repeats. If `arr` is smaller than `n`,
// reshuffles the remainder (so kids never see the same word twice in a row
// across rounds; only after the entire pool is exhausted).
function shuffleAndSlice<T>(arr: T[], n: number): T[] {
  const out: T[] = [];
  let deck = [...arr].sort(() => Math.random() - 0.5);
  for (let i = 0; i < n; i++) {
    if (deck.length === 0) {
      // Reshuffle when exhausted, avoiding back-to-back duplicates if possible.
      deck = [...arr].sort(() => Math.random() - 0.5);
      if (deck[0] === out[out.length - 1] && deck.length > 1) {
        [deck[0], deck[1]] = [deck[1], deck[0]];
      }
    }
    out.push(deck.shift()!);
  }
  return out;
}

// Pick `count` random word+emoji entries that are NOT `excluded.word`.
// Falls back to other lessons' pools if the current lesson's pool is too small.
function pickDistractorWords(currentLessonId: string, exclude: string, count: number): { word: string; emoji: string }[] {
  const same = (WORD_POOLS[currentLessonId] ?? []).filter(w => w.word !== exclude);
  const others = Object.entries(WORD_POOLS)
    .filter(([k]) => k !== currentLessonId)
    .flatMap(([, words]) => words)
    .filter(w => w.word !== exclude);
  const combined = [...same, ...others];
  const shuffled = [...combined].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

// Common phoneme tokens used as distractors in Fill the Blank.
const COMMON_PHONEME_TOKENS = ["m", "s", "t", "p", "n", "a", "i", "e", "o", "u", "b", "f", "l", "r", "sh", "ch", "th"];

function pickDistractorLetters(correct: string, count: number): string[] {
  const lower = correct.toLowerCase();
  const pool = COMMON_PHONEME_TOKENS.filter(p => p !== lower);
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

// Blank out the phoneme inside the word. If the phoneme doesn't appear,
// fall back to blanking the first letter so the game still works.
function maskWord(word: string, phoneme: string): { masked: string; missing: string } {
  const lower = word.toLowerCase();
  const ph = phoneme.toLowerCase();
  const idx = lower.indexOf(ph);
  if (idx === -1) {
    return { masked: "_" + word.slice(1), missing: word[0] };
  }
  const before = word.slice(0, idx);
  const blank = "_".repeat(ph.length);
  const after = word.slice(idx + ph.length);
  return { masked: before + blank + after, missing: word.slice(idx, idx + ph.length) };
}

const LESSONS: Record<string, LessonData> = {
  // ── Level 1: Structured Literacy sequence (m, s, t, short-a, p, n) ──────────
  "m-sound": {
    id: "m-sound", phoneme: "M", word: "mat", wordEmoji: "🟫",
    tipText: 'M says "mmm" — hum with your lips together, like tasting something yummy!',
    phonemeParts: [
      { letters: "M", label: "The sound", highlight: true },
      { letters: "A", label: "Short A", highlight: false },
      { letters: "T", label: "The stop", highlight: false },
    ],
    traceStrokes: [
      "M 60 200 L 60 50", "M 60 50 L 180 150",
      "M 180 150 L 300 50", "M 300 50 L 300 200",
    ],
    traceViewBox: "0 0 360 240",
    sayAccept: /\b(mat|map|man|mad|mud|mop|met|mix|mob|mug)\b/i,
    buildSlots: ["M", "A", "T"], buildTiles: ["M", "A", "T", "S", "P", "N"],
    xpReward: 15,
  },
  "s-sound": {
    id: "s-sound", phoneme: "S", word: "sat", wordEmoji: "🧸",
    tipText: 'S says "sss" — like a snake hissing! Keep your tongue behind your teeth.',
    phonemeParts: [
      { letters: "S", label: "The sound", highlight: true },
      { letters: "A", label: "Short A", highlight: false },
      { letters: "T", label: "The stop", highlight: false },
    ],
    traceStrokes: [
      "M 270 75 Q 180 50 130 100 Q 90 140 180 165 Q 240 185 270 160",
    ],
    traceViewBox: "0 0 360 240",
    sayAccept: /\b(sat|sit|sun|sap|sip|sad|set|sob|sum|sot)\b/i,
    buildSlots: ["S", "A", "T"], buildTiles: ["S", "A", "T", "M", "P", "N"],
    xpReward: 15,
  },
  "t-sound": {
    id: "t-sound", phoneme: "T", word: "tap", wordEmoji: "🚰",
    tipText: 'T says "t-t-t" — a quick tap of your tongue on the roof of your mouth!',
    phonemeParts: [
      { letters: "T", label: "The sound", highlight: true },
      { letters: "A", label: "Short A", highlight: false },
      { letters: "P", label: "The end", highlight: false },
    ],
    traceStrokes: [
      "M 60 75 L 300 75", "M 180 75 L 180 210",
    ],
    traceViewBox: "0 0 360 240",
    sayAccept: /\b(tap|tan|tip|top|tub|tab|ten|tin|tug|tot)\b/i,
    buildSlots: ["T", "A", "P"], buildTiles: ["T", "A", "P", "M", "S", "N"],
    xpReward: 15,
  },
  "p-sound": {
    id: "p-sound", phoneme: "P", word: "pan", wordEmoji: "🍳",
    tipText: 'P says "p-p-p" — pop your lips together like blowing a tiny bubble!',
    phonemeParts: [
      { letters: "P", label: "The sound", highlight: true },
      { letters: "A", label: "Short A", highlight: false },
      { letters: "N", label: "The end", highlight: false },
    ],
    traceStrokes: [
      "M 80 50 L 80 210",
      "M 80 50 Q 260 50 260 120 Q 260 190 80 190",
    ],
    traceViewBox: "0 0 360 240",
    sayAccept: /\b(pan|pat|pit|pot|pup|pad|pen|pin|pun|pap)\b/i,
    buildSlots: ["P", "A", "N"], buildTiles: ["P", "A", "N", "M", "S", "T"],
    xpReward: 15,
  },
  "n-sound": {
    id: "n-sound", phoneme: "N", word: "nap", wordEmoji: "😴",
    tipText: 'N says "nnn" — feel the buzz in your nose as air flows through!',
    phonemeParts: [
      { letters: "N", label: "The sound", highlight: true },
      { letters: "A", label: "Short A", highlight: false },
      { letters: "P", label: "The end", highlight: false },
    ],
    traceStrokes: [
      "M 80 50 L 80 210", "M 80 50 L 280 210", "M 280 50 L 280 210",
    ],
    traceViewBox: "0 0 360 240",
    sayAccept: /\b(nap|net|nit|not|nut|nab|nag|nod|nun|nip)\b/i,
    buildSlots: ["N", "A", "P"], buildTiles: ["N", "A", "P", "M", "S", "T"],
    xpReward: 15,
  },
  "level1-boss": {
    id: "level1-boss", phoneme: "M S T A P N", word: "Level 1", wordEmoji: "🏆",
    tipText: "You know M, S, T, short-A, P, and N — that's real reading power!",
    phonemeParts: [], traceStrokes: [], traceViewBox: "0 0 360 240",
    sayAccept: /.*/,
    buildSlots: ["M", "A", "T"], buildTiles: ["M", "A", "T", "S", "P", "N"],
    xpReward: 75, isBoss: true,
  },
  // ── Level 2: Remaining short vowels ──────────────────────────────────────────
  "short-a": {
    id: "short-a", phoneme: "A", word: "cat", wordEmoji: "🐱",
    tipText: 'Short A says "aah" — like when you open wide at the doctor!',
    phonemeParts: [
      { letters: "C", label: "The start", highlight: false },
      { letters: "A", label: "Short A", highlight: true },
      { letters: "T", label: "The stop", highlight: false },
    ],
    traceStrokes: ["M 60 200 L 180 60", "M 180 60 L 300 200", "M 100 145 L 260 145"],
    traceViewBox: "0 0 360 240",
    sayAccept: /\b(cat|cap|can|mat|bat|hat|sat|fat|rat|tap|map|nap)\b/i,
    buildSlots: ["C", "A", "T"], buildTiles: ["C", "A", "T", "S", "B", "H"],
    xpReward: 15,
  },
  "short-e": {
    id: "short-e", phoneme: "E", word: "hen", wordEmoji: "🐔",
    tipText: 'Short E says "ehh" — like when you\'re not sure about something!',
    phonemeParts: [
      { letters: "H", label: "The start", highlight: false },
      { letters: "E", label: "Short E", highlight: true },
      { letters: "N", label: "The end", highlight: false },
    ],
    traceStrokes: ["M 80 60 L 80 200", "M 80 60 L 260 60", "M 80 130 L 220 130", "M 80 200 L 260 200"],
    traceViewBox: "0 0 360 240",
    sayAccept: /\b(hen|bed|pet|set|net|wet|ten|pen|men|red|fed|led)\b/i,
    buildSlots: ["H", "E", "N"], buildTiles: ["H", "E", "N", "B", "D", "T"],
    xpReward: 15,
  },
  "short-i": {
    id: "short-i", phoneme: "I", word: "big", wordEmoji: "🐘",
    tipText: 'Short I says "ih" — a quick little sound in the middle!',
    phonemeParts: [
      { letters: "B", label: "The start", highlight: false },
      { letters: "I", label: "Short I", highlight: true },
      { letters: "G", label: "The end", highlight: false },
    ],
    traceStrokes: ["M 180 60 L 180 200", "M 140 60 L 220 60", "M 140 200 L 220 200"],
    traceViewBox: "0 0 360 240",
    sayAccept: /\b(big|bit|sit|lip|tip|dip|hip|rip|sip|zip|fig|dig)\b/i,
    buildSlots: ["B", "I", "G"], buildTiles: ["B", "I", "G", "P", "A", "D"],
    xpReward: 15,
  },
  "vowel-boss": {
    id: "vowel-boss", phoneme: "A E I", word: "vowels", wordEmoji: "🏆",
    tipText: "You mastered all the short vowels — A, E, and I!",
    phonemeParts: [], traceStrokes: [], traceViewBox: "0 0 360 240",
    sayAccept: /.*/,
    buildSlots: ["A", "E", "I"], buildTiles: ["A", "E", "I", "O", "U"],
    xpReward: 50, isBoss: true,
  },
  "sh-sound": {
    id: "sh-sound", phoneme: "SH", word: "ship", wordEmoji: "🚢",
    tipText: 'SH together make one special sound — like saying "shhhh"!',
    phonemeParts: [
      { letters: "SH", label: "The blend", highlight: true },
      { letters: "i", label: "Short I", highlight: false },
      { letters: "p", label: "The stop", highlight: false },
    ],
    traceStrokes: [
      "M 150 70 Q 60 60 60 105 Q 60 135 105 135 Q 150 135 150 165 Q 150 200 60 195",
      "M 210 60 L 210 200", "M 300 60 L 300 200", "M 210 130 L 300 130",
    ],
    traceViewBox: "0 0 360 240",
    sayAccept: /\b(ship|sheep|shape|shift|chip|shed|shell|shop|shot)\b/i,
    buildSlots: ["SH", "I", "P"], buildTiles: ["SH", "I", "P", "T", "R", "CH"],
    xpReward: 20,
  },
  "ch-sound": {
    id: "ch-sound", phoneme: "CH", word: "chip", wordEmoji: "🍟",
    tipText: 'CH makes a sound like a sneeze — "ch ch ch"!',
    phonemeParts: [
      { letters: "CH", label: "The blend", highlight: true },
      { letters: "i", label: "Short I", highlight: false },
      { letters: "p", label: "The stop", highlight: false },
    ],
    traceStrokes: [
      "M 160 70 Q 80 60 80 130 Q 80 200 160 195",
      "M 210 60 L 210 200", "M 300 60 L 300 200", "M 210 130 L 300 130",
    ],
    traceViewBox: "0 0 360 240",
    sayAccept: /\b(chip|chat|chin|chop|chum|check|chest|chair|chick|chest)\b/i,
    buildSlots: ["CH", "I", "P"], buildTiles: ["CH", "I", "P", "SH", "T", "R"],
    xpReward: 20,
  },
  "th-sound": {
    id: "th-sound", phoneme: "TH", word: "that", wordEmoji: "👉",
    tipText: 'TH is made by putting your tongue between your teeth — try it!',
    phonemeParts: [
      { letters: "TH", label: "The blend", highlight: true },
      { letters: "A", label: "Short A", highlight: false },
      { letters: "T", label: "The stop", highlight: false },
    ],
    traceStrokes: [
      "M 60 70 L 160 70", "M 110 70 L 110 200",
      "M 200 60 L 200 200", "M 290 60 L 290 200", "M 200 130 L 290 130",
    ],
    traceViewBox: "0 0 360 240",
    sayAccept: /\b(that|this|the|them|then|thin|thick|think|thing|thank)\b/i,
    buildSlots: ["TH", "A", "T"], buildTiles: ["TH", "A", "T", "SH", "CH", "S"],
    xpReward: 20,
  },
  "blend-boss": {
    id: "blend-boss", phoneme: "SH CH TH", word: "blends", wordEmoji: "🏆",
    tipText: "You mastered SH, CH, and TH blends — amazing!",
    phonemeParts: [], traceStrokes: [], traceViewBox: "0 0 360 240",
    sayAccept: /.*/,
    buildSlots: ["SH", "CH", "TH"], buildTiles: ["SH", "CH", "TH", "BL", "ST"],
    xpReward: 50, isBoss: true,
  },
  "long-a": {
    id: "long-a", phoneme: "AI", word: "rain", wordEmoji: "🌧",
    tipText: 'AI makes the long A sound — it says its own name, "ayyy"!',
    phonemeParts: [
      { letters: "R", label: "The start", highlight: false },
      { letters: "AI", label: "Long A", highlight: true },
      { letters: "N", label: "The end", highlight: false },
    ],
    traceStrokes: ["M 80 200 L 180 60", "M 180 60 L 280 200", "M 115 145 L 245 145"],
    traceViewBox: "0 0 360 240",
    sayAccept: /\b(rain|main|pain|gain|train|brain|plain|mail|tail|sail|wait|bait)\b/i,
    buildSlots: ["R", "AI", "N"], buildTiles: ["R", "AI", "N", "T", "SH", "CH"],
    xpReward: 25,
  },
  "long-e": {
    id: "long-e", phoneme: "EE", word: "feet", wordEmoji: "🦶",
    tipText: 'EE makes the long E sound — stretch it out and say "eeee"!',
    phonemeParts: [
      { letters: "F", label: "The start", highlight: false },
      { letters: "EE", label: "Long E", highlight: true },
      { letters: "T", label: "The stop", highlight: false },
    ],
    traceStrokes: ["M 80 60 L 80 200", "M 80 60 L 260 60", "M 80 130 L 220 130", "M 80 200 L 260 200"],
    traceViewBox: "0 0 360 240",
    sayAccept: /\b(feet|tree|bee|see|fee|free|seed|feed|need|weed|meet|teeth)\b/i,
    buildSlots: ["F", "EE", "T"], buildTiles: ["F", "EE", "T", "B", "S", "CH"],
    xpReward: 25,
  },
  "short-o": {
    id: "short-o", phoneme: "O", word: "dog", wordEmoji: "🐶",
    tipText: 'Short O says "aah" — a short round sound!',
    phonemeParts: [
      { letters: "D", label: "The start", highlight: false },
      { letters: "O", label: "Short O", highlight: true },
      { letters: "G", label: "The end", highlight: false },
    ],
    traceStrokes: ["M 180 70 Q 80 70 80 135 Q 80 200 180 200 Q 280 200 280 135 Q 280 70 180 70"],
    traceViewBox: "0 0 360 240",
    sayAccept: /\b(dog|log|fog|hot|pot|dot|got|lot|mop|top|hop|box|fox)\b/i,
    buildSlots: ["D", "O", "G"], buildTiles: ["D", "O", "G", "B", "A", "T"],
    xpReward: 20,
  },
  "short-u": {
    id: "short-u", phoneme: "U", word: "sun", wordEmoji: "☀",
    tipText: 'Short U says "uh" — short and round like a bubble!',
    phonemeParts: [
      { letters: "S", label: "The start", highlight: false },
      { letters: "U", label: "Short U", highlight: true },
      { letters: "N", label: "The end", highlight: false },
    ],
    traceStrokes: ["M 100 60 L 100 165 Q 100 210 180 210 Q 260 210 260 165 L 260 60"],
    traceViewBox: "0 0 360 240",
    sayAccept: /\b(sun|bun|fun|run|gun|cup|pup|mud|bud|bug|mug|rug)\b/i,
    buildSlots: ["S", "U", "N"], buildTiles: ["S", "U", "N", "B", "A", "T"],
    xpReward: 20,
  },
  "long-i": {
    id: "long-i", phoneme: "IGH", word: "night", wordEmoji: "🌙",
    tipText: 'IGH makes the long I sound — it says "I" like you say about yourself!',
    phonemeParts: [
      { letters: "N", label: "The start", highlight: false },
      { letters: "IGH", label: "Long I", highlight: true },
      { letters: "T", label: "The stop", highlight: false },
    ],
    traceStrokes: ["M 180 60 L 180 200", "M 140 60 L 220 60", "M 140 200 L 220 200"],
    traceViewBox: "0 0 360 240",
    sayAccept: /\b(night|light|right|fight|sight|might|tight|bright|flight|fright)\b/i,
    buildSlots: ["N", "IGH", "T"], buildTiles: ["N", "IGH", "T", "B", "SH", "CH"],
    xpReward: 25,
  },
  "long-o": {
    id: "long-o", phoneme: "OA", word: "boat", wordEmoji: "🚤",
    tipText: 'OA makes the long O sound — like "oh" when you\'re surprised!',
    phonemeParts: [
      { letters: "B", label: "The start", highlight: false },
      { letters: "OA", label: "Long O", highlight: true },
      { letters: "T", label: "The stop", highlight: false },
    ],
    traceStrokes: ["M 180 70 Q 80 70 80 135 Q 80 200 180 200 Q 280 200 280 135 Q 280 70 180 70"],
    traceViewBox: "0 0 360 240",
    sayAccept: /\b(boat|coat|goat|moat|road|load|toad|toast|roast|coast|float)\b/i,
    buildSlots: ["B", "OA", "T"], buildTiles: ["B", "OA", "T", "C", "SH", "N"],
    xpReward: 25,
  },
  "vowel-boss-2": {
    id: "vowel-boss-2", phoneme: "★", word: "vowels", wordEmoji: "🏆",
    tipText: "You mastered ALL the vowels — short and long!",
    phonemeParts: [], traceStrokes: [], traceViewBox: "0 0 360 240",
    sayAccept: /.*/,
    buildSlots: ["A", "E", "I"], buildTiles: ["A", "E", "I", "O", "U"],
    xpReward: 75, isBoss: true,
  },

  // ── Level 5: Action Words ───────────────────────────────────────────────────
  // Verb-focused lessons. Strokes reuse first-letter shapes from earlier
  // lessons so Trace It still works. Word pools (see WORD_POOLS) give all
  // the verb-themed games (Flashcards, Listen Up, Photo Touch, Memory, True
  // or False, Spelling Bee) something to draw from.
  "action-play": {
    id: "action-play", phoneme: "P", word: "play", wordEmoji: "🎮",
    tipText: "Action words tell us what we DO — like \"play\"! P is for play.",
    phonemeParts: [
      { letters: "P", label: "The sound", highlight: true },
      { letters: "LAY", label: "The rest", highlight: false },
    ],
    traceStrokes: [
      "M 80 50 L 80 210",
      "M 80 50 Q 260 50 260 120 Q 260 190 80 190",
    ],
    traceViewBox: "0 0 360 240",
    sayAccept: /\b(play|plays|playing|paint|push|pull|plant)\b/i,
    buildSlots: ["P", "L", "A", "Y"], buildTiles: ["P", "L", "A", "Y", "S", "R"],
    xpReward: 20,
  },
  "action-eat": {
    id: "action-eat", phoneme: "E", word: "eat", wordEmoji: "🍽️",
    tipText: "Eat is something we ALL do! E says \"ehh\" — like \"eat\".",
    phonemeParts: [
      { letters: "E", label: "Short E", highlight: true },
      { letters: "A", label: "Short A", highlight: false },
      { letters: "T", label: "The end", highlight: false },
    ],
    traceStrokes: ["M 80 60 L 80 200", "M 80 60 L 260 60", "M 80 130 L 220 130", "M 80 200 L 260 200"],
    traceViewBox: "0 0 360 240",
    sayAccept: /\b(eat|eats|eating|drink|chew|sip|snack)\b/i,
    buildSlots: ["E", "A", "T"], buildTiles: ["E", "A", "T", "S", "M", "P"],
    xpReward: 20,
  },
  "action-sing": {
    id: "action-sing", phoneme: "S", word: "sing", wordEmoji: "🎤",
    tipText: "Sing makes music! S says \"sss\" — start with that snake sound.",
    phonemeParts: [
      { letters: "S", label: "The sound", highlight: true },
      { letters: "I", label: "Short I", highlight: false },
      { letters: "NG", label: "The end", highlight: false },
    ],
    traceStrokes: [
      "M 270 75 Q 180 50 130 100 Q 90 140 180 165 Q 240 185 270 160",
    ],
    traceViewBox: "0 0 360 240",
    sayAccept: /\b(sing|sings|singing|shout|smile|talk|wave|say)\b/i,
    buildSlots: ["S", "I", "N", "G"], buildTiles: ["S", "I", "N", "G", "A", "T"],
    xpReward: 20,
  },
  "action-nap": {
    id: "action-nap", phoneme: "N", word: "nap", wordEmoji: "😴",
    tipText: "A nap is a short sleep. N says \"nnn\" — feel the buzz in your nose.",
    phonemeParts: [
      { letters: "N", label: "The sound", highlight: true },
      { letters: "A", label: "Short A", highlight: false },
      { letters: "P", label: "The end", highlight: false },
    ],
    traceStrokes: [
      "M 80 50 L 80 210", "M 80 50 L 280 210", "M 280 50 L 280 210",
    ],
    traceViewBox: "0 0 360 240",
    sayAccept: /\b(nap|naps|napping|rest|yawn|stretch|dream|sleep)\b/i,
    buildSlots: ["N", "A", "P"], buildTiles: ["N", "A", "P", "S", "T", "M"],
    xpReward: 20,
  },
  "action-run": {
    id: "action-run", phoneme: "R", word: "run", wordEmoji: "🏃",
    tipText: "Run means to go fast on your feet! R says \"rrr\" — like a tiger growling.",
    phonemeParts: [
      { letters: "R", label: "The sound", highlight: true },
      { letters: "U", label: "Short U", highlight: false },
      { letters: "N", label: "The end", highlight: false },
    ],
    traceStrokes: [
      "M 80 50 L 80 210",
      "M 80 50 Q 240 50 240 115 Q 240 175 80 175",
      "M 140 175 L 260 220",
    ],
    traceViewBox: "0 0 360 240",
    sayAccept: /\b(run|runs|running|jog|hop|skip|walk|race|dash|sprint)\b/i,
    buildSlots: ["R", "U", "N"], buildTiles: ["R", "U", "N", "S", "P", "A"],
    xpReward: 20,
  },
  "action-jump": {
    id: "action-jump", phoneme: "J", word: "jump", wordEmoji: "🤸",
    tipText: "Jump means up into the air! J says \"juh\" — quick and crisp.",
    phonemeParts: [
      { letters: "J", label: "The sound", highlight: true },
      { letters: "U", label: "Short U", highlight: false },
      { letters: "MP", label: "The end", highlight: false },
    ],
    traceStrokes: [
      "M 80 60 L 240 60",
      "M 180 60 L 180 180 Q 180 220 130 220 Q 80 220 80 185",
    ],
    traceViewBox: "0 0 360 240",
    sayAccept: /\b(jump|jumps|jumping|leap|fly|climb|swim|hop|bounce)\b/i,
    buildSlots: ["J", "U", "M", "P"], buildTiles: ["J", "U", "M", "P", "R", "T"],
    xpReward: 20,
  },
  "action-look": {
    id: "action-look", phoneme: "L", word: "look", wordEmoji: "👀",
    tipText: "Look means to use your eyes! L says \"lll\" — tip your tongue up.",
    phonemeParts: [
      { letters: "L", label: "The sound", highlight: true },
      { letters: "OO", label: "Long OO", highlight: false },
      { letters: "K", label: "The end", highlight: false },
    ],
    traceStrokes: [
      "M 100 50 L 100 210",
      "M 100 210 L 260 210",
    ],
    traceViewBox: "0 0 360 240",
    sayAccept: /\b(look|looks|looking|see|watch|read|find|peek)\b/i,
    buildSlots: ["L", "O", "O", "K"], buildTiles: ["L", "O", "K", "B", "S", "T"],
    xpReward: 20,
  },
  "action-make": {
    id: "action-make", phoneme: "M", word: "make", wordEmoji: "🛠️",
    tipText: "Make means to build something new! M says \"mmm\" — hum with closed lips.",
    phonemeParts: [
      { letters: "M", label: "The sound", highlight: true },
      { letters: "A", label: "Long A", highlight: false },
      { letters: "KE", label: "The end", highlight: false },
    ],
    traceStrokes: [
      "M 60 200 L 60 50", "M 60 50 L 180 150",
      "M 180 150 L 300 50", "M 300 50 L 300 200",
    ],
    traceViewBox: "0 0 360 240",
    sayAccept: /\b(make|makes|making|build|fix|draw|paint|create)\b/i,
    buildSlots: ["M", "A", "K", "E"], buildTiles: ["M", "A", "K", "E", "S", "T"],
    xpReward: 20,
  },
  "action-help": {
    id: "action-help", phoneme: "H", word: "help", wordEmoji: "🤝",
    tipText: "Help means to be kind to others! H says \"huh\" — a soft puff of breath.",
    phonemeParts: [
      { letters: "H", label: "The sound", highlight: true },
      { letters: "E", label: "Short E", highlight: false },
      { letters: "LP", label: "The end", highlight: false },
    ],
    traceStrokes: [
      "M 80 50 L 80 210",
      "M 280 50 L 280 210",
      "M 80 130 L 280 130",
    ],
    traceViewBox: "0 0 360 240",
    sayAccept: /\b(help|helps|helping|share|hug|smile|wave|care)\b/i,
    buildSlots: ["H", "E", "L", "P"], buildTiles: ["H", "E", "L", "P", "M", "S"],
    xpReward: 20,
  },
  "action-clean": {
    id: "action-clean", phoneme: "C", word: "clean", wordEmoji: "🧼",
    tipText: "Clean means to wash and tidy up! C makes a \"kuh\" sound here.",
    phonemeParts: [
      { letters: "C", label: "The sound", highlight: true },
      { letters: "L", label: "Blend", highlight: false },
      { letters: "EAN", label: "The end", highlight: false },
    ],
    traceStrokes: [
      "M 280 90 Q 220 50 150 90 Q 90 130 150 190 Q 220 230 280 190",
    ],
    traceViewBox: "0 0 360 240",
    sayAccept: /\b(clean|cleans|cleaning|wash|brush|sweep|scrub|dry)\b/i,
    buildSlots: ["C", "L", "E", "A", "N"], buildTiles: ["C", "L", "E", "A", "N", "S"],
    xpReward: 20,
  },
  "action-boss": {
    id: "action-boss", phoneme: "Action!", word: "verbs", wordEmoji: "🏆",
    tipText: "You learned tons of action words — keep doing, reading, and growing!",
    phonemeParts: [], traceStrokes: [], traceViewBox: "0 0 360 240",
    sayAccept: /.*/,
    buildSlots: ["P", "L", "A", "Y"], buildTiles: ["P", "L", "A", "Y", "E", "T"],
    xpReward: 100, isBoss: true,
  },

  // ── Level 6: Sight Words (Dolch Pre-K) ─────────────────────────────────────
  // Irregular high-frequency words that can't reliably be sounded out.
  // Research-backed: Dolch and Fry lists cover ~50-75% of all printed text.
  // Strategy = memorize by sight, repeated exposure across multiple games.
  "sight-pk-1": {
    id: "sight-pk-1", phoneme: "Sight Words", word: "see", wordEmoji: "👁️",
    tipText: "Sight words are words you'll SEE everywhere. Memorize them — don't sound them out!",
    phonemeParts: [
      { letters: "S", label: "Start", highlight: true },
      { letters: "EE", label: "Long E", highlight: false },
    ],
    traceStrokes: ["M 270 75 Q 180 50 130 100 Q 90 140 180 165 Q 240 185 270 160"],
    traceViewBox: "0 0 360 240",
    sayAccept: /\b(see|sees|i|can|you|look)\b/i,
    buildSlots: ["S", "E", "E"], buildTiles: ["S", "E", "I", "C", "Y", "O"],
    xpReward: 18,
  },
  "sight-pk-2": {
    id: "sight-pk-2", phoneme: "Sight Words", word: "the", wordEmoji: "📘",
    tipText: "Tiny words like \"the\" and \"and\" glue sentences together. They show up everywhere!",
    phonemeParts: [
      { letters: "TH", label: "TH start", highlight: true },
      { letters: "E", label: "Short E", highlight: false },
    ],
    traceStrokes: ["M 60 75 L 300 75", "M 180 75 L 180 210"],
    traceViewBox: "0 0 360 240",
    sayAccept: /\b(the|a|is|and|to)\b/i,
    buildSlots: ["T", "H", "E"], buildTiles: ["T", "H", "E", "A", "I", "S"],
    xpReward: 18,
  },
  "sight-pk-3": {
    id: "sight-pk-3", phoneme: "Sight Words", word: "me", wordEmoji: "🙋",
    tipText: "People words — me, you, we, my. They're about who's doing things!",
    phonemeParts: [
      { letters: "M", label: "Start", highlight: true },
      { letters: "E", label: "Long E", highlight: false },
    ],
    traceStrokes: [
      "M 60 200 L 60 50", "M 60 50 L 180 150",
      "M 180 150 L 300 50", "M 300 50 L 300 200",
    ],
    traceViewBox: "0 0 360 240",
    sayAccept: /\b(me|my|we|in|it)\b/i,
    buildSlots: ["M", "E"], buildTiles: ["M", "E", "Y", "W", "I", "T"],
    xpReward: 18,
  },
  "sight-pk-4": {
    id: "sight-pk-4", phoneme: "Sight Words", word: "come", wordEmoji: "👋",
    tipText: "Movement and helping words — come, go, help, find. Action that connects people!",
    phonemeParts: [
      { letters: "C", label: "Start", highlight: true },
      { letters: "OME", label: "The rest", highlight: false },
    ],
    traceStrokes: ["M 280 90 Q 220 50 150 90 Q 90 130 150 190 Q 220 230 280 190"],
    traceViewBox: "0 0 360 240",
    sayAccept: /\b(come|go|here|find|help)\b/i,
    buildSlots: ["C", "O", "M", "E"], buildTiles: ["C", "O", "M", "E", "G", "H"],
    xpReward: 18,
  },
  "sight-pk-5": {
    id: "sight-pk-5", phoneme: "Sight Words", word: "jump", wordEmoji: "🤸",
    tipText: "Size and direction words — big, little, up, down. They paint a picture!",
    phonemeParts: [
      { letters: "J", label: "Start", highlight: true },
      { letters: "UMP", label: "The rest", highlight: false },
    ],
    traceStrokes: [
      "M 80 60 L 240 60",
      "M 180 60 L 180 180 Q 180 220 130 220 Q 80 220 80 185",
    ],
    traceViewBox: "0 0 360 240",
    sayAccept: /\b(jump|big|little|up|down)\b/i,
    buildSlots: ["J", "U", "M", "P"], buildTiles: ["J", "U", "M", "P", "B", "D"],
    xpReward: 18,
  },
  "sight-pk-6": {
    id: "sight-pk-6", phoneme: "Sight Words", word: "red", wordEmoji: "🔴",
    tipText: "Colors and numbers — your favorites! Memorize them by sight.",
    phonemeParts: [
      { letters: "R", label: "Start", highlight: true },
      { letters: "ED", label: "Short E", highlight: false },
    ],
    traceStrokes: [
      "M 80 50 L 80 210",
      "M 80 50 Q 240 50 240 115 Q 240 175 80 175",
      "M 140 175 L 260 220",
    ],
    traceViewBox: "0 0 360 240",
    sayAccept: /\b(red|blue|yellow|one|two)\b/i,
    buildSlots: ["R", "E", "D"], buildTiles: ["R", "E", "D", "B", "Y", "O"],
    xpReward: 18,
  },
  "sight-boss-pk": {
    id: "sight-boss-pk", phoneme: "Pre-K Done!", word: "amazing", wordEmoji: "⭐",
    tipText: "Pre-K sight words done — that's 30 of the most-used words in English. Next tier unlocked!",
    phonemeParts: [], traceStrokes: [], traceViewBox: "0 0 360 240",
    sayAccept: /.*/,
    buildSlots: ["S", "E", "E"], buildTiles: ["S", "E", "T", "H", "M", "I"],
    xpReward: 75, isBoss: true,
  },

  // ── Level 6b: Sight Words (Dolch Primer) ───────────────────────────────────
  // Higher-frequency words used everywhere. Includes the to-be verbs, helping
  // verbs, common pronouns, and color/feeling vocabulary.
  "sight-prim-1": {
    id: "sight-prim-1", phoneme: "Sight Words", word: "she", wordEmoji: "👩",
    tipText: "Pronouns! He, she, they — words for the people we talk about.",
    phonemeParts: [
      { letters: "SH", label: "SH start", highlight: true },
      { letters: "E", label: "Long E", highlight: false },
    ],
    traceStrokes: [
      "M 150 70 Q 60 60 60 105 Q 60 135 105 135 Q 150 135 150 165 Q 150 200 60 195",
      "M 210 60 L 210 200", "M 300 60 L 300 200", "M 210 130 L 300 130",
    ],
    traceViewBox: "0 0 360 240",
    sayAccept: /\b(she|he|they|was|are)\b/i,
    buildSlots: ["S", "H", "E"], buildTiles: ["S", "H", "E", "T", "A", "Y"],
    xpReward: 20,
  },
  "sight-prim-2": {
    id: "sight-prim-2", phoneme: "Sight Words", word: "have", wordEmoji: "✋",
    tipText: "Helping words! Have, do, did, will — they team up with other verbs.",
    phonemeParts: [
      { letters: "H", label: "Start", highlight: true },
      { letters: "AVE", label: "Long A", highlight: false },
    ],
    traceStrokes: [
      "M 80 50 L 80 210", "M 280 50 L 280 210", "M 80 130 L 280 130",
    ],
    traceViewBox: "0 0 360 240",
    sayAccept: /\b(have|do|did|will|must)\b/i,
    buildSlots: ["H", "A", "V", "E"], buildTiles: ["H", "A", "V", "E", "D", "W"],
    xpReward: 20,
  },
  "sight-prim-3": {
    id: "sight-prim-3", phoneme: "Sight Words", word: "came", wordEmoji: "🚶",
    tipText: "Past-tense verbs! Came, went, saw — things that already happened.",
    phonemeParts: [
      { letters: "C", label: "Start", highlight: true },
      { letters: "AME", label: "Long A", highlight: false },
    ],
    traceStrokes: ["M 280 90 Q 220 50 150 90 Q 90 130 150 190 Q 220 230 280 190"],
    traceViewBox: "0 0 360 240",
    sayAccept: /\b(came|went|saw|ate|ran)\b/i,
    buildSlots: ["C", "A", "M", "E"], buildTiles: ["C", "A", "M", "E", "W", "T"],
    xpReward: 20,
  },
  "sight-prim-4": {
    id: "sight-prim-4", phoneme: "Sight Words", word: "this", wordEmoji: "👇",
    tipText: "Pointing & asking words! This, that, what, who — you'll see them in every question.",
    phonemeParts: [
      { letters: "TH", label: "TH start", highlight: true },
      { letters: "IS", label: "The end", highlight: false },
    ],
    traceStrokes: ["M 60 75 L 300 75", "M 180 75 L 180 210"],
    traceViewBox: "0 0 360 240",
    sayAccept: /\b(this|that|there|what|who)\b/i,
    buildSlots: ["T", "H", "I", "S"], buildTiles: ["T", "H", "I", "S", "A", "W"],
    xpReward: 20,
  },
  "sight-prim-5": {
    id: "sight-prim-5", phoneme: "Sight Words", word: "new", wordEmoji: "✨",
    tipText: "Colors & descriptors! Black, white, brown, pretty, new — they paint a picture.",
    phonemeParts: [
      { letters: "N", label: "Start", highlight: true },
      { letters: "EW", label: "Long U", highlight: false },
    ],
    traceStrokes: [
      "M 80 50 L 80 210", "M 80 50 L 280 210", "M 280 50 L 280 210",
    ],
    traceViewBox: "0 0 360 240",
    sayAccept: /\b(new|black|brown|white|pretty)\b/i,
    buildSlots: ["N", "E", "W"], buildTiles: ["N", "E", "W", "B", "P", "T"],
    xpReward: 20,
  },
  "sight-prim-6": {
    id: "sight-prim-6", phoneme: "Sight Words", word: "like", wordEmoji: "❤️",
    tipText: "Feelings & preferences! Like, want, good, please — the polite words.",
    phonemeParts: [
      { letters: "L", label: "Start", highlight: true },
      { letters: "IKE", label: "Long I", highlight: false },
    ],
    traceStrokes: [
      "M 100 50 L 100 210",
      "M 100 210 L 260 210",
    ],
    traceViewBox: "0 0 360 240",
    sayAccept: /\b(like|want|good|please|yes)\b/i,
    buildSlots: ["L", "I", "K", "E"], buildTiles: ["L", "I", "K", "E", "W", "G"],
    xpReward: 20,
  },
  "sight-master": {
    id: "sight-master", phoneme: "Sight Master!", word: "champion", wordEmoji: "🏆",
    tipText: "You learned 60+ of the most-used English words. You can read SO much now!",
    phonemeParts: [], traceStrokes: [], traceViewBox: "0 0 360 240",
    sayAccept: /.*/,
    buildSlots: ["L", "I", "K", "E"], buildTiles: ["L", "I", "K", "E", "S", "H"],
    xpReward: 150, isBoss: true,
  },

  // ── Level 7: Magic E / CVCe ────────────────────────────────────────────────
  // Silent E at the end of a word makes the vowel "say its name".
  // cap → cape, kit → kite, hop → hope, cut → cute. Standard 1st-grade phonics.
  "cvce-a": {
    id: "cvce-a", phoneme: "a_e", word: "cake", wordEmoji: "🎂",
    tipText: "Magic E! Add an E at the end and the A says its name — \"AY\" not \"ahh\".",
    phonemeParts: [
      { letters: "C", label: "Start", highlight: false },
      { letters: "A", label: "Long A", highlight: true },
      { letters: "K", label: "Middle", highlight: false },
      { letters: "E", label: "Silent E ✨", highlight: true },
    ],
    traceStrokes: ["M 280 90 Q 220 50 150 90 Q 90 130 150 190 Q 220 230 280 190"],
    traceViewBox: "0 0 360 240",
    sayAccept: /\b(cake|bake|lake|name|game|made|came|take|snake|plate)\b/i,
    buildSlots: ["C", "A", "K", "E"], buildTiles: ["C", "A", "K", "E", "B", "T"],
    xpReward: 25,
  },
  "cvce-i": {
    id: "cvce-i", phoneme: "i_e", word: "bike", wordEmoji: "🚲",
    tipText: "I + Magic E! The I says \"EYE\" — like \"bike\" sounds like \"BIKE\" not \"bick\".",
    phonemeParts: [
      { letters: "B", label: "Start", highlight: false },
      { letters: "I", label: "Long I", highlight: true },
      { letters: "K", label: "Middle", highlight: false },
      { letters: "E", label: "Silent E ✨", highlight: true },
    ],
    traceStrokes: [
      "M 80 50 L 80 210",
      "M 80 50 Q 240 50 240 110 Q 240 130 80 130",
      "M 80 130 Q 250 130 250 175 Q 250 210 80 210",
    ],
    traceViewBox: "0 0 360 240",
    sayAccept: /\b(bike|like|time|five|ride|smile|kite|mine|side|line)\b/i,
    buildSlots: ["B", "I", "K", "E"], buildTiles: ["B", "I", "K", "E", "L", "T"],
    xpReward: 25,
  },
  "cvce-o": {
    id: "cvce-o", phoneme: "o_e", word: "hope", wordEmoji: "🌟",
    tipText: "O + Magic E! O says its name — \"OH\". Hope, rope, home, nose!",
    phonemeParts: [
      { letters: "H", label: "Start", highlight: false },
      { letters: "O", label: "Long O", highlight: true },
      { letters: "P", label: "Middle", highlight: false },
      { letters: "E", label: "Silent E ✨", highlight: true },
    ],
    traceStrokes: [
      "M 80 50 L 80 210", "M 280 50 L 280 210", "M 80 130 L 280 130",
    ],
    traceViewBox: "0 0 360 240",
    sayAccept: /\b(hope|rope|nose|home|joke|note|those|broke|stone)\b/i,
    buildSlots: ["H", "O", "P", "E"], buildTiles: ["H", "O", "P", "E", "R", "N"],
    xpReward: 25,
  },
  "cvce-u": {
    id: "cvce-u", phoneme: "u_e", word: "cute", wordEmoji: "🐶",
    tipText: "U + Magic E! U says \"YOU\" — cute, cube, tube, use!",
    phonemeParts: [
      { letters: "C", label: "Start", highlight: false },
      { letters: "U", label: "Long U", highlight: true },
      { letters: "T", label: "Middle", highlight: false },
      { letters: "E", label: "Silent E ✨", highlight: true },
    ],
    traceStrokes: ["M 280 90 Q 220 50 150 90 Q 90 130 150 190 Q 220 230 280 190"],
    traceViewBox: "0 0 360 240",
    sayAccept: /\b(cute|cube|tube|use|mute|huge|rule|tune|June)\b/i,
    buildSlots: ["C", "U", "T", "E"], buildTiles: ["C", "U", "T", "E", "B", "M"],
    xpReward: 25,
  },
  "cvce-boss": {
    id: "cvce-boss", phoneme: "Magic E!", word: "magic", wordEmoji: "🪄",
    tipText: "You mastered Magic E! Now you can read TONS of new words.",
    phonemeParts: [], traceStrokes: [], traceViewBox: "0 0 360 240",
    sayAccept: /.*/,
    buildSlots: ["C", "A", "K", "E"], buildTiles: ["C", "A", "K", "E", "B", "T"],
    xpReward: 125, isBoss: true,
  },
};

const LEARN_PATH_DEF: { id: string; label: string; sub: string; boss: boolean; x: number }[] = [
  // Level 1 — Structured Literacy sequence
  { id: "m-sound",     label: "M Sound",    sub: "mat, man, mud",      boss: false, x: 60 },
  { id: "s-sound",     label: "S Sound",    sub: "sat, sit, sun",      boss: false, x: 240 },
  { id: "t-sound",     label: "T Sound",    sub: "tap, tan, tip",      boss: false, x: 140 },
  { id: "short-a",     label: "Short A",    sub: "mat, sat, tap",      boss: false, x: 60 },
  { id: "p-sound",     label: "P Sound",    sub: "pan, pat, pit",      boss: false, x: 240 },
  { id: "n-sound",     label: "N Sound",    sub: "nap, net, nit",      boss: false, x: 140 },
  { id: "level1-boss", label: "Level 1!",   sub: "You crushed it!",    boss: true,  x: 195 },
  // Level 2 — More short vowels
  { id: "short-i",     label: "Short I",    sub: "big, sit, lip",      boss: false, x: 80 },
  { id: "short-e",     label: "Short E",    sub: "hen, bed, pet",      boss: false, x: 250 },
  { id: "short-o",     label: "Short O",    sub: "dog, hot, fox",      boss: false, x: 140 },
  { id: "short-u",     label: "Short U",    sub: "sun, bun, cup",      boss: false, x: 60 },
  { id: "vowel-boss",  label: "Vowel Boss!",sub: "All short vowels!",  boss: true,  x: 195 },
  // Level 3 — Blends & digraphs
  { id: "sh-sound",    label: "SH Sound",   sub: "ship, shell, fish",  boss: false, x: 80 },
  { id: "ch-sound",    label: "CH Sound",   sub: "chip, chop, much",   boss: false, x: 250 },
  { id: "th-sound",    label: "TH Sound",   sub: "the, this, that",    boss: false, x: 140 },
  { id: "blend-boss",  label: "Blend Boss!",sub: "Master level",       boss: true,  x: 195 },
  // Level 4 — Long vowels
  { id: "long-a",      label: "Long A",     sub: "rain, tail, wait",   boss: false, x: 80 },
  { id: "long-e",      label: "Long E",     sub: "feet, tree, bee",    boss: false, x: 240 },
  { id: "long-i",      label: "Long I",     sub: "night, light, right",boss: false, x: 140 },
  { id: "long-o",      label: "Long O",     sub: "boat, road, coat",   boss: false, x: 60 },
  { id: "vowel-boss-2",label: "Vowel Master!",sub: "All vowels!",      boss: true,  x: 195 },
  // Level 5 — Action Words (verbs in context, inspired by the AAC "Action Words" set)
  { id: "action-play",  label: "Play",         sub: "play, push, paint",  boss: false, x: 80 },
  { id: "action-eat",   label: "Eat",          sub: "eat, drink, chew",   boss: false, x: 240 },
  { id: "action-sing",  label: "Sing",         sub: "sing, say, shout",   boss: false, x: 140 },
  { id: "action-nap",   label: "Nap",          sub: "nap, rest, yawn",    boss: false, x: 60 },
  { id: "action-run",   label: "Run",          sub: "run, jog, race",     boss: false, x: 240 },
  { id: "action-jump",  label: "Jump",         sub: "jump, leap, climb",  boss: false, x: 140 },
  { id: "action-look",  label: "Look",         sub: "look, see, find",    boss: false, x: 60 },
  { id: "action-make",  label: "Make",         sub: "make, build, draw",  boss: false, x: 240 },
  { id: "action-help",  label: "Help",         sub: "help, share, hug",   boss: false, x: 140 },
  { id: "action-clean", label: "Clean",        sub: "clean, wash, brush", boss: false, x: 80 },
  { id: "action-boss",  label: "Action Hero!", sub: "All action words!",  boss: true,  x: 195 },
  // Level 6 — Sight Words (Dolch Pre-K)
  { id: "sight-pk-1",    label: "See & I",      sub: "see, I, can, you",   boss: false, x: 80 },
  { id: "sight-pk-2",    label: "The & And",    sub: "the, a, is, and",    boss: false, x: 240 },
  { id: "sight-pk-3",    label: "Me & We",      sub: "me, my, we, in",     boss: false, x: 140 },
  { id: "sight-pk-4",    label: "Come & Go",    sub: "come, go, here",     boss: false, x: 60 },
  { id: "sight-pk-5",    label: "Big & Little", sub: "big, little, up",    boss: false, x: 240 },
  { id: "sight-pk-6",    label: "Colors",       sub: "red, blue, yellow",  boss: false, x: 140 },
  { id: "sight-boss-pk", label: "Pre-K Done!",  sub: "Pre-K tier complete", boss: true,  x: 195 },
  // Level 6b — Sight Words: Primer
  { id: "sight-prim-1",  label: "He & She",     sub: "she, he, they",      boss: false, x: 80 },
  { id: "sight-prim-2",  label: "Have & Do",    sub: "have, do, did, will",boss: false, x: 240 },
  { id: "sight-prim-3",  label: "Came & Went",  sub: "past-tense verbs",   boss: false, x: 140 },
  { id: "sight-prim-4",  label: "This & That",  sub: "this, what, who",    boss: false, x: 60 },
  { id: "sight-prim-5",  label: "More Colors",  sub: "black, white, new",  boss: false, x: 240 },
  { id: "sight-prim-6",  label: "Like & Want",  sub: "like, want, good",   boss: false, x: 140 },
  { id: "sight-master",  label: "Sight Master", sub: "60+ words!",         boss: true,  x: 195 },
  // Level 7 — Magic E (CVCe)
  { id: "cvce-a",        label: "A + Magic E",  sub: "cake, name, snake",  boss: false, x: 80 },
  { id: "cvce-i",        label: "I + Magic E",  sub: "bike, kite, time",   boss: false, x: 240 },
  { id: "cvce-o",        label: "O + Magic E",  sub: "hope, rope, nose",   boss: false, x: 140 },
  { id: "cvce-u",        label: "U + Magic E",  sub: "cute, cube, tube",   boss: false, x: 60 },
  { id: "cvce-boss",     label: "Magic E Master",sub:"Silent E expert!",   boss: true,  x: 195 },
];

// ─── Categories — independent learning tracks ────────────────────────────────
// Each category is its own self-contained path. Kids pick whichever track
// they want — no cross-category gating. Within a category, prev-must-be-done
// gating still applies so they progress through the mini-path properly.
type LessonCategory = {
  id: string;
  label: string;
  sub: string;
  emoji: string;
  gradient: [string, string];
  lessonIds: string[];   // ids match LEARN_PATH_DEF + LESSONS keys
};

const CATEGORIES: LessonCategory[] = [
  {
    id: "first-sounds",
    label: "First Sounds",
    sub: "M, S, T, A, P, N",
    emoji: "🔤",
    gradient: [C.primary, C.primaryDark],
    lessonIds: ["m-sound", "s-sound", "t-sound", "short-a", "p-sound", "n-sound", "level1-boss"],
  },
  {
    id: "short-vowels",
    label: "Short Vowels",
    sub: "A, E, I, O, U",
    emoji: "🅰️",
    gradient: [C.amber, "#E8772E"],
    lessonIds: ["short-i", "short-e", "short-o", "short-u", "vowel-boss"],
  },
  {
    id: "blends",
    label: "Blends & Digraphs",
    sub: "SH, CH, TH",
    emoji: "🧩",
    gradient: [C.teal, C.echoDark],
    lessonIds: ["sh-sound", "ch-sound", "th-sound", "blend-boss"],
  },
  {
    id: "long-vowels",
    label: "Long Vowels",
    sub: "AI, EE, IGH, OA",
    emoji: "🌟",
    gradient: [C.blush, "#E8729B"],
    lessonIds: ["long-a", "long-e", "long-i", "long-o", "vowel-boss-2"],
  },
  {
    id: "action-words",
    label: "Action Words",
    sub: "11 verbs — what you DO",
    emoji: "🏃",
    gradient: [C.glow, C.glowDark],
    lessonIds: [
      "action-play", "action-eat", "action-sing", "action-nap",
      "action-run", "action-jump", "action-look", "action-make",
      "action-help", "action-clean", "action-boss",
    ],
  },
  {
    id: "sight-words",
    label: "Sight Words",
    sub: "60+ most-used words",
    emoji: "👀",
    gradient: ["#7C6FE0", "#5645B8"],
    lessonIds: [
      // Pre-K tier
      "sight-pk-1", "sight-pk-2", "sight-pk-3",
      "sight-pk-4", "sight-pk-5", "sight-pk-6",
      "sight-boss-pk",
      // Primer tier
      "sight-prim-1", "sight-prim-2", "sight-prim-3",
      "sight-prim-4", "sight-prim-5", "sight-prim-6",
      "sight-master",
    ],
  },
  {
    id: "magic-e",
    label: "Magic E",
    sub: "Silent E unlocks long vowels",
    emoji: "🪄",
    gradient: ["#9B7EFF", "#6C47FF"],
    lessonIds: ["cvce-a", "cvce-i", "cvce-o", "cvce-u", "cvce-boss"],
  },
];

// ─── Lexi mascot (lavender, star wand) ───────────────────────────────────────
// Shared pose decorations — overlay extras on top of every mascot's SVG.
// Pass each mascot's eye coordinates so sleepy lids land in the right spot.
function PoseFx({ pose, eyes }: { pose: string; eyes: [number, number][] }) {
  const thinking = pose === "thinking";
  const sleepy = pose === "sleepy";
  const tryAgain = pose === "tryAgain" || pose === "try-again";
  const levelUp = pose === "levelUp";
  return (
    <>
      {levelUp && (
        <>
          <circle cx="50" cy="60" r="56" fill={C.yellow} opacity={0.18} />
          <circle cx="50" cy="60" r="48" fill={C.amber} opacity={0.12} />
          <text x="6" y="22" fontSize="14" fill={C.amber}>★</text>
          <text x="82" y="20" fontSize="14" fill={C.yellow}>★</text>
          <text x="2" y="68" fontSize="11" fill={C.amber}>✦</text>
          <text x="86" y="78" fontSize="11" fill={C.yellow}>✦</text>
          <text x="48" y="6" fontSize="10" fill={C.amber}>✦</text>
        </>
      )}
      {thinking && (
        <>
          {/* Thought bubble */}
          <circle cx="78" cy="14" r="9" fill="white" stroke={C.ink} strokeWidth="1.2" opacity={0.95} />
          <circle cx="68" cy="26" r="3" fill="white" stroke={C.ink} strokeWidth="1" opacity={0.95} />
          <circle cx="64" cy="32" r="2" fill="white" stroke={C.ink} strokeWidth="0.9" opacity={0.95} />
          <text x="74" y="18" fontSize="10" fontWeight="700" fill={C.primary}>?</text>
        </>
      )}
      {sleepy && (
        <>
          {/* Half-closed eyelids — cover top half of each eye white */}
          {eyes.map(([cx, cy], i) => (
            <rect key={i} x={cx - 10} y={cy - 9} width="20" height="9" rx="9" fill={C.ink} opacity={0.85} />
          ))}
          {/* Floating Zzz */}
          <text x="72" y="14" fontSize="11" fontWeight="700" fill={C.muted}>z</text>
          <text x="80" y="22" fontSize="13" fontWeight="700" fill={C.muted}>Z</text>
          <text x="89" y="32" fontSize="15" fontWeight="700" fill={C.muted}>Z</text>
        </>
      )}
      {tryAgain && (
        <>
          {/* Gentle encouraging sparkles */}
          <text x="6" y="32" fontSize="10" fill={C.teal}>✨</text>
          <text x="84" y="36" fontSize="10" fill={C.amber}>✨</text>
          <text x="14" y="80" fontSize="8" fill={C.blush}>✨</text>
        </>
      )}
    </>
  );
}

function Lexi({ size = 100, pose = "idle" }: { size?: number; pose?: string }) {
  const happy = pose === "happy" || pose === "celebrating";
  const s = size / 100;
  return (
    <svg width={size} height={size * 1.2} viewBox="0 0 100 120" style={{ overflow: "visible" }}>
      {/* Body glow on celebrate */}
      {pose === "celebrating" && (
        <ellipse cx="50" cy="65" rx="48" ry="50" fill={C.lexi} opacity={0.2} />
      )}
      {/* Body */}
      <ellipse cx="50" cy="65" rx="40" ry="44" fill={C.lexi} />
      <ellipse cx="36" cy="48" rx="14" ry="10" fill="white" fillOpacity={0.28} />
      {/* Eyes */}
      <circle cx="38" cy="60" r={happy ? 9.5 : 8.5} fill="white" />
      <circle cx="62" cy="60" r={happy ? 9.5 : 8.5} fill="white" />
      <circle cx={happy ? 39.5 : 38.5} cy={happy ? 59 : 60} r={5.5} fill={C.ink} />
      <circle cx={happy ? 63.5 : 62.5} cy={happy ? 59 : 60} r={5.5} fill={C.ink} />
      <circle cx={happy ? 41 : 40} cy={happy ? 57 : 58} r={2} fill="white" />
      <circle cx={happy ? 65 : 64} cy={happy ? 57 : 58} r={2} fill="white" />
      {/* Cheeks */}
      {happy && <>
        <circle cx="26" cy="70" r={7} fill={C.blush} fillOpacity={0.5} />
        <circle cx="74" cy="70" r={7} fill={C.blush} fillOpacity={0.5} />
      </>}
      {/* Mouth */}
      {happy
        ? <path d="M 36 74 Q 50 86 64 74" stroke={C.ink} strokeWidth="2.5" fill="none" strokeLinecap="round" />
        : <path d="M 38 73 Q 50 80 62 73" stroke={C.ink} strokeWidth="2" fill="none" strokeLinecap="round" />}
      {/* Wand */}
      <line x1="76" y1="44" x2="86" y2="20" stroke={C.amber} strokeWidth="3" strokeLinecap="round" />
      <circle cx="87" cy="17" r="7" fill={C.yellow} />
      <text x="80.5" y="21.5" fontSize="10" fill={C.amber} fontWeight="bold">✦</text>
      {pose === "celebrating" && <>
        <text x="88" y="35" fontSize="8" fill={C.yellow}>✦</text>
        <text x="68" y="18" fontSize="7" fill={C.lexi}>✦</text>
        <text x="92" y="50" fontSize="9" fill={C.amber}>✦</text>
      </>}
      {/* Arms */}
      <ellipse cx="12" cy="70" rx="10" ry="6" fill={C.lexi} transform="rotate(-25 12 70)" />
      <ellipse cx="88" cy="68" rx="10" ry="6" fill={C.lexi} transform="rotate(20 88 68)" />
      {/* Feet */}
      <ellipse cx="38" cy="108" rx="11" ry="7" fill={C.lexiDark} />
      <ellipse cx="62" cy="108" rx="11" ry="7" fill={C.lexiDark} />
      <PoseFx pose={pose} eyes={[[38, 60], [62, 60]]} />
    </svg>
  );
}

// ─── Echo mascot (teal, headphones, big ears) ─────────────────────────────────
function Echo({ size = 100, pose = "idle" }: { size?: number; pose?: string }) {
  const happy = pose === "happy" || pose === "celebrating";
  return (
    <svg width={size} height={size * 1.15} viewBox="0 0 100 115" style={{ overflow: "visible" }}>
      {/* Big floppy ears */}
      <ellipse cx="11" cy="54" rx="13" ry="22" fill={C.echoDark} />
      <ellipse cx="89" cy="54" rx="13" ry="22" fill={C.echoDark} />
      <ellipse cx="11" cy="54" rx="8" ry="15" fill={C.tealSoft} />
      <ellipse cx="89" cy="54" rx="8" ry="15" fill={C.tealSoft} />
      {/* Body */}
      <ellipse cx="50" cy="64" rx="37" ry="40" fill={C.teal} />
      <ellipse cx="36" cy="47" rx="13" ry="9" fill="white" fillOpacity={0.2} />
      {/* Headphone arc */}
      <path d="M 20 46 Q 50 18 80 46" stroke="#1A6B50" strokeWidth="4.5" fill="none" strokeLinecap="round" />
      <rect x="13" y="44" width="14" height="18" rx="6" fill="#1A6B50" />
      <rect x="73" y="44" width="14" height="18" rx="6" fill="#1A6B50" />
      <rect x="15" y="46" width="10" height="14" rx="4" fill="#2A9B72" />
      <rect x="75" y="46" width="10" height="14" rx="4" fill="#2A9B72" />
      {/* Eyes */}
      <circle cx="38" cy="64" r={happy ? 9.5 : 8.5} fill="white" />
      <circle cx="62" cy="64" r={happy ? 9.5 : 8.5} fill="white" />
      <circle cx="39" cy={happy ? 63 : 64} r={5.5} fill={C.ink} />
      <circle cx="63" cy={happy ? 63 : 64} r={5.5} fill={C.ink} />
      <circle cx="41" cy={happy ? 61 : 62} r={2} fill="white" />
      <circle cx="65" cy={happy ? 61 : 62} r={2} fill="white" />
      {/* Mouth */}
      {happy
        ? <path d="M 37 76 Q 50 88 63 76" stroke={C.ink} strokeWidth="2.5" fill="none" strokeLinecap="round" />
        : <path d="M 39 75 Q 50 82 61 75" stroke={C.ink} strokeWidth="2" fill="none" strokeLinecap="round" />}
      {happy && <>
        <circle cx="27" cy="73" r={6} fill={C.blush} fillOpacity={0.4} />
        <circle cx="73" cy="73" r={6} fill={C.blush} fillOpacity={0.4} />
      </>}
      {/* Feet */}
      <ellipse cx="38" cy="103" rx="11" ry="7" fill={C.echoDark} />
      <ellipse cx="62" cy="103" rx="11" ry="7" fill={C.echoDark} />
      <PoseFx pose={pose} eyes={[[38, 64], [62, 64]]} />
    </svg>
  );
}

// ─── Glow mascot (yellow, glasses, book) ─────────────────────────────────────
function Glow({ size = 100, pose = "idle" }: { size?: number; pose?: string }) {
  const happy = pose === "happy" || pose === "celebrating";
  return (
    <svg width={size} height={size * 1.2} viewBox="0 0 100 120" style={{ overflow: "visible" }}>
      <ellipse cx="50" cy="66" rx="40" ry="44" fill={C.glow} />
      <ellipse cx="36" cy="48" rx="14" ry="10" fill="white" fillOpacity={0.3} />
      {/* Glasses */}
      <rect x="22" y="54" width="22" height="17" rx="6" stroke={C.ink} strokeWidth="2.2" fill="white" fillOpacity={0.7} />
      <rect x="56" y="54" width="22" height="17" rx="6" stroke={C.ink} strokeWidth="2.2" fill="white" fillOpacity={0.7} />
      <line x1="44" y1="62" x2="56" y2="62" stroke={C.ink} strokeWidth="2" />
      <line x1="22" y1="61" x2="15" y2="59" stroke={C.ink} strokeWidth="1.8" />
      <line x1="78" y1="61" x2="85" y2="59" stroke={C.ink} strokeWidth="1.8" />
      {/* Eyes */}
      <circle cx="33" cy={happy ? 62 : 63} r={4.5} fill={C.ink} />
      <circle cx="67" cy={happy ? 62 : 63} r={4.5} fill={C.ink} />
      <circle cx="35" cy={happy ? 60 : 61} r={1.8} fill="white" />
      <circle cx="69" cy={happy ? 60 : 61} r={1.8} fill="white" />
      {/* Mouth */}
      {happy
        ? <path d="M 36 77 Q 50 89 64 77" stroke={C.ink} strokeWidth="2.5" fill="none" strokeLinecap="round" />
        : <path d="M 38 76 Q 50 83 62 76" stroke={C.ink} strokeWidth="2" fill="none" strokeLinecap="round" />}
      {happy && <>
        <circle cx="27" cy="75" r={6} fill={C.blush} fillOpacity={0.4} />
        <circle cx="73" cy="75" r={6} fill={C.blush} fillOpacity={0.4} />
      </>}
      {/* Book */}
      <rect x="58" y="72" width="26" height="20" rx="3" fill={C.primary} />
      <rect x="58" y="72" width="4" height="20" rx="2" fill={C.primaryDark} />
      <line x1="64" y1="77" x2="80" y2="77" stroke="white" strokeWidth="1.5" opacity={0.6} />
      <line x1="64" y1="81" x2="80" y2="81" stroke="white" strokeWidth="1.5" opacity={0.6} />
      <line x1="64" y1="85" x2="74" y2="85" stroke="white" strokeWidth="1.5" opacity={0.6} />
      {/* Arms */}
      <ellipse cx="12" cy="72" rx="10" ry="6" fill={C.glowDark} transform="rotate(-20 12 72)" />
      <ellipse cx="80" cy="78" rx="12" ry="6" fill={C.glowDark} transform="rotate(12 80 78)" />
      {/* Feet */}
      <ellipse cx="38" cy="108" rx="11" ry="7" fill={C.glowDark} />
      <ellipse cx="62" cy="108" rx="11" ry="7" fill={C.glowDark} />
      <PoseFx pose={pose} eyes={[[33, 63], [67, 63]]} />
    </svg>
  );
}

// ─── Bubble mascot (pink, speech bubbles) ────────────────────────────────────
function Bubble({ size = 100, pose = "idle" }: { size?: number; pose?: string }) {
  const happy = pose === "happy" || pose === "celebrating";
  return (
    <svg width={size} height={size * 1.2} viewBox="0 0 100 120" style={{ overflow: "visible" }}>
      {/* Speech bubble */}
      <ellipse cx="78" cy="22" rx="15" ry="11" fill="white" opacity={0.92} />
      <polygon points="72,31 68,38 76,33" fill="white" opacity={0.92} />
      <text x="70" y="26" fontSize="11" fill={C.primary}>♪</text>
      {/* Body */}
      <ellipse cx="50" cy="66" rx="39" ry="43" fill={C.blush} />
      <ellipse cx="36" cy="48" rx="14" ry="10" fill="white" fillOpacity={0.3} />
      {/* Eyes */}
      <circle cx="37" cy="62" r={happy ? 9.5 : 8.5} fill="white" />
      <circle cx="63" cy="62" r={happy ? 9.5 : 8.5} fill="white" />
      <circle cx={happy ? 38.5 : 37.5} cy={happy ? 61 : 62} r={5.5} fill={C.ink} />
      <circle cx={happy ? 64.5 : 63.5} cy={happy ? 61 : 62} r={5.5} fill={C.ink} />
      <circle cx={happy ? 40 : 39} cy={happy ? 59 : 60} r={2} fill="white" />
      <circle cx={happy ? 66 : 65} cy={happy ? 59 : 60} r={2} fill="white" />
      {/* Big round mouth */}
      <ellipse cx="50" cy="76" rx="11" ry="8" fill={C.ink} />
      <ellipse cx="50" cy={happy ? 73.5 : 74} rx="8.5" ry="5" fill={happy ? "#FF9EB5" : "#FF7A9A"} />
      {happy && <>
        <circle cx="26" cy="70" r={6} fill="white" fillOpacity={0.4} />
        <circle cx="74" cy="70" r={6} fill="white" fillOpacity={0.4} />
      </>}
      {/* Arms */}
      <ellipse cx="13" cy="70" rx="10" ry="6" fill={C.blush} transform="rotate(-22 13 70)" />
      <ellipse cx="87" cy="68" rx="10" ry="6" fill={C.blush} transform="rotate(22 87 68)" />
      {/* Feet */}
      <ellipse cx="38" cy="108" rx="11" ry="7" fill="#E8A0BA" />
      <ellipse cx="62" cy="108" rx="11" ry="7" fill="#E8A0BA" />
      <PoseFx pose={pose} eyes={[[37, 62], [63, 62]]} />
    </svg>
  );
}

// ─── Brick mascot (orange, phoneme tiles) ────────────────────────────────────
function Brick({ size = 100, pose = "idle" }: { size?: number; pose?: string }) {
  const happy = pose === "happy" || pose === "celebrating";
  return (
    <svg width={size} height={size * 1.2} viewBox="0 0 100 120" style={{ overflow: "visible" }}>
      {/* Blocky body */}
      <rect x="12" y="22" width="76" height="80" rx="26" fill={C.amber} />
      <ellipse cx="36" cy="44" rx="18" ry="12" fill="white" fillOpacity={0.22} />
      {/* Phoneme tiles it carries */}
      <rect x="60" y="70" width="18" height="16" rx="4" fill="white" opacity={0.92} />
      <text x="63" y="82" fontSize="11" fontWeight="bold" fill={C.amber} style={{ fontFamily: uiFont }}>A</text>
      <rect x="63" y="55" width="18" height="16" rx="4" fill="white" opacity={0.92} />
      <text x="66" y="67" fontSize="11" fontWeight="bold" fill={C.primaryDark} style={{ fontFamily: uiFont }}>T</text>
      {/* Eyes */}
      <circle cx="37" cy="57" r={happy ? 9.5 : 8.5} fill="white" />
      <circle cx="63" cy="57" r={happy ? 9.5 : 8.5} fill="white" />
      <circle cx={happy ? 38.5 : 37.5} cy={happy ? 56 : 57} r={5.5} fill={C.ink} />
      <circle cx={happy ? 64.5 : 63.5} cy={happy ? 56 : 57} r={5.5} fill={C.ink} />
      <circle cx={happy ? 40 : 39} cy={happy ? 54 : 55} r={2} fill="white" />
      <circle cx={happy ? 66 : 65} cy={happy ? 54 : 55} r={2} fill="white" />
      {/* Mouth */}
      {happy
        ? <path d="M 35 70 Q 50 82 65 70" stroke={C.ink} strokeWidth="2.5" fill="none" strokeLinecap="round" />
        : <path d="M 37 69 Q 50 76 63 69" stroke={C.ink} strokeWidth="2" fill="none" strokeLinecap="round" />}
      {happy && <>
        <circle cx="25" cy="66" r={6} fill={C.blush} fillOpacity={0.5} />
        <circle cx="75" cy="66" r={6} fill={C.blush} fillOpacity={0.5} />
      </>}
      {/* Arms */}
      <rect x="2" y="60" width="13" height="9" rx="4" fill="#E8924A" />
      <rect x="85" y="58" width="13" height="9" rx="4" fill="#E8924A" />
      {/* Feet */}
      <rect x="24" y="100" width="22" height="14" rx="6" fill="#D8822A" />
      <rect x="54" y="100" width="22" height="14" rx="6" fill="#D8822A" />
      <PoseFx pose={pose} eyes={[[37, 57], [63, 57]]} />
    </svg>
  );
}

// ─── Shared UI primitives ─────────────────────────────────────────────────────
function PrimaryBtn({ children, onClick, className = "", disabled = false }: {
  children: React.ReactNode; onClick?: () => void; className?: string; disabled?: boolean;
}) {
  return (
    <motion.button
      whileTap={{ scale: 0.96 }}
      whileHover={disabled ? undefined : { scale: 1.02, y: -1 }}
      transition={{ duration: 0.15 }}
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center justify-center gap-2 rounded-2xl font-semibold text-white transition-opacity ${className}`}
      style={{
        background: disabled ? "#C4B0FF" : `linear-gradient(135deg, ${C.primary}, ${C.primaryDark})`,
        fontFamily: uiFont,
        minHeight: 56,
        boxShadow: disabled ? "none" : "0 8px 24px rgba(108, 71, 255, 0.32)",
      }}
    >
      {children}
    </motion.button>
  );
}

function GhostBtn({ children, onClick, className = "" }: {
  children: React.ReactNode; onClick?: () => void; className?: string;
}) {
  return (
    <motion.button
      whileTap={{ scale: 0.97 }}
      whileHover={{ scale: 1.02, backgroundColor: C.primarySoft }}
      transition={{ duration: 0.15 }}
      onClick={onClick}
      className={`flex items-center justify-center gap-2 rounded-2xl font-medium transition-colors ${className}`}
      style={{
        fontFamily: uiFont,
        minHeight: 52,
        color: C.muted,
        border: `2px solid ${C.border ?? "rgba(108,71,255,0.16)"}`,
      }}
    >
      {children}
    </motion.button>
  );
}

function Card({ children, className = "", style = {} }: {
  children: React.ReactNode; className?: string; style?: React.CSSProperties;
}) {
  return (
    <div
      className={`rounded-3xl ${className}`}
      style={{
        background: C.white,
        boxShadow: "0 4px 20px rgba(108, 71, 255, 0.08)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function ProgressRing({ pct, size = 64, stroke = 6, color = C.primary, bg = C.primarySoft }: {
  pct: number; size?: number; stroke?: number; color?: string; bg?: string;
}) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={bg} strokeWidth={stroke} />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke}
        strokeDasharray={circ} strokeDashoffset={circ * (1 - pct / 100)}
        strokeLinecap="round"
      />
    </svg>
  );
}

function StreakFlame({ days = 1, size = 32 }: { days?: number; size?: number }) {
  const color = days >= 30 ? "#FF4500" : days >= 7 ? "#F4A261" : "#FFD166";
  const shadow = days >= 30 ? "0 0 16px rgba(255,69,0,0.5)" : days >= 7 ? "0 0 12px rgba(244,162,97,0.4)" : "none";
  return (
    <div style={{ position: "relative", width: size, height: size * 1.1 }}>
      <svg width={size} height={size * 1.1} viewBox="0 0 32 35" style={{ filter: `drop-shadow(${shadow})` }}>
        <path
          d="M16 2 C16 2 22 10 22 16 C22 22 18 26 16 28 C14 26 10 22 10 16 C10 10 16 2 16 2Z"
          fill={color}
        />
        <path
          d="M16 12 C16 12 19 16 19 19 C19 22 17.5 24 16 25 C14.5 24 13 22 13 19 C13 16 16 12 16 12Z"
          fill="#FFE082"
        />
        <circle cx="16" cy="28" r="5" fill={color} opacity={0.3} />
      </svg>
    </div>
  );
}

function XPBurst({ xp, show }: { xp: number; show: boolean }) {
  if (!show) return null;
  return (
    <motion.div
      initial={{ scale: 0, opacity: 0, y: 0 }}
      animate={{ scale: [0, 1.3, 1], opacity: [0, 1, 0], y: -60 }}
      transition={{ duration: 1.2, ease: "easeOut" }}
      style={{
        position: "absolute",
        top: "40%",
        left: "50%",
        transform: "translateX(-50%)",
        background: `linear-gradient(135deg, ${C.yellow}, ${C.amber})`,
        borderRadius: 20,
        padding: "10px 24px",
        fontFamily: uiFont,
        fontWeight: 700,
        fontSize: 24,
        color: C.ink,
        boxShadow: "0 8px 24px rgba(244, 162, 97, 0.5)",
        zIndex: 50,
        whiteSpace: "nowrap",
      }}
    >
      +{xp} XP ✦
    </motion.div>
  );
}

// ─── Splash Screen ────────────────────────────────────────────────────────────
function SplashScreen({ onNext }: { onNext: () => void }) {
  return (
    <div
      className="flex flex-col items-center justify-between h-full"
      style={{ background: `linear-gradient(160deg, #F0EBFF 0%, #FFFDF5 50%, #E1F5EC 100%)`, fontFamily: uiFont, padding: "60px 32px 52px" }}
    >
      <div />
      <div className="flex flex-col items-center gap-8">
        <motion.div
          initial={{ scale: 0.7, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.6, ease: "backOut" }}
        >
          <Lexi size={140} pose="happy" />
        </motion.div>
        <motion.div
          initial={{ y: 24, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.3, duration: 0.5 }}
          className="flex flex-col items-center gap-3"
        >
          <div style={{ fontSize: 52, fontWeight: 800, color: C.primary, letterSpacing: -1 }}>
            Lexio
          </div>
          <div style={{ fontSize: 18, color: C.muted, letterSpacing: 2, fontWeight: 500, textTransform: "uppercase" }}>
            Read · Speak · Grow
          </div>
        </motion.div>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6 }}
          className="flex gap-2"
        >
          {[C.primary, C.teal, C.amber, C.blush].map((c, i) => (
            <div key={i} style={{ width: 8, height: 8, borderRadius: 4, background: c }} />
          ))}
        </motion.div>
      </div>
      <motion.div
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.8 }}
        className="w-full"
      >
        <PrimaryBtn onClick={onNext} className="w-full text-lg">
          Let's Begin <ArrowRight size={20} />
        </PrimaryBtn>
        <p style={{ textAlign: "center", marginTop: 16, color: C.muted, fontSize: 14 }}>
          Your reading adventure starts here ✦
        </p>
      </motion.div>
    </div>
  );
}

// ─── Onboarding Flow ──────────────────────────────────────────────────────────
function OnboardingFlow({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0);
  const storeName = useStore(s => s.name);
  const storeAge = useStore(s => s.age);
  const setStore = useStore(s => s.set);
  const [name, setName] = useState(storeName);
  const [age, setAge] = useState<number | null>(storeAge);
  const ages = [4, 5, 6, 7, 8, 9, 10, 11, 12, "13+"];
  const allMascots = [
    { Comp: Lexi, name: "Lexi", desc: "Your guide", color: C.lexi },
    { Comp: Echo, name: "Echo", desc: "Listens with you", color: C.teal },
    { Comp: Glow, name: "Glow", desc: "Reads with you", color: C.glow },
    { Comp: Bubble, name: "Bubble", desc: "Speaks with you", color: C.blush },
    { Comp: Brick, name: "Brick", desc: "Builds words", color: C.amber },
  ];
  const next = () => {
    if (step < 2) { setStep(step + 1); return; }
    // Derive the starting difficulty tier from age. The adaptive engine
    // (recordHit / recordMiss in the store) can nudge it up or down later
    // based on actual performance.
    setStore({
      name: name.trim(),
      age,
      difficultyTier: tierForAge(age),
      onboarded: true,
    });
    onDone();
  };
  return (
    <div className="flex flex-col h-full" style={{ fontFamily: uiFont, background: C.bg }}>
      {/* Progress dots */}
      <div className="flex justify-center gap-2 pt-14 pb-4">
        {[0, 1, 2].map(i => (
          <div key={i} style={{
            width: i === step ? 24 : 8, height: 8, borderRadius: 4,
            background: i <= step ? C.primary : C.primarySoft,
            transition: "all 0.3s ease"
          }} />
        ))}
      </div>
      <div className="flex-1 flex flex-col items-center justify-center px-8 gap-8">
        {step === 0 && (
          <motion.div key="s0" initial={{ x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} className="w-full flex flex-col items-center gap-7">
            <Lexi size={110} pose="happy" />
            <div className="text-center">
              <div style={{ fontSize: 28, fontWeight: 700, color: C.ink, marginBottom: 8 }}>Hi there! 👋</div>
              <div style={{ fontSize: 16, color: C.muted }}>What should we call you?</div>
            </div>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Your name..."
              className="w-full text-center rounded-2xl outline-none"
              style={{
                background: C.primarySoft, border: `2px solid ${name ? C.primary : "transparent"}`,
                padding: "16px 20px", fontSize: 22, fontFamily: uiFont, color: C.ink,
                transition: "border-color 0.2s",
              }}
            />
          </motion.div>
        )}
        {step === 1 && (
          <motion.div key="s1" initial={{ x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} className="w-full flex flex-col items-center gap-7">
            <Echo size={110} pose="happy" />
            <div className="text-center">
              <div style={{ fontSize: 28, fontWeight: 700, color: C.ink, marginBottom: 8 }}>
                Nice to meet you{name ? `, ${name}` : ""}!
              </div>
              <div style={{ fontSize: 16, color: C.muted }}>How old are you?</div>
            </div>
            <div className="grid grid-cols-4 gap-3 w-full">
              {ages.map(a => (
                <motion.button
                  key={a}
                  whileTap={{ scale: 0.94 }}
                  onClick={() => setAge(typeof a === "number" ? a : 13)}
                  style={{
                    padding: "14px 4px",
                    borderRadius: 16,
                    fontSize: 18,
                    fontWeight: 700,
                    fontFamily: uiFont,
                    background: age === (typeof a === "number" ? a : 13) ? C.primary : C.primarySoft,
                    color: age === (typeof a === "number" ? a : 13) ? C.white : C.primary,
                    border: "none",
                    cursor: "pointer",
                    transition: "all 0.2s",
                  }}
                >
                  {a}
                </motion.button>
              ))}
            </div>
          </motion.div>
        )}
        {step === 2 && (
          <motion.div key="s2" initial={{ x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} className="w-full flex flex-col items-center gap-6">
            <div className="text-center">
              <div style={{ fontSize: 26, fontWeight: 700, color: C.ink, marginBottom: 6 }}>Meet your friends!</div>
              <div style={{ fontSize: 15, color: C.muted }}>They're here to help you every step of the way</div>
            </div>
            <div className="flex justify-center gap-2 w-full">
              {allMascots.map(({ Comp, name: n, desc, color }) => (
                <motion.div
                  key={n}
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ delay: allMascots.findIndex(m => m.name === n) * 0.1, type: "spring" }}
                  className="flex flex-col items-center gap-1"
                >
                  <Comp size={58} pose="happy" />
                  <div style={{ fontSize: 11, fontWeight: 700, color: C.ink }}>{n}</div>
                  <div style={{ fontSize: 9, color: C.muted, textAlign: "center" }}>{desc}</div>
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}
      </div>
      <div className="px-8 pb-12">
        <PrimaryBtn
          onClick={next}
          className="w-full text-lg"
          disabled={step === 0 && name.trim().length < 2}
        >
          {step === 2 ? "Start Learning!" : "Continue"} <ArrowRight size={20} />
        </PrimaryBtn>
      </div>
    </div>
  );
}

// ─── Home Screen ──────────────────────────────────────────────────────────────
function HomeScreen({ onStartLesson, onTabChange }: {
  onStartLesson: () => void; onTabChange: (t: Tab) => void;
}) {
  const name = useStore(s => s.name) || "friend";
  const streak = useStore(s => s.streak);
  const masteredPhonemes = useStore(s => s.masteredPhonemes);

  // Find the current active lesson for dynamic Word of the Day
  const currentLessonDef = LEARN_PATH_DEF.find((def, i) => {
    const done = masteredPhonemes.includes(def.id);
    const prevDone = i === 0 || masteredPhonemes.includes(LEARN_PATH_DEF[i - 1].id);
    return !done && prevDone;
  }) ?? LEARN_PATH_DEF[0];
  const currentLesson = LESSONS[currentLessonDef.id] ?? LESSONS["m-sound"];

  const pathNodes = LEARN_PATH_DEF.slice(0, 4).map((def, i) => {
    const done = masteredPhonemes.includes(def.id);
    const prevDone = i === 0 || masteredPhonemes.includes(LEARN_PATH_DEF[i - 1].id);
    const current = !done && prevDone;
    return { ...def, done, current };
  });
  const greeting = (() => {
    const h = new Date().getHours();
    return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  })();
  return (
    <div className="flex flex-col h-full overflow-y-auto" style={{ fontFamily: uiFont, background: C.bg }}>
      {/* Header */}
      <div className="px-6 pt-14 pb-2">
        <div className="flex items-center justify-between">
          <div>
            <div style={{ fontSize: 22, fontWeight: 700, color: C.ink }}>{greeting}, {name}! ☀</div>
            <div style={{ fontSize: 15, color: C.muted }}>Ready to read something great?</div>
          </div>
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={() => onTabChange("profile")}
            style={{
              width: 48, height: 48, borderRadius: 24,
              background: C.primarySoft, display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            <User size={22} color={C.primary} />
          </motion.button>
        </div>
      </div>
      {/* Goal + Streak row */}
      <div className="px-6 py-4 flex gap-4">
        <Card className="flex-1 p-4 flex items-center gap-4">
          <div style={{ position: "relative" }}>
            <ProgressRing pct={40} size={60} stroke={6} color={C.primary} bg={C.primarySoft} />
            <div style={{
              position: "absolute", inset: 0, display: "flex", alignItems: "center",
              justifyContent: "center", fontSize: 13, fontWeight: 700, color: C.primary
            }}>40%</div>
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>Today's Goal</div>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>2 of 5 minutes</div>
            <div className="flex gap-1 mt-2">
              {[1, 2, 3, 4, 5].map(i => (
                <div key={i} style={{
                  width: 20, height: 6, borderRadius: 3,
                  background: i <= 2 ? C.primary : C.primarySoft
                }} />
              ))}
            </div>
          </div>
        </Card>
        <Card className="p-4 flex flex-col items-center justify-center gap-1" style={{ minWidth: 80 }}>
          <StreakFlame days={streak} size={28} />
          <div style={{ fontSize: 22, fontWeight: 800, color: C.amber }}>{streak}</div>
          <div style={{ fontSize: 10, color: C.muted }}>day streak</div>
        </Card>
      </div>
      {/* Start CTA */}
      <div className="px-6 pb-5">
        <PrimaryBtn onClick={onStartLesson} className="w-full text-xl" style={{ height: 64 }}>
          <Play size={22} fill="white" />
          Start Today's Session
        </PrimaryBtn>
        <div style={{ textAlign: "center", marginTop: 8, fontSize: 12, color: C.muted, display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
          <Clock size={12} color={C.muted} /> About 10 minutes · One lesson at a time
        </div>
      </div>
      {/* Today's Path */}
      <div className="px-6 pb-3">
        <div style={{ fontSize: 16, fontWeight: 700, color: C.ink, marginBottom: 12 }}>Today's Path</div>
        <Card className="p-5">
          <div className="flex items-center justify-between">
            {pathNodes.map((node, i) => (
              <div key={node.id} className="flex items-center">
                <div className="flex flex-col items-center gap-1">
                  <motion.div
                    whileTap={{ scale: 0.9 }}
                    onClick={!node.done && node.current || node.done ? onStartLesson : undefined}
                    style={{
                      width: 56, height: 56, borderRadius: 28,
                      background: node.done ? C.teal : node.current
                        ? `linear-gradient(135deg, ${C.primary}, ${C.primaryDark})`
                        : C.primarySoft,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      boxShadow: node.current ? `0 6px 20px rgba(108,71,255,0.35)` : "none",
                      cursor: node.current ? "pointer" : "default",
                      border: node.current ? `3px solid white` : "none",
                    }}
                  >
                    {node.done
                      ? <Check size={24} color="white" />
                      : <span style={{ fontSize: 20 }}>{node.emoji}</span>
                    }
                  </motion.div>
                  <div style={{ fontSize: 9, color: C.muted, textAlign: "center", maxWidth: 56 }}>{node.label}</div>
                </div>
                {i < pathNodes.length - 1 && (
                  <div style={{ width: 20, height: 3, background: pathNodes[i + 1].done || pathNodes[i + 1].current ? C.primary : C.primarySoft, borderRadius: 2, margin: "0 2px 12px" }} />
                )}
              </div>
            ))}
          </div>
        </Card>
      </div>
      {/* Word of the Day — dynamic based on current lesson */}
      <div className="px-6 pb-6">
        <div style={{ fontSize: 16, fontWeight: 700, color: C.ink, marginBottom: 12 }}>Word of the Day</div>
        <Card className="p-5" style={{ background: `linear-gradient(135deg, ${C.primarySoft}, #F8F5FF)` }}>
          <div className="flex items-center justify-between">
            <div>
              <div style={{
                fontFamily: dyslexicFont, fontSize: 40, fontWeight: 700,
                color: C.primary, letterSpacing: 2, lineHeight: 1.2
              }}>
                {currentLesson.word.startsWith(currentLesson.phoneme.toLowerCase())
                  ? <><span style={{ color: C.teal }}>{currentLesson.phoneme}</span>{currentLesson.word.slice(currentLesson.phoneme.length)}</>
                  : currentLesson.word}
              </div>
              <div style={{ fontSize: 14, color: C.muted, marginTop: 4 }}>
                {currentLesson.wordEmoji} · Focus sound: <strong style={{ color: C.teal }}>{currentLesson.phoneme}</strong>
              </div>
            </div>
            <motion.button
              whileTap={{ scale: 0.88 }}
              onClick={() => speakLesson(currentLesson.phoneme.toLowerCase(), currentLesson.word)}
              style={{
                width: 56, height: 56, borderRadius: 28,
                background: C.primary, display: "flex", alignItems: "center", justifyContent: "center",
                boxShadow: `0 6px 18px rgba(108,71,255,0.35)`,
                border: "none", cursor: "pointer",
              }}
            >
              <Volume2 size={24} color="white" />
            </motion.button>
          </div>
          <div className="flex gap-2 mt-4">
            {currentLesson.phonemeParts.length > 0
              ? currentLesson.phonemeParts.map((p, i) => (
                <motion.button key={i} whileTap={{ scale: 0.92 }} onClick={() => speakPhoneme(p.letters)}
                  style={{ padding: "4px 12px", borderRadius: 8, background: p.highlight ? C.teal : C.white, color: p.highlight ? "white" : C.muted, fontSize: 14, fontWeight: 600, fontFamily: dyslexicFont, border: "none", cursor: "pointer" }}>
                  {p.letters}
                </motion.button>
              ))
              : currentLesson.buildSlots.map((p, i) => (
                <div key={i} style={{ padding: "4px 12px", borderRadius: 8, background: i === 0 ? C.teal : C.white, color: i === 0 ? "white" : C.muted, fontSize: 14, fontWeight: 600, fontFamily: dyslexicFont }}>
                  {p}
                </div>
              ))
            }
          </div>
          <div style={{ fontSize: 11, color: C.muted, marginTop: 8, display: "flex", alignItems: "center", gap: 4 }}>
            <Volume2 size={11} color={C.muted} /> Tap a tile to hear that sound
          </div>
        </Card>
      </div>
      {/* Lexi peek */}
      <div className="px-6 pb-4">
        <Card className="p-4 flex items-center gap-4" style={{ background: C.tealSoft }}>
          <Echo size={60} pose="happy" />
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.ink }}>You're doing amazing! 🎉</div>
            <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>7-day streak! Keep it going!</div>
          </div>
        </Card>
      </div>
    </div>
  );
}

// ─── Learn Screen — category overview + per-category path ─────────────────────
// Two views managed by internal state:
//   activeCategoryId === null  → grid of category cards
//   activeCategoryId === <id>  → lesson path filtered to that category
// Categories are always unlocked (kid picks any track freely). Within a
// category, the existing prev-must-be-done gate keeps the mini-path ordered.
function LearnScreen({ onStartLesson }: { onStartLesson: (id: string) => void }) {
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null);
  const masteredPhonemes = useStore(s => s.masteredPhonemes);
  const activeCategory = activeCategoryId
    ? CATEGORIES.find(c => c.id === activeCategoryId) ?? null
    : null;

  if (!activeCategory) {
    return (
      <CategoryOverview
        mastered={masteredPhonemes}
        onPickCategory={(id) => setActiveCategoryId(id)}
      />
    );
  }
  return (
    <CategoryPath
      category={activeCategory}
      mastered={masteredPhonemes}
      onBack={() => setActiveCategoryId(null)}
      onStartLesson={onStartLesson}
    />
  );
}

// ─── Categories overview ──────────────────────────────────────────────────────
function CategoryOverview({ mastered, onPickCategory }: {
  mastered: string[];
  onPickCategory: (id: string) => void;
}) {
  const totalDone = mastered.length;
  return (
    <div className="flex flex-col h-full" style={{ fontFamily: uiFont, background: C.bg }}>
      <div className="px-6 pt-14 pb-4">
        <div style={{ fontSize: 24, fontWeight: 700, color: C.ink }}>Learning Tracks</div>
        <div style={{ fontSize: 14, color: C.muted, marginTop: 2 }}>
          Pick any track — jump in wherever you want!
        </div>
        <div className="flex gap-3 mt-4">
          <div style={{
            padding: "6px 14px", borderRadius: 20,
            background: C.teal + "20", color: C.teal, fontSize: 12, fontWeight: 600,
          }}>
            {totalDone} lessons done
          </div>
          <div style={{
            padding: "6px 14px", borderRadius: 20,
            background: C.primary + "20", color: C.primary, fontSize: 12, fontWeight: 600,
          }}>
            {CATEGORIES.length} tracks
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 pb-8">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          {CATEGORIES.map((cat, i) => {
            const total = cat.lessonIds.length;
            const done = cat.lessonIds.filter(id => mastered.includes(id)).length;
            const pct = total > 0 ? Math.round((done / total) * 100) : 0;
            const isDone = done === total;
            return (
              <motion.button
                key={cat.id}
                initial={{ scale: 0.85, opacity: 0, y: 12 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05, type: "spring", bounce: 0.4 }}
                whileTap={{ scale: 0.94 }}
                onClick={() => onPickCategory(cat.id)}
                style={{
                  position: "relative",
                  border: "none", cursor: "pointer",
                  background: `linear-gradient(135deg, ${cat.gradient[0]}, ${cat.gradient[1]})`,
                  borderRadius: 22,
                  padding: "18px 14px 14px",
                  textAlign: "left",
                  color: "white",
                  display: "flex", flexDirection: "column", gap: 8,
                  aspectRatio: "1 / 1.05",
                  boxShadow: `0 10px 24px ${cat.gradient[1]}55`,
                  overflow: "hidden",
                  fontFamily: uiFont,
                }}
              >
                {/* decorative blob */}
                <div style={{
                  position: "absolute", top: -30, right: -30,
                  width: 100, height: 100, borderRadius: 50,
                  background: "rgba(255,255,255,0.18)",
                }} />
                {isDone && (
                  <div style={{
                    position: "absolute", top: 10, right: 10,
                    width: 26, height: 26, borderRadius: 13,
                    background: "white",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    boxShadow: "0 2px 6px rgba(0,0,0,0.15)",
                  }}>
                    <Trophy size={14} color={cat.gradient[1]} />
                  </div>
                )}
                <div style={{ fontSize: 38, lineHeight: 1, marginTop: 6 }}>{cat.emoji}</div>
                <div style={{ marginTop: "auto" }}>
                  <div style={{ fontSize: 17, fontWeight: 800, lineHeight: 1.15 }}>{cat.label}</div>
                  <div style={{ fontSize: 11, opacity: 0.85, marginTop: 2, fontWeight: 600 }}>{cat.sub}</div>
                  {/* Progress bar */}
                  <div style={{
                    marginTop: 8,
                    height: 6, borderRadius: 3,
                    background: "rgba(255,255,255,0.25)",
                    overflow: "hidden",
                  }}>
                    <div style={{
                      width: `${pct}%`,
                      height: "100%",
                      background: "rgba(255,255,255,0.85)",
                      transition: "width 0.4s",
                    }} />
                  </div>
                  <div style={{ fontSize: 10, opacity: 0.85, marginTop: 4, fontWeight: 700 }}>
                    {done}/{total} done
                  </div>
                </div>
              </motion.button>
            );
          })}
        </div>

        <div style={{ fontSize: 11, color: C.muted, textAlign: "center", marginTop: 22, lineHeight: 1.6 }}>
          Each track is independent. Switch anytime!
        </div>
      </div>
    </div>
  );
}

// ─── Per-category lesson path (uses LEARN_PATH_DEF layout, filtered) ──────────
function CategoryPath({ category, mastered, onBack, onStartLesson }: {
  category: LessonCategory;
  mastered: string[];
  onBack: () => void;
  onStartLesson: (id: string) => void;
}) {
  // Build the filtered path: LEARN_PATH_DEF entries that belong to this category
  const learnPath = category.lessonIds
    .map(id => LEARN_PATH_DEF.find(d => d.id === id))
    .filter((d): d is typeof LEARN_PATH_DEF[number] => !!d)
    .map((def, i, arr) => {
      const done = mastered.includes(def.id);
      const prevDone = i === 0 || mastered.includes(arr[i - 1].id);
      const locked = !done && !prevDone;
      const current = !done && prevDone;
      return { ...def, done, locked, current };
    });

  const doneCount = learnPath.filter(n => n.done).length;

  return (
    <div className="flex flex-col h-full" style={{ fontFamily: uiFont, background: C.bg }}>
      <div className="px-5 pt-12 pb-4 flex items-center gap-3">
        <motion.button
          whileTap={{ scale: 0.88 }}
          onClick={onBack}
          style={{
            width: 44, height: 44, borderRadius: 22,
            background: C.white,
            display: "flex", alignItems: "center", justifyContent: "center",
            border: "none", cursor: "pointer",
            boxShadow: "0 2px 8px rgba(108,71,255,0.15)",
          }}
          aria-label="Back to tracks"
        >
          <ChevronLeft size={22} color={C.primary} />
        </motion.button>
        <div className="flex-1">
          <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, letterSpacing: 2, textTransform: "uppercase" }}>
            Track
          </div>
          <div style={{ fontSize: 20, fontWeight: 800, color: C.ink, lineHeight: 1.1 }}>
            {category.label}
          </div>
        </div>
        {/* Category emoji badge */}
        <div style={{
          width: 52, height: 52, borderRadius: 18,
          background: `linear-gradient(135deg, ${category.gradient[0]}, ${category.gradient[1]})`,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 26,
          boxShadow: `0 6px 18px ${category.gradient[1]}55`,
        }}>
          {category.emoji}
        </div>
      </div>

      <div className="px-5 pb-3">
        <div style={{
          padding: "6px 14px", borderRadius: 20,
          background: doneCount === learnPath.length ? C.tealSoft : C.primarySoft,
          color: doneCount === learnPath.length ? C.teal : C.primary,
          fontSize: 12, fontWeight: 700, display: "inline-block",
        }}>
          {doneCount}/{learnPath.length} lessons
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-8">
        <div style={{ position: "relative", minHeight: learnPath.length * 88 + 80 }}>
          <svg
            style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", pointerEvents: "none" }}
            viewBox={`0 0 390 ${learnPath.length * 88 + 80}`}
            preserveAspectRatio="none"
          >
            {learnPath.slice(0, -1).map((node, i) => {
              const next = learnPath[i + 1];
              const y1 = 56 + i * 88;
              const y2 = 56 + (i + 1) * 88;
              return (
                <line
                  key={i}
                  x1={node.x + 28} y1={y1} x2={next.x + 28} y2={y2}
                  stroke={node.done && next.done ? C.teal : C.primarySoft}
                  strokeWidth={4}
                  strokeDasharray={next.locked ? "8 6" : "none"}
                  strokeLinecap="round"
                />
              );
            })}
          </svg>
          {learnPath.map((node, i) => (
            <motion.div
              key={node.id}
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: i * 0.05 }}
              style={{
                position: "absolute", top: i * 88 + 12, left: node.x,
                display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
              }}
            >
              <motion.button
                whileTap={!node.locked ? { scale: 0.9 } : {}}
                onClick={!node.locked ? () => onStartLesson(node.id) : undefined}
                style={{
                  width: node.boss ? 72 : 56,
                  height: node.boss ? 72 : 56,
                  borderRadius: node.boss ? 36 : 28,
                  background: node.done
                    ? `linear-gradient(135deg, ${C.teal}, ${C.echoDark})`
                    : node.current
                      ? `linear-gradient(135deg, ${category.gradient[0]}, ${category.gradient[1]})`
                      : node.locked ? "#E8E5F0" : C.primarySoft,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  boxShadow: node.current
                    ? `0 8px 24px ${category.gradient[1]}66`
                    : node.boss && node.done ? `0 6px 18px rgba(93,202,165,0.4)` : "none",
                  border: node.current ? `3px solid white` : "none",
                  cursor: node.locked ? "default" : "pointer",
                }}
              >
                {node.locked
                  ? <Lock size={20} color={C.muted} />
                  : node.done
                    ? node.boss ? <Trophy size={28} color="white" /> : <Check size={22} color="white" />
                    : node.boss ? <Star size={28} color={C.primary} fill={C.yellow} />
                      : <span style={{ fontSize: 22 }}>📖</span>}
              </motion.button>
              <div style={{
                fontSize: 11, fontWeight: 700,
                color: node.locked ? C.muted : node.current ? category.gradient[0] : C.ink,
                textAlign: "center", maxWidth: 80
              }}>{node.label}</div>
              {node.current && (
                <div style={{
                  background: category.gradient[0], color: "white", fontSize: 9, fontWeight: 700,
                  padding: "2px 8px", borderRadius: 8
                }}>NOW</div>
              )}
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Lesson: Hear It ──────────────────────────────────────────────────────────
function HearItStep({ onNext, lesson }: { onNext: () => void; lesson: LessonData }) {
  const [played, setPlayed] = useState(false);
  const [pulsing, setPulsing] = useState(false);
  const handlePlay = useCallback(() => {
    setPulsing(true);
    setPlayed(true);
    speakLesson(lesson.phoneme.toLowerCase(), lesson.word);
    setTimeout(() => setPulsing(false), 2200);
  }, [lesson]);
  useEffect(() => {
    const t = setTimeout(handlePlay, 450);
    return () => { clearTimeout(t); cancelTTS(); };
  }, [handlePlay]);
  const wordDisplay = lesson.word.toUpperCase().startsWith(lesson.phoneme.toUpperCase())
    ? <><span style={{ color: C.teal, fontWeight: 700 }}>{lesson.phoneme}</span>{lesson.word.slice(lesson.phoneme.length)}</>
    : <span>{lesson.word}</span>;
  return (
    <div className="flex flex-col items-center justify-between h-full px-8 py-10" style={{ fontFamily: uiFont }}>
      <div className="flex flex-col items-center gap-2">
        <div style={{ fontSize: 13, fontWeight: 700, color: C.muted, letterSpacing: 2, textTransform: "uppercase" }}>
          Step 1 of 5
        </div>
        <div style={{ fontSize: 28, fontWeight: 700, color: C.ink }}>Hear It</div>
        <div style={{ fontSize: 15, color: C.muted, textAlign: "center" }}>
          Listen carefully to the sound
        </div>
      </div>
      <div className="flex flex-col items-center gap-6">
        <motion.div animate={pulsing ? { scale: [1, 1.05, 1] } : {}} transition={{ duration: 0.4 }}>
          <Echo size={120} pose={played ? "happy" : "idle"} />
        </motion.div>
        <div style={{
          fontSize: 20, fontWeight: 600, color: C.muted, textAlign: "center",
          background: C.tealSoft, padding: "12px 24px", borderRadius: 16
        }}>
          "Listen for the <span style={{ color: C.teal, fontWeight: 800 }}>{lesson.phoneme}</span> sound"
        </div>
        <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}>
          {pulsing && [1, 2].map(ring => (
            <motion.div
              key={ring}
              animate={{ scale: [1, 1.8], opacity: [0.5, 0] }}
              transition={{ duration: 1, delay: ring * 0.2, repeat: Infinity }}
              style={{ position: "absolute", width: 100, height: 100, borderRadius: 50, background: C.teal, opacity: 0.3 }}
            />
          ))}
          <motion.button
            whileTap={{ scale: 0.92 }}
            onClick={handlePlay}
            style={{
              width: 100, height: 100, borderRadius: 50,
              background: `linear-gradient(135deg, ${C.teal}, ${C.echoDark})`,
              display: "flex", alignItems: "center", justifyContent: "center",
              boxShadow: `0 12px 32px rgba(93,202,165,0.45)`,
              border: "4px solid white",
            }}
          >
            <Volume2 size={40} color="white" />
          </motion.button>
        </div>
        <div style={{ fontSize: 22, fontFamily: dyslexicFont, color: C.ink, letterSpacing: 2 }}>
          {wordDisplay}
        </div>
        {played && (
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            style={{ fontSize: 14, color: C.teal, fontWeight: 600 }}
          >
            ✓ Great listening! Tap again to replay
          </motion.div>
        )}
      </div>
      <PrimaryBtn onClick={onNext} className="w-full text-lg" disabled={!played}>
        I heard it! <ChevronRight size={20} />
      </PrimaryBtn>
    </div>
  );
}

// ─── Lesson: See It ──────────────────────────────────────────────────────────
function SeeItStep({ onNext, lesson }: { onNext: () => void; lesson: LessonData }) {
  const wordDisplay = (() => {
    const upper = lesson.word.toUpperCase();
    const ph = lesson.phoneme.toUpperCase();
    if (upper.startsWith(ph)) {
      return (
        <>
          <span style={{ color: C.teal, background: C.tealSoft, borderRadius: 8, padding: "2px 4px" }}>{lesson.phoneme}</span>
          <span style={{ color: C.ink }}>{lesson.word.slice(lesson.phoneme.length)}</span>
        </>
      );
    }
    return <span style={{ color: C.ink }}>{lesson.word}</span>;
  })();
  return (
    <div className="flex flex-col items-center justify-between h-full px-8 py-10" style={{ fontFamily: uiFont }}>
      <div className="flex flex-col items-center gap-2">
        <div style={{ fontSize: 13, fontWeight: 700, color: C.muted, letterSpacing: 2, textTransform: "uppercase" }}>
          Step 2 of 5
        </div>
        <div style={{ fontSize: 28, fontWeight: 700, color: C.ink }}>See It</div>
        <div style={{ fontSize: 15, color: C.muted, textAlign: "center" }}>Find the special sound</div>
      </div>
      <div className="flex flex-col items-center gap-6 w-full">
        <Glow size={100} pose="idle" />
        <Card className="w-full p-6 flex flex-col items-center gap-4" style={{ background: C.primarySoft }}>
          <div style={{ fontFamily: dyslexicFont, fontSize: 56, letterSpacing: 4, lineHeight: 1.3 }}>
            {wordDisplay}
          </div>
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={() => speakPhoneme(lesson.phoneme)}
            style={{
              width: 44, height: 44, borderRadius: 22,
              background: C.white, display: "flex", alignItems: "center", justifyContent: "center",
              boxShadow: "0 2px 8px rgba(0,0,0,0.1)", border: "none", cursor: "pointer",
            }}
          >
            <Volume2 size={20} color={C.primary} />
          </motion.button>
        </Card>
        <Card className="w-full p-4 flex gap-3" style={{ background: C.amberSoft }}>
          <div style={{ fontSize: 24 }}>💡</div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>Tip from Glow</div>
            <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.6, marginTop: 2 }}>{lesson.tipText}</div>
          </div>
        </Card>
        {lesson.phonemeParts.length > 0 && (
          <div className="flex flex-col items-center gap-2 w-full">
            <div className="flex gap-3 w-full">
              {lesson.phonemeParts.map(p => (
                <motion.button
                  key={p.letters}
                  whileTap={{ scale: 0.92 }}
                  onClick={() => speakPhoneme(p.letters)}
                  style={{
                    flex: 1, padding: "10px 0", borderRadius: 16, textAlign: "center",
                    background: p.highlight ? C.teal : C.white,
                    boxShadow: p.highlight ? `0 4px 12px rgba(93,202,165,0.3)` : "0 2px 8px rgba(0,0,0,0.06)",
                    border: "none", cursor: "pointer",
                  }}
                >
                  <div style={{ fontFamily: dyslexicFont, fontSize: 22, color: p.highlight ? "white" : C.ink, fontWeight: 700 }}>
                    {p.letters}
                  </div>
                  <div style={{ fontSize: 10, color: p.highlight ? "rgba(255,255,255,0.8)" : C.muted, marginTop: 2 }}>
                    {p.label}
                  </div>
                </motion.button>
              ))}
            </div>
            <div style={{ fontSize: 11, color: C.muted, display: "flex", alignItems: "center", gap: 4 }}>
              <Volume2 size={12} color={C.muted} /> Tap each sound to hear it
            </div>
          </div>
        )}
      </div>
      <PrimaryBtn onClick={onNext} className="w-full text-lg">
        Got it! <ChevronRight size={20} />
      </PrimaryBtn>
    </div>
  );
}

// ─── Lesson: Trace It ────────────────────────────────────────────────────────
// SH stroke paths in a 360×240 viewBox. Four strokes: S body, H-left, H-right, H-crossbar.
// Designed for whole-arm motion on touch — letters fill the canvas.
const SH_STROKES = [
  // S: written in one stroke top→bottom. Quadratic curves give a clean letterform.
  //   Start top-right (150,70) → top hook bulges upper-left to mid-left → crosses
  //   right through mid → bottom hook bulges lower-right → ends bottom-left.
  "M 150 70 Q 60 60 60 105 Q 60 135 105 135 Q 150 135 150 165 Q 150 200 60 195",
  // H left vertical (top → bottom)
  "M 210 60 L 210 200",
  // H right vertical (top → bottom)
  "M 300 60 L 300 200",
  // H crossbar (left → right)
  "M 210 130 L 300 130",
];

function TraceItStep({ onNext, lesson }: { onNext: () => void; lesson: LessonData }) {
  const [attempts, setAttempts] = useState(0);
  const [encourage, setEncourage] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const [complete, setComplete] = useState(false);

  // TODO(FishAudio): when API key lands, start/stop a looped "shhhh" phoneme
  //   audio sample on finger down / finger up. The hooks below are wired but
  //   intentionally silent for now. See PLAN.md for the audio contract.
  const handleFingerDown = useCallback(() => { /* TODO: start phoneme loop */ }, []);
  const handleFingerUp = useCallback(() => { /* TODO: stop phoneme loop */ }, []);

  const handleComplete = useCallback(() => {
    setComplete(true);
    setEncourage(null);
    // Brief celebration then advance
    setTimeout(onNext, 1400);
  }, [onNext]);

  const handlePartialLift = useCallback((coverage: number) => {
    const nextAttempts = attempts + 1;
    setAttempts(nextAttempts);
    // After 2 partial lifts, auto-pass with celebration — never get stuck.
    if (nextAttempts >= 2) {
      setEncourage(`Great effort! ✨ Let's keep going.`);
      setTimeout(handleComplete, 900);
      return;
    }
    const pct = Math.round(coverage * 100);
    setEncourage(pct > 30
      ? `Nice start — let's finish the line together!`
      : `You've got this — slide your finger along the path.`);
    setTimeout(() => {
      setEncourage(null);
      setResetKey(k => k + 1);
    }, 1100);
  }, [attempts, handleComplete]);

  return (
    <div className="flex flex-col items-center justify-between h-full px-8 py-10" style={{ fontFamily: uiFont }}>
      <div className="flex flex-col items-center gap-2">
        <div style={{ fontSize: 13, fontWeight: 700, color: C.muted, letterSpacing: 2, textTransform: "uppercase" }}>
          Step 3 of 5
        </div>
        <div style={{ fontSize: 28, fontWeight: 700, color: C.ink }}>Trace It</div>
        <div style={{ fontSize: 15, color: C.muted, textAlign: "center" }}>
          Use your finger to draw the letters
        </div>
      </div>
      <div className="flex flex-col items-center gap-4 w-full">
        <Glow size={80} pose={complete ? "celebrating" : "idle"} />
        <Card className="w-full p-3" style={{ background: C.white }}>
          <TraceLetter
            strokes={lesson.traceStrokes}
            viewBox={lesson.traceViewBox}
            tolerance={32}
            threshold={0.5}
            samplesPerStroke={32}
            onComplete={handleComplete}
            onPartialLift={handlePartialLift}
            onFingerDown={handleFingerDown}
            onFingerUp={handleFingerUp}
            resetKey={resetKey}
            showDemo={attempts === 0}
          />
        </Card>
        {encourage && (
          <motion.div
            initial={{ y: 8, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            style={{
              background: C.amberSoft,
              color: C.amber,
              padding: "8px 16px",
              borderRadius: 14,
              fontSize: 13,
              fontWeight: 700,
              textAlign: "center",
            }}
          >
            {encourage}
          </motion.div>
        )}
        {complete && (
          <motion.div
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            style={{ fontSize: 18, fontWeight: 700, color: C.teal }}
          >
            ✦ Beautiful tracing! ✦
          </motion.div>
        )}
        <div style={{ fontSize: 11, color: C.muted }}>
          Tip: Use your finger, not a stylus — your finger learns letters faster.
        </div>
      </div>
      <GhostBtn onClick={onNext} className="w-full">
        Skip for now
      </GhostBtn>
    </div>
  );
}

// ─── Lesson: Say It ──────────────────────────────────────────────────────────
function SayItStep({ onNext, lesson, onCorrect, onWrong }: { onNext: () => void; lesson: LessonData; onCorrect?: () => void; onWrong?: () => void }) {
  const TARGET_WORD_SAY = lesson.word;
  const TARGET_ACCEPT = lesson.sayAccept;
  const [micState, setMicState] = useState<MicState>("idle");
  const [denied, setDenied] = useState(false);
  const [matched, setMatched] = useState(false);
  const [heard, setHeard] = useState<string>("");
  const [levels, setLevels] = useState<number[]>(() => new Array(10).fill(8));
  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const recogRef = useRef<any>(null);
  const matchedRef = useRef(false);

  const stopMic = useCallback(() => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    ctxRef.current?.close().catch(() => {});
    ctxRef.current = null;
    try { recogRef.current?.stop(); } catch {}
    recogRef.current = null;
  }, []);

  useEffect(() => stopMic, [stopMic]);

  const handleMic = useCallback(async () => {
    if (micState !== "idle") return;
    setMatched(false);
    setHeard("");
    matchedRef.current = false;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const Ctx = window.AudioContext || (window as any).webkitAudioContext;
      const ctx: AudioContext = new Ctx();
      ctxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);

      // Speech recognition for real word matching
      const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SR) {
        const r = new SR();
        r.lang = "en-US";
        r.interimResults = true;
        r.continuous = true;
        r.maxAlternatives = 5;
        r.onresult = (ev: any) => {
          let text = "";
          for (let i = 0; i < ev.results.length; i++) {
            for (let j = 0; j < ev.results[i].length; j++) {
              text += " " + ev.results[i][j].transcript;
            }
          }
          setHeard(text.trim());
          if (TARGET_ACCEPT.test(text)) {
            matchedRef.current = true;
            setMatched(true);
          }
        };
        r.onerror = () => {};
        recogRef.current = r;
        try { r.start(); } catch {}
      }

      setMicState("listening");
      const started = performance.now();
      const tick = () => {
        analyser.getByteFrequencyData(data);
        const bins = 10;
        const step = Math.floor(data.length / bins);
        const next: number[] = [];
        for (let i = 0; i < bins; i++) {
          let sum = 0;
          for (let j = 0; j < step; j++) sum += data[i * step + j];
          const avg = sum / step;
          next.push(6 + (avg / 255) * 28);
        }
        setLevels(next);
        const elapsed = performance.now() - started;
        // Stop early on confident match
        if (matchedRef.current && elapsed > 800) {
          stopMic();
          setMicState("processing");
          setTimeout(() => setMicState("encourage"), 600);
          return;
        }
        if (elapsed < 3500) {
          rafRef.current = requestAnimationFrame(tick);
        } else {
          stopMic();
          setMicState("processing");
          setTimeout(() => setMicState("encourage"), 700);
        }
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch {
      setDenied(true);
      setMicState("encourage");
    }
  }, [micState, stopMic]);

  const tryAgain = () => {
    setMicState("idle");
    setMatched(false);
    setHeard("");
    matchedRef.current = false;
    setLevels(new Array(10).fill(8));
  };
  // Emit hit/miss exactly once when entering "encourage" (not on denial)
  const reportedRef = useRef(false);
  useEffect(() => {
    if (micState !== "encourage") { reportedRef.current = false; return; }
    if (denied || reportedRef.current) return;
    reportedRef.current = true;
    if (matched) onCorrect?.(); else onWrong?.();
  }, [micState, matched, denied, onCorrect, onWrong]);
  const srSupported = typeof window !== "undefined" && !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
  const micBg = micState === "idle"
    ? `linear-gradient(135deg, ${C.teal}, ${C.echoDark})`
    : micState === "listening"
      ? `linear-gradient(135deg, ${C.primary}, ${C.primaryDark})`
      : micState === "processing"
        ? `linear-gradient(135deg, ${C.amber}, #E8922A)`
        : `linear-gradient(135deg, ${C.teal}, ${C.echoDark})`;
  return (
    <div className="flex flex-col items-center justify-between h-full px-8 py-10" style={{ fontFamily: uiFont }}>
      <div className="flex flex-col items-center gap-2">
        <div style={{ fontSize: 13, fontWeight: 700, color: C.muted, letterSpacing: 2, textTransform: "uppercase" }}>
          Step 4 of 5
        </div>
        <div style={{ fontSize: 28, fontWeight: 700, color: C.ink }}>Say It</div>
        <div style={{ fontSize: 15, color: C.muted, textAlign: "center" }}>
          {micState === "idle" ? "Your turn to say it!" : micState === "listening" ? "Listening… 🎵" : micState === "processing" ? "Processing your voice…" : "Nice try! Keep going!"}
        </div>
      </div>
      <div className="flex flex-col items-center gap-6 w-full">
        <motion.div animate={micState === "encourage" ? { scale: [1, 1.08, 1] } : {}}>
          <Bubble
            size={110}
            pose={
              micState === "processing" ? "thinking"
              : denied ? "tryAgain"
              : micState === "encourage" ? (matched ? "happy" : "tryAgain")
              : "idle"
            }
          />
        </motion.div>
        <div style={{ fontFamily: dyslexicFont, fontSize: 48, color: C.ink, letterSpacing: 3 }}>
          {lesson.word.toUpperCase().startsWith(lesson.phoneme.toUpperCase())
            ? <><span style={{ color: C.teal }}>{lesson.phoneme}</span>{lesson.word.slice(lesson.phoneme.length)}</>
            : lesson.word}
        </div>
        {/* Mic button with waveform */}
        <div style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
          {/* Waveform rings */}
          {micState === "listening" && [1, 2, 3].map(ring => (
            <motion.div
              key={ring}
              animate={{ scale: [1, 1.5 + ring * 0.3], opacity: [0.4, 0] }}
              transition={{ duration: 0.9, delay: ring * 0.15, repeat: Infinity }}
              style={{
                position: "absolute",
                width: 90, height: 90, borderRadius: 45,
                background: C.primary, opacity: 0.2,
              }}
            />
          ))}
          <motion.button
            whileTap={{ scale: 0.92 }}
            onClick={handleMic}
            style={{
              width: 90, height: 90, borderRadius: 45,
              background: micBg,
              display: "flex", alignItems: "center", justifyContent: "center",
              boxShadow: micState === "listening"
                ? `0 0 0 6px rgba(108,71,255,0.2), 0 12px 32px rgba(108,71,255,0.4)`
                : `0 12px 32px rgba(93,202,165,0.4)`,
              border: "4px solid white",
              cursor: micState === "idle" ? "pointer" : "default",
            }}
          >
            {micState === "processing"
              ? <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: "linear" }}>
                  <RefreshCw size={36} color="white" />
                </motion.div>
              : <Mic size={40} color="white" />}
          </motion.button>
          {/* Live waveform bars driven by mic */}
          {micState === "listening" && (
            <div className="flex items-end gap-1 h-10">
              {levels.map((h, i) => (
                <div
                  key={i}
                  style={{
                    width: 5,
                    height: h,
                    background: C.primary,
                    borderRadius: 2,
                    transition: "height 60ms linear",
                  }}
                />
              ))}
            </div>
          )}
        </div>
        {/* Feedback */}
        {micState === "encourage" && (() => {
          const bg = denied ? C.amberSoft : matched ? C.tealSoft : C.amberSoft;
          const accent = denied ? C.amber : matched ? C.teal : C.amber;
          const title = denied ? "No worries! 👍" : matched ? "Great job! 🌟" : "Nice try! 🎉";
          const sub = denied
            ? "We need mic access to hear you. Tap Continue when you're ready."
            : matched
              ? `Bubble heard you say "${TARGET_WORD_SAY}"! That was perfect.`
              : srSupported
                ? `You're getting it! Try saying "${TARGET_WORD_SAY}" one more time — you've got this.`
                : "Keep practicing — every try makes you better!";
          return (
            <motion.div initial={{ y: 12, opacity: 0 }} animate={{ y: 0, opacity: 1 }}>
              <Card className="w-full p-4" style={{ background: bg, textAlign: "center" }}>
                <div style={{ fontSize: 18, fontWeight: 700, color: accent }}>{title}</div>
                <div style={{ fontSize: 13, color: C.muted, marginTop: 4 }}>{sub}</div>
                {heard && !matched && !denied && (
                  <div style={{ fontSize: 11, color: C.muted, marginTop: 6, fontStyle: "italic" }}>
                    I heard: "{heard}"
                  </div>
                )}
              </Card>
            </motion.div>
          );
        })()}
      </div>
      <div className="flex flex-col gap-3 w-full">
        {micState === "encourage" && (
          <GhostBtn onClick={tryAgain} className="w-full">
            <RefreshCw size={18} /> Try Again
          </GhostBtn>
        )}
        <PrimaryBtn
          onClick={onNext}
          className="w-full text-lg"
          disabled={micState === "idle"}
        >
          {micState === "encourage" ? "Continue Anyway" : "Continue"} <ChevronRight size={20} />
        </PrimaryBtn>
      </div>
    </div>
  );
}

// ─── Lesson: Build It ────────────────────────────────────────────────────────

function DragTile({ idx, letter, used, disabled }: { idx: number; letter: string; used: boolean; disabled: boolean }) {
  const [{ isDragging }, drag] = useDrag(() => ({
    type: DND_TYPE,
    item: { idx, letter },
    canDrag: () => !used && !disabled,
    collect: m => ({ isDragging: !!m.isDragging() }),
  }), [idx, letter, used, disabled]);
  return (
    <motion.div
      ref={drag as any}
      whileTap={!used && !disabled ? { scale: 0.92 } : {}}
      style={{
        padding: "12px 20px", borderRadius: 16,
        background: used ? C.primarySoft : C.white,
        boxShadow: used ? "none" : "0 4px 12px rgba(108,71,255,0.14)",
        fontSize: 22, fontFamily: dyslexicFont, fontWeight: 700,
        color: used ? C.muted : C.primary,
        opacity: used ? 0.5 : isDragging ? 0.4 : 1,
        border: `2px solid ${used ? "transparent" : C.primarySoft}`,
        cursor: used || disabled ? "default" : "grab",
        touchAction: "none",
        userSelect: "none",
        transition: "all 0.2s",
      }}
    >
      {letter}
    </motion.div>
  );
}

function DropSlot({
  filledLetter, expected, isCorrect, shake, onDropTile, onClear,
}: {
  filledLetter: string | null;
  expected: string;
  isCorrect: boolean;
  shake: boolean;
  onDropTile: (item: { idx: number; letter: string }) => boolean;
  onClear: () => void;
}) {
  const [{ isOver, canDrop }, drop] = useDrop(() => ({
    accept: DND_TYPE,
    canDrop: (item: { letter: string }) => !filledLetter && item.letter === expected,
    drop: (item: { idx: number; letter: string }) => { onDropTile(item); },
    collect: m => ({ isOver: !!m.isOver(), canDrop: !!m.canDrop() }),
  }), [filledLetter, expected, onDropTile]);
  const ringColor = isCorrect ? C.teal : filledLetter ? C.primary : isOver && canDrop ? C.teal : C.primarySoft;
  const bg = isCorrect ? C.tealSoft : filledLetter ? C.primarySoft : isOver && canDrop ? C.tealSoft : "transparent";
  return (
    <motion.button
      ref={drop as any}
      animate={shake && !filledLetter ? { x: [-6, 6, -6, 6, 0] } : isOver && !canDrop ? { x: [-3, 3, -3, 3, 0] } : {}}
      transition={{ duration: 0.35 }}
      whileTap={filledLetter && !isCorrect ? { scale: 0.92 } : {}}
      onClick={() => filledLetter && !isCorrect && onClear()}
      style={{
        width: 80, height: 68, borderRadius: 18,
        border: `3px dashed ${ringColor}`,
        background: bg,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 24, fontFamily: dyslexicFont, fontWeight: 700,
        color: isCorrect ? C.teal : C.primary,
        boxShadow: isCorrect && filledLetter ? `0 4px 16px rgba(93,202,165,0.4)` : "none",
        cursor: filledLetter && !isCorrect ? "pointer" : "default",
        position: "relative",
        transition: "border-color 0.2s, background 0.2s",
      }}
    >
      {filledLetter}
      {isCorrect && filledLetter && (
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          style={{
            position: "absolute", top: -8, right: -8,
            width: 20, height: 20, borderRadius: 10,
            background: C.teal, display: "flex", alignItems: "center", justifyContent: "center"
          }}
        >
          <Check size={12} color="white" />
        </motion.div>
      )}
    </motion.button>
  );
}

function BuildItStep({ onNext, lesson, onCorrect, onWrong }: { onNext: () => void; lesson: LessonData; onCorrect?: () => void; onWrong?: () => void }) {
  // ── Difficulty tier read site #2 ─────────────────────────────────────────
  // Subscribe so this component re-renders if the adaptive engine nudges the
  // tier mid-session. Not yet used to alter behavior — wiring only.
  // TODO: when the tier-aware Build game lands, derive the tile bank from
  // this. Sketch:
  //   foundational → slots = first 2–3 letters, distractors = 0
  //   developing   → slots = full word, distractors = 1
  //   advanced     → slots = full word, distractors = 2–3, randomized order
  const difficultyTier = useStore(s => s.difficultyTier);
  void difficultyTier; // silence unused-var lint until games consume it

  const slots = useMemo(() => lesson.buildSlots, [lesson]);
  const [filled, setFilled] = useState<(null | { tileIdx: number; letter: string })[]>(() => new Array(lesson.buildSlots.length).fill(null));
  const [shake, setShake] = useState(false);
  const [wrongHint, setWrongHint] = useState<string | null>(null);
  const isCorrect = filled.every(f => f !== null);
  // Emit combo hit once the word is fully built — but DON'T auto-advance.
  // The user explicitly taps Next so they can hear/admire their work.
  const reportedRef = useRef(false);
  useEffect(() => {
    if (isCorrect && !reportedRef.current) {
      reportedRef.current = true;
      onCorrect?.();
    }
  }, [isCorrect, onCorrect]);
  const usedIdxs = new Set(filled.filter(Boolean).map(f => f!.tileIdx));
  const dropAt = (slotIdx: number, item: { idx: number; letter: string }) => {
    if (filled[slotIdx]) return false;
    if (item.letter !== slots[slotIdx]) {
      setShake(true);
      onWrong?.();
      const hints = [
        "Try a different sound! You're so close.",
        "Keep going — find the right spot!",
        "Almost! Listen to the sound again.",
      ];
      setWrongHint(hints[Math.floor(Math.random() * hints.length)]);
      setTimeout(() => { setShake(false); setWrongHint(null); }, 1600);
      return false;
    }
    setFilled(prev => {
      const next = [...prev];
      next[slotIdx] = { tileIdx: item.idx, letter: item.letter };
      return next;
    });
    return true;
  };
  const clearSlot = (slotIdx: number) => {
    setFilled(prev => { const n = [...prev]; n[slotIdx] = null; return n; });
  };
  return (
    <div className="flex flex-col items-center justify-between h-full px-8 py-10" style={{ fontFamily: uiFont }}>
      <div className="flex flex-col items-center gap-2">
        <div style={{ fontSize: 13, fontWeight: 700, color: C.muted, letterSpacing: 2, textTransform: "uppercase" }}>
          Step 5 of 5
        </div>
        <div style={{ fontSize: 28, fontWeight: 700, color: C.ink }}>Build It</div>
        <div style={{ fontSize: 15, color: C.muted, textAlign: "center" }}>
          Put the sounds in the right order!
        </div>
      </div>
      <div className="flex flex-col items-center gap-8 w-full">
        <Brick size={100} pose={isCorrect ? "celebrating" : shake ? "tryAgain" : "idle"} />
        <div style={{ fontSize: 32, textAlign: "center" }}>{lesson.wordEmoji} {lesson.word}</div>
        {/* Slots */}
        <div className="flex gap-4 justify-center">
          {slots.map((expected, i) => (
            <DropSlot
              key={i}
              expected={expected}
              filledLetter={filled[i]?.letter ?? null}
              isCorrect={isCorrect}
              shake={shake}
              onDropTile={(item) => dropAt(i, item)}
              onClear={() => clearSlot(i)}
            />
          ))}
        </div>
        {isCorrect && (
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            style={{ fontSize: 22, fontWeight: 700, color: C.teal, textAlign: "center" }}
          >
            ✦ Perfect! You built it! ✦
          </motion.div>
        )}
        {wrongHint && !isCorrect && (
          <motion.div
            initial={{ y: 6, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
            style={{ background: C.amberSoft, color: C.amber, padding: "8px 16px", borderRadius: 14, fontSize: 13, fontWeight: 700, textAlign: "center" }}
          >
            {wrongHint}
          </motion.div>
        )}
        {/* Tile bank (draggable) — hidden once correct so the Next button takes center stage */}
        {!isCorrect && (
          <>
            <div className="flex flex-wrap justify-center gap-3">
              {lesson.buildTiles.map((letter, i) => (
                <DragTile
                  key={i}
                  idx={i}
                  letter={letter}
                  used={usedIdxs.has(i)}
                  disabled={isCorrect}
                />
              ))}
            </div>
            <div style={{ fontSize: 11, color: C.muted, marginTop: -4 }}>
              Drag a sound into the matching box
            </div>
          </>
        )}
      </div>
      {/* Next button — only after the word is fully built */}
      {isCorrect ? (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, type: "spring", bounce: 0.4 }}
          style={{ width: "100%" }}
        >
          <PrimaryBtn onClick={onNext} className="w-full text-xl">
            Next <ArrowRight size={22} />
          </PrimaryBtn>
        </motion.div>
      ) : (
        <div style={{ height: 56 }} />
      )}
    </div>
  );
}

// ─── Lesson Unlock Overlay ────────────────────────────────────────────────────
// Shown after "Next" on the win screen — animates the locked next node on the
// learning path snapping open with a lock-breaking + sparkle burst, then
// reveals the unlocked node before returning the user to the path.
function getNextLessonDef(currentLessonId: string) {
  const idx = LEARN_PATH_DEF.findIndex(n => n.id === currentLessonId);
  if (idx === -1 || idx >= LEARN_PATH_DEF.length - 1) return null;
  return LEARN_PATH_DEF[idx + 1];
}

function LessonUnlockOverlay({ currentLessonId, onContinue }: { currentLessonId: string; onContinue: () => void }) {
  const nextDef = getNextLessonDef(currentLessonId);
  const [phase, setPhase] = useState<"intro" | "shake" | "burst" | "revealed">("intro");

  useEffect(() => {
    const t1 = setTimeout(() => setPhase("shake"), 650);
    const t2 = setTimeout(() => setPhase("burst"), 1350);
    const t3 = setTimeout(() => setPhase("revealed"), 1750);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, []);

  // No "next" lesson → path complete celebration instead
  const isPathComplete = !nextDef;
  const nextIsBoss = nextDef?.boss ?? false;

  // Particle burst at lock-break moment
  const particles = Array.from({ length: 14 }, (_, i) => {
    const angle = (i / 14) * Math.PI * 2;
    return {
      id: i,
      dx: Math.cos(angle) * (60 + Math.random() * 40),
      dy: Math.sin(angle) * (60 + Math.random() * 40),
      size: 4 + Math.random() * 5,
      color: [C.yellow, C.amber, C.primary, C.teal, "white"][i % 5],
      delay: Math.random() * 0.08,
    };
  });
  const sparkles = Array.from({ length: 10 }, (_, i) => ({
    id: i,
    x: -60 + Math.random() * 120,
    y: -60 + Math.random() * 120,
    delay: 0.1 + Math.random() * 0.4,
    size: 10 + Math.random() * 8,
  }));

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
      style={{
        position: "absolute", inset: 0, zIndex: 50,
        background: "linear-gradient(160deg, rgba(20,12,48,0.95), rgba(40,20,80,0.95))",
        backdropFilter: "blur(10px)",
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        padding: "32px 24px",
        fontFamily: uiFont,
        overflow: "hidden",
      }}
    >
      {/* Floating ambient sparkles */}
      {[...Array(18)].map((_, i) => (
        <motion.div
          key={`amb-${i}`}
          initial={{ opacity: 0, scale: 0 }}
          animate={{
            opacity: [0, 0.7, 0],
            scale: [0, 1, 0],
            y: [0, -30, -60],
          }}
          transition={{
            duration: 3 + Math.random() * 2,
            delay: Math.random() * 2,
            repeat: Infinity,
            ease: "easeOut",
          }}
          style={{
            position: "absolute",
            top: `${Math.random() * 100}%`,
            left: `${Math.random() * 100}%`,
            width: 4, height: 4, borderRadius: 4,
            background: i % 2 === 0 ? C.yellow : C.lexi,
            boxShadow: `0 0 8px ${i % 2 === 0 ? C.yellow : C.lexi}`,
          }}
        />
      ))}

      {/* Title */}
      <motion.div
        initial={{ y: -20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.1 }}
        style={{
          fontSize: 12, fontWeight: 800,
          letterSpacing: 4, color: C.yellow,
          textTransform: "uppercase",
        }}
      >
        Lesson Complete
      </motion.div>
      <motion.div
        initial={{ y: -10, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.2 }}
        style={{
          fontSize: 28, fontWeight: 900, color: "white",
          marginTop: 6, marginBottom: 36, textAlign: "center",
        }}
      >
        {isPathComplete ? "Path Complete!" : "Unlocking next lesson…"}
      </motion.div>

      {/* Mini path: done node → connecting line → locked-then-unlocked node */}
      <div style={{ display: "flex", alignItems: "center", gap: 0, marginBottom: 28 }}>
        {/* Completed node */}
        <motion.div
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.25, type: "spring", bounce: 0.5 }}
          style={{
            width: 64, height: 64, borderRadius: 32,
            background: `linear-gradient(135deg, ${C.teal}, ${C.echoDark})`,
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: `0 0 30px rgba(93,202,165,0.55)`,
            flexShrink: 0,
          }}
        >
          <Check size={28} color="white" strokeWidth={3} />
        </motion.div>

        {/* Connecting line w/ traveling glow */}
        <div style={{ position: "relative", width: 70, height: 6, marginInline: 4 }}>
          <motion.div
            initial={{ scaleX: 0, originX: 0 }}
            animate={{ scaleX: 1 }}
            transition={{ delay: 0.5, duration: 0.45, ease: "easeOut" }}
            style={{
              position: "absolute", inset: 0, borderRadius: 3,
              background: `linear-gradient(90deg, ${C.teal}, ${C.yellow})`,
              boxShadow: `0 0 16px ${C.yellow}`,
            }}
          />
          <motion.div
            initial={{ x: 0, opacity: 0 }}
            animate={{ x: 64, opacity: [0, 1, 1, 0] }}
            transition={{ delay: 0.55, duration: 0.55, ease: "easeInOut" }}
            style={{
              position: "absolute", top: -4, left: 0,
              width: 14, height: 14, borderRadius: 7,
              background: "white",
              boxShadow: `0 0 18px ${C.yellow}`,
            }}
          />
        </div>

        {/* Lock / Unlock target node */}
        <motion.div
          animate={
            phase === "shake"
              ? { x: [0, -4, 4, -4, 4, 0], rotate: [0, -3, 3, -3, 3, 0] }
              : { x: 0, rotate: 0 }
          }
          transition={{ duration: 0.55, repeat: phase === "shake" ? 1 : 0 }}
          style={{ position: "relative", width: 80, height: 80, flexShrink: 0 }}
        >
          {/* Background ring — gray when locked, gradient when unlocked */}
          <motion.div
            animate={{
              background: phase === "revealed" || phase === "burst"
                ? (nextIsBoss
                  ? `linear-gradient(135deg, ${C.amber}, ${C.primary})`
                  : `linear-gradient(135deg, ${C.primary}, ${C.primaryDark})`)
                : "#3A2D5F",
              boxShadow: phase === "revealed"
                ? `0 0 40px ${nextIsBoss ? C.amber : C.primary}, 0 0 80px ${nextIsBoss ? C.amber : C.primary}66`
                : "0 0 0px rgba(0,0,0,0)",
            }}
            transition={{ duration: 0.4 }}
            style={{
              position: "absolute", inset: 0,
              borderRadius: 40,
              border: phase === "revealed" ? "3px solid white" : "3px solid rgba(255,255,255,0.15)",
            }}
          />

          {/* Lock icon — visible until burst */}
          <motion.div
            animate={
              phase === "burst" || phase === "revealed"
                ? { scale: 0, opacity: 0, rotate: 25 }
                : { scale: 1, opacity: 1, rotate: 0 }
            }
            transition={{ duration: 0.25, ease: "easeIn" }}
            style={{
              position: "absolute", inset: 0,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            <Lock size={34} color="rgba(255,255,255,0.85)" strokeWidth={2.5} />
          </motion.div>

          {/* Particle burst on break */}
          {(phase === "burst" || phase === "revealed") && particles.map(p => (
            <motion.div
              key={p.id}
              initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
              animate={{ x: p.dx, y: p.dy, opacity: 0, scale: 0.3 }}
              transition={{ duration: 0.7, delay: p.delay, ease: "easeOut" }}
              style={{
                position: "absolute", top: "50%", left: "50%",
                marginTop: -p.size / 2, marginLeft: -p.size / 2,
                width: p.size, height: p.size, borderRadius: p.size,
                background: p.color,
                boxShadow: `0 0 8px ${p.color}`,
              }}
            />
          ))}

          {/* Revealed next-lesson icon */}
          {phase === "revealed" && (
            <motion.div
              initial={{ scale: 0, rotate: -180 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: "spring", bounce: 0.55, duration: 0.7 }}
              style={{
                position: "absolute", inset: 0,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}
            >
              {isPathComplete
                ? <Trophy size={36} color="white" />
                : nextIsBoss
                  ? <Star size={36} color="white" fill={C.yellow} />
                  : <span style={{ fontSize: 32 }}>📖</span>}
            </motion.div>
          )}

          {/* Sparkle burst around node on reveal */}
          {phase === "revealed" && sparkles.map(s => (
            <motion.div
              key={`sp-${s.id}`}
              initial={{ opacity: 0, scale: 0 }}
              animate={{ opacity: [0, 1, 0], scale: [0, 1, 0.6], rotate: 180 }}
              transition={{ duration: 0.9, delay: s.delay }}
              style={{
                position: "absolute",
                top: `calc(50% + ${s.y}px)`, left: `calc(50% + ${s.x}px)`,
                marginTop: -s.size / 2, marginLeft: -s.size / 2,
                pointerEvents: "none",
              }}
            >
              <Sparkles size={s.size} color={C.yellow} fill={C.yellow} />
            </motion.div>
          ))}
        </motion.div>
      </div>

      {/* "Next lesson unlocked" reveal text */}
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{
          opacity: phase === "revealed" ? 1 : 0,
          y: phase === "revealed" ? 0 : 14,
        }}
        transition={{ duration: 0.4 }}
        style={{ textAlign: "center", marginBottom: 24, minHeight: 64 }}
      >
        <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 3, color: C.yellow, textTransform: "uppercase" }}>
          {isPathComplete ? "You finished the path!" : "New lesson unlocked"}
        </div>
        <div style={{ fontSize: 22, fontWeight: 900, color: "white", marginTop: 6 }}>
          {isPathComplete ? "Amazing!" : nextDef?.label}
        </div>
        {!isPathComplete && nextDef?.sub && (
          <div style={{ fontSize: 13, color: "rgba(255,255,255,0.65)", marginTop: 4 }}>
            {nextDef.sub}
          </div>
        )}
      </motion.div>

      {/* Continue button */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{
          opacity: phase === "revealed" ? 1 : 0,
          y: phase === "revealed" ? 0 : 20,
        }}
        transition={{ delay: phase === "revealed" ? 0.25 : 0, duration: 0.4 }}
        style={{ width: "100%", maxWidth: 320 }}
      >
        <motion.button
          whileTap={{ scale: 0.96 }}
          onClick={onContinue}
          disabled={phase !== "revealed"}
          style={{
            width: "100%", padding: "16px 24px",
            borderRadius: 18, border: "none",
            background: `linear-gradient(135deg, ${C.yellow}, ${C.amber})`,
            color: C.ink, fontWeight: 800, fontSize: 17,
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            boxShadow: `0 10px 30px rgba(255,204,0,0.35)`,
            cursor: phase === "revealed" ? "pointer" : "default",
            fontFamily: uiFont,
          }}
        >
          {isPathComplete ? "Back to Path" : "Continue"}
          <ArrowRight size={20} />
        </motion.button>
      </motion.div>
    </motion.div>
  );
}

// ─── Win Screen ───────────────────────────────────────────────────────────────
function WinScreen({ onDone, variant = "small", lesson, comboMax }: { onDone: () => void; variant?: WinVariant; lesson?: LessonData; comboMax?: number }) {
  const completeLesson = useStore(s => s.completeLesson);
  const [result, setResult] = useState<LessonResult | null>(null);
  const [showXP, setShowXP] = useState(false);
  const [showUnlock, setShowUnlock] = useState(false);

  // Fire once on mount — record completion + capture level/shield result
  const firedRef = useRef(false);
  useEffect(() => {
    if (firedRef.current) return;
    firedRef.current = true;
    if (lesson) {
      const r = completeLesson(lesson.id, lesson.xpReward);
      setResult(r);
    }
    const t = setTimeout(() => setShowXP(true), 400);
    return () => clearTimeout(t);
  }, [completeLesson, lesson]);

  const confettiColors = [C.primary, C.teal, C.amber, C.blush, C.yellow, C.sky, C.lexi];
  const confettiItems = Array.from({ length: 28 }, (_, i) => ({
    color: confettiColors[i % confettiColors.length],
    x: Math.random() * 360 + 15,
    delay: Math.random() * 0.5,
    size: Math.random() * 10 + 6,
    rotate: Math.random() * 360,
  }));
  const xpReward = lesson?.xpReward ?? 15;
  // Promote to level variant if the lesson triggered a real level jump
  const effectiveVariant: WinVariant = result?.levelUp ? "level" : variant;
  const variantData = {
    small: { title: "Awesome!", sub: "You completed the lesson!", xp: xpReward },
    streak: { title: `${result?.newStreak ?? 7}-Day Streak!`, sub: "You're on fire! Amazing dedication!", xp: 30 },
    level: { title: `Level ${result?.newLevel ?? 2}!`, sub: `You've mastered ${lesson?.phoneme ?? "it"}!`, xp: xpReward + 10 },
  };
  const { title, sub, xp } = variantData[effectiveVariant];
  const mascotPose = effectiveVariant === "level" ? "levelUp" : "celebrating";
  return (
    <div
      className="flex flex-col items-center justify-between h-full px-8 py-12"
      style={{
        fontFamily: uiFont,
        background: `linear-gradient(160deg, ${C.primarySoft} 0%, ${C.bg} 50%, ${C.tealSoft} 100%)`,
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Confetti */}
      {confettiItems.map((c, i) => (
        <motion.div
          key={i}
          initial={{ y: -20, opacity: 0, rotate: 0 }}
          animate={{ y: 900, opacity: [0, 1, 1, 0], rotate: c.rotate + 360 }}
          transition={{ duration: 2.5 + Math.random(), delay: c.delay, ease: "linear" }}
          style={{
            position: "absolute",
            top: 0, left: c.x,
            width: c.size, height: c.size * 0.5,
            borderRadius: 2,
            background: c.color,
          }}
        />
      ))}
      <XPBurst xp={xp} show={showXP} />
      <div />
      <div className="flex flex-col items-center gap-5 z-10">
        {/* Shield-saved toast */}
        {result?.shieldUsed && (
          <motion.div
            initial={{ y: -20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.2, type: "spring" }}
            style={{
              background: `linear-gradient(135deg, ${C.amber}, #E8772E)`,
              borderRadius: 16, padding: "10px 18px",
              display: "flex", alignItems: "center", gap: 10,
              boxShadow: "0 6px 18px rgba(244,162,97,0.35)",
            }}
          >
            <Shield size={18} color="white" />
            <span style={{ color: "white", fontWeight: 700, fontSize: 13 }}>
              Your shield saved your streak!
            </span>
          </motion.div>
        )}
        {comboMax && comboMax >= 3 && (
          <motion.div
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.4, type: "spring" }}
            style={{
              background: C.tealSoft, borderRadius: 14, padding: "6px 14px",
              fontSize: 12, fontWeight: 700, color: C.teal,
            }}
          >
            🔥 Best combo: {comboMax} in a row
          </motion.div>
        )}
        <motion.div
          animate={effectiveVariant === "level"
            ? { scale: [1, 1.15, 1], rotate: [-5, 5, -5, 0] }
            : { scale: [1, 1.08, 1], rotate: [-3, 3, -3, 0] }}
          transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
        >
          <Lexi size={effectiveVariant === "level" ? 160 : 140} pose={mascotPose} />
        </motion.div>
        <motion.div
          initial={{ scale: 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.3, type: "spring", bounce: 0.5 }}
          className="flex flex-col items-center gap-3 text-center"
        >
          <div style={{ fontSize: 40, fontWeight: 800, color: C.primary }}>{title}</div>
          <div style={{ fontSize: 16, color: C.muted }}>{sub}</div>
        </motion.div>
        {/* Stats row — real values from store */}
        <div className="flex gap-4">
          {[
            { icon: <Zap size={20} color={C.yellow} />, value: `+${xp} XP`, color: C.yellow },
            { icon: <StreakFlame days={result?.newStreak ?? 1} size={22} />, value: `${result?.newStreak ?? 1} day${(result?.newStreak ?? 1) === 1 ? "" : "s"}`, color: C.amber },
            { icon: <Star size={20} color={C.primary} fill={C.primary} />, value: `Lvl ${result?.newLevel ?? 1}`, color: C.primary },
          ].map(s => (
            <Card key={s.value} className="flex-1 p-3 flex flex-col items-center gap-1" style={{ background: "rgba(255,255,255,0.85)" }}>
              {s.icon}
              <div style={{ fontSize: 13, fontWeight: 700, color: s.color }}>{s.value}</div>
            </Card>
          ))}
        </div>
        {/* What you learned */}
        <motion.div
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.8, type: "spring" }}
          style={{ width: "100%", display: "flex", flexDirection: "column", gap: 10 }}
        >
          <div style={{
            background: `linear-gradient(135deg, ${C.teal}, ${C.echoDark})`,
            borderRadius: 20, padding: "12px 20px",
            display: "flex", alignItems: "center", gap: 10,
          }}>
            <Check size={18} color="white" />
            <div>
              <div style={{ color: "white", fontWeight: 700, fontSize: 14 }}>{lesson?.phoneme ?? "Lesson"} — Skill Unlocked! ✦</div>
              {lesson && !lesson.isBoss && (
                <div style={{ color: "rgba(255,255,255,0.8)", fontSize: 12, marginTop: 2 }}>
                  You can now read words like: {lesson.buildSlots.join(" · ")} sounds in "{lesson.word}"
                </div>
              )}
            </div>
          </div>
          {/* Share with teacher nudge */}
          <motion.div
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 1.2 }}
            style={{
              background: C.amberSoft, borderRadius: 16, padding: "10px 16px",
              display: "flex", alignItems: "center", gap: 10,
            }}
          >
            <span style={{ fontSize: 18 }}>📋</span>
            <div style={{ fontSize: 12, color: C.ink, lineHeight: 1.5 }}>
              <strong>For your teacher:</strong> Share your progress report from the Profile tab — great for IEP meetings!
            </div>
          </motion.div>
        </motion.div>
      </div>
      <PrimaryBtn onClick={() => setShowUnlock(true)} className="w-full text-xl z-10">
        Next <ArrowRight size={22} />
      </PrimaryBtn>
      {showUnlock && lesson && (
        <LessonUnlockOverlay currentLessonId={lesson.id} onContinue={onDone} />
      )}
    </div>
  );
}

// ─── Mini-Game: Flashcards ────────────────────────────────────────────────────
// Exposure / review game. Steps through 4 cards from the lesson's word pool.
// Each card: emoji + word + speaker (auto-plays cloned voice once). Buttons:
// "Show me 🤔" (replays audio) and "Got it! ✨" (advance).
//
// Accuracy tracking: each completed card counts as 1/1 (it's not a quiz; total
// elapsed time and attempts are the more meaningful signals). The aggregate
// accuracy in the store stays at 100% for this game — by design.
function FlashcardsGame({ lesson, onFinish, onCorrect }: {
  lesson: LessonData;
  onFinish: () => void;
  onCorrect?: () => void;
  onWrong?: () => void;
}) {
  const cards = useMemo(() => wordsForLesson(lesson).slice(0, 4), [lesson]);
  const [idx, setIdx] = useState(0);
  const card = cards[idx];
  const isLast = idx >= cards.length - 1;

  // Auto-play the word on each card change (cloned voice through tts service).
  useEffect(() => {
    if (!card) return;
    cancelTTS();
    const t = setTimeout(() => void playTTS(card.word, { rate: 0.9 }), 250);
    return () => { clearTimeout(t); cancelTTS(); };
  }, [card]);

  const advance = () => {
    onCorrect?.(); // 1/1 per card → 100% accuracy by design
    if (isLast) { onFinish(); return; }
    setIdx(i => i + 1);
  };
  const replay = () => { if (card) void playTTS(card.word, { rate: 0.85 }); };

  // wordsForLesson always returns ≥1 item, so `card` is guaranteed.
  // No defensive branch needed — keep hooks unconditional.

  return (
    <div className="flex flex-col items-center justify-between h-full px-6 pb-8 pt-2" style={{ fontFamily: uiFont }}>
      {/* Progress dots */}
      <div className="flex gap-2 mb-2">
        {cards.map((_, i) => (
          <div
            key={i}
            style={{
              width: i === idx ? 24 : 8, height: 8, borderRadius: 4,
              background: i <= idx ? C.glow : C.primarySoft,
              transition: "all 0.3s",
            }}
          />
        ))}
      </div>

      {/* Card */}
      <motion.div
        key={idx}
        initial={{ scale: 0.9, opacity: 0, y: 14 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        transition={{ type: "spring", bounce: 0.4 }}
        style={{
          width: "100%", maxWidth: 320,
          background: `linear-gradient(135deg, ${C.yellowSoft}, ${C.glow}55)`,
          borderRadius: 28, padding: "32px 24px 28px",
          textAlign: "center",
          boxShadow: `0 14px 36px rgba(255,209,102,0.35)`,
          border: `3px solid ${C.glow}`,
        }}
      >
        <div style={{ fontSize: 92, lineHeight: 1, marginBottom: 14 }}>{card.emoji}</div>
        <div style={{ fontSize: 44, fontWeight: 900, color: C.ink, letterSpacing: 1 }}>{card.word}</div>
        <motion.button
          whileTap={{ scale: 0.9 }}
          onClick={replay}
          style={{
            marginTop: 18, padding: "10px 18px", borderRadius: 24,
            background: "rgba(255,255,255,0.85)", border: "none",
            display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer",
            color: C.amber, fontWeight: 800, fontSize: 13,
            boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
          }}
        >
          <Volume2 size={16} /> Hear it again
        </motion.button>
      </motion.div>

      {/* Counter */}
      <div style={{ fontSize: 13, fontWeight: 700, color: C.muted }}>
        Card {idx + 1} of {cards.length}
      </div>

      {/* Action button */}
      <PrimaryBtn onClick={advance} className="w-full text-xl">
        {isLast ? "Finish" : "Got it! ✨"} <ArrowRight size={22} />
      </PrimaryBtn>
    </div>
  );
}

// ─── Mini-Game: Listen Up ─────────────────────────────────────────────────────
// "Hear a word, pick the match." 4 rounds. Each round:
//   1. Auto-play target word via cloned voice
//   2. Show 3 word+emoji choices (target + 2 distractors), positions shuffled
//   3. Tap → correct/wrong feedback → next round
function ListenUpGame({ lesson, onFinish, onCorrect, onWrong }: {
  lesson: LessonData;
  onFinish: () => void;
  onCorrect?: () => void;
  onWrong?: () => void;
}) {
  const ROUNDS = 4;

  const rounds = useMemo(() => {
    const pool = wordsForLesson(lesson);
    const targets = shuffleAndSlice(pool, ROUNDS); // unique target per round
    return targets.map((target) => {
      const distractors = pickDistractorWords(lesson.id, target.word, 2);
      const choices = [target, ...distractors].sort(() => Math.random() - 0.5);
      return { target, choices };
    });
  }, [lesson]);

  const [round, setRound] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [locked, setLocked] = useState(false); // prevents double-tap during feedback
  const current = rounds[round];

  // Auto-play target on round start
  useEffect(() => {
    if (!current) return;
    setPicked(null); setLocked(false);
    cancelTTS();
    const t = setTimeout(() => void playTTS(current.target.word, { rate: 0.9 }), 280);
    return () => { clearTimeout(t); cancelTTS(); };
  }, [round, current]);

  const replay = () => { if (current) void playTTS(current.target.word, { rate: 0.85 }); };

  const onChoose = (word: string) => {
    if (locked) return;
    setLocked(true);
    setPicked(word);
    const isRight = word === current.target.word;
    if (isRight) onCorrect?.(); else onWrong?.();
    setTimeout(() => {
      if (round + 1 >= ROUNDS) onFinish();
      else setRound(r => r + 1);
    }, 900);
  };

  if (!current) return null;

  return (
    <div className="flex flex-col items-center justify-between h-full px-6 pb-8 pt-2" style={{ fontFamily: uiFont }}>
      {/* Progress dots */}
      <div className="flex gap-2 mb-2">
        {rounds.map((_, i) => (
          <div
            key={i}
            style={{
              width: i === round ? 24 : 8, height: 8, borderRadius: 4,
              background: i <= round ? C.primary : C.primarySoft,
              transition: "all 0.3s",
            }}
          />
        ))}
      </div>

      {/* Listen button */}
      <motion.button
        whileTap={{ scale: 0.92 }}
        onClick={replay}
        style={{
          width: 130, height: 130, borderRadius: 65, border: "none",
          background: `linear-gradient(135deg, ${C.primary}, ${C.primaryDark})`,
          color: "white", cursor: "pointer",
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          gap: 4,
          boxShadow: `0 14px 36px rgba(108,71,255,0.45)`,
        }}
      >
        <Volume2 size={42} />
        <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: 1 }}>Tap to hear</div>
      </motion.button>

      <div style={{ fontSize: 15, fontWeight: 700, color: C.muted, textAlign: "center" }}>
        Which word did you hear?
      </div>

      {/* Choice tiles */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, width: "100%" }}>
        {current.choices.map((c) => {
          const isPicked = picked === c.word;
          const isCorrect = c.word === current.target.word;
          const showRight = picked !== null && isCorrect;
          const showWrong = isPicked && !isCorrect;
          return (
            <motion.button
              key={c.word}
              whileTap={{ scale: locked ? 1 : 0.93 }}
              animate={showWrong ? { x: [0, -6, 6, -6, 6, 0] } : {}}
              transition={{ duration: 0.4 }}
              onClick={() => onChoose(c.word)}
              disabled={locked}
              style={{
                background: showRight ? C.tealSoft : showWrong ? "#FFE0E0" : C.white,
                border: `3px solid ${showRight ? C.teal : showWrong ? "#E08080" : C.primarySoft}`,
                borderRadius: 18, padding: "14px 8px",
                cursor: locked ? "default" : "pointer",
                display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
                fontFamily: uiFont,
                transition: "background 0.2s, border 0.2s",
              }}
            >
              <div style={{ fontSize: 36, lineHeight: 1 }}>{c.emoji}</div>
              <div style={{ fontSize: 13, fontWeight: 800, color: C.ink }}>{c.word}</div>
            </motion.button>
          );
        })}
      </div>

      <div style={{ fontSize: 13, fontWeight: 700, color: C.muted }}>
        Round {round + 1} of {ROUNDS}
      </div>
    </div>
  );
}

// ─── Mini-Game: Fill the Blank ────────────────────────────────────────────────
// Word with the target phoneme replaced by an underline. Pick the right
// letter(s) from 3 chips. 4 rounds.
function FillBlankGame({ lesson, onFinish, onCorrect, onWrong }: {
  lesson: LessonData;
  onFinish: () => void;
  onCorrect?: () => void;
  onWrong?: () => void;
}) {
  const ROUNDS = 4;

  const rounds = useMemo(() => {
    const pool = wordsForLesson(lesson);
    // Prefer words that actually contain the phoneme so the masking is meaningful.
    const ph = lesson.phoneme.toLowerCase();
    const eligible = pool.filter(p => p.word.toLowerCase().includes(ph));
    const source = eligible.length ? eligible : pool;
    const targets = shuffleAndSlice(source, ROUNDS); // unique per round
    return targets.map((target) => {
      const { masked, missing } = maskWord(target.word, lesson.phoneme);
      const distractors = pickDistractorLetters(missing, 2);
      const choices = [missing.toLowerCase(), ...distractors].sort(() => Math.random() - 0.5);
      return { target, masked, missing: missing.toLowerCase(), choices };
    });
  }, [lesson]);

  const [round, setRound] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const current = rounds[round];

  // Auto-play the full target word on round start so the kid hears what they're solving for
  useEffect(() => {
    if (!current) return;
    setPicked(null); setLocked(false);
    cancelTTS();
    const t = setTimeout(() => void playTTS(current.target.word, { rate: 0.85 }), 280);
    return () => { clearTimeout(t); cancelTTS(); };
  }, [round, current]);

  const replay = () => { if (current) void playTTS(current.target.word, { rate: 0.8 }); };

  const onChoose = (letter: string) => {
    if (locked) return;
    setLocked(true);
    setPicked(letter);
    const isRight = letter === current.missing;
    if (isRight) onCorrect?.(); else onWrong?.();
    setTimeout(() => {
      if (round + 1 >= ROUNDS) onFinish();
      else setRound(r => r + 1);
    }, 950);
  };

  if (!current) return null;

  // Reveal the full word at the end of the round if they got it right
  const showFullWord = picked !== null && picked === current.missing;
  const displayed = showFullWord ? current.target.word : current.masked;

  return (
    <div className="flex flex-col items-center justify-between h-full px-6 pb-8 pt-2" style={{ fontFamily: uiFont }}>
      {/* Progress dots */}
      <div className="flex gap-2 mb-2">
        {rounds.map((_, i) => (
          <div
            key={i}
            style={{
              width: i === round ? 24 : 8, height: 8, borderRadius: 4,
              background: i <= round ? C.blush : C.primarySoft,
              transition: "all 0.3s",
            }}
          />
        ))}
      </div>

      {/* Emoji hint */}
      <div style={{ fontSize: 70, lineHeight: 1 }}>{current.target.emoji}</div>

      {/* Masked word + speaker */}
      <div className="flex flex-col items-center gap-3">
        <motion.div
          key={`${round}-${displayed}`}
          initial={{ scale: 0.9 }}
          animate={{ scale: 1 }}
          style={{
            fontSize: 52, fontWeight: 900, color: C.ink, letterSpacing: 6,
            fontFamily: dyslexicFont,
          }}
        >
          {[...displayed].map((ch, i) => (
            <span
              key={i}
              style={{
                color: ch === "_" ? C.blush : C.ink,
                borderBottom: ch === "_" ? `4px solid ${C.blush}` : "none",
                paddingBottom: ch === "_" ? 0 : 0,
                display: "inline-block",
                minWidth: ch === "_" ? 32 : undefined,
                textAlign: "center",
              }}
            >
              {ch === "_" ? " " : ch}
            </span>
          ))}
        </motion.div>
        <motion.button
          whileTap={{ scale: 0.92 }}
          onClick={replay}
          style={{
            padding: "8px 16px", borderRadius: 20, border: "none",
            background: C.blushSoft, color: C.blush,
            display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer",
            fontSize: 13, fontWeight: 800,
          }}
        >
          <Volume2 size={14} /> Hear the word
        </motion.button>
      </div>

      {/* Choice chips */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, width: "100%" }}>
        {current.choices.map((letter) => {
          const isPicked = picked === letter;
          const isCorrect = letter === current.missing;
          const showRight = picked !== null && isCorrect;
          const showWrong = isPicked && !isCorrect;
          return (
            <motion.button
              key={letter}
              whileTap={{ scale: locked ? 1 : 0.93 }}
              animate={showWrong ? { x: [0, -6, 6, -6, 6, 0] } : {}}
              transition={{ duration: 0.4 }}
              onClick={() => onChoose(letter)}
              disabled={locked}
              style={{
                background: showRight ? C.tealSoft : showWrong ? "#FFE0E0" : C.white,
                border: `3px solid ${showRight ? C.teal : showWrong ? "#E08080" : C.primarySoft}`,
                borderRadius: 18, padding: "18px 8px",
                cursor: locked ? "default" : "pointer",
                fontSize: 28, fontWeight: 900, color: C.ink,
                fontFamily: dyslexicFont,
                textTransform: "lowercase",
              }}
            >
              {letter}
            </motion.button>
          );
        })}
      </div>

      <div style={{ fontSize: 13, fontWeight: 700, color: C.muted }}>
        Round {round + 1} of {ROUNDS}
      </div>
    </div>
  );
}

// ─── Mini-Game: Photo Touch ───────────────────────────────────────────────────
// Visual-first matching. Big 2×2 emoji grid; voice says the target word; kid
// taps the matching image. 4 rounds. Tracks first-tap accuracy.
function PhotoTouchGame({ lesson, onFinish, onCorrect, onWrong }: {
  lesson: LessonData;
  onFinish: () => void;
  onCorrect?: () => void;
  onWrong?: () => void;
}) {
  const ROUNDS = 4;

  const rounds = useMemo(() => {
    const pool = wordsForLesson(lesson);
    const targets = shuffleAndSlice(pool, ROUNDS); // unique per round
    return targets.map((target) => {
      const distractors = pickDistractorWords(lesson.id, target.word, 3);
      const choices = [target, ...distractors].sort(() => Math.random() - 0.5);
      return { target, choices };
    });
  }, [lesson]);

  const [round, setRound] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const current = rounds[round];

  useEffect(() => {
    if (!current) return;
    setPicked(null); setLocked(false);
    cancelTTS();
    const t = setTimeout(() => void playTTS(current.target.word, { rate: 0.9 }), 280);
    return () => { clearTimeout(t); cancelTTS(); };
  }, [round, current]);

  const replay = () => { if (current) void playTTS(current.target.word, { rate: 0.85 }); };

  const onChoose = (word: string) => {
    if (locked) return;
    setLocked(true);
    setPicked(word);
    const isRight = word === current.target.word;
    if (isRight) onCorrect?.(); else onWrong?.();
    setTimeout(() => {
      if (round + 1 >= ROUNDS) onFinish();
      else setRound(r => r + 1);
    }, 950);
  };

  if (!current) return null;

  return (
    <div className="flex flex-col items-center justify-between h-full px-6 pb-8 pt-2" style={{ fontFamily: uiFont }}>
      {/* Progress dots */}
      <div className="flex gap-2 mb-2">
        {rounds.map((_, i) => (
          <div
            key={i}
            style={{
              width: i === round ? 24 : 8, height: 8, borderRadius: 4,
              background: i <= round ? C.teal : C.primarySoft,
              transition: "all 0.3s",
            }}
          />
        ))}
      </div>

      {/* Replay speaker */}
      <motion.button
        whileTap={{ scale: 0.92 }}
        onClick={replay}
        style={{
          width: 110, height: 110, borderRadius: 55, border: "none",
          background: `linear-gradient(135deg, ${C.teal}, ${C.echoDark})`,
          color: "white", cursor: "pointer",
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2,
          boxShadow: `0 14px 32px rgba(93,202,165,0.45)`,
        }}
      >
        <Volume2 size={38} />
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1 }}>Hear it</div>
      </motion.button>

      <div style={{ fontSize: 15, fontWeight: 700, color: C.muted, textAlign: "center" }}>
        Tap the picture you hear
      </div>

      {/* 2×2 photo grid */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, width: "100%" }}>
        {current.choices.map((c) => {
          const isPicked = picked === c.word;
          const isCorrect = c.word === current.target.word;
          const showRight = picked !== null && isCorrect;
          const showWrong = isPicked && !isCorrect;
          return (
            <motion.button
              key={c.word}
              whileTap={{ scale: locked ? 1 : 0.94 }}
              animate={showWrong ? { x: [0, -6, 6, -6, 6, 0] } : {}}
              transition={{ duration: 0.4 }}
              onClick={() => onChoose(c.word)}
              disabled={locked}
              style={{
                aspectRatio: "1 / 1",
                background: showRight ? C.tealSoft : showWrong ? "#FFE0E0" : C.white,
                border: `4px solid ${showRight ? C.teal : showWrong ? "#E08080" : C.primarySoft}`,
                borderRadius: 22,
                cursor: locked ? "default" : "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 64, lineHeight: 1,
                transition: "background 0.2s, border 0.2s",
                fontFamily: uiFont,
              }}
            >
              {c.emoji}
            </motion.button>
          );
        })}
      </div>

      <div style={{ fontSize: 13, fontWeight: 700, color: C.muted }}>
        Round {round + 1} of {ROUNDS}
      </div>
    </div>
  );
}

// ─── Mini-Game: Sound Match ───────────────────────────────────────────────────
// Hear an isolated phoneme (IPA-tagged for crisp playback), tap each word
// that starts with that sound. 3 rounds × 4 words each.
function SoundMatchGame({ lesson, onFinish, onCorrect, onWrong }: {
  lesson: LessonData;
  onFinish: () => void;
  onCorrect?: () => void;
  onWrong?: () => void;
}) {
  const ROUNDS = 3;

  const rounds = useMemo(() => {
    const phoneme = lesson.phoneme.toLowerCase();
    const samePool = (WORD_POOLS[lesson.id] ?? wordsForLesson(lesson));
    const matchCandidates = samePool.filter(w => w.word.toLowerCase().startsWith(phoneme));
    // Fallback to "contains" if not enough start-position matches
    const matchFallback = samePool.filter(w => w.word.toLowerCase().includes(phoneme));
    const matchPool = matchCandidates.length >= 2 ? matchCandidates : matchFallback;
    const distractorPool = Object.values(WORD_POOLS)
      .flat()
      .filter(w => !w.word.toLowerCase().includes(phoneme));

    // Pre-shuffle decks so words don't repeat across rounds within a session.
    // We pull 2 matches + 2 distractors per round → need ROUNDS*2 of each.
    const matchDeck = shuffleAndSlice(matchPool, ROUNDS * 2);
    const distractorDeck = shuffleAndSlice(distractorPool, ROUNDS * 2);

    return Array.from({ length: ROUNDS }, (_, i) => {
      const matches = matchDeck.slice(i * 2, i * 2 + 2);
      const distractors = distractorDeck.slice(i * 2, i * 2 + 2);
      const choices = [...matches, ...distractors].sort(() => Math.random() - 0.5);
      const matchSet = new Set(matches.map(m => m.word));
      return { choices, matchSet };
    });
  }, [lesson]);

  const [round, setRound] = useState(0);
  const [taps, setTaps] = useState<Map<string, "right" | "wrong">>(new Map());
  const [advancing, setAdvancing] = useState(false);
  const current = rounds[round];

  // Auto-play the target phoneme on round start. Uses the existing
  // PHONEME_MAP-backed speakPhoneme() helper which sends sustained letter
  // spellings (e.g. "Sssssss") that ElevenLabs reliably renders as the
  // actual sound — far more dependable than inline IPA phoneme tags.
  useEffect(() => {
    if (!current) return;
    setTaps(new Map());
    setAdvancing(false);
    cancelTTS();
    const t = setTimeout(() => speakPhoneme(lesson.phoneme), 320);
    return () => { clearTimeout(t); cancelTTS(); };
  }, [round, current, lesson.phoneme]);

  const replay = () => speakPhoneme(lesson.phoneme);

  const onTap = (word: string) => {
    if (advancing) return;
    if (taps.has(word)) return;
    const isMatch = current.matchSet.has(word);
    const next = new Map(taps);
    next.set(word, isMatch ? "right" : "wrong");
    setTaps(next);
    if (isMatch) onCorrect?.();
    else onWrong?.();
    // Also speak the word the kid tapped, briefly, so they hear the
    // attempted match (helps learning regardless of right/wrong).
    void playTTS(word, { rate: 0.9 });

    // Advance once they've found both correct matches
    const foundAllRight = [...next.entries()].filter(([, r]) => r === "right").length >= current.matchSet.size;
    if (foundAllRight) {
      setAdvancing(true);
      setTimeout(() => {
        if (round + 1 >= ROUNDS) onFinish();
        else setRound(r => r + 1);
      }, 1100);
    }
  };

  if (!current) return null;

  const matchesFound = [...taps.entries()].filter(([, r]) => r === "right").length;
  const totalMatches = current.matchSet.size;

  return (
    <div className="flex flex-col items-center justify-between h-full px-6 pb-8 pt-2" style={{ fontFamily: uiFont }}>
      {/* Progress dots */}
      <div className="flex gap-2 mb-2">
        {rounds.map((_, i) => (
          <div
            key={i}
            style={{
              width: i === round ? 24 : 8, height: 8, borderRadius: 4,
              background: i <= round ? C.amber : C.primarySoft,
              transition: "all 0.3s",
            }}
          />
        ))}
      </div>

      {/* Phoneme target — big speaker tile */}
      <motion.button
        whileTap={{ scale: 0.94 }}
        onClick={replay}
        style={{
          minWidth: 150, padding: "16px 28px", borderRadius: 30, border: "none",
          background: `linear-gradient(135deg, ${C.amber}, #E8772E)`,
          color: "white", cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center", gap: 14,
          boxShadow: `0 14px 36px rgba(244,162,97,0.45)`,
        }}
      >
        <Volume2 size={28} />
        <div style={{ fontSize: 36, fontWeight: 900, letterSpacing: 2, fontFamily: dyslexicFont }}>
          {lesson.phoneme}
        </div>
      </motion.button>

      <div style={{ fontSize: 15, fontWeight: 700, color: C.muted, textAlign: "center" }}>
        Tap every word that starts with <strong style={{ color: C.amber }}>{lesson.phoneme}</strong>
      </div>

      {/* 2×2 word grid */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, width: "100%" }}>
        {current.choices.map((c) => {
          const result = taps.get(c.word);
          return (
            <motion.button
              key={c.word}
              whileTap={{ scale: !result ? 0.93 : 1 }}
              animate={result === "wrong" ? { x: [0, -6, 6, -6, 6, 0] } : {}}
              transition={{ duration: 0.4 }}
              onClick={() => onTap(c.word)}
              disabled={!!result}
              style={{
                position: "relative",
                background: result === "right" ? C.tealSoft : result === "wrong" ? "#FFE0E0" : C.white,
                border: `3px solid ${result === "right" ? C.teal : result === "wrong" ? "#E08080" : C.primarySoft}`,
                borderRadius: 18, padding: "14px 10px",
                cursor: result ? "default" : "pointer",
                display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
                fontFamily: uiFont,
                transition: "background 0.2s, border 0.2s",
              }}
            >
              <div style={{ fontSize: 36, lineHeight: 1 }}>{c.emoji}</div>
              <div style={{ fontSize: 14, fontWeight: 800, color: C.ink }}>{c.word}</div>
              {result === "right" && (
                <div style={{ position: "absolute", top: 6, right: 6 }}>
                  <Check size={16} color={C.teal} strokeWidth={3} />
                </div>
              )}
            </motion.button>
          );
        })}
      </div>

      <div style={{ fontSize: 13, fontWeight: 700, color: C.muted }}>
        Round {round + 1} of {ROUNDS} · Found {matchesFound}/{totalMatches}
      </div>
    </div>
  );
}

// ─── Mini-Game: Memory Cards ──────────────────────────────────────────────────
// Classic concentration. 8 cards = 4 pairs. Each pair: an emoji card and a
// word card for the same word. Reveal two; if matched they stay up and the
// cloned voice says the word. After all 4 pairs found → finish. Each "try"
// (pair of taps) is one attempt; matched pair = 1 correct.
function MemoryCardsGame({ lesson, onFinish, onCorrect, onWrong }: {
  lesson: LessonData;
  onFinish: () => void;
  onCorrect?: () => void;
  onWrong?: () => void;
}) {
  const PAIR_COUNT = 4;

  type Card = { id: number; word: string; emoji: string; face: "emoji" | "word" };
  const cards = useMemo<Card[]>(() => {
    const pool = wordsForLesson(lesson);
    // Pick up to PAIR_COUNT distinct words; if pool is too small, allow repeats.
    const chosen: { word: string; emoji: string }[] = [];
    const seen = new Set<string>();
    for (let i = 0; chosen.length < PAIR_COUNT && i < pool.length * 3; i++) {
      const w = pool[i % pool.length];
      if (!seen.has(w.word)) { seen.add(w.word); chosen.push(w); }
    }
    while (chosen.length < PAIR_COUNT) chosen.push(pool[0]); // hard fallback
    const built: Card[] = [];
    chosen.forEach((w, i) => {
      built.push({ id: i * 2,     word: w.word, emoji: w.emoji, face: "emoji" });
      built.push({ id: i * 2 + 1, word: w.word, emoji: w.emoji, face: "word"  });
    });
    return built.sort(() => Math.random() - 0.5);
  }, [lesson]);

  const [revealed, setRevealed] = useState<Set<number>>(new Set()); // currently-flipped (max 2)
  const [matched, setMatched] = useState<Set<number>>(new Set());   // permanently matched
  const [locked, setLocked] = useState(false);

  const tap = (card: Card) => {
    if (locked) return;
    if (revealed.has(card.id)) return;
    if (matched.has(card.id)) return;
    const next = new Set(revealed);
    next.add(card.id);
    setRevealed(next);
    // Speak the word whenever a card is revealed (great for the word-card too)
    void playTTS(card.word, { rate: 0.9 });
    if (next.size === 2) {
      setLocked(true);
      const [aId, bId] = [...next];
      const a = cards.find(c => c.id === aId)!;
      const b = cards.find(c => c.id === bId)!;
      if (a.word === b.word) {
        // Match!
        setTimeout(() => {
          setMatched(m => { const n = new Set(m); n.add(aId); n.add(bId); return n; });
          setRevealed(new Set());
          setLocked(false);
          onCorrect?.();
          // If that was the last pair → finish
          if (matched.size + 2 >= cards.length) {
            setTimeout(onFinish, 600);
          }
        }, 700);
      } else {
        // No match — flip back
        onWrong?.();
        setTimeout(() => {
          setRevealed(new Set());
          setLocked(false);
        }, 1100);
      }
    }
  };

  const pairsFound = matched.size / 2;

  return (
    <div className="flex flex-col items-center justify-between h-full px-6 pb-8 pt-2" style={{ fontFamily: uiFont }}>
      {/* Header */}
      <div className="flex flex-col items-center gap-1">
        <div style={{ fontSize: 13, fontWeight: 800, color: C.muted, letterSpacing: 2, textTransform: "uppercase" }}>
          Memory Cards
        </div>
        <div style={{ fontSize: 15, fontWeight: 700, color: C.ink }}>
          Match each word to its picture
        </div>
      </div>

      {/* 4×2 card grid */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8, width: "100%" }}>
        {cards.map((c) => {
          const isUp = revealed.has(c.id) || matched.has(c.id);
          const isMatched = matched.has(c.id);
          return (
            <motion.button
              key={c.id}
              whileTap={{ scale: !isUp && !locked ? 0.93 : 1 }}
              onClick={() => tap(c)}
              style={{
                aspectRatio: "1 / 1.15",
                background: isUp
                  ? isMatched ? C.tealSoft : C.white
                  : `linear-gradient(135deg, ${C.primary}, ${C.primaryDark})`,
                border: isUp
                  ? `3px solid ${isMatched ? C.teal : C.primary}`
                  : "3px solid transparent",
                borderRadius: 14, padding: 4,
                cursor: !isUp && !locked ? "pointer" : "default",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontFamily: uiFont,
                color: isUp ? C.ink : "white",
                fontSize: c.face === "emoji" ? 28 : 13,
                fontWeight: 800,
                textAlign: "center",
                lineHeight: 1.05,
                transition: "background 0.25s, border 0.25s",
                boxShadow: isUp ? "0 4px 12px rgba(0,0,0,0.08)" : `0 4px 10px rgba(108,71,255,0.25)`,
                wordBreak: "break-word",
              }}
            >
              {isUp ? (c.face === "emoji" ? c.emoji : c.word) : "?"}
            </motion.button>
          );
        })}
      </div>

      <div style={{ fontSize: 13, fontWeight: 700, color: C.muted }}>
        {pairsFound} of {PAIR_COUNT} pairs found
      </div>
    </div>
  );
}

// ─── Mini-Game: True or False ────────────────────────────────────────────────
// Show a big emoji + a word label. Half the time the word matches the emoji;
// half the time it's the wrong word from another pool. Kid taps ✓ or ✗.
// 4 rounds. Track first-tap accuracy.
function TrueOrFalseGame({ lesson, onFinish, onCorrect, onWrong }: {
  lesson: LessonData;
  onFinish: () => void;
  onCorrect?: () => void;
  onWrong?: () => void;
}) {
  const ROUNDS = 4;

  const rounds = useMemo(() => {
    const pool = wordsForLesson(lesson);
    const targets = shuffleAndSlice(pool, ROUNDS);
    return targets.map((target, i) => {
      // Alternate: half true, half false, but randomize order
      const shouldBeTrue = ((i + Math.floor(Math.random() * 2)) % 2) === 0;
      if (shouldBeTrue) {
        return { emoji: target.emoji, label: target.word, isTrue: true };
      }
      // false: show this emoji but with a wrong word label from another pool
      const wrong = pickDistractorWords(lesson.id, target.word, 1)[0];
      return { emoji: target.emoji, label: wrong?.word ?? target.word, isTrue: false };
    });
  }, [lesson]);

  const [round, setRound] = useState(0);
  const [picked, setPicked] = useState<"true" | "false" | null>(null);
  const [locked, setLocked] = useState(false);
  const current = rounds[round];

  useEffect(() => {
    if (!current) return;
    setPicked(null); setLocked(false);
    cancelTTS();
    // Auto-play the LABEL (what the screen claims it is)
    const t = setTimeout(() => void playTTS(current.label, { rate: 0.9 }), 280);
    return () => { clearTimeout(t); cancelTTS(); };
  }, [round, current]);

  const replay = () => { if (current) void playTTS(current.label, { rate: 0.85 }); };

  const onChoose = (choice: "true" | "false") => {
    if (locked) return;
    setLocked(true);
    setPicked(choice);
    const isRight = (choice === "true") === current.isTrue;
    if (isRight) onCorrect?.(); else onWrong?.();
    setTimeout(() => {
      if (round + 1 >= ROUNDS) onFinish();
      else setRound(r => r + 1);
    }, 950);
  };

  if (!current) return null;

  return (
    <div className="flex flex-col items-center justify-between h-full px-6 pb-8 pt-2" style={{ fontFamily: uiFont }}>
      {/* Progress dots */}
      <div className="flex gap-2 mb-2">
        {rounds.map((_, i) => (
          <div
            key={i}
            style={{
              width: i === round ? 24 : 8, height: 8, borderRadius: 4,
              background: i <= round ? "#5DCAA5" : C.primarySoft,
              transition: "all 0.3s",
            }}
          />
        ))}
      </div>

      {/* The card under test */}
      <div className="flex flex-col items-center gap-3">
        <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, letterSpacing: 2, textTransform: "uppercase" }}>
          Is this true?
        </div>
        <motion.div
          key={round}
          initial={{ scale: 0.85, opacity: 0, y: 14 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          transition={{ type: "spring", bounce: 0.4 }}
          style={{
            width: 240, padding: "26px 18px",
            background: `linear-gradient(135deg, ${C.white}, ${C.primarySoft})`,
            borderRadius: 24,
            border: `3px solid ${C.primarySoft}`,
            boxShadow: "0 14px 36px rgba(108,71,255,0.18)",
            display: "flex", flexDirection: "column", alignItems: "center", gap: 10,
          }}
        >
          <div style={{ fontSize: 90, lineHeight: 1 }}>{current.emoji}</div>
          <div style={{ fontSize: 32, fontWeight: 900, color: C.ink, letterSpacing: 1, fontFamily: dyslexicFont }}>
            {current.label}
          </div>
        </motion.div>
        <motion.button
          whileTap={{ scale: 0.92 }}
          onClick={replay}
          style={{
            padding: "8px 16px", borderRadius: 20, border: "none",
            background: C.primarySoft, color: C.primary,
            display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer",
            fontSize: 13, fontWeight: 800,
          }}
        >
          <Volume2 size={14} /> Hear word
        </motion.button>
      </div>

      {/* True / False buttons */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, width: "100%" }}>
        {(["true", "false"] as const).map(choice => {
          const isPicked = picked === choice;
          const wasRight = picked !== null && ((picked === "true") === current.isTrue);
          const showResult = isPicked && (wasRight ? "right" : "wrong");
          const baseColor = choice === "true" ? "#5DCAA5" : "#E08080";
          return (
            <motion.button
              key={choice}
              whileTap={{ scale: locked ? 1 : 0.94 }}
              animate={showResult === "wrong" ? { x: [0, -6, 6, -6, 6, 0] } : {}}
              transition={{ duration: 0.4 }}
              onClick={() => onChoose(choice)}
              disabled={locked}
              style={{
                padding: "20px 8px",
                borderRadius: 22, border: "none",
                background: showResult === "right" ? baseColor
                          : showResult === "wrong" ? "#E08080"
                          : choice === "true" ? `linear-gradient(135deg, #5DCAA5, #3DB88A)`
                                              : `linear-gradient(135deg, #F88282, #D85555)`,
                color: "white",
                cursor: locked ? "default" : "pointer",
                display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
                fontFamily: uiFont,
                boxShadow: `0 8px 22px ${choice === "true" ? "rgba(93,202,165,0.4)" : "rgba(232,128,128,0.4)"}`,
              }}
            >
              <div style={{ fontSize: 36, lineHeight: 1 }}>{choice === "true" ? "✓" : "✗"}</div>
              <div style={{ fontSize: 16, fontWeight: 900, letterSpacing: 1 }}>
                {choice === "true" ? "TRUE" : "FALSE"}
              </div>
            </motion.button>
          );
        })}
      </div>

      <div style={{ fontSize: 13, fontWeight: 700, color: C.muted }}>
        Round {round + 1} of {ROUNDS}
      </div>
    </div>
  );
}

// ─── Mini-Game: Spelling Bee ─────────────────────────────────────────────────
// Hear a word, tap the right letters in order to spell it. Wrong letters
// shake and don't fill the slot. 3 rounds.
function SpellingBeeGame({ lesson, onFinish, onCorrect, onWrong }: {
  lesson: LessonData;
  onFinish: () => void;
  onCorrect?: () => void;
  onWrong?: () => void;
}) {
  const ROUNDS = 3;

  const rounds = useMemo(() => {
    const pool = wordsForLesson(lesson);
    const targets = shuffleAndSlice(pool, ROUNDS);
    return targets.map((target) => {
      const letters = target.word.toLowerCase().split("");
      // Tile bank: unique letters from the word + 2 distractors, shuffled
      const unique = Array.from(new Set(letters));
      const distractors = pickDistractorLetters(letters[0], 2).map(d => d[0]);
      const bank = [...unique, ...distractors].sort(() => Math.random() - 0.5);
      return { target, letters, bank };
    });
  }, [lesson]);

  const [round, setRound] = useState(0);
  const [pos, setPos] = useState(0);
  const [shake, setShake] = useState(false);
  const [advancing, setAdvancing] = useState(false);
  const current = rounds[round];

  useEffect(() => {
    if (!current) return;
    setPos(0); setShake(false); setAdvancing(false);
    cancelTTS();
    const t = setTimeout(() => void playTTS(current.target.word, { rate: 0.85 }), 280);
    return () => { clearTimeout(t); cancelTTS(); };
  }, [round, current]);

  const replay = () => { if (current) void playTTS(current.target.word, { rate: 0.8 }); };

  const tryLetter = (letter: string) => {
    if (advancing) return;
    const expected = current.letters[pos];
    if (letter.toLowerCase() === expected) {
      onCorrect?.();
      const nextPos = pos + 1;
      setPos(nextPos);
      if (nextPos >= current.letters.length) {
        // Word complete!
        setAdvancing(true);
        setTimeout(() => void playTTS(current.target.word, { rate: 0.9 }), 200);
        setTimeout(() => {
          if (round + 1 >= ROUNDS) onFinish();
          else setRound(r => r + 1);
        }, 1500);
      }
    } else {
      onWrong?.();
      setShake(true);
      setTimeout(() => setShake(false), 400);
    }
  };

  if (!current) return null;

  return (
    <div className="flex flex-col items-center justify-between h-full px-6 pb-8 pt-2" style={{ fontFamily: uiFont }}>
      {/* Progress dots */}
      <div className="flex gap-2 mb-2">
        {rounds.map((_, i) => (
          <div
            key={i}
            style={{
              width: i === round ? 24 : 8, height: 8, borderRadius: 4,
              background: i <= round ? C.amber : C.primarySoft,
              transition: "all 0.3s",
            }}
          />
        ))}
      </div>

      {/* Emoji hint + speaker */}
      <div className="flex flex-col items-center gap-3">
        <div style={{ fontSize: 70, lineHeight: 1 }}>{current.target.emoji}</div>
        <motion.button
          whileTap={{ scale: 0.92 }}
          onClick={replay}
          style={{
            padding: "10px 20px", borderRadius: 24, border: "none",
            background: `linear-gradient(135deg, ${C.amber}, #E8772E)`,
            color: "white", cursor: "pointer",
            display: "inline-flex", alignItems: "center", gap: 8,
            fontWeight: 800, fontSize: 14,
            boxShadow: `0 8px 22px rgba(244,162,97,0.4)`,
          }}
        >
          <Volume2 size={18} /> Hear it again
        </motion.button>
      </div>

      {/* Letter slots */}
      <motion.div
        animate={shake ? { x: [0, -8, 8, -8, 8, 0] } : {}}
        transition={{ duration: 0.4 }}
        style={{ display: "flex", gap: 6, justifyContent: "center", flexWrap: "wrap" }}
      >
        {current.letters.map((letter, i) => {
          const filled = i < pos;
          return (
            <div
              key={i}
              style={{
                minWidth: 38, height: 50,
                padding: "0 6px",
                borderRadius: 10,
                background: filled ? C.tealSoft : C.white,
                border: `3px solid ${i === pos ? C.amber : filled ? C.teal : C.primarySoft}`,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 26, fontWeight: 900,
                color: filled ? C.teal : C.muted,
                fontFamily: dyslexicFont,
                textTransform: "uppercase",
                transition: "all 0.2s",
              }}
            >
              {filled ? letter.toUpperCase() : ""}
            </div>
          );
        })}
      </motion.div>

      {/* Letter tile bank */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, width: "100%" }}>
        {current.bank.map((letter, i) => (
          <motion.button
            key={`${letter}-${i}`}
            whileTap={{ scale: advancing ? 1 : 0.92 }}
            onClick={() => tryLetter(letter)}
            disabled={advancing}
            style={{
              padding: "16px 4px",
              borderRadius: 14, border: "none",
              background: `linear-gradient(135deg, ${C.primary}, ${C.primaryDark})`,
              color: "white",
              fontSize: 24, fontWeight: 900,
              fontFamily: dyslexicFont, textTransform: "uppercase",
              cursor: advancing ? "default" : "pointer",
              boxShadow: `0 6px 16px rgba(108,71,255,0.3)`,
            }}
          >
            {letter}
          </motion.button>
        ))}
      </div>

      <div style={{ fontSize: 13, fontWeight: 700, color: C.muted }}>
        Round {round + 1} of {ROUNDS}
      </div>
    </div>
  );
}

// ─── Mini-Game: What's the Action? ────────────────────────────────────────────
// Visual → semantic game. Tailored for action words: shows a BIG silent
// emoji (no auto-audio) and asks the kid to identify the verb. Picks 4 word
// labels — the correct one + 3 verb distractors from the same lesson pool.
// Different from Photo Touch (which is audio-first); here the kid must
// recognize the meaning visually before tapping.
function WhatsTheActionGame({ lesson, onFinish, onCorrect, onWrong }: {
  lesson: LessonData;
  onFinish: () => void;
  onCorrect?: () => void;
  onWrong?: () => void;
}) {
  const ROUNDS = 4;

  const rounds = useMemo(() => {
    const pool = wordsForLesson(lesson);
    const targets = shuffleAndSlice(pool, ROUNDS);
    return targets.map((target) => {
      const distractors = pickDistractorWords(lesson.id, target.word, 3);
      const choices = [target, ...distractors].sort(() => Math.random() - 0.5);
      return { target, choices };
    });
  }, [lesson]);

  const [round, setRound] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const current = rounds[round];

  // Reset on round change but DO NOT auto-play audio (this is the differentiator)
  useEffect(() => {
    setPicked(null); setLocked(false);
    cancelTTS();
  }, [round]);

  const onChoose = (word: string) => {
    if (locked) return;
    setLocked(true);
    setPicked(word);
    const isRight = word === current.target.word;
    if (isRight) onCorrect?.(); else onWrong?.();
    // Play the chosen word (so kid hears their attempt)
    void playTTS(word, { rate: 0.9 });
    setTimeout(() => {
      if (round + 1 >= ROUNDS) onFinish();
      else setRound(r => r + 1);
    }, 1100);
  };

  if (!current) return null;

  return (
    <div className="flex flex-col items-center justify-between h-full px-6 pb-8 pt-2" style={{ fontFamily: uiFont }}>
      {/* Progress dots */}
      <div className="flex gap-2 mb-2">
        {rounds.map((_, i) => (
          <div
            key={i}
            style={{
              width: i === round ? 24 : 8, height: 8, borderRadius: 4,
              background: i <= round ? C.glow : C.primarySoft,
              transition: "all 0.3s",
            }}
          />
        ))}
      </div>

      <div style={{ fontSize: 13, fontWeight: 700, color: C.muted, letterSpacing: 2, textTransform: "uppercase" }}>
        What's happening?
      </div>

      {/* Big silent emoji — the visual question */}
      <motion.div
        key={round}
        initial={{ scale: 0.7, opacity: 0, y: 14 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        transition={{ type: "spring", bounce: 0.45 }}
        style={{
          fontSize: 140, lineHeight: 1,
          padding: 20, borderRadius: 32,
          background: `linear-gradient(135deg, ${C.yellowSoft}, ${C.glow}33)`,
          border: `3px solid ${C.glow}`,
        }}
      >
        {current.target.emoji}
      </motion.div>

      {/* Verb choices — 2×2 grid of word tiles */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, width: "100%" }}>
        {current.choices.map((c) => {
          const isPicked = picked === c.word;
          const isCorrect = c.word === current.target.word;
          const showRight = picked !== null && isCorrect;
          const showWrong = isPicked && !isCorrect;
          return (
            <motion.button
              key={c.word}
              whileTap={{ scale: locked ? 1 : 0.94 }}
              animate={showWrong ? { x: [0, -6, 6, -6, 6, 0] } : {}}
              transition={{ duration: 0.4 }}
              onClick={() => onChoose(c.word)}
              disabled={locked}
              style={{
                padding: "16px 12px",
                background: showRight ? C.tealSoft : showWrong ? "#FFE0E0" : C.white,
                border: `3px solid ${showRight ? C.teal : showWrong ? "#E08080" : C.primarySoft}`,
                borderRadius: 18,
                cursor: locked ? "default" : "pointer",
                fontFamily: uiFont,
                fontSize: 20, fontWeight: 800,
                color: C.ink,
                textTransform: "lowercase",
                transition: "background 0.2s, border 0.2s",
              }}
            >
              {c.word}
            </motion.button>
          );
        })}
      </div>

      <div style={{ fontSize: 13, fontWeight: 700, color: C.muted }}>
        Round {round + 1} of {ROUNDS}
      </div>
    </div>
  );
}

// ─── Games Grid Screen ────────────────────────────────────────────────────────
// Kid-facing "pick a game" surface for a single lesson. Every tile teaches the
// same target phoneme (the lesson's phoneme). Two tiles are wired to real
// games (Trace It, Word Builder); the rest are visible-but-locked "Coming
// Soon" tiles so the grid feels full and the roadmap is obvious.
//
// Internally manages three views:
//   "grid"    → tile grid + Finish Lesson CTA
//   "playing" → renders a single game with a back chevron
//   "win"     → existing WinScreen + LessonUnlockOverlay flow
type GameKey = "trace" | "build" | "flashcards" | "listen-up" | "fill-blank" | "photo-touch" | "sound-match" | "memory" | "true-false" | "spelling-bee" | "whats-action" | "word-sort" | "unscramble";

type GameTile = {
  key: GameKey;
  title: string;
  subtitle: string;
  emoji: string;
  gradient: [string, string];
  status: "active" | "coming";
};

function GamesGridScreen({ lessonId, onExit }: { lessonId: string; onExit: (lessonId: string) => void }) {
  const lesson = LESSONS[lessonId] ?? LESSONS["sh-sound"];

  // Local view state
  const [view, setView] = useState<"grid" | "playing" | "win">("grid");
  const [activeGame, setActiveGame] = useState<GameKey | null>(null);
  const [completed, setCompleted] = useState<Set<GameKey>>(new Set());
  const [comingSoonKey, setComingSoonKey] = useState<GameKey | null>(null);

  // Combo + adaptive signals — kept here so multiple games in one session
  // share the same combo counter. Mirrors LessonScreen's wiring.
  const [combo, setCombo] = useState(0);
  const [comboMax, setComboMax] = useState(0);
  const [comboKey, setComboKey] = useState(0);
  const recordHit = useStore(s => s.recordHit);
  const recordMiss = useStore(s => s.recordMiss);
  // Per-game-session tracking: correct/total/elapsed are recorded into the
  // store on game finish via recordGameStat (read-site: Profile screen card).
  const recordGameStat = useStore(s => s.recordGameStat);
  const sessionCorrectRef = useRef(0);
  const sessionTotalRef = useRef(0);
  const sessionStartRef = useRef(0);
  // Toast shown on the grid after a game finishes — quick visual confirmation
  // that tracking ran.
  const [lastResult, setLastResult] = useState<{ key: GameKey; correct: number; total: number; ms: number } | null>(null);

  const onCorrect = useCallback(() => {
    setCombo(c => {
      const n = c + 1;
      setComboMax(m => (n > m ? n : m));
      return n;
    });
    setComboKey(k => k + 1);
    sessionCorrectRef.current += 1;
    sessionTotalRef.current += 1;
    recordHit();
  }, [recordHit]);
  const onWrong = useCallback(() => {
    setCombo(0);
    sessionTotalRef.current += 1;
    recordMiss();
  }, [recordMiss]);

  // Tile catalog — order matters for the 2-column grid layout.
  // 10 active games + 2 placeholders (Word Sort, Unscramble = next slice).
  const tiles: GameTile[] = [
    { key: "trace",        title: "Trace It",       subtitle: "Write the letter",  emoji: "✍️", gradient: [C.glow,    C.glowDark],      status: "active" },
    { key: "build",        title: "Word Builder",   subtitle: "Build the word",    emoji: "🧱", gradient: [C.amber,   "#E8772E"],       status: "active" },
    { key: "flashcards",   title: "Flashcards",     subtitle: "See & say",         emoji: "🃏", gradient: ["#FFD166", "#F4A261"],       status: "active" },
    { key: "listen-up",    title: "Listen Up",      subtitle: "Hear & pick",       emoji: "👂", gradient: [C.primary, C.primaryDark],   status: "active" },
    { key: "fill-blank",   title: "Fill the Blank", subtitle: "Missing letter",    emoji: "🧩", gradient: [C.blush,   "#E8729B"],       status: "active" },
    { key: "photo-touch",  title: "Photo Touch",    subtitle: "Tap the picture",   emoji: "📸", gradient: [C.teal,    C.echoDark],      status: "active" },
    { key: "sound-match",  title: "Sound Match",    subtitle: "Find the sound",    emoji: "🔊", gradient: [C.amber,   "#D17A1E"],       status: "active" },
    { key: "memory",       title: "Memory Cards",   subtitle: "Match the pairs",   emoji: "🧠", gradient: ["#C4B0FF", C.primary],       status: "active" },
    { key: "true-false",   title: "True or False",  subtitle: "Real or wrong?",    emoji: "✅", gradient: ["#5DCAA5", "#3DB88A"],       status: "active" },
    { key: "spelling-bee", title: "Spelling Bee",   subtitle: "Spell the word",    emoji: "🐝", gradient: ["#F4A261", "#D17A1E"],       status: "active" },
    { key: "whats-action", title: "What's Happening?", subtitle: "Name the action",emoji: "🎬", gradient: [C.glow,    C.glowDark],      status: "active" },
    { key: "word-sort",    title: "Word Sort",      subtitle: "Sort the sounds",   emoji: "🗂️", gradient: [C.sky,     "#5092C7"],       status: "coming" },
    { key: "unscramble",   title: "Unscramble",     subtitle: "Fix the word",      emoji: "🔀", gradient: ["#A89BFF", "#7C6FE0"],       status: "coming" },
  ];

  const playableCount = tiles.filter(t => t.status === "active").length;
  const playedCount = [...completed].filter(k => tiles.find(t => t.key === k)?.status === "active").length;
  const allDone = playedCount >= playableCount;

  const openTile = (tile: GameTile) => {
    if (tile.status === "coming") {
      setComingSoonKey(tile.key);
      setTimeout(() => setComingSoonKey(prev => (prev === tile.key ? null : prev)), 1400);
      return;
    }
    // Reset per-session counters and start the timer
    sessionCorrectRef.current = 0;
    sessionTotalRef.current = 0;
    sessionStartRef.current = Date.now();
    setActiveGame(tile.key);
    setView("playing");
  };

  const finishGame = () => {
    if (activeGame) {
      const elapsedMs = Math.max(0, Date.now() - sessionStartRef.current);
      const correct = sessionCorrectRef.current;
      const total = sessionTotalRef.current;
      recordGameStat(activeGame, { correct, total, elapsedMs });
      setLastResult({ key: activeGame, correct, total, ms: elapsedMs });
      setCompleted(prev => {
        const n = new Set(prev);
        n.add(activeGame);
        return n;
      });
    }
    setActiveGame(null);
    setView("grid");
  };

  // ── Sub-view: playing a single game ───────────────────────────────────────
  if (view === "playing" && activeGame) {
    const tile = tiles.find(t => t.key === activeGame)!;
    return (
      <div className="flex flex-col h-full" style={{ background: C.bg, fontFamily: uiFont }}>
        <div className="flex items-center gap-3 px-5 pt-12 pb-4">
          <motion.button
            whileTap={{ scale: 0.88 }}
            onClick={() => { setActiveGame(null); setView("grid"); }}
            style={{
              width: 44, height: 44, borderRadius: 22,
              background: C.primarySoft,
              display: "flex", alignItems: "center", justifyContent: "center",
              border: "none", cursor: "pointer",
            }}
            aria-label="Back to games"
          >
            <ChevronLeft size={22} color={C.primary} />
          </motion.button>
          <div className="flex-1">
            <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, letterSpacing: 1.5, textTransform: "uppercase" }}>
              {lesson.phoneme} Sound
            </div>
            <div style={{ fontSize: 18, fontWeight: 800, color: C.ink, lineHeight: 1.1 }}>
              {tile.title}
            </div>
          </div>
        </div>
        {/* Combo chip — appears after 2+ correct answers in a row */}
        {combo >= 2 && (
          <div className="px-5 pb-2 flex justify-center" style={{ marginTop: -8 }}>
            <motion.div
              key={comboKey}
              initial={{ scale: 0.6, opacity: 0, y: -8 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              transition={{ type: "spring", stiffness: 380, damping: 18 }}
              style={{
                background: `linear-gradient(135deg, ${C.teal}, ${C.echoDark})`,
                color: "white", borderRadius: 14,
                padding: "5px 12px", fontSize: 12, fontWeight: 700,
                fontFamily: uiFont,
                boxShadow: "0 4px 12px rgba(93,202,165,0.35)",
                display: "flex", alignItems: "center", gap: 6,
              }}
            >
              🔥 {combo} in a row!
            </motion.div>
          </div>
        )}
        <div className="flex-1 overflow-hidden">
          {activeGame === "trace" && (
            <TraceItStep onNext={finishGame} lesson={lesson} />
          )}
          {activeGame === "build" && (
            <DndProvider backend={DndBackend} options={isTouch ? { enableMouseEvents: true } : undefined}>
              <BuildItStep onNext={finishGame} lesson={lesson} onCorrect={onCorrect} onWrong={onWrong} />
            </DndProvider>
          )}
          {activeGame === "flashcards" && (
            <FlashcardsGame lesson={lesson} onFinish={finishGame} onCorrect={onCorrect} onWrong={onWrong} />
          )}
          {activeGame === "listen-up" && (
            <ListenUpGame lesson={lesson} onFinish={finishGame} onCorrect={onCorrect} onWrong={onWrong} />
          )}
          {activeGame === "fill-blank" && (
            <FillBlankGame lesson={lesson} onFinish={finishGame} onCorrect={onCorrect} onWrong={onWrong} />
          )}
          {activeGame === "photo-touch" && (
            <PhotoTouchGame lesson={lesson} onFinish={finishGame} onCorrect={onCorrect} onWrong={onWrong} />
          )}
          {activeGame === "sound-match" && (
            <SoundMatchGame lesson={lesson} onFinish={finishGame} onCorrect={onCorrect} onWrong={onWrong} />
          )}
          {activeGame === "memory" && (
            <MemoryCardsGame lesson={lesson} onFinish={finishGame} onCorrect={onCorrect} onWrong={onWrong} />
          )}
          {activeGame === "true-false" && (
            <TrueOrFalseGame lesson={lesson} onFinish={finishGame} onCorrect={onCorrect} onWrong={onWrong} />
          )}
          {activeGame === "spelling-bee" && (
            <SpellingBeeGame lesson={lesson} onFinish={finishGame} onCorrect={onCorrect} onWrong={onWrong} />
          )}
          {activeGame === "whats-action" && (
            <WhatsTheActionGame lesson={lesson} onFinish={finishGame} onCorrect={onCorrect} onWrong={onWrong} />
          )}
        </div>
      </div>
    );
  }

  // ── Sub-view: lesson celebration / unlock animation ───────────────────────
  if (view === "win") {
    return (
      <WinScreen
        onDone={() => onExit(lessonId)}
        variant={lesson.isBoss ? "level" : "small"}
        lesson={lesson}
        comboMax={comboMax}
      />
    );
  }

  // ── Main view: the game tile grid ─────────────────────────────────────────
  return (
    <div
      className="flex flex-col h-full"
      style={{
        fontFamily: uiFont,
        background: `linear-gradient(180deg, ${C.primarySoft} 0%, ${C.bg} 35%)`,
      }}
    >
      {/* Header */}
      <div className="flex items-center gap-3 px-5 pt-12 pb-3">
        <motion.button
          whileTap={{ scale: 0.88 }}
          onClick={() => onExit("")}
          style={{
            width: 44, height: 44, borderRadius: 22,
            background: C.white,
            display: "flex", alignItems: "center", justifyContent: "center",
            border: "none", cursor: "pointer",
            boxShadow: "0 2px 8px rgba(108,71,255,0.15)",
          }}
          aria-label="Back to learning path"
        >
          <ChevronLeft size={22} color={C.primary} />
        </motion.button>
        <div className="flex-1">
          <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, letterSpacing: 2, textTransform: "uppercase" }}>
            Today's Sound
          </div>
          <div style={{ fontSize: 22, fontWeight: 800, color: C.ink, lineHeight: 1.1 }}>
            Pick a game!
          </div>
        </div>
        {/* Phoneme badge */}
        <div
          style={{
            minWidth: 60, height: 60, borderRadius: 18, padding: "0 14px",
            background: `linear-gradient(135deg, ${C.primary}, ${C.primaryDark})`,
            color: "white", display: "flex", alignItems: "center", justifyContent: "center",
            fontWeight: 900, fontSize: 26,
            boxShadow: `0 6px 18px rgba(108,71,255,0.4)`,
          }}
        >
          {lesson.phoneme}
        </div>
      </div>

      {/* Sub-header — playful prompt + progress chip */}
      <div className="px-5 pb-4 flex items-center justify-between">
        <div style={{ fontSize: 13, color: C.muted, fontWeight: 600 }}>
          Every game teaches the <strong style={{ color: C.primary }}>{lesson.phoneme}</strong> sound.
        </div>
        <div
          style={{
            padding: "4px 10px", borderRadius: 10,
            background: allDone ? C.tealSoft : C.primarySoft,
            color: allDone ? C.teal : C.primary,
            fontSize: 11, fontWeight: 800,
          }}
        >
          {playedCount}/{playableCount}
        </div>
      </div>

      {/* Last-result toast — shows briefly after each game finishes so you
          can see the tracker fired. */}
      {lastResult && (() => {
        const tile = tiles.find(t => t.key === lastResult.key);
        const pct = lastResult.total > 0 ? Math.round((lastResult.correct / lastResult.total) * 100) : null;
        const seconds = Math.max(1, Math.round(lastResult.ms / 1000));
        return (
          <motion.div
            key={lastResult.key + "-" + lastResult.ms}
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="mx-5 mb-3"
            style={{
              padding: "10px 14px", borderRadius: 14,
              background: C.tealSoft, color: C.teal,
              display: "flex", alignItems: "center", gap: 10,
              fontSize: 12, fontWeight: 700,
            }}
          >
            <Check size={16} />
            <span>
              {tile?.title ?? "Game"} done
              {pct !== null ? ` · ${pct}% (${lastResult.correct}/${lastResult.total})` : ""}
              {" · "}{seconds}s
            </span>
          </motion.div>
        );
      })()}

      {/* Tile grid — 2 columns */}
      <div className="flex-1 overflow-y-auto px-5 pb-4">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 14,
          }}
        >
          {tiles.map((t, i) => {
            const isDone = completed.has(t.key);
            const isLocked = t.status === "coming";
            const isWiggling = comingSoonKey === t.key;
            return (
              <motion.button
                key={t.key}
                initial={{ scale: 0.85, opacity: 0, y: 12 }}
                animate={
                  isWiggling
                    ? { scale: 1, opacity: 1, y: 0, x: [0, -6, 6, -6, 6, 0] }
                    : { scale: 1, opacity: 1, y: 0 }
                }
                transition={{ delay: i * 0.05, type: "spring", bounce: 0.4 }}
                whileTap={{ scale: 0.94 }}
                onClick={() => openTile(t)}
                style={{
                  position: "relative",
                  border: "none", cursor: "pointer",
                  background: isLocked
                    ? "linear-gradient(135deg, #DDD7EA, #C7BEDA)"
                    : `linear-gradient(135deg, ${t.gradient[0]}, ${t.gradient[1]})`,
                  borderRadius: 22,
                  padding: "18px 14px 14px",
                  textAlign: "left",
                  color: "white",
                  display: "flex", flexDirection: "column", gap: 6,
                  aspectRatio: "1 / 1.05",
                  boxShadow: isLocked
                    ? "0 4px 10px rgba(0,0,0,0.06)"
                    : `0 10px 24px ${t.gradient[1]}55`,
                  overflow: "hidden",
                  fontFamily: uiFont,
                }}
              >
                {/* Decorative blob */}
                <div
                  style={{
                    position: "absolute", top: -30, right: -30,
                    width: 100, height: 100, borderRadius: 50,
                    background: "rgba(255,255,255,0.18)",
                  }}
                />
                {/* Status badge — done or coming-soon */}
                {isDone && (
                  <div
                    style={{
                      position: "absolute", top: 10, right: 10,
                      width: 26, height: 26, borderRadius: 13,
                      background: "white",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      boxShadow: "0 2px 6px rgba(0,0,0,0.15)",
                    }}
                  >
                    <Check size={16} color={C.teal} strokeWidth={3} />
                  </div>
                )}
                {isLocked && (
                  <div
                    style={{
                      position: "absolute", top: 10, right: 10,
                      padding: "3px 8px", borderRadius: 10,
                      background: "rgba(255,255,255,0.7)",
                      color: C.ink, fontSize: 9, fontWeight: 800,
                      letterSpacing: 0.5, textTransform: "uppercase",
                    }}
                  >
                    Soon
                  </div>
                )}
                {/* Emoji icon */}
                <div style={{ fontSize: 38, lineHeight: 1, marginTop: 6 }}>{t.emoji}</div>
                {/* Title + subtitle */}
                <div style={{ marginTop: "auto" }}>
                  <div style={{ fontSize: 17, fontWeight: 800, lineHeight: 1.15 }}>{t.title}</div>
                  <div style={{ fontSize: 11, opacity: 0.85, marginTop: 2, fontWeight: 600 }}>{t.subtitle}</div>
                </div>
              </motion.button>
            );
          })}
        </div>

        {/* Helper text */}
        <div style={{ fontSize: 11, color: C.muted, textAlign: "center", marginTop: 18, lineHeight: 1.5 }}>
          Play one or play them all — every game makes you stronger.<br />
          More games are on the way! 🚀
        </div>
      </div>

      {/* Finish Lesson CTA */}
      <div className="px-5 pb-5 pt-2">
        <motion.button
          whileTap={{ scale: 0.96 }}
          animate={allDone ? { scale: [1, 1.04, 1] } : {}}
          transition={allDone ? { duration: 1.6, repeat: Infinity, ease: "easeInOut" } : { duration: 0.2 }}
          onClick={() => setView("win")}
          disabled={playedCount === 0}
          style={{
            width: "100%", padding: "16px 24px",
            borderRadius: 20, border: "none",
            background: playedCount === 0
              ? "#E0DDEC"
              : allDone
                ? `linear-gradient(135deg, ${C.yellow}, ${C.amber})`
                : `linear-gradient(135deg, ${C.primary}, ${C.primaryDark})`,
            color: playedCount === 0 ? C.muted : C.ink,
            fontWeight: 800, fontSize: 17,
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            boxShadow: playedCount === 0
              ? "none"
              : allDone
                ? `0 10px 28px rgba(255,204,0,0.4)`
                : `0 10px 28px rgba(108,71,255,0.35)`,
            cursor: playedCount === 0 ? "not-allowed" : "pointer",
            fontFamily: uiFont,
            transition: "all 0.25s",
          }}
        >
          {playedCount === 0
            ? "Play a game first"
            : allDone
              ? "🎉 Finish Lesson!"
              : "Finish Lesson"}
          {playedCount > 0 && <ArrowRight size={20} />}
        </motion.button>
      </div>
    </div>
  );
}

// ─── Lesson Player Shell ──────────────────────────────────────────────────────
function LessonScreen({ onDone, lessonId }: { onDone: (lessonId: string) => void; lessonId: string }) {
  const lesson = LESSONS[lessonId] ?? LESSONS["sh-sound"];
  const [step, setStep] = useState<LessonStep>(lesson.isBoss ? "win" : "hear");
  const steps: LessonStep[] = ["hear", "see", "trace", "say", "build", "win"];
  const stepIdx = steps.indexOf(step);
  const next = () => {
    const nextStep = steps[stepIdx + 1];
    if (nextStep) setStep(nextStep);
  };

  // Combo tracking + adaptive signals
  const [combo, setCombo] = useState(0);
  const [comboMax, setComboMax] = useState(0);
  const [comboKey, setComboKey] = useState(0); // bumps for re-animation
  const recordHit = useStore(s => s.recordHit);
  const recordMiss = useStore(s => s.recordMiss);
  const onCorrect = useCallback(() => {
    setCombo(c => {
      const n = c + 1;
      setComboMax(m => (n > m ? n : m));
      return n;
    });
    setComboKey(k => k + 1);
    recordHit();
  }, [recordHit]);
  const onWrong = useCallback(() => {
    setCombo(0);
    recordMiss();
  }, [recordMiss]);

  const stepColors: Record<LessonStep, string> = {
    hear: C.teal, see: C.primary, trace: C.glow, say: C.blush, build: C.amber, win: C.yellow
  };
  return (
    <div className="flex flex-col h-full" style={{ background: C.bg }}>
      {step !== "win" && (
        <div className="flex items-center gap-3 px-5 pt-12 pb-4">
          <motion.button
            whileTap={{ scale: 0.88 }}
            onClick={() => onDone("")}
            style={{
              width: 44, height: 44, borderRadius: 22,
              background: C.primarySoft, display: "flex", alignItems: "center", justifyContent: "center"
            }}
          >
            <ChevronLeft size={22} color={C.primary} />
          </motion.button>
          <div className="flex-1 flex gap-2">
            {steps.slice(0, -1).map((s, i) => (
              <div
                key={s}
                style={{
                  flex: 1, height: 6, borderRadius: 3,
                  background: i < stepIdx ? stepColors[s] : i === stepIdx ? stepColors[s] : C.primarySoft,
                  opacity: i < stepIdx ? 1 : i === stepIdx ? 1 : 0.4,
                  transition: "all 0.3s",
                }}
              />
            ))}
          </div>
          <div style={{ fontSize: 12, color: C.muted, fontFamily: uiFont, fontWeight: 600 }}>
            {stepIdx + 1}/5
          </div>
        </div>
      )}
      {/* Combo chip — appears after 2+ correct answers in a row */}
      {step !== "win" && combo >= 2 && (
        <div className="px-5 pb-2 flex justify-center" style={{ marginTop: -8 }}>
          <motion.div
            key={comboKey}
            initial={{ scale: 0.6, opacity: 0, y: -8 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            transition={{ type: "spring", stiffness: 380, damping: 18 }}
            style={{
              background: `linear-gradient(135deg, ${C.teal}, ${C.echoDark})`,
              color: "white", borderRadius: 14,
              padding: "5px 12px", fontSize: 12, fontWeight: 700,
              fontFamily: uiFont,
              boxShadow: "0 4px 12px rgba(93,202,165,0.35)",
              display: "flex", alignItems: "center", gap: 6,
            }}
          >
            🔥 {combo} in a row!
          </motion.div>
        </div>
      )}
      <div className="flex-1 overflow-hidden">
        {step === "hear" && <HearItStep onNext={next} lesson={lesson} />}
        {step === "see" && <SeeItStep onNext={next} lesson={lesson} />}
        {step === "trace" && <TraceItStep onNext={next} lesson={lesson} />}
        {step === "say" && <SayItStep onNext={next} lesson={lesson} onCorrect={onCorrect} onWrong={onWrong} />}
        {step === "build" && (
          <DndProvider backend={DndBackend} options={isTouch ? { enableMouseEvents: true } : undefined}>
            <BuildItStep onNext={next} lesson={lesson} onCorrect={onCorrect} onWrong={onWrong} />
          </DndProvider>
        )}
        {step === "win" && <WinScreen onDone={() => onDone(lessonId)} variant={lesson.isBoss ? "level" : "small"} lesson={lesson} comboMax={comboMax} />}
      </div>
    </div>
  );
}

// ─── Progress Screen ──────────────────────────────────────────────────────────
const weekData = [
  { day: "Mon", xp: 45 },
  { day: "Tue", xp: 80 },
  { day: "Wed", xp: 60 },
  { day: "Thu", xp: 95 },
  { day: "Fri", xp: 40 },
  { day: "Sat", xp: 110 },
  { day: "Sun", xp: 70 },
];
const masteredWords = ["ship", "chat", "thin", "shop", "chin", "them", "shed", "chip", "that", "shell", "chop", "thick"];

function ProgressScreen() {
  const maxXP = Math.max(...weekData.map(d => d.xp));
  const masteredPhonemes = useStore(s => s.masteredPhonemes);
  const lessonsCompleted = useStore(s => s.lessonsCompleted);

  // Build skill milestone list from path
  const skillMilestones = LEARN_PATH_DEF.filter(n => !n.boss).map((def, i) => {
    const done = masteredPhonemes.includes(def.id);
    const prevDone = i === 0 || masteredPhonemes.includes(LEARN_PATH_DEF.filter(n => !n.boss)[i - 1]?.id ?? "");
    const current = !done && prevDone;
    const locked = !done && !prevDone;
    return { ...def, done, current, locked };
  });
  const masteredCount = skillMilestones.filter(s => s.done).length;

  return (
    <div className="flex flex-col h-full overflow-y-auto" style={{ fontFamily: uiFont, background: C.bg }}>
      <div className="px-6 pt-14 pb-4">
        <div style={{ fontSize: 24, fontWeight: 700, color: C.ink }}>Your Progress</div>
        <div style={{ fontSize: 14, color: C.muted }}>This week · {masteredCount} sounds mastered</div>
      </div>
      {/* Summary row */}
      <div className="px-6 flex gap-3 pb-5">
        {[
          { label: "Sounds", value: String(masteredCount), icon: "🔤", color: C.primary },
          { label: "Lessons", value: String(lessonsCompleted), icon: "📖", color: C.teal },
          { label: "Accuracy", value: "91%", icon: "🎯", color: C.amber },
        ].map(s => (
          <Card key={s.label} className="flex-1 p-3 flex flex-col items-center gap-1">
            <div style={{ fontSize: 22 }}>{s.icon}</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: 10, color: C.muted }}>{s.label}</div>
          </Card>
        ))}
      </div>
      {/* Skill milestones — for IEP/parent reports */}
      <div className="px-6 pb-5">
        <div style={{ fontSize: 15, fontWeight: 700, color: C.ink, marginBottom: 4 }}>Phonics Skills Report</div>
        <div style={{ fontSize: 12, color: C.muted, marginBottom: 12 }}>Share this with your teacher or at IEP meetings 📋</div>
        <Card className="p-4 flex flex-col gap-2">
          {skillMilestones.slice(0, 8).map(s => (
            <div key={s.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 10px", borderRadius: 12, background: s.done ? C.tealSoft : s.current ? C.primarySoft : "#F5F4F8" }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: s.done ? C.teal : s.current ? C.primary : C.muted }}>{s.label}</div>
              <div style={{ fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 10, background: s.done ? C.teal : s.current ? C.primary : "#E5E3EF", color: s.done || s.current ? "white" : C.muted }}>
                {s.done ? "Mastered ✓" : s.current ? "In Progress →" : "🔒 Locked"}
              </div>
            </div>
          ))}
          {skillMilestones.length > 8 && (
            <div style={{ fontSize: 12, color: C.muted, textAlign: "center", paddingTop: 4 }}>
              +{skillMilestones.length - 8} more skills coming up
            </div>
          )}
        </Card>
      </div>
      {/* XP Bar chart */}
      <div className="px-6 pb-5">
        <Card className="p-5">
          <div style={{ fontSize: 14, fontWeight: 700, color: C.ink, marginBottom: 16 }}>XP This Week</div>
          <div className="flex items-end gap-2" style={{ height: 100 }}>
            {weekData.map(d => (
              <div key={d.day} className="flex flex-col items-center gap-2" style={{ flex: 1 }}>
                <motion.div
                  initial={{ height: 0 }}
                  animate={{ height: (d.xp / maxXP) * 80 }}
                  transition={{ duration: 0.6, ease: "easeOut" }}
                  style={{
                    borderRadius: "6px 6px 3px 3px",
                    background: d.day === "Sat"
                      ? `linear-gradient(180deg, ${C.amber}, #E8922A)`
                      : `linear-gradient(180deg, ${C.primary}, ${C.primaryDark})`,
                    width: "100%",
                    minHeight: 4,
                  }}
                />
                <div style={{ fontSize: 10, color: C.muted }}>{d.day}</div>
              </div>
            ))}
          </div>
        </Card>
      </div>
      {/* Accuracy ring */}
      <div className="px-6 pb-5">
        <Card className="p-5 flex items-center gap-5">
          <div style={{ position: "relative" }}>
            <ProgressRing pct={91} size={80} stroke={8} color={C.teal} bg={C.tealSoft} />
            <div style={{
              position: "absolute", inset: 0,
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center"
            }}>
              <div style={{ fontSize: 18, fontWeight: 800, color: C.teal }}>91%</div>
            </div>
          </div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.ink }}>Accuracy</div>
            <div style={{ fontSize: 12, color: C.muted, marginTop: 3, lineHeight: 1.5 }}>
              You got 91 out of 100 sounds right this week!
            </div>
            <div style={{
              marginTop: 8, padding: "4px 12px", borderRadius: 10,
              background: C.tealSoft, color: C.teal, fontSize: 11, fontWeight: 700,
              display: "inline-block"
            }}>
              ↑ 4% from last week
            </div>
          </div>
        </Card>
      </div>
      {/* Words mastered */}
      <div className="px-6 pb-6">
        <div style={{ fontSize: 16, fontWeight: 700, color: C.ink, marginBottom: 12 }}>
          Words Mastered
          <span style={{
            marginLeft: 10, fontSize: 12, background: C.primary,
            color: "white", borderRadius: 10, padding: "2px 10px"
          }}>{masteredWords.length}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {masteredWords.map((w, i) => (
            <motion.div
              key={w}
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: i * 0.05 }}
              style={{
                padding: "6px 14px", borderRadius: 20,
                background: i < 4 ? C.tealSoft : i < 8 ? C.primarySoft : C.amberSoft,
                color: i < 4 ? C.teal : i < 8 ? C.primary : C.amber,
                fontSize: 14, fontWeight: 600, fontFamily: dyslexicFont,
              }}
            >
              {w}
            </motion.div>
          ))}
        </div>
      </div>
      {/* Mascot peek */}
      <div className="px-6 pb-8" style={{ position: "relative" }}>
        <div style={{ position: "absolute", right: 16, bottom: 80, zIndex: 0 }}>
          <Lexi size={80} pose="happy" />
        </div>
      </div>
    </div>
  );
}

// ─── Rewards Screen ───────────────────────────────────────────────────────────
const badges = [
  { id: 1, emoji: "🌟", label: "First Steps", unlocked: true, color: C.yellow },
  { id: 2, emoji: "🔥", label: "7-Day Streak", unlocked: true, color: C.amber },
  { id: 3, emoji: "🔊", label: "Sound Explorer", unlocked: true, color: C.teal },
  { id: 4, emoji: "🏗", label: "Word Builder", unlocked: true, color: C.primary },
  { id: 5, emoji: "🧩", label: "Phoneme Master", unlocked: false, color: C.muted },
  { id: 6, emoji: "📚", label: "Bookworm", unlocked: false, color: C.muted },
  { id: 7, emoji: "⚡", label: "Speed Reader", unlocked: false, color: C.muted },
  { id: 8, emoji: "💎", label: "Diamond Reader", unlocked: false, color: C.muted },
  { id: 9, emoji: "🦋", label: "Transformation", unlocked: false, color: C.muted },
];
const shopItems = [
  { id: 1, name: "Starry Hat", emoji: "⭐", unlocked: true, price: 0, mascot: "Lexi" },
  { id: 2, name: "Rainbow Cape", emoji: "🌈", unlocked: false, price: 200, mascot: "Echo" },
  { id: 3, name: "Cozy Scarf", emoji: "🧣", unlocked: false, price: 150, mascot: "Glow" },
  { id: 4, name: "Space Helmet", emoji: "🚀", unlocked: false, price: 300, mascot: "Bubble" },
  { id: 5, name: "Magic Boots", emoji: "✨", unlocked: false, price: 250, mascot: "Brick" },
  { id: 6, name: "Crown", emoji: "👑", unlocked: false, price: 500, mascot: "Lexi" },
];

function RewardsScreen() {
  const [tab, setTab] = useState<"badges" | "shop">("badges");
  return (
    <div className="flex flex-col h-full overflow-y-auto" style={{ fontFamily: uiFont, background: C.bg }}>
      <div className="px-6 pt-14 pb-4">
        <div style={{ fontSize: 24, fontWeight: 700, color: C.ink }}>Rewards</div>
      </div>
      {/* XP balance */}
      <div className="px-6 pb-5">
        <Card className="p-5" style={{ background: `linear-gradient(135deg, ${C.primary}, ${C.primaryDark})` }}>
          <div className="flex items-center justify-between">
            <div>
              <div style={{ fontSize: 13, color: "rgba(255,255,255,0.7)", fontWeight: 500 }}>Total XP Balance</div>
              <div style={{ fontSize: 44, fontWeight: 800, color: "white", lineHeight: 1.1 }}>2,340</div>
            </div>
            <div>
              <div style={{ width: 70, height: 70, borderRadius: 35, background: "rgba(255,255,255,0.15)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Zap size={36} color={C.yellow} />
              </div>
            </div>
          </div>
          <div className="flex gap-4 mt-4">
            {[
              { label: "This Week", value: "+450 XP" },
              { label: "Streak Bonus", value: "+90 XP" },
            ].map(s => (
              <div key={s.label} style={{ padding: "6px 14px", borderRadius: 10, background: "rgba(255,255,255,0.15)" }}>
                <div style={{ fontSize: 10, color: "rgba(255,255,255,0.6)" }}>{s.label}</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "white" }}>{s.value}</div>
              </div>
            ))}
          </div>
        </Card>
      </div>
      {/* Tab switcher */}
      <div className="px-6 pb-4 flex gap-3">
        {(["badges", "shop"] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              flex: 1, padding: "12px 0", borderRadius: 16,
              background: tab === t ? C.primary : C.primarySoft,
              color: tab === t ? "white" : C.primary,
              fontFamily: uiFont, fontWeight: 700, fontSize: 15,
              border: "none", cursor: "pointer",
              transition: "all 0.2s",
            }}
          >
            {t === "badges" ? "🏅 Badges" : "🛍 Items"}
          </button>
        ))}
      </div>
      {tab === "badges" && (
        <div className="px-6 pb-8 grid grid-cols-3 gap-3">
          {badges.map((b, i) => (
            <motion.div
              key={b.id}
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: i * 0.06 }}
            >
              <Card className="p-3 flex flex-col items-center gap-2" style={{
                opacity: b.unlocked ? 1 : 0.5,
                filter: b.unlocked ? "none" : "grayscale(1)",
              }}>
                <div style={{
                  width: 52, height: 52, borderRadius: 26,
                  background: b.unlocked ? b.color + "20" : "#F0EFF5",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 28,
                }}>
                  {b.unlocked ? b.emoji : "🔒"}
                </div>
                <div style={{ fontSize: 11, fontWeight: 700, color: b.unlocked ? C.ink : C.muted, textAlign: "center" }}>
                  {b.label}
                </div>
              </Card>
            </motion.div>
          ))}
        </div>
      )}
      {tab === "shop" && (
        <div className="px-6 pb-8 grid grid-cols-2 gap-3">
          {shopItems.map((item, i) => (
            <motion.div
              key={item.id}
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: i * 0.08 }}
            >
              <Card className="p-4 flex flex-col items-center gap-2">
                <div style={{ fontSize: 40 }}>{item.emoji}</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.ink, textAlign: "center" }}>{item.name}</div>
                <div style={{ fontSize: 10, color: C.muted }}>for {item.mascot}</div>
                {item.unlocked
                  ? <div style={{ padding: "4px 12px", borderRadius: 10, background: C.tealSoft, color: C.teal, fontSize: 12, fontWeight: 700 }}>✓ Owned</div>
                  : <div style={{ padding: "4px 12px", borderRadius: 10, background: C.primarySoft, color: C.primary, fontSize: 12, fontWeight: 700 }}>{item.price} XP</div>
                }
              </Card>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Profile Screen ───────────────────────────────────────────────────────────
const bgTints = [
  { label: "Cream", value: "#FFFDF5" },
  { label: "Mint", value: "#F0FBF6" },
  { label: "Sky", value: "#EFF6FD" },
  { label: "Lavender", value: "#F5F0FF" },
  { label: "Peach", value: "#FFF3EE" },
  { label: "Rose", value: "#FFF0F4" },
];

function ProfileScreen({ onRestart, onOpenParent }: { onRestart: () => void; onOpenParent: () => void }) {
  const name = useStore(s => s.name) || "Friend";
  const textSize = useStore(s => s.textSize);
  const selectedBg = useStore(s => s.bgTint);
  const selectedMascot = useStore(s => s.activeMascot);
  const xp = useStore(s => s.xp);
  const streak = useStore(s => s.streak);
  const lessonsCompleted = useStore(s => s.lessonsCompleted);
  const masteredCount = useStore(s => s.masteredPhonemes.length);
  // ── Difficulty tier read site #1: visible to user in the Profile card ─────
  const difficultyTier = useStore(s => s.difficultyTier);
  const tierLabel: Record<"foundational" | "developing" | "advanced", string> = {
    foundational: "Foundational · Ages 4–5",
    developing:   "Developing · Ages 6–7",
    advanced:     "Advanced · Ages 8+",
  };
  // ── Game stats read site: per-game accuracy / attempts / time ─────────────
  const gameStats = useStore(s => s.gameStats);
  const setStore = useStore(s => s.set);
  const reset = useStore(s => s.reset);
  const setTextSize = (v: "small" | "medium" | "large") => setStore({ textSize: v });
  const setSelectedBg = (v: number) => setStore({ bgTint: v });
  const setSelectedMascot = (v: number) => setStore({ activeMascot: v });
  const [confirmReset, setConfirmReset] = useState(false);
  const mascots = [Lexi, Echo, Glow, Bubble, Brick];
  const MascotComp = mascots[selectedMascot];
  return (
    <div className="flex flex-col h-full overflow-y-auto" style={{ fontFamily: uiFont, background: C.bg }}>
      <div className="px-6 pt-14 pb-2">
        <div style={{ fontSize: 24, fontWeight: 700, color: C.ink }}>Profile</div>
      </div>
      {/* Avatar & stats */}
      <div className="px-6 pb-5">
        <Card className="p-5" style={{ background: `linear-gradient(135deg, ${C.primarySoft}, #F8F5FF)` }}>
          <div className="flex items-center gap-4">
            <div style={{
              width: 76, height: 76, borderRadius: 38,
              background: C.white, display: "flex", alignItems: "center", justifyContent: "center",
              boxShadow: `0 4px 16px rgba(108,71,255,0.2)`,
              overflow: "hidden",
            }}>
              <MascotComp size={66} pose="happy" />
            </div>
            <div>
              <div style={{ fontSize: 20, fontWeight: 700, color: C.ink }}>{name}</div>
              <div style={{ fontSize: 12, color: C.muted }}>Level {Math.max(1, Math.floor(xp / 500))} · Sound Explorer</div>
              <div className="flex gap-2 mt-2 flex-wrap">
                <div style={{ padding: "4px 10px", borderRadius: 8, background: C.primary, color: "white", fontSize: 11, fontWeight: 700 }}>
                  {xp.toLocaleString()} XP
                </div>
                <div style={{ padding: "4px 10px", borderRadius: 8, background: C.amberSoft, color: C.amber, fontSize: 11, fontWeight: 700 }}>
                  🔥 {streak} days
                </div>
                {/* Difficulty tier chip — visible read site so it's obvious the wiring works */}
                <div style={{ padding: "4px 10px", borderRadius: 8, background: C.tealSoft, color: C.teal, fontSize: 11, fontWeight: 700 }}>
                  📚 {tierLabel[difficultyTier]}
                </div>
              </div>
            </div>
          </div>
          {/* Stats row */}
          <div className="flex gap-3 mt-4">
            {[
              { label: "Words", v: masteredCount * 4 },
              { label: "Lessons", v: lessonsCompleted },
              { label: "Minutes", v: lessonsCompleted * 5 },
            ].map(s => (
              <div key={s.label} style={{ flex: 1, textAlign: "center", padding: "8px 4px", background: "rgba(255,255,255,0.6)", borderRadius: 12 }}>
                <div style={{ fontSize: 18, fontWeight: 800, color: C.primary }}>{s.v}</div>
                <div style={{ fontSize: 10, color: C.muted }}>{s.label}</div>
              </div>
            ))}
          </div>
        </Card>
      </div>
      {/* Pick mascot */}
      <div className="px-6 pb-5">
        <div style={{ fontSize: 15, fontWeight: 700, color: C.ink, marginBottom: 10 }}>Your Lexi Friend</div>
        <div className="flex gap-3 justify-between">
          {mascots.map((MC, i) => (
            <motion.button
              key={i}
              whileTap={{ scale: 0.88 }}
              onClick={() => setSelectedMascot(i)}
              style={{
                flex: 1, padding: "8px 0", borderRadius: 16,
                background: selectedMascot === i ? C.primarySoft : C.white,
                border: `2px solid ${selectedMascot === i ? C.primary : "transparent"}`,
                boxShadow: selectedMascot === i ? `0 4px 12px rgba(108,71,255,0.2)` : "0 2px 8px rgba(0,0,0,0.06)",
                cursor: "pointer",
                display: "flex", flexDirection: "column", alignItems: "center",
              }}
            >
              <MC size={46} pose={selectedMascot === i ? "happy" : "idle"} />
            </motion.button>
          ))}
        </div>
      </div>

      {/* Game Stats — accuracy, attempts, time per game type */}
      {(() => {
        const gameMeta: { key: string; label: string; emoji: string; color: string }[] = [
          { key: "trace",       label: "Trace It",       emoji: "✍️", color: C.glow },
          { key: "build",       label: "Word Builder",   emoji: "🧱", color: C.amber },
          { key: "flashcards",  label: "Flashcards",     emoji: "🃏", color: C.glow },
          { key: "listen-up",   label: "Listen Up",      emoji: "👂", color: C.primary },
          { key: "fill-blank",  label: "Fill the Blank", emoji: "🧩", color: C.blush },
          { key: "photo-touch",  label: "Photo Touch",   emoji: "📸", color: C.teal },
          { key: "sound-match",  label: "Sound Match",   emoji: "🔊", color: C.amber },
          { key: "memory",       label: "Memory Cards",  emoji: "🧠", color: C.primary },
          { key: "true-false",   label: "True or False", emoji: "✅", color: C.teal },
          { key: "spelling-bee", label: "Spelling Bee",  emoji: "🐝", color: C.amber },
          { key: "whats-action", label: "What's Happening?", emoji: "🎬", color: C.glow },
        ];
        const fmtTime = (ms: number) => {
          if (ms <= 0) return "—";
          const secs = Math.round(ms / 1000);
          if (secs < 60) return `${secs}s`;
          const m = Math.floor(secs / 60);
          const s = secs % 60;
          return `${m}m ${s}s`;
        };
        const fmtAcc = (correct: number, total: number) =>
          total > 0 ? `${Math.round((correct / total) * 100)}%` : "—";
        const anyPlayed = gameMeta.some(g => (gameStats[g.key]?.attempts ?? 0) > 0);
        return (
          <div className="px-6 pb-5">
            <div style={{ fontSize: 15, fontWeight: 700, color: C.ink, marginBottom: 10 }}>
              Game Stats
            </div>
            <Card className="p-4 flex flex-col gap-3">
              {!anyPlayed && (
                <div style={{ fontSize: 12, color: C.muted, textAlign: "center", padding: "12px 0" }}>
                  Play some games to see stats here.
                </div>
              )}
              {anyPlayed && gameMeta.map(g => {
                const s = gameStats[g.key];
                const played = (s?.attempts ?? 0) > 0;
                return (
                  <div
                    key={g.key}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "32px 1fr auto",
                      alignItems: "center",
                      gap: 10,
                      opacity: played ? 1 : 0.45,
                    }}
                  >
                    <div style={{ fontSize: 22, lineHeight: 1, textAlign: "center" }}>{g.emoji}</div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 800, color: C.ink }}>{g.label}</div>
                      <div style={{ fontSize: 11, color: C.muted, marginTop: 1 }}>
                        {played
                          ? `${s!.attempts} play${s!.attempts === 1 ? "" : "s"} · ${fmtTime(s!.totalTimeMs)}`
                          : "Not played yet"}
                      </div>
                    </div>
                    <div
                      style={{
                        padding: "4px 10px", borderRadius: 10,
                        background: g.color + "22", color: g.color,
                        fontSize: 11, fontWeight: 800,
                        minWidth: 48, textAlign: "center",
                      }}
                    >
                      {played ? fmtAcc(s!.correct, s!.total) : "—"}
                    </div>
                  </div>
                );
              })}
            </Card>
          </div>
        );
      })()}

      {/* Customize Your View */}
      <div className="px-6 pb-5">
        <div style={{ fontSize: 15, fontWeight: 700, color: C.ink, marginBottom: 10 }}>Customize Your View</div>
        <Card className="p-5 flex flex-col gap-5">
          {/* Text size */}
          <div>
            <div style={{ fontSize: 13, color: C.muted, marginBottom: 8 }}>Text Size</div>
            <div className="flex gap-2">
              {(["small", "medium", "large"] as const).map(sz => (
                <button
                  key={sz}
                  onClick={() => setTextSize(sz)}
                  style={{
                    flex: 1, padding: "10px 0", borderRadius: 12,
                    background: textSize === sz ? C.primary : C.primarySoft,
                    color: textSize === sz ? "white" : C.primary,
                    fontFamily: uiFont, fontWeight: 700,
                    fontSize: sz === "small" ? 11 : sz === "medium" ? 13 : 15,
                    border: "none", cursor: "pointer",
                  }}
                >
                  {sz === "small" ? "A" : sz === "medium" ? "A" : "A"}
                </button>
              ))}
            </div>
          </div>
          {/* Background tints */}
          <div>
            <div style={{ fontSize: 13, color: C.muted, marginBottom: 8 }}>Background Color</div>
            <div className="flex gap-3">
              {bgTints.map((bg, i) => (
                <motion.button
                  key={bg.label}
                  whileTap={{ scale: 0.88 }}
                  onClick={() => setSelectedBg(i)}
                  style={{
                    width: 36, height: 36, borderRadius: 18,
                    background: bg.value,
                    border: `3px solid ${selectedBg === i ? C.primary : "rgba(0,0,0,0.1)"}`,
                    cursor: "pointer",
                    boxShadow: selectedBg === i ? `0 3px 10px rgba(108,71,255,0.3)` : "none",
                  }}
                />
              ))}
            </div>
          </div>
          {/* Live preview */}
          <div style={{
            padding: "16px",
            borderRadius: 12,
            background: bgTints[selectedBg].value,
            border: "1px solid rgba(0,0,0,0.08)",
          }}>
            <div style={{ fontSize: textSize === "small" ? 18 : textSize === "medium" ? 22 : 28, fontFamily: dyslexicFont, color: C.ink }}>
              <span style={{ color: C.teal }}>SH</span>ip
            </div>
            <div style={{ fontSize: textSize === "small" ? 11 : textSize === "medium" ? 13 : 15, color: C.muted, marginTop: 4, fontFamily: uiFont }}>
              Preview: {bgTints[selectedBg].label}
            </div>
          </div>
        </Card>
      </div>
      {/* Parent section — opens math gate */}
      <div className="px-6 pb-5">
        <motion.button
          whileTap={{ scale: 0.98 }}
          onClick={onOpenParent}
          style={{
            width: "100%", textAlign: "left", border: "none",
            background: C.amberSoft, borderRadius: 24, padding: 20, cursor: "pointer",
            boxShadow: "0 4px 20px rgba(108, 71, 255, 0.08)",
            fontFamily: uiFont,
          }}
        >
          <div className="flex items-center justify-between mb-2">
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: C.ink }}>For Parents & Teachers</div>
              <div style={{ fontSize: 12, color: C.muted }}>Dashboard · weekly digest · IEP report</div>
            </div>
            <div style={{ width: 44, height: 44, borderRadius: 22, background: C.amber, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Shield size={22} color="white" />
            </div>
          </div>
          <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.5, marginTop: 4 }}>
            🔒 Tap to open — a quick math problem keeps it kid-proof.
          </div>
        </motion.button>
      </div>
      {/* Demo restart */}
      <div className="px-6 pb-10">
        {!confirmReset ? (
          <motion.button
            whileTap={{ scale: 0.96 }}
            onClick={() => setConfirmReset(true)}
            style={{
              width: "100%", padding: "12px", borderRadius: 16,
              background: "transparent", border: `2px dashed ${C.muted}`,
              color: C.muted, fontSize: 13, fontWeight: 600,
              fontFamily: uiFont, cursor: "pointer",
            }}
          >
            🔄 Restart Demo
          </motion.button>
        ) : (
          <Card className="p-4 flex flex-col gap-3" style={{ background: "#FFF0F0" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.ink, textAlign: "center" }}>
              Reset everything and start from the beginning?
            </div>
            <div className="flex gap-3">
              <motion.button
                whileTap={{ scale: 0.95 }}
                onClick={() => {
                  reset();
                  setStore({ masteredPhonemes: [], xp: 0, lessonsCompleted: 0, streak: 0 });
                  onRestart();
                }}
                style={{
                  flex: 1, padding: "10px", borderRadius: 12,
                  background: "#FF4D4D", color: "white",
                  fontSize: 13, fontWeight: 700, fontFamily: uiFont,
                  border: "none", cursor: "pointer",
                }}
              >
                Yes, reset
              </motion.button>
              <motion.button
                whileTap={{ scale: 0.95 }}
                onClick={() => setConfirmReset(false)}
                style={{
                  flex: 1, padding: "10px", borderRadius: 12,
                  background: C.primarySoft, color: C.primary,
                  fontSize: 13, fontWeight: 700, fontFamily: uiFont,
                  border: "none", cursor: "pointer",
                }}
              >
                Cancel
              </motion.button>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

// ─── Parent Screen (gate + dashboard) ─────────────────────────────────────────
// Adult-styled, behind a math gate. COPPA-safe: no audio ever persisted.

const ADULT_INK = "#1A1A2E";
const ADULT_BG = "#F4F5F8";
const ADULT_MUTED = "#5C6079";

function ParentGate({ onPass, onCancel }: { onPass: () => void; onCancel: () => void }) {
  const [problem, setProblem] = useState(() => {
    const a = 3 + Math.floor(Math.random() * 7);
    const b = 3 + Math.floor(Math.random() * 7);
    return { a, b, answer: a * b };
  });
  const [input, setInput] = useState("");
  const [tried, setTried] = useState(false);
  const wrong = tried && input !== "" && Number(input) !== problem.answer;
  const press = (d: string) => {
    if (input.length >= 3) return;
    setInput(p => p + d);
    setTried(false);
  };
  const back = () => { setInput(p => p.slice(0, -1)); setTried(false); };
  const submit = () => {
    if (Number(input) === problem.answer) { onPass(); return; }
    setTried(true);
    setTimeout(() => {
      const a = 3 + Math.floor(Math.random() * 7);
      const b = 3 + Math.floor(Math.random() * 7);
      setProblem({ a, b, answer: a * b });
      setInput("");
      setTried(false);
    }, 1200);
  };
  return (
    <div className="flex flex-col h-full" style={{ background: ADULT_BG, fontFamily: uiFont }}>
      <div className="flex items-center justify-between px-6 pt-12 pb-4">
        <motion.button
          whileTap={{ scale: 0.92 }}
          onClick={onCancel}
          style={{
            width: 40, height: 40, borderRadius: 20,
            background: "white", border: "none", cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: "0 2px 6px rgba(0,0,0,0.06)",
          }}
        >
          <ChevronLeft size={20} color={ADULT_INK} />
        </motion.button>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Shield size={16} color={ADULT_MUTED} />
          <span style={{ fontSize: 13, fontWeight: 600, color: ADULT_MUTED, letterSpacing: 0.5 }}>PARENT AREA</span>
        </div>
        <div style={{ width: 40 }} />
      </div>
      <div className="flex-1 flex flex-col items-center justify-center px-8 gap-6">
        <div style={{ fontSize: 22, fontWeight: 700, color: ADULT_INK, textAlign: "center" }}>
          Just checking — are you a grown-up?
        </div>
        <div style={{ fontSize: 14, color: ADULT_MUTED, textAlign: "center", maxWidth: 280 }}>
          Solve this to open the parent dashboard. (We never lock kids out of their own progress.)
        </div>
        <div style={{
          background: "white", padding: "28px 36px", borderRadius: 24,
          boxShadow: "0 6px 24px rgba(26,26,46,0.08)",
          display: "flex", alignItems: "center", gap: 18,
          fontSize: 40, fontWeight: 700, color: ADULT_INK,
        }}>
          <span>{problem.a}</span>
          <span style={{ color: ADULT_MUTED }}>×</span>
          <span>{problem.b}</span>
          <span style={{ color: ADULT_MUTED }}>=</span>
          <span style={{
            minWidth: 64, padding: "6px 14px", borderRadius: 12,
            border: `2px solid ${wrong ? C.amber : input ? ADULT_INK : "#D8DBE4"}`,
            color: wrong ? C.amber : ADULT_INK, textAlign: "center",
            background: wrong ? C.amberSoft : "white",
            transition: "all 0.2s",
          }}>
            {input || "?"}
          </span>
        </div>
        {wrong && (
          <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} style={{
            fontSize: 13, color: C.amber, fontWeight: 600,
          }}>
            Not quite — here's a new one.
          </motion.div>
        )}
        {/* Numpad */}
        <div style={{
          display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10,
          width: "100%", maxWidth: 280, marginTop: 8,
        }}>
          {["1","2","3","4","5","6","7","8","9"].map(d => (
            <motion.button
              key={d}
              whileTap={{ scale: 0.92 }}
              onClick={() => press(d)}
              style={{
                height: 56, borderRadius: 16,
                background: "white", border: "none", cursor: "pointer",
                fontSize: 22, fontWeight: 600, color: ADULT_INK,
                boxShadow: "0 2px 6px rgba(0,0,0,0.04)",
                fontFamily: uiFont,
              }}
            >
              {d}
            </motion.button>
          ))}
          <motion.button
            whileTap={{ scale: 0.92 }}
            onClick={back}
            style={{
              height: 56, borderRadius: 16,
              background: "#E5E7ED", border: "none", cursor: "pointer",
              fontSize: 18, color: ADULT_INK, fontWeight: 600,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            ⌫
          </motion.button>
          <motion.button
            whileTap={{ scale: 0.92 }}
            onClick={() => press("0")}
            style={{
              height: 56, borderRadius: 16,
              background: "white", border: "none", cursor: "pointer",
              fontSize: 22, fontWeight: 600, color: ADULT_INK,
              boxShadow: "0 2px 6px rgba(0,0,0,0.04)",
              fontFamily: uiFont,
            }}
          >
            0
          </motion.button>
          <motion.button
            whileTap={{ scale: 0.92 }}
            onClick={submit}
            disabled={!input}
            style={{
              height: 56, borderRadius: 16,
              background: input ? C.primary : "#C4B0FF", border: "none",
              cursor: input ? "pointer" : "default",
              fontSize: 16, color: "white", fontWeight: 700,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontFamily: uiFont,
            }}
          >
            Enter
          </motion.button>
        </div>
      </div>
    </div>
  );
}

// Curated phoneme bank for the dashboard heatmap.
// TODO(real-data): wire actual per-phoneme accuracy from session events.
const PHONEME_BANK = [
  { id: "short-a", label: "Short A", group: "vowels" },
  { id: "short-e", label: "Short E", group: "vowels" },
  { id: "short-i", label: "Short I", group: "vowels" },
  { id: "short-o", label: "Short O", group: "vowels" },
  { id: "short-u", label: "Short U", group: "vowels" },
  { id: "long-a", label: "Long A", group: "vowels" },
  { id: "long-e", label: "Long E", group: "vowels" },
  { id: "sh", label: "SH", group: "digraphs" },
  { id: "ch", label: "CH", group: "digraphs" },
  { id: "th", label: "TH", group: "digraphs" },
  { id: "wh", label: "WH", group: "digraphs" },
  { id: "bl", label: "BL", group: "blends" },
  { id: "cr", label: "CR", group: "blends" },
  { id: "st", label: "ST", group: "blends" },
];

function heatColor(pct: number | null) {
  if (pct == null) return { bg: "#E5E7ED", fg: ADULT_MUTED, label: "—" };
  if (pct >= 90) return { bg: "#C9EFDD", fg: "#1F7A53", label: `${pct}%` };
  if (pct >= 75) return { bg: "#DFF4EA", fg: "#2D8B66", label: `${pct}%` };
  if (pct >= 60) return { bg: "#FEE7CC", fg: "#9C5314", label: `${pct}%` };
  return { bg: "#FFE1D6", fg: "#A8462A", label: `${pct}%` };
}

function ParentDashboard({ onExit }: { onExit: () => void }) {
  const name = useStore(s => s.name) || "your child";
  const lessonsCompleted = useStore(s => s.lessonsCompleted);
  const masteredPhonemes = useStore(s => s.masteredPhonemes);
  const streak = useStore(s => s.streak);
  const weeklyDigest = useStore(s => s.weeklyDigest);
  const parentEmail = useStore(s => s.parentEmail);
  const setStore = useStore(s => s.set);

  // Compute per-phoneme accuracy. Real signal where we have it (mastered = high
  // accuracy band), placeholder for the rest. // TODO(real-data)
  const phonemeAcc = PHONEME_BANK.map(p => {
    if (masteredPhonemes.includes(p.id)) {
      return { ...p, pct: 88 + ((p.id.charCodeAt(0) * 7) % 10) }; // 88–97%
    }
    // Stable pseudo value so the dashboard doesn't flicker on rerender
    const seed = (p.id.charCodeAt(0) + p.id.length * 13) % 100;
    if (seed < 25) return { ...p, pct: null }; // locked / not started
    if (seed < 60) return { ...p, pct: 50 + (seed % 20) }; // working on
    return { ...p, pct: 70 + (seed % 18) };
  });
  const focusList = phonemeAcc
    .filter(p => p.pct != null && p.pct < 80)
    .sort((a, b) => (a.pct ?? 100) - (b.pct ?? 100))
    .slice(0, 3);

  // Rough weekly stats derived from store. // TODO(real-data) replace with session logs.
  const weekMinutes = Math.max(0, lessonsCompleted * 5);
  const weekSessions = lessonsCompleted;
  const masteredCount = masteredPhonemes.length;

  return (
    <div className="flex flex-col h-full overflow-y-auto" style={{ background: ADULT_BG, fontFamily: uiFont }}>
      {/* Header */}
      <div className="flex items-center justify-between px-6 pt-12 pb-4">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 18,
            background: C.primary, display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <Shield size={18} color="white" />
          </div>
          <div>
            <div style={{ fontSize: 17, fontWeight: 700, color: ADULT_INK }}>Parent Dashboard</div>
            <div style={{ fontSize: 11, color: ADULT_MUTED }}>{name}'s phonics progress</div>
          </div>
        </div>
        <motion.button
          whileTap={{ scale: 0.92 }}
          onClick={onExit}
          style={{
            width: 36, height: 36, borderRadius: 18,
            background: "white", border: "none", cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: "0 2px 6px rgba(0,0,0,0.06)",
            fontSize: 18, color: ADULT_INK,
          }}
        >
          ✕
        </motion.button>
      </div>

      {/* This Week summary */}
      <div className="px-6 pb-4">
        <div style={{ fontSize: 12, fontWeight: 600, color: ADULT_MUTED, letterSpacing: 1, textTransform: "uppercase", marginBottom: 8 }}>
          This week
        </div>
        <div className="flex gap-3">
          {[
            { label: "Minutes", value: weekMinutes, accent: C.primary },
            { label: "Sessions", value: weekSessions, accent: C.teal },
            { label: "Mastered", value: masteredCount, accent: C.amber },
            { label: "Streak", value: `${streak}d`, accent: "#E8772E" },
          ].map(s => (
            <div key={s.label} style={{
              flex: 1, background: "white", borderRadius: 16, padding: "14px 8px",
              textAlign: "center", boxShadow: "0 2px 6px rgba(0,0,0,0.04)",
            }}>
              <div style={{ fontSize: 24, fontWeight: 800, color: s.accent, lineHeight: 1.1 }}>{s.value}</div>
              <div style={{ fontSize: 10, color: ADULT_MUTED, marginTop: 4, fontWeight: 600, letterSpacing: 0.3 }}>{s.label.toUpperCase()}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Phoneme heatmap */}
      <div className="px-6 pb-4">
        <div style={{ fontSize: 13, fontWeight: 700, color: ADULT_INK, marginBottom: 6 }}>Phoneme mastery</div>
        <div style={{ fontSize: 11, color: ADULT_MUTED, marginBottom: 10 }}>Color intensity = accuracy on recent attempts.</div>
        <div style={{
          background: "white", borderRadius: 16, padding: 14,
          boxShadow: "0 2px 6px rgba(0,0,0,0.04)",
        }}>
          <div style={{
            display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8,
          }}>
            {phonemeAcc.map(p => {
              const c = heatColor(p.pct);
              return (
                <div key={p.id} style={{
                  background: c.bg, borderRadius: 10, padding: "10px 6px",
                  textAlign: "center", minHeight: 56,
                }}>
                  <div style={{ fontFamily: dyslexicFont, fontSize: 15, fontWeight: 700, color: c.fg }}>
                    {p.label}
                  </div>
                  <div style={{ fontSize: 10, color: c.fg, fontWeight: 600, marginTop: 2 }}>
                    {c.label}
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{ display: "flex", gap: 12, marginTop: 12, fontSize: 10, color: ADULT_MUTED, justifyContent: "center", flexWrap: "wrap" }}>
            {[
              { c: "#C9EFDD", l: "90%+" },
              { c: "#DFF4EA", l: "75–89%" },
              { c: "#FEE7CC", l: "60–74%" },
              { c: "#FFE1D6", l: "<60%" },
              { c: "#E5E7ED", l: "Not yet" },
            ].map(k => (
              <div key={k.l} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ width: 10, height: 10, borderRadius: 3, background: k.c, display: "inline-block" }} />
                <span>{k.l}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Recommended next focus */}
      <div className="px-6 pb-4">
        <div style={{ fontSize: 13, fontWeight: 700, color: ADULT_INK, marginBottom: 6 }}>Recommended next focus</div>
        <div style={{ fontSize: 11, color: ADULT_MUTED, marginBottom: 10 }}>Sounds where {name} would benefit from extra practice.</div>
        <div style={{
          background: "white", borderRadius: 16, padding: 14,
          boxShadow: "0 2px 6px rgba(0,0,0,0.04)",
          display: "flex", flexDirection: "column", gap: 10,
        }}>
          {focusList.length === 0 ? (
            <div style={{ fontSize: 12, color: ADULT_MUTED, textAlign: "center", padding: "12px 0" }}>
              Nothing flagged — {name} is doing great across the board. 🎯
            </div>
          ) : focusList.map((p, i) => (
            <div key={p.id} style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "10px 12px", borderRadius: 12, background: "#FAFAFC",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{
                  width: 28, height: 28, borderRadius: 8,
                  background: C.amberSoft, display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 12, fontWeight: 800, color: C.amber,
                }}>
                  {i + 1}
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: ADULT_INK, fontFamily: dyslexicFont }}>{p.label}</div>
                  <div style={{ fontSize: 10, color: ADULT_MUTED }}>
                    {p.pct}% accuracy · suggest 2 short sessions this week
                  </div>
                </div>
              </div>
              <ArrowRight size={16} color={ADULT_MUTED} />
            </div>
          ))}
        </div>
      </div>

      {/* Weekly digest */}
      <div className="px-6 pb-4">
        <div style={{ fontSize: 13, fontWeight: 700, color: ADULT_INK, marginBottom: 6 }}>Weekly email digest</div>
        <div style={{
          background: "white", borderRadius: 16, padding: 16,
          boxShadow: "0 2px 6px rgba(0,0,0,0.04)",
        }}>
          <div className="flex items-center justify-between" style={{ marginBottom: weeklyDigest ? 12 : 0 }}>
            <div style={{ paddingRight: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: ADULT_INK }}>Send me a recap every Sunday</div>
              <div style={{ fontSize: 11, color: ADULT_MUTED, marginTop: 2 }}>
                Minutes, words mastered, streak, and one recommended focus.
              </div>
            </div>
            <button
              onClick={() => setStore({ weeklyDigest: !weeklyDigest })}
              style={{
                width: 48, height: 28, borderRadius: 14,
                background: weeklyDigest ? C.primary : "#D8DBE4",
                border: "none", cursor: "pointer", position: "relative",
                transition: "background 0.2s",
                flexShrink: 0,
              }}
              aria-pressed={weeklyDigest}
            >
              <span style={{
                position: "absolute", top: 3, left: weeklyDigest ? 23 : 3,
                width: 22, height: 22, borderRadius: 11, background: "white",
                boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
                transition: "left 0.2s",
              }} />
            </button>
          </div>
          {weeklyDigest && (
            <input
              type="email"
              value={parentEmail}
              onChange={e => setStore({ parentEmail: e.target.value })}
              placeholder="parent@email.com"
              style={{
                width: "100%", padding: "10px 14px", borderRadius: 10,
                border: `1px solid ${parentEmail ? C.primary : "#D8DBE4"}`,
                fontSize: 13, fontFamily: uiFont, color: ADULT_INK,
                background: "white", outline: "none",
              }}
            />
          )}
        </div>
      </div>

      {/* Notification previews */}
      <div className="px-6 pb-4">
        <div style={{ fontSize: 13, fontWeight: 700, color: ADULT_INK, marginBottom: 6 }}>Notifications preview</div>
        <div style={{ fontSize: 11, color: ADULT_MUTED, marginBottom: 10 }}>What {name} sees when it's time to practice.</div>

        {/* iOS daily push mockup */}
        <div style={{
          background: "#1A1A2E", borderRadius: 20, padding: 14,
          boxShadow: "0 4px 14px rgba(26,26,46,0.15)",
          marginBottom: 12,
        }}>
          <div style={{ fontSize: 10, color: "#A6A8B5", fontWeight: 600, marginBottom: 8, paddingLeft: 4 }}>NOTIFICATION</div>
          <div style={{
            background: "rgba(255,255,255,0.92)", borderRadius: 14,
            padding: "10px 12px", display: "flex", gap: 10, alignItems: "flex-start",
          }}>
            <div style={{
              width: 36, height: 36, borderRadius: 8,
              background: `linear-gradient(135deg, ${C.primary}, ${C.lexi})`,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 18, color: "white", fontWeight: 800,
              flexShrink: 0,
            }}>
              L
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#1A1A2E" }}>Lexio</span>
                <span style={{ fontSize: 10, color: "#6B6B8A" }}>now</span>
              </div>
              <div style={{ fontSize: 13, color: "#1A1A2E", fontWeight: 600, marginTop: 2 }}>
                Echo's waiting for you 🎧
              </div>
              <div style={{ fontSize: 12, color: "#3D3D54", marginTop: 2, lineHeight: 1.4 }}>
                Same time as yesterday — just a 2-minute lesson to keep your {streak}-day streak alive.
              </div>
            </div>
          </div>
        </div>

        {/* Weekly email digest mockup */}
        <div style={{
          background: "white", borderRadius: 16, padding: 0,
          boxShadow: "0 2px 6px rgba(0,0,0,0.04)",
          overflow: "hidden",
          border: "1px solid #E5E7ED",
        }}>
          {/* Email header */}
          <div style={{
            background: `linear-gradient(135deg, ${C.primary}, ${C.primaryDark})`,
            padding: "12px 16px",
            color: "white",
          }}>
            <div style={{ fontSize: 10, opacity: 0.8, letterSpacing: 0.5 }}>WEEKLY DIGEST · LEXIO</div>
            <div style={{ fontSize: 15, fontWeight: 700, marginTop: 2 }}>{name}'s week in reading</div>
          </div>
          <div style={{ padding: "14px 16px" }}>
            <div style={{ fontSize: 12, color: ADULT_INK, lineHeight: 1.6, marginBottom: 10 }}>
              {name} read for <strong>{weekMinutes} minutes</strong> across <strong>{weekSessions} sessions</strong> this week and mastered <strong>{masteredCount} new phonemes</strong>. 🎉
            </div>
            <div style={{
              display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6, marginBottom: 12,
            }}>
              {[
                { v: weekMinutes, l: "min" },
                { v: weekSessions, l: "sessions" },
                { v: streak, l: "day streak" },
              ].map(s => (
                <div key={s.l} style={{
                  background: "#F4F5F8", borderRadius: 8, padding: "8px 4px", textAlign: "center",
                }}>
                  <div style={{ fontSize: 18, fontWeight: 800, color: C.primary }}>{s.v}</div>
                  <div style={{ fontSize: 9, color: ADULT_MUTED, marginTop: 2 }}>{s.l.toUpperCase()}</div>
                </div>
              ))}
            </div>
            <div style={{ fontSize: 11, color: ADULT_MUTED, marginBottom: 8 }}>This week's focus:</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
              {focusList.slice(0, 3).map(p => (
                <div key={p.id} style={{
                  background: C.amberSoft, color: C.amber, fontSize: 11, fontWeight: 700,
                  padding: "4px 10px", borderRadius: 8, fontFamily: dyslexicFont,
                }}>
                  {p.label}
                </div>
              ))}
            </div>
            <div style={{
              background: C.primary, color: "white", textAlign: "center",
              borderRadius: 10, padding: "10px 12px",
              fontSize: 12, fontWeight: 700,
            }}>
              See full report →
            </div>
          </div>
        </div>
      </div>

      {/* COPPA note */}
      <div className="px-6 pb-10">
        <div style={{
          background: "transparent", border: `1px dashed ${ADULT_MUTED}`,
          borderRadius: 12, padding: "10px 14px",
          fontSize: 11, color: ADULT_MUTED, lineHeight: 1.6,
        }}>
          🔒 <strong style={{ color: ADULT_INK }}>COPPA-safe.</strong> Lexio never stores or transmits voice recordings. Mic data is processed on-device for waveform feedback only and discarded after each attempt.
        </div>
      </div>
    </div>
  );
}

function ParentScreen({ onExit }: { onExit: () => void }) {
  const [unlocked, setUnlocked] = useState(false);
  return unlocked
    ? <ParentDashboard onExit={onExit} />
    : <ParentGate onPass={() => setUnlocked(true)} onCancel={onExit} />;
}

// ─── Bottom Tab Bar ────────────────────────────────────────────────────────────
const TAB_DEF: { id: Tab; label: string; icon: React.ReactNode; MascotComp: React.FC<{ size?: number; pose?: string }> }[] = [
  { id: "home", label: "Home", icon: <Home size={22} />, MascotComp: Lexi },
  { id: "learn", label: "Learn", icon: <BookOpen size={22} />, MascotComp: Glow },
  { id: "progress", label: "Progress", icon: <BarChart2 size={22} />, MascotComp: Echo },
  { id: "rewards", label: "Rewards", icon: <Gift size={22} />, MascotComp: Bubble },
  { id: "profile", label: "Profile", icon: <User size={22} />, MascotComp: Brick },
];

function TabBar({ active, onChange }: { active: Tab; onChange: (t: Tab) => void }) {
  return (
    <div
      style={{
        height: 84,
        background: C.white,
        borderTop: `1px solid rgba(108,71,255,0.1)`,
        display: "flex",
        alignItems: "center",
        paddingBottom: 8,
        boxShadow: "0 -4px 20px rgba(108,71,255,0.08)",
      }}
    >
      {TAB_DEF.map(t => {
        const isActive = t.id === active;
        return (
          <motion.button
            key={t.id}
            whileTap={{ scale: 0.88 }}
            onClick={() => onChange(t.id)}
            style={{
              flex: 1, height: "100%",
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end",
              paddingBottom: 8, gap: 0,
              background: "none", border: "none", cursor: "pointer",
              position: "relative",
              fontFamily: uiFont,
            }}
          >
            {/* Mascot peek on active */}
            {isActive && (
              <motion.div
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                style={{
                  position: "absolute",
                  top: -32,
                  left: "50%",
                  transform: "translateX(-50%)",
                }}
              >
                <t.MascotComp size={38} pose="happy" />
              </motion.div>
            )}
            {/* Icon pill */}
            <div style={{
              padding: isActive ? "6px 18px" : "6px",
              borderRadius: 20,
              background: isActive ? C.primarySoft : "transparent",
              color: isActive ? C.primary : C.muted,
              transition: "all 0.2s",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              {t.icon}
            </div>
            <div style={{
              fontSize: 10, fontWeight: isActive ? 700 : 500,
              color: isActive ? C.primary : C.muted,
              marginTop: 2,
            }}>
              {t.label}
            </div>
          </motion.button>
        );
      })}
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const onboarded = useStore(s => s.onboarded);
  const completeLesson = useStore(s => s.completeLesson);
  const masteredPhonemes = useStore(s => s.masteredPhonemes);
  const [screen, setScreen] = useState<Screen>(onboarded ? "home" : "splash");
  const [tab, setTab] = useState<Tab>("home");
  const [currentLessonId, setCurrentLessonId] = useState<string>("sh-sound");
  const showTabs = ["home", "learn", "progress", "rewards", "profile"].includes(screen) && screen !== "lesson";

  const handleTabChange = (t: Tab) => { setTab(t); setScreen(t as Screen); };

  const handleStartLesson = (id?: string) => {
    // Find the current (first unlocked non-done) lesson if no id given
    const targetId = id ?? (() => {
      const first = LEARN_PATH_DEF.find((def, i) => {
        const done = masteredPhonemes.includes(def.id);
        const prevDone = i === 0 || masteredPhonemes.includes(LEARN_PATH_DEF[i - 1].id);
        return !done && prevDone;
      });
      return first?.id ?? "sh-sound";
    })();
    setCurrentLessonId(targetId);
    // Picking a lesson now lands on the GamesGridScreen ("games" route),
    // which lets the kid pick which game to play. The legacy multi-step
    // "lesson" route still works if invoked directly.
    setScreen("games");
  };

  const handleLessonDone = (lessonId: string) => {
    if (lessonId && !masteredPhonemes.includes(lessonId)) {
      const lesson = LESSONS[lessonId];
      if (lesson) completeLesson(lessonId, lesson.xpReward);
    }
    setTab("learn");
    setScreen("learn");
  };

  return (
    <div
      className="lexio-shell"
      style={{
        minHeight: "100vh",
        background: `linear-gradient(135deg, #E8E0FF 0%, #FFFDF5 40%, #D4F0E8 100%)`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        fontFamily: uiFont,
      }}
    >
      {/* Phone frame */}
      <div
        className="lexio-phone-frame"
        style={{
          width: 390,
          height: 844,
          borderRadius: 52,
          overflow: "hidden",
          position: "relative",
          background: C.bg,
          boxShadow: "0 60px 120px rgba(108, 71, 255, 0.25), 0 0 0 12px #1A1A2E, 0 0 0 14px rgba(255,255,255,0.3)",
          flexShrink: 0,
        }}
      >
        {/* Status bar notch */}
        <div className="lexio-phone-notch" style={{
          position: "absolute", top: 0, left: "50%", transform: "translateX(-50%)",
          width: 120, height: 34, background: "#1A1A2E", borderRadius: "0 0 20px 20px",
          zIndex: 100,
        }} />
        {/* Screen content */}
        <div className="lexio-screen-content" style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: showTabs ? 84 : 0,
          overflowY: "auto",
          overflowX: "hidden",
          background: C.bg,
        }}>
          {screen === "splash" && <SplashScreen onNext={() => setScreen("onboard")} />}
          {screen === "onboard" && <OnboardingFlow onDone={() => { setScreen("home"); setTab("home"); }} />}
          {screen === "home" && <HomeScreen onStartLesson={() => handleStartLesson()} onTabChange={handleTabChange} />}
          {screen === "learn" && <LearnScreen onStartLesson={(id) => handleStartLesson(id)} />}
          {screen === "games" && <GamesGridScreen lessonId={currentLessonId} onExit={handleLessonDone} />}
          {screen === "lesson" && <LessonScreen onDone={handleLessonDone} lessonId={currentLessonId} />}
          {screen === "progress" && <ProgressScreen />}
          {screen === "rewards" && <RewardsScreen />}
          {screen === "profile" && <ProfileScreen onRestart={() => setScreen("splash")} onOpenParent={() => setScreen("parent")} />}
          {screen === "parent" && <ParentScreen onExit={() => setScreen("profile")} />}
        </div>
        {/* Tab bar */}
        {showTabs && (
          <div className="lexio-tab-wrap" style={{ position: "absolute", bottom: 0, left: 0, right: 0 }}>
            <TabBar active={tab} onChange={handleTabChange} />
          </div>
        )}
      </div>
    </div>
  );
}
