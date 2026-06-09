import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export type TextSize = "small" | "medium" | "large";

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
  difficultyLevel: 1 | 2 | 3; // 1=easy, 2=med, 3=hard
  set: (patch: Partial<Omit<State, "set" | "addXp" | "completeLesson" | "reset" | "recordHit" | "recordMiss">>) => void;
  addXp: (n: number) => void;
  completeLesson: (phoneme: string, xp: number) => LessonResult;
  recordHit: () => void;
  recordMiss: () => void;
  reset: () => void;
};

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
          const next = { hitsInARow: s.hitsInARow + 1, missesInARow: 0, difficultyLevel: s.difficultyLevel };
          if (next.hitsInARow >= 5 && s.difficultyLevel < 3) {
            next.difficultyLevel = (s.difficultyLevel + 1) as 1 | 2 | 3;
            next.hitsInARow = 0;
          }
          return next;
        }),
      recordMiss: () =>
        set((s) => {
          const next = { missesInARow: s.missesInARow + 1, hitsInARow: 0, difficultyLevel: s.difficultyLevel };
          if (next.missesInARow >= 3 && s.difficultyLevel > 1) {
            next.difficultyLevel = (s.difficultyLevel - 1) as 1 | 2 | 3;
            next.missesInARow = 0;
          }
          return next;
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
