import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export type TextSize = "small" | "medium" | "large";

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
  set: (patch: Partial<Omit<State, "set" | "addXp" | "completeLesson" | "reset">>) => void;
  addXp: (n: number) => void;
  completeLesson: (phoneme: string, xp: number) => void;
  reset: () => void;
};

export const useStore = create<State>()(
  persist(
    (set) => ({
      name: "",
      age: null,
      activeMascot: 0,
      textSize: "medium",
      bgTint: 0,
      streak: 7,
      xp: 105,
      lessonsCompleted: 0,
      masteredPhonemes: [],
      onboarded: false,
      set: (patch) => set(patch),
      addXp: (n) => set((s) => ({ xp: s.xp + n })),
      completeLesson: (phoneme, xp) =>
        set((s) => ({
          xp: s.xp + xp,
          lessonsCompleted: s.lessonsCompleted + 1,
          masteredPhonemes: s.masteredPhonemes.includes(phoneme)
            ? s.masteredPhonemes
            : [...s.masteredPhonemes, phoneme],
        })),
      reset: () =>
        set({
          name: "",
          age: null,
          activeMascot: 0,
          textSize: "medium",
          bgTint: 0,
          onboarded: false,
        }),
    }),
    {
      name: "lexio-v4",
      storage: createJSONStorage(() => localStorage),
    }
  )
);
