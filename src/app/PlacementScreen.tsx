// ─── Placement Screen ────────────────────────────────────────────────────────
// Walks a learner through the placement probe and produces a skill profile.
//
// Replaces age as the thing that decides where practice starts. See
// src/curriculum/placement.ts for the scoring rules and the reasoning.
//
// Design constraints for this audience:
//   • No timer and no score shown. This is placement, not a test to pass, and
//     visible scoring makes a struggling reader anxious.
//   • Wrong answers get no buzzer or red X — the probe advances calmly either
//     way, so a learner can't tell they're "failing" and give up.
//   • Testing stops early via the ceiling rule, so nobody grinds through
//     material well beyond their level.

import { useState, useMemo, useCallback, useEffect } from "react";
import { motion } from "motion/react";
import {
  SKILL_BANDS,
  bandById,
  type SkillBandId,
} from "../curriculum/scopeAndSequence";
import {
  itemsForBand,
  profileFromResults,
  PASS_THRESHOLD,
  type BandResult,
  type SkillProfile,
} from "../curriculum/placement";

type Props = {
  /** Colors + font passed in so this file doesn't duplicate the theme. */
  theme: {
    bg: string; ink: string; muted: string; white: string;
    primary: string; primaryDark: string; primarySoft: string;
    teal: string; tealSoft: string;
  };
  uiFont: string;
  dyslexicFont: string;
  /** Speaks a single grapheme in isolation. */
  speakPhoneme: (letters: string) => void;
  /** Speaks a whole word. */
  speakWord: (text: string) => void;
  onComplete: (profile: SkillProfile) => void;
  /** Lets a family skip; they land at the first band and a teacher can adjust. */
  onSkip: () => void;
};

