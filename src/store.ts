import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export type TextSize = "small" | "medium" | "large";

// ─── Difficulty tier ──────────────────────────────────────────────────────────
// Coarse age-cohort setting that controls word complexity, number of letter
// tiles in build games, and lesson pacing. Set from age at onboarding, then
// nudge-able by the adaptive engine when the kid blows through the ceiling
// (or hits a wall) of the per-tier difficulty band.
//   foundational → ages 4–5    (short CVC, 2–3 tiles, slow pacing)
//   developing   → ages 6–7    (CVC + simple blends, 3–4 tiles, medium pacing)
//   advanced     → ages 8+     (blends, digraphs, multisyllabic, 4–5 tiles, brisk)
export type DifficultyTier = "foundational" | "developing" | "advanced";

const TIER_ORDER: DifficultyTier[] = ["foundational", "developing", "advanced"];

export function tierForAge(age: number | null): DifficultyTier {
  if (age == null) return "developing";
  if (age <= 5) return "foundational";
  if (age <= 7) return "developing";
  return "advanced";
}

function bumpTier(tier: DifficultyTier, direction: "up" | "down"): DifficultyTier {
  const i = TIER_ORDER.indexOf(tier);
  const delta = direction === "up" ? 1 : -1;
  const next = Math.max(0, Math.min(TIER_ORDER.length - 1, i + delta));
  return TIER_ORDER[next];
}

// Day = YYYY-MM-DD in local time
const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const dayDiff = (a: string, b: string) => {
  const da = new Date(a + "T00:00:00").getTime();
  const db = new Date(b + "T00:00:00").getTime();
  return Math.round((db - da) / 86400000);
};
const levelFor = (xp: number) => Math.max(1, Math.floor(xp / 500) + 1);

export type LessonResult = {
  oldLevel: number;
  newLevel: number;
  levelUp: boolean;
  oldStreak: number;
  newStreak: number;
  shieldUsed: boolean;
  newXp: number;
};

type State = {
  name: string;
  age: number | null;
  activeMascot: number;
  textSize: TextSize;
  bgTint: number;
  streak: number;
  xp: number;
  lessonsCompleted: number;
  masteredPhonemes: string[];
  onboarded: boolean;
  weeklyDigest: boolean;
  parentEmail: string;
  // Streak shield + daily session tracking
  lastSessionDay: string | null;
  lastShieldUseDay: string | null;
  // Adaptive difficulty (lightweight running counters)
  hitsInARow: number;
  missesInARow: number;
  difficultyLevel: 1 | 2 | 3; // word complexity WITHIN the current tier
  difficultyTier: DifficultyTier; // coarse cohort — see DifficultyTier comment
  // Per-game-type rollup: accuracy, attempts, time. Keyed by game key
  // (e.g. "trace", "build", "flashcards", "listen-up", "fill-blank").
  gameStats: Record<string, GameStat>;
  set: (patch: Partial<Omit<State, "set" | "addXp" | "completeLesson" | "reset" | "recordHit" | "recordMiss" | "nudgeTier" | "recordGameStat">>) => void;
  addXp: (n: number) => void;
  completeLesson: (phoneme: string, xp: number) => LessonResult;
  recordHit: () => void;
  recordMiss: () => void;
  // Manual tier nudge — call from adaptive engine, parent dashboard override,
  // or tests. Always safe; clamps at the ends.
  nudgeTier: (direction: "up" | "down") => void;
  // Append one game-session result to the rollup for that game key.
  recordGameStat: (
    gameKey: string,
    payload: { correct: number; total: number; elapsedMs: number },
  ) => void;
  reset: () => void;
};

export type GameStat = {
  attempts: number;       // number of completed sessions
  correct: number;        // accumulated correct answers across sessions
  total: number;          // accumulated answered questions across sessions
  totalTimeMs: number;    // accumulated time spent
  lastPlayedAt: number;   // epoch ms of most recent session
};

const emptyGameStat = (): GameStat => ({
  attempts: 0, correct: 0, total: 0, totalTimeMs: 0, lastPlayedAt: 0,
});

