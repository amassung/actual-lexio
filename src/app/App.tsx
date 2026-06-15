import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { motion } from "motion/react";
import { DndProvider, useDrag, useDrop } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import { TouchBackend } from "react-dnd-touch-backend";
import { useStore, type LessonResult, pickWord, WORD_BANK } from "../store";
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
const PHONEME_MAP: Record<string, { text: string; rate: number }> = {
  // Digraphs / blends — TTS handles these reasonably well
  sh: { text: "Shhhhh", rate: 0.4 },
  ch: { text: "ch, ch, ch", rate: 0.5 },
  th: { text: "Thhhh", rate: 0.4 },
  wh: { text: "wh, wh", rate: 0.5 },
  // Vowels — short sounds
  a: { text: "ahh", rate: 0.5 },
  e: { text: "ehh", rate: 0.5 },
  i: { text: "ih", rate: 0.55 },
  o: { text: "ahh", rate: 0.5 },
  u: { text: "uhh", rate: 0.55 },
  // Continuants — sustained / drawn out
  m: { text: "Mmmmmmm", rate: 0.35 },
  n: { text: "Nnnnnnn", rate: 0.35 },
  s: { text: "Sssssss", rate: 0.4 },
  f: { text: "Ffffff", rate: 0.4 },
  l: { text: "Llllll", rate: 0.4 },
  r: { text: "Rrrrrr", rate: 0.45 },
  z: { text: "Zzzzzz", rate: 0.4 },
  v: { text: "Vvvvvv", rate: 0.4 },
  // Stops — pair with short "i" rather than schwa "uh"
  t: { text: "ti, ti, ti", rate: 0.55 },
  p: { text: "pi, pi, pi", rate: 0.55 },
  k: { text: "ki, ki, ki", rate: 0.55 },
  b: { text: "bi, bi, bi", rate: 0.55 },
  d: { text: "di, di, di", rate: 0.55 },
  g: { text: "gi, gi, gi", rate: 0.55 },
};
function speakPhoneme(letters: string) {
  const key = letters.toLowerCase();
  // Prefer a recorded clip if present; only TTS as fallback.
  void playPhonemeFile(key).then(played => {
    if (played) return;
    const entry = PHONEME_MAP[key] ?? { text: letters, rate: 0.55 };
    void playTTS(entry.text, { rate: entry.rate });
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
type Screen = "splash" | "onboard" | "home" | "learn" | "lesson" | "progress" | "rewards" | "profile" | "parent";
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
    id: "sh-sound", phoneme: "SH", word: "ship", wordEmoji: "⛵",
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
  const ages = [6, 7, 8, 9, 10, 11, 12, "13+"];
  const allMascots = [
    { Comp: Lexi, name: "Lexi", desc: "Your guide", color: C.lexi },
    { Comp: Echo, name: "Echo", desc: "Listens with you", color: C.teal },
    { Comp: Glow, name: "Glow", desc: "Reads with you", color: C.glow },
    { Comp: Bubble, name: "Bubble", desc: "Speaks with you", color: C.blush },
    { Comp: Brick, name: "Brick", desc: "Builds words", color: C.amber },
  ];
  const next = () => {
    if (step < 2) { setStep(step + 1); return; }
    setStore({ name: name.trim(), age, onboarded: true });
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

// ─── Learn / Path Screen ──────────────────────────────────────────────────────
function LearnScreen({ onStartLesson }: { onStartLesson: (id: string) => void }) {
  const masteredPhonemes = useStore(s => s.masteredPhonemes);

  const learnPath = LEARN_PATH_DEF.map((def, i) => {
    const done = masteredPhonemes.includes(def.id);
    const prevDone = i === 0 || masteredPhonemes.includes(LEARN_PATH_DEF[i - 1].id);
    const locked = !done && !prevDone;
    const current = !done && prevDone;
    return { ...def, done, locked, current };
  });

  const doneCount = learnPath.filter(n => n.done).length;
  const chapterIdx = Math.floor(doneCount / 4);
  const chapterNames = ["Level 1: First Sounds (M, S, T, A, P, N)", "Level 2: Short Vowels", "Level 3: Blends & Digraphs", "Level 4: Long Vowels"];
  const chapterName = chapterNames[Math.min(chapterIdx, chapterNames.length - 1)];

  return (
    <div className="flex flex-col h-full" style={{ fontFamily: uiFont, background: C.bg }}>
      <div className="px-6 pt-14 pb-4">
        <div style={{ fontSize: 24, fontWeight: 700, color: C.ink }}>Learning Path</div>
        <div style={{ fontSize: 14, color: C.muted, marginTop: 2 }}>{chapterName}</div>
        <div className="flex gap-3 mt-4">
          {[
            { label: `${doneCount} done`, color: C.teal },
            { label: `Chapter ${chapterIdx + 1}`, color: C.primary },
            { label: `Level ${doneCount + 1}`, color: C.amber },
          ].map(b => (
            <div key={b.label} style={{
              padding: "6px 14px", borderRadius: 20,
              background: b.color + "20", color: b.color, fontSize: 12, fontWeight: 600
            }}>{b.label}</div>
          ))}
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
                onClick={!node.locked && !node.done ? () => onStartLesson(node.id) : node.done ? () => onStartLesson(node.id) : undefined}
                style={{
                  width: node.boss ? 72 : 56,
                  height: node.boss ? 72 : 56,
                  borderRadius: node.boss ? 36 : 28,
                  background: node.done
                    ? `linear-gradient(135deg, ${C.teal}, ${C.echoDark})`
                    : node.current
                      ? `linear-gradient(135deg, ${C.primary}, ${C.primaryDark})`
                      : node.locked ? "#E8E5F0" : C.primarySoft,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  boxShadow: node.current
                    ? `0 8px 24px rgba(108,71,255,0.4)`
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
                color: node.locked ? C.muted : node.current ? C.primary : C.ink,
                textAlign: "center", maxWidth: 80
              }}>{node.label}</div>
              {node.current && (
                <div style={{
                  background: C.primary, color: "white", fontSize: 9, fontWeight: 700,
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
              <div className="flex gap-2 mt-2">
                <div style={{ padding: "4px 10px", borderRadius: 8, background: C.primary, color: "white", fontSize: 11, fontWeight: 700 }}>
                  {xp.toLocaleString()} XP
                </div>
                <div style={{ padding: "4px 10px", borderRadius: 8, background: C.amberSoft, color: C.amber, fontSize: 11, fontWeight: 700 }}>
                  🔥 {streak} days
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
    setScreen("lesson");
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
