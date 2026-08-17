// ─── Placement Assessment ────────────────────────────────────────────────────
//
// ⚠️  FOR SPECIALIST REVIEW — NOT A DIAGNOSTIC INSTRUMENT
//
// Replaces the previous age-based routing. Age does not indicate reading
// ability: a 6-year-old and an 11-year-old can both need letter sounds, and
// routing by birthday guarantees some learners see patterns they were never
// taught while others repeat what they already know.
//
// This is a PLACEMENT probe — it decides where to start practice. It is NOT a
// screener for dyslexia or any other condition, is not normed, and produces no
// diagnostic claim. Copy shown to families must not imply otherwise.
//
// HOW IT WORKS
//   Items are grouped by skill band and asked in sequence order. Every item in
//   a band is asked, then the band passes if the learner got at least
//   `PASS_THRESHOLD` correct. Testing stops at the first band they don't pass —
//   that band is their instructional level.
//
//   Note the band is always completed rather than abandoned on the first miss.
//   An earlier version stopped immediately on any wrong answer, which meant a
//   single mis-tap by a young child ended the whole assessment and placed them
//   at the very bottom. Asking all three items makes one slip recoverable.
//
//   A learner who passes every band starts at the last band with content,
//   rather than being told there is nothing left to practice.
//
// REVIEW NOTES for an OG-trained specialist:
//   • ITEMS_PER_BAND (3) and PASS_THRESHOLD (2) keep the probe under ~2 minutes
//     for a young child. Both are tunable below. Three items is few for a
//     reliable judgement — a specialist may want more per band.
//   • Items use recognition (pick from four) rather than production (say the
//     sound aloud), because the app cannot reliably score speech. A specialist
//     may consider this insufficient evidence of decoding skill.
//   • Word choices are meant to be decodable within their own band.

import { SKILL_BANDS, bandsWithContent, type SkillBandId } from "./scopeAndSequence";

/** How many items are asked per band before moving on. */
export const ITEMS_PER_BAND = 3;
/** Correct answers needed within a band to count it as passed. */
export const PASS_THRESHOLD = 2;

export type PlacementItem = {
  id: string;
  band: SkillBandId;
  /** What the teacher voice speaks. */
  prompt: string;
  /** "phoneme" routes through speakPhoneme; "word" through normal TTS. */
  promptKind: "phoneme" | "word";
  /** Instruction shown on screen above the choices. */
  instruction: string;
  choices: string[];
  answer: string;
};