export const useStore = create<State>()(
  persist(
    (set, get) => ({
      name: "",
      age: null,
      activeMascot: 0,
      textSize: "medium",
      bgTint: 0,
      streak: 0,
      xp: 0,
      lessonsCompleted: 0,
      masteredPhonemes: [],
      onboarded: false,
      weeklyDigest: false,
      parentEmail: "",
      lastSessionDay: null,
      lastShieldUseDay: null,
      hitsInARow: 0,
      missesInARow: 0,
      difficultyLevel: 2,
      difficultyTier: "developing",
      gameStats: {},
      set: (patch) => set(patch),
      addXp: (n) => set((s) => ({ xp: s.xp + n })),
      completeLesson: (phoneme, xp) => {
        const s = get();
        const today = todayKey();
        const oldXp = s.xp;
        const newXp = oldXp + xp;
        const oldLevel = levelFor(oldXp);
        const newLevel = levelFor(newXp);

        // Streak + shield logic
        let newStreak = s.streak;
        let shieldUsed = false;
        let lastShieldUseDay = s.lastShieldUseDay;
        if (!s.lastSessionDay) {
          newStreak = 1;
        } else {
          const gap = dayDiff(s.lastSessionDay, today);
          if (gap === 0) {
            // same day, no streak change
          } else if (gap === 1) {
            newStreak = s.streak + 1;
          } else if (gap > 1) {
            // Shield available if never used or used >=7 days ago
            const shieldAvail = !s.lastShieldUseDay || dayDiff(s.lastShieldUseDay, today) >= 7;
            if (shieldAvail && gap <= 2) {
              shieldUsed = true;
              lastShieldUseDay = today;
              newStreak = s.streak + 1;
            } else {
              newStreak = 1;
            }
          }
        }

        set({
          xp: newXp,
          lessonsCompleted: s.lessonsCompleted + 1,
          masteredPhonemes: s.masteredPhonemes.includes(phoneme)
            ? s.masteredPhonemes
            : [...s.masteredPhonemes, phoneme],
          lastSessionDay: today,
          lastShieldUseDay,
          streak: newStreak,
        });

        return {
          oldLevel,
          newLevel,
          levelUp: newLevel > oldLevel,
          oldStreak: s.streak,
          newStreak,
          shieldUsed,
          newXp,
        };
      },
      recordHit: () =>
        set((s) => {
          const next: Partial<State> = {
            hitsInARow: s.hitsInARow + 1,
            missesInARow: 0,
            difficultyLevel: s.difficultyLevel,
            difficultyTier: s.difficultyTier,
          };
          if ((next.hitsInARow ?? 0) >= 5) {
            if (s.difficultyLevel < 3) {
              // Headroom within the current tier — bump word complexity.
              next.difficultyLevel = (s.difficultyLevel + 1) as 1 | 2 | 3;
              next.hitsInARow = 0;
            } else if (s.difficultyTier !== "advanced") {
              // Already at the ceiling of this tier and still acing it →
              // promote to the next tier and reset complexity to its floor.
              next.difficultyTier = bumpTier(s.difficultyTier, "up");
              next.difficultyLevel = 1;
              next.hitsInARow = 0;
            }
          }
          return next;
        }),
      recordMiss: () =>
        set((s) => {
          const next: Partial<State> = {
            missesInARow: s.missesInARow + 1,
            hitsInARow: 0,
            difficultyLevel: s.difficultyLevel,
            difficultyTier: s.difficultyTier,
          };
          if ((next.missesInARow ?? 0) >= 3) {
            if (s.difficultyLevel > 1) {
              // Headroom within the current tier — drop word complexity.
              next.difficultyLevel = (s.difficultyLevel - 1) as 1 | 2 | 3;
              next.missesInARow = 0;
            } else if (s.difficultyTier !== "foundational") {
              // Already at the floor of this tier and still missing →
              // demote to the previous tier and reset complexity to its ceiling.
              next.difficultyTier = bumpTier(s.difficultyTier, "down");
              next.difficultyLevel = 3;
              next.missesInARow = 0;
            }
          }
          return next;
        }),
      nudgeTier: (direction) =>
        set((s) => ({
          difficultyTier: bumpTier(s.difficultyTier, direction),
          // Reset the per-tier complexity to a neutral starting point.
          difficultyLevel: 2,
          hitsInARow: 0,
          missesInARow: 0,
        })),
      recordGameStat: (gameKey, payload) =>
        set((s) => {
          const prev = s.gameStats[gameKey] ?? emptyGameStat();
          const next: GameStat = {
            attempts: prev.attempts + 1,
            correct: prev.correct + Math.max(0, payload.correct),
            total: prev.total + Math.max(0, payload.total),
            totalTimeMs: prev.totalTimeMs + Math.max(0, payload.elapsedMs),
            lastPlayedAt: Date.now(),
          };
          return { gameStats: { ...s.gameStats, [gameKey]: next } };
        }),
      reset: () =>
        set({
          name: "",
          age: null,
          activeMascot: 0,
          textSize: "medium",
          bgTint: 0,
          onboarded: false,
          streak: 0,
          xp: 0,
          lessonsCompleted: 0,
          masteredPhonemes: [],
          weeklyDigest: false,
          parentEmail: "",
          lastSessionDay: null,
          lastShieldUseDay: null,
          hitsInARow: 0,
          missesInARow: 0,
          difficultyLevel: 2,
          difficultyTier: "developing",
          gameStats: {},
        }),
    }),
    {
      name: "lexio-v4",
      storage: createJSONStorage(() => localStorage),
    }
  )
);

// Word bank by phoneme — adaptive difficulty pulls from this.
// Difficulty 1 = easy (familiar single-syllable), 3 = hard (clusters/blends).
export const WORD_BANK: Record<string, Record<1 | 2 | 3, string[]>> = {
  sh: {
    1: ["she", "ash"],
    2: ["ship", "shop", "fish"],
    3: ["shrimp", "fresh", "flash"],
  },
  ch: {
    1: ["chi"],
    2: ["chip", "chop", "much"],
    3: ["crunch", "branch"],
  },
  th: {
    1: ["the"],
    2: ["this", "that", "thin"],
    3: ["throw", "thumb"],
  },
};

export function pickWord(phoneme: string, level: 1 | 2 | 3): string {
  const bank = WORD_BANK[phoneme]?.[level] ?? WORD_BANK.sh[2];
  return bank[Math.floor(Math.random() * bank.length)];
}
