import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { syncLessonCompletion, syncGameSession, syncStudentProgress } from "./services/progressSync";

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

// ─── Multi-profile support ────────────────────────────────────────────────────
// Multiple kids share one device. Each kid has their own progress (XP, streak,
// mastered lessons, game stats, tier, mascot, etc.).
//
// Data model:
//   - "Flat state" (name, age, xp, streak, etc.) = the ACTIVE kid's state.
//     Existing code across the app reads flat state directly — no changes.
//   - `profiles: Record<id, ProfileSnapshot>` = saved snapshots per kid.
//   - `activeProfileId` = which kid is currently signed in.
//
// Switch flow: current flat → save to profiles[activeId] → load profiles[targetId] → flat.
// Add flow: current flat → save → reset flat to defaults + activeId=null → app routes to onboarding.
export type ProfileSnapshot = {
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
  lastSessionDay: string | null;
  lastShieldUseDay: string | null;
  hitsInARow: number;
  missesInARow: number;
  difficultyLevel: 1 | 2 | 3;
  difficultyTier: DifficultyTier;
  gameStats: Record<string, GameStat>;
  // "Continue where you left off" — updated on lesson entry and game launch.
  lastLessonId: string | null;
  lastGameKey: string | null;
};

type State = ProfileSnapshot & {
  // Multi-profile registry
  profiles: Record<string, ProfileSnapshot>;
  activeProfileId: string | null;

  set: (patch: Partial<Omit<State, "set" | "addXp" | "completeLesson" | "reset" | "recordHit" | "recordMiss" | "nudgeTier" | "recordGameStat" | "createProfile" | "switchProfile" | "startAddProfile" | "deleteProfile">>) => void;
  addXp: (n: number) => void;
  completeLesson: (phoneme: string, xp: number) => LessonResult;
  recordHit: () => void;
  recordMiss: () => void;
  // Manual tier nudge — call from adaptive engine, parent dashboard override,
  // or tests. Always safe; clamps at the ends.
  nudgeTier: (direction: "up" | "down") => void;
  // Append one game-session result to the rollup for that game key.
  // Optional `phoneme` gets attached to the Supabase game_sessions row so
  // teacher dashboards can slice accuracy by phoneme × game type.
  recordGameStat: (
    gameKey: string,
    payload: { correct: number; total: number; elapsedMs: number; phoneme?: string | null },
  ) => void;

  // ── Profile actions ──
  // Create a profile from the current onboarded flat state (called at end of
  // onboarding). Generates an id and stores the snapshot.
  createProfile: () => string;
  // Save current flat → profiles[current], then load profiles[targetId] → flat.
  switchProfile: (targetId: string) => void;
  // Save current flat → profiles[current], then reset flat state (onboarded=false)
  // and clear activeProfileId → App shell routes to onboarding for the new kid.
  startAddProfile: () => void;
  // Delete a profile. If deleting the active one, load the first remaining
  // profile OR reset to fresh + clear activeProfileId.
  deleteProfile: (id: string) => void;

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

// Default profile shape — used for fresh onboarding and reset()
const emptyProfile = (): ProfileSnapshot => ({
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
  lastLessonId: null,
  lastGameKey: null,
});

// Extract the profile-level fields from state (excludes actions + profiles map).
function snapshotOf(s: State): ProfileSnapshot {
  return {
    name: s.name, age: s.age, activeMascot: s.activeMascot,
    textSize: s.textSize, bgTint: s.bgTint, streak: s.streak,
    xp: s.xp, lessonsCompleted: s.lessonsCompleted,
    masteredPhonemes: s.masteredPhonemes, onboarded: s.onboarded,
    weeklyDigest: s.weeklyDigest, parentEmail: s.parentEmail,
    lastSessionDay: s.lastSessionDay, lastShieldUseDay: s.lastShieldUseDay,
    hitsInARow: s.hitsInARow, missesInARow: s.missesInARow,
    difficultyLevel: s.difficultyLevel, difficultyTier: s.difficultyTier,
    gameStats: s.gameStats,
    lastLessonId: s.lastLessonId, lastGameKey: s.lastGameKey,
  };
}

// Generate a short random id for a profile.
function newProfileId(): string {
  return "p_" + Math.random().toString(36).slice(2, 10);
}

export const useStore = create<State>()(
  persist(
    (set, get) => ({
      // Active kid's flat state (defaults to a fresh profile)
      ...emptyProfile(),
      // Multi-profile registry
      profiles: {},
      activeProfileId: null,
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

        const nextLessonsCompleted = s.lessonsCompleted + 1;
        set({
          xp: newXp,
          lessonsCompleted: nextLessonsCompleted,
          masteredPhonemes: s.masteredPhonemes.includes(phoneme)
            ? s.masteredPhonemes
            : [...s.masteredPhonemes, phoneme],
          lastSessionDay: today,
          lastShieldUseDay,
          streak: newStreak,
        });

        // ── Fire-and-forget Supabase sync ──
        // record_lesson_completion is idempotent per-completion, so we send
        // one row per call. Progress fields go through the debounced sync.
        void syncLessonCompletion(phoneme, xp);
        syncStudentProgress({
          xp: newXp,
          streak: newStreak,
          lessons_completed: nextLessonsCompleted,
          last_session_day: today,
          last_shield_use_day: lastShieldUseDay,
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
          // Debounced push — coalesces bursts into one server write.
          syncStudentProgress({
            hits_in_a_row: next.hitsInARow ?? 0,
            misses_in_a_row: 0,
            difficulty_level: next.difficultyLevel,
            difficulty_tier: next.difficultyTier,
          });
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
          syncStudentProgress({
            hits_in_a_row: 0,
            misses_in_a_row: next.missesInARow ?? 0,
            difficulty_level: next.difficultyLevel,
            difficulty_tier: next.difficultyTier,
          });
          return next;
        }),
      nudgeTier: (direction) =>
        set((s) => {
          const nextTier = bumpTier(s.difficultyTier, direction);
          syncStudentProgress({
            difficulty_tier: nextTier,
            difficulty_level: 2,
            hits_in_a_row: 0,
            misses_in_a_row: 0,
          });
          return {
            difficultyTier: nextTier,
            // Reset the per-tier complexity to a neutral starting point.
            difficultyLevel: 2,
            hitsInARow: 0,
            missesInARow: 0,
          };
        }),
      recordGameStat: (gameKey, payload) => {
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
        });
        // Fire-and-forget: one game_sessions row per finished game, plus a
        // debounced progress push so `last_game_key` reflects reality.
        void syncGameSession({
          gameKey,
          phoneme: payload.phoneme ?? null,
          correct: payload.correct,
          total: payload.total,
          elapsedMs: payload.elapsedMs,
        });
        syncStudentProgress({
          last_lesson_id: get().lastLessonId ?? null,
          last_game_key: gameKey,
        });
      },

      // ── Profile actions ──────────────────────────────────────────────────
      createProfile: () => {
        const s = get();
        const id = newProfileId();
        set({
          activeProfileId: id,
          profiles: { ...s.profiles, [id]: snapshotOf(s) },
        });
        return id;
      },

      switchProfile: (targetId) => {
        const s = get();
        if (targetId === s.activeProfileId) return;
        const target = s.profiles[targetId];
        if (!target) return; // no such profile — no-op
        // Save current flat → profiles[currentId], then load target → flat.
        const nextProfiles = { ...s.profiles };
        if (s.activeProfileId) nextProfiles[s.activeProfileId] = snapshotOf(s);
        set({
          ...target,
          profiles: nextProfiles,
          activeProfileId: targetId,
        });
      },

      startAddProfile: () => {
        const s = get();
        // Save current flat → profiles map so the current kid's progress is safe
        const nextProfiles = { ...s.profiles };
        if (s.activeProfileId) nextProfiles[s.activeProfileId] = snapshotOf(s);
        // Reset flat state to a fresh profile so the App shell routes to onboarding
        set({
          ...emptyProfile(),
          profiles: nextProfiles,
          activeProfileId: null,
        });
      },

      deleteProfile: (id) => {
        const s = get();
        const nextProfiles = { ...s.profiles };
        delete nextProfiles[id];
        if (id !== s.activeProfileId) {
          // Deleting a non-active profile — flat state untouched
          set({ profiles: nextProfiles });
          return;
        }
        // Deleting the active profile — pick a fallback
        const remaining = Object.keys(nextProfiles);
        if (remaining.length > 0) {
          const nextId = remaining[0];
          const nextSnap = nextProfiles[nextId];
          set({ ...nextSnap, profiles: nextProfiles, activeProfileId: nextId });
        } else {
          // No profiles left — back to fresh onboarding
          set({ ...emptyProfile(), profiles: nextProfiles, activeProfileId: null });
        }
      },

      reset: () =>
        set({
          ...emptyProfile(),
          profiles: {},
          activeProfileId: null,
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
