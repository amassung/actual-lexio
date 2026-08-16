// ─── Scope & Sequence ────────────────────────────────────────────────────────
//
// ⚠️  FOR SPECIALIST REVIEW — NOT YET VALIDATED
//
// This file is the single place where Lexio's instructional order lives. It is
// deliberately isolated from UI code so an Orton-Gillingham-trained specialist
// can review and correct the sequence without touching the app.
//
// It encodes widely-published structured-literacy principles (simple → complex,
// high-utility → low-utility, phonemes before the patterns that build on them).
// It has NOT been validated by an OG-trained practitioner. Every ordering
// decision below is a starting draft for review, not an authoritative sequence.
//
// KNOWN GAPS in the current app content (verified against the lesson data):
//   • Only m, s, t, p, n have consonant lessons. Missing: b c d f g h j k l
//     q r v w x y z — 16 of 21 consonants.
//   • Zero consonant blend lessons (bl, cr, st, …), despite a category named
//     "Blends & Digraphs" that contains only digraphs.
//   • Zero r-controlled vowel lessons (ar, er, ir, or, ur).
//   • "oo" has a second sound /ʊ/ (book, look, good) with no lesson.
//
// Bands are ordered but the order is data, not logic — reordering this array
// changes the sequence everywhere, including placement.

export type SkillBandId =
  | "letter-sounds"
  | "cvc"
  | "digraphs"
  | "blends"
  | "vce"
  | "vowel-teams"
  | "r-controlled";

export type SkillBand = {
  id: SkillBandId;
  /** Learner-facing name. Deliberately not age- or grade-linked: an 11-year-old
   *  working on letter sounds should not be shown "Level 1" or "Pre-K". */
  label: string;
  /** One line a teacher or parent can understand without phonics training. */
  description: string;
  /** Lesson ids from LESSONS that belong to this band. Empty means the app has
   *  no content for it yet — surfaced honestly rather than hidden. */
  lessonIds: string[];
};

export const SKILL_BANDS: SkillBand[] = [
  {
    id: "letter-sounds",
    label: "Letter Sounds",
    description: "Hearing and naming the sound each single letter makes.",
    lessonIds: ["m-sound", "s-sound", "t-sound", "p-sound", "n-sound"],
  },
  {
    id: "cvc",
    label: "Short Vowel Words",
    description: "Blending three sounds into words like cat, hen, and pig.",
    lessonIds: ["short-a", "short-i", "short-e", "short-o", "short-u"],
  },
  {
    id: "digraphs",
    label: "Two Letters, One Sound",
    description: "Letter pairs that make a single new sound: sh, ch, th, wh, ck.",
    lessonIds: ["sh-sound", "ch-sound", "th-sound", "wh-team", "ck-team"],
  },
  {
    id: "blends",
    label: "Blended Sounds",
    description: "Two consonants keeping both sounds: bl, cr, st, and others.",
    // No content yet — see KNOWN GAPS above.
    lessonIds: [],
  },
  {
    id: "vce",
    label: "Silent E",
    description: "A final e making the vowel say its name: cake, bike, hope.",
    lessonIds: ["cvce-a", "cvce-i", "cvce-o", "cvce-u"],
  },
  {
    id: "vowel-teams",
    label: "Vowel Teams",
    description: "Vowel pairs working together: ai, ee, oa, ea, igh, oo.",
    lessonIds: ["long-a", "long-e", "long-o", "long-i", "ea-team", "oo-team"],
  },
  {
    id: "r-controlled",
    label: "R-Controlled Vowels",
    description: "Vowels changed by a following r: car, her, bird, corn, turn.",
    // No content yet — see KNOWN GAPS above.
    lessonIds: [],
  },
];

export function bandById(id: SkillBandId): SkillBand | undefined {
  return SKILL_BANDS.find(b => b.id === id);
}

/** Bands that actually have lessons — used so placement never routes a learner
 *  to a band with nothing to practice. */
export function bandsWithContent(): SkillBand[] {
  return SKILL_BANDS.filter(b => b.lessonIds.length > 0);
}