export function PlacementScreen({
  theme: C, uiFont, dyslexicFont, speakPhoneme, speakWord, onComplete, onSkip,
}: Props) {
  const [bandIndex, setBandIndex] = useState(0);
  const [itemIndex, setItemIndex] = useState(0);
  const [missesThisBand, setMissesThisBand] = useState(0);
  const [correctThisBand, setCorrectThisBand] = useState(0);
  const [results, setResults] = useState<BandResult[]>([]);
  const [locked, setLocked] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);

  const band = SKILL_BANDS[bandIndex];
  const items = useMemo(() => (band ? itemsForBand(band.id) : []), [band]);
  const item = items[itemIndex];

  const speak = useCallback(() => {
    if (!item) return;
    if (item.promptKind === "phoneme") speakPhoneme(item.prompt);
    else speakWord(item.prompt);
  }, [item, speakPhoneme, speakWord]);

  // Auto-play each new item so a pre-reader isn't stuck waiting for a tap.
  useEffect(() => {
    if (!item) return;
    const t = setTimeout(speak, 350);
    return () => clearTimeout(t);
  }, [item, speak]);

  const finish = useCallback((finalResults: BandResult[]) => {
    onComplete(profileFromResults(finalResults));
  }, [onComplete]);

  const choose = (choice: string) => {
    if (locked || !item || !band) return;
    setLocked(true);
    setPicked(choice);

    const right = choice === item.answer;
    const nextCorrect = correctThisBand + (right ? 1 : 0);
    const nextMisses = missesThisBand + (right ? 0 : 1);

    setTimeout(() => {
      setLocked(false);
      setPicked(null);

      const isLastItem = itemIndex + 1 >= items.length;

      // Always finish the band before judging it. Stopping on the first miss
      // let one mis-tap end the assessment and bottom out the placement.
      if (!isLastItem) {
        setItemIndex(i => i + 1);
        setMissesThisBand(nextMisses);
        setCorrectThisBand(nextCorrect);
        return;
      }

      const bandResult: BandResult = {
        band: band.id,
        correct: nextCorrect,
        total: items.length,
      };
      const nextResults = [...results, bandResult];
      setResults(nextResults);

      // Stop at the first band they didn't pass — that's their level.
      const passedBand = nextCorrect >= PASS_THRESHOLD;
      if (!passedBand || bandIndex + 1 >= SKILL_BANDS.length) {
        finish(nextResults);
        return;
      }
      setBandIndex(i => i + 1);
      setItemIndex(0);
      setMissesThisBand(0);
      setCorrectThisBand(0);
    }, 480);
  };

  if (!band || !item) return null;

  // Progress reflects bands cleared, not a score — deliberately coarse so it
  // reads as "how far along" rather than "how many you got right".
  const progress = (bandIndex + itemIndex / Math.max(1, items.length)) / SKILL_BANDS.length;

  return (
    <div
      className="flex flex-col h-full"
      style={{ background: C.bg, fontFamily: uiFont, padding: "48px 20px 24px" }}
    >
      {/* Progress + skip */}
      <div className="flex items-center gap-3 mb-6">
        <div style={{ flex: 1, height: 8, borderRadius: 4, background: C.primarySoft }}>
          <motion.div
            animate={{ width: `${Math.min(100, progress * 100)}%` }}
            transition={{ type: "spring", stiffness: 120, damping: 20 }}
            style={{ height: "100%", borderRadius: 4, background: C.primary }}
          />
        </div>
        <button
          onClick={onSkip}
          style={{
            border: "none", background: "transparent", cursor: "pointer",
            color: C.muted, fontSize: 12, fontWeight: 700, fontFamily: uiFont,
          }}
        >
          Skip
        </button>
      </div>

      <div style={{ fontSize: 11, fontWeight: 800, color: C.muted, letterSpacing: 1.6, textTransform: "uppercase" }}>
        Let's find your starting point
      </div>
      <div style={{ fontSize: 20, fontWeight: 800, color: C.ink, lineHeight: 1.2, marginTop: 4 }}>
        {item.instruction}
      </div>

      {/* Replay button — big, central, the only thing to tap before answering */}
      <div className="flex-1 flex items-center justify-center">
        <motion.button
          whileTap={{ scale: 0.94 }}
          onClick={speak}
          style={{
            border: "none", cursor: "pointer",
            minWidth: 150, height: 110, borderRadius: 26, padding: "0 26px",
            background: `linear-gradient(135deg, ${C.primary}, ${C.primaryDark})`,
            color: "white", fontWeight: 900, fontSize: 34,
            fontFamily: dyslexicFont,
            display: "flex", alignItems: "center", justifyContent: "center", gap: 12,
            boxShadow: "0 10px 28px rgba(108,71,255,0.35)",
          }}
          aria-label="Play the sound again"
        >
          <span style={{ fontSize: 26 }}>🔊</span>
          {item.promptKind === "phoneme" ? item.prompt : "Listen"}
        </motion.button>
      </div>

      {/* Choices */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        {item.choices.map(choice => {
          const isPicked = picked === choice;
          return (
            <motion.button
              key={choice}
              whileTap={{ scale: 0.95 }}
              onClick={() => choose(choice)}
              disabled={locked}
              style={{
                border: "none",
                cursor: locked ? "default" : "pointer",
                // Selection is acknowledged neutrally. No correct/incorrect
                // colouring: a learner who sees red repeatedly disengages, and
                // placement needs their honest best guess, not their morale.
                background: isPicked ? C.primarySoft : C.white,
                color: C.ink,
                borderRadius: 18,
                padding: "20px 12px",
                fontSize: 24, fontWeight: 800,
                fontFamily: dyslexicFont,
                boxShadow: "0 3px 10px rgba(108,71,255,0.10)",
              }}
            >
              {choice}
            </motion.button>
          );
        })}
      </div>

      <div style={{ fontSize: 11, color: C.muted, textAlign: "center", marginTop: 14, lineHeight: 1.5 }}>
        This isn't a test — it just helps us pick where to start.
      </div>
    </div>
  );
}

/** Learner-facing summary shown after placement. */
export function bandSummary(profile: SkillProfile): { label: string; description: string } {
  const b = bandById(profile.startBand as SkillBandId);
  return {
    label: b?.label ?? "Letter Sounds",
    description: b?.description ?? "",
  };
}