// Items are intentionally few and plain. Each one probes the band's core skill,
// not vocabulary knowledge — a learner should not fail because they don't know
// what a word means.
export const PLACEMENT_ITEMS: PlacementItem[] = [
  // ── Letter sounds: hear an isolated sound, pick the letter ────────────────
  { id: "ls-1", band: "letter-sounds", prompt: "m", promptKind: "phoneme",
    instruction: "Which letter makes this sound?", choices: ["m", "s", "t", "p"], answer: "m" },
  { id: "ls-2", band: "letter-sounds", prompt: "s", promptKind: "phoneme",
    instruction: "Which letter makes this sound?", choices: ["n", "s", "p", "m"], answer: "s" },
  { id: "ls-3", band: "letter-sounds", prompt: "t", promptKind: "phoneme",
    instruction: "Which letter makes this sound?", choices: ["p", "m", "t", "n"], answer: "t" },

  // ── CVC: hear a word, pick its spelling ──────────────────────────────────
  { id: "cvc-1", band: "cvc", prompt: "cat", promptKind: "word",
    instruction: "Which word did you hear?", choices: ["cat", "cot", "cut", "kit"], answer: "cat" },
  { id: "cvc-2", band: "cvc", prompt: "pig", promptKind: "word",
    instruction: "Which word did you hear?", choices: ["peg", "pig", "pug", "bag"], answer: "pig" },
  { id: "cvc-3", band: "cvc", prompt: "sun", promptKind: "word",
    instruction: "Which word did you hear?", choices: ["sit", "son", "sun", "sat"], answer: "sun" },

  // ── Digraphs: hear a word, pick the pair that starts/ends it ─────────────
  { id: "dg-1", band: "digraphs", prompt: "ship", promptKind: "word",
    instruction: "Which two letters start this word?", choices: ["sh", "ch", "th", "wh"], answer: "sh" },
  { id: "dg-2", band: "digraphs", prompt: "chin", promptKind: "word",
    instruction: "Which two letters start this word?", choices: ["sh", "th", "ch", "ck"], answer: "ch" },
  { id: "dg-3", band: "digraphs", prompt: "duck", promptKind: "word",
    instruction: "Which two letters end this word?", choices: ["ck", "th", "sh", "ch"], answer: "ck" },

  // ── Blends: both consonants keep their sound ─────────────────────────────
  { id: "bl-1", band: "blends", prompt: "stop", promptKind: "word",
    instruction: "Which two letters start this word?", choices: ["st", "sp", "sk", "sn"], answer: "st" },
  { id: "bl-2", band: "blends", prompt: "frog", promptKind: "word",
    instruction: "Which two letters start this word?", choices: ["fl", "fr", "tr", "gr"], answer: "fr" },
  { id: "bl-3", band: "blends", prompt: "clap", promptKind: "word",
    instruction: "Which two letters start this word?", choices: ["cr", "bl", "cl", "pl"], answer: "cl" },

  // ── Silent E: the vowel says its name ────────────────────────────────────
  { id: "vce-1", band: "vce", prompt: "cake", promptKind: "word",
    instruction: "Which word did you hear?", choices: ["cak", "cake", "cack", "kake"], answer: "cake" },
  { id: "vce-2", band: "vce", prompt: "bike", promptKind: "word",
    instruction: "Which word did you hear?", choices: ["bik", "bick", "bike", "byke"], answer: "bike" },
  { id: "vce-3", band: "vce", prompt: "hope", promptKind: "word",
    instruction: "Which word did you hear?", choices: ["hop", "hoap", "hope", "hopp"], answer: "hope" },

  // ── Vowel teams ──────────────────────────────────────────────────────────
  { id: "vt-1", band: "vowel-teams", prompt: "rain", promptKind: "word",
    instruction: "Which letters make the middle sound?", choices: ["ai", "ee", "oa", "igh"], answer: "ai" },
  { id: "vt-2", band: "vowel-teams", prompt: "boat", promptKind: "word",
    instruction: "Which letters make the middle sound?", choices: ["ai", "oa", "oo", "ea"], answer: "oa" },
  { id: "vt-3", band: "vowel-teams", prompt: "beach", promptKind: "word",
    instruction: "Which letters make the middle sound?", choices: ["ee", "ai", "ea", "oa"], answer: "ea" },

  // ── R-controlled vowels ──────────────────────────────────────────────────
  { id: "rc-1", band: "r-controlled", prompt: "car", promptKind: "word",
    instruction: "Which letters make the ending sound?", choices: ["ar", "or", "er", "ur"], answer: "ar" },
  { id: "rc-2", band: "r-controlled", prompt: "bird", promptKind: "word",
    instruction: "Which letters make the middle sound?", choices: ["ar", "ir", "or", "ear"], answer: "ir" },
  { id: "rc-3", band: "r-controlled", prompt: "corn", promptKind: "word",
    instruction: "Which letters make the middle sound?", choices: ["ar", "ur", "or", "er"], answer: "or" },
];

export function itemsForBand(band: SkillBandId): PlacementItem[] {
  return PLACEMENT_ITEMS.filter(i => i.band === band).slice(0, ITEMS_PER_BAND);
}

/** The full ordered item list the probe walks through. */
export function placementSequence(): PlacementItem[] {
  return SKILL_BANDS.flatMap(b => itemsForBand(b.id));
}

export type BandResult = { band: SkillBandId; correct: number; total: number };

export type SkillProfile = {
  /** Where practice should start. */
  startBand: SkillBandId;
  /** Per-band scores, for the teacher report. */
  results: BandResult[];
  /** True when the learner never hit the ceiling — they completed every band. */
  completedAllBands: boolean;
  /** ISO timestamp so a teacher can see how stale a placement is. */
  assessedAt: string;
};

/**
 * Decide the starting band from per-band results.
 *
 * The learner starts at the FIRST band they did not pass — that's the earliest
 * skill with a gap, and starting later would skip unlearned material. If they
 * passed everything, they start at the last band that has lessons, so they are
 * never routed somewhere with nothing to do.
 */
export function profileFromResults(results: BandResult[]): SkillProfile {
  const passed = (r: BandResult) => r.correct >= PASS_THRESHOLD;

  const firstGap = results.find(r => !passed(r));
  const withContent = bandsWithContent();

  let startBand: SkillBandId;
  if (firstGap) {
    const hasContent = withContent.some(b => b.id === firstGap.band);
    if (hasContent) {
      startBand = firstGap.band;
    } else {
      // The band they need has no lessons yet (blends, r-controlled). Fall back
      // to the nearest EARLIER band that has content, so a learner who is stuck
      // consolidates a known skill. Falling forward to a later band would hand
      // someone who just failed blends the harder vowel-team material instead.
      const gapIndex = SKILL_BANDS.findIndex(b => b.id === firstGap.band);
      const earlier = SKILL_BANDS
        .slice(0, gapIndex)
        .filter(b => b.lessonIds.length > 0);
      startBand = earlier[earlier.length - 1]?.id ?? withContent[0]?.id ?? SKILL_BANDS[0].id;
    }
  } else {
    startBand = withContent[withContent.length - 1]?.id ?? SKILL_BANDS[0].id;
  }

  return {
    startBand,
    results,
    completedAllBands: !firstGap,
    assessedAt: new Date().toISOString(),
  };
}
