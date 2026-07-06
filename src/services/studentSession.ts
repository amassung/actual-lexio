// ─── Student session ─────────────────────────────────────────────────────────
// Kids don't have Supabase Auth. Their "session" is just a student_id we
// persist in localStorage after a successful `student_login` RPC call. Every
// server write (progressSync.ts) reads this id and no-ops when null.
//
// See supabase/migrations/001_initial_schema.sql for the RPC contract.

import { supabase, supabaseConfigured } from "./supabase";

const STORAGE_KEY = "lexio.studentId";

export type StudentSession = {
  student_id: string;
  classroom_id: string;
  first_name: string;
  avatar_mascot: number;
  difficulty_tier: "foundational" | "developing" | "advanced";
  difficulty_level: 1 | 2 | 3;
  xp: number;
  streak: number;
  lessons_completed: number;
  mastered_phonemes: string[];
  last_session_day: string | null;
  hits_in_a_row: number;
  misses_in_a_row: number;
  last_lesson_id: string | null;
  last_game_key: string | null;
};

// ─── Session id (localStorage) ───────────────────────────────────────────────
export function getStudentId(): string | null {
  if (typeof window === "undefined") return null;
  try { return window.localStorage.getItem(STORAGE_KEY); } catch { return null; }
}

function setStudentId(id: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (id) window.localStorage.setItem(STORAGE_KEY, id);
    else    window.localStorage.removeItem(STORAGE_KEY);
  } catch {}
}

export function signOutStudent() {
  setStudentId(null);
}

export function isStudentSignedIn(): boolean {
  return supabaseConfigured && !!getStudentId();
}

// ─── RPC: student_login ──────────────────────────────────────────────────────
// Returns the joined student + progress row on success, null otherwise.
// Never throws; the UI just says "no match, try again."
export async function signInAsStudent(
  classCode: string,
  firstName: string,
  pin: string,
): Promise<StudentSession | null> {
  if (!supabaseConfigured) return null;
  const p_class_code = classCode.trim().toUpperCase();
  const p_first_name = firstName.trim();
  const p_pin = pin.trim();
  if (!p_class_code || !p_first_name || !p_pin) return null;

  const { data, error } = await supabase.rpc("student_login", {
    p_class_code, p_pin, p_first_name,
  });
  if (error) {
    // eslint-disable-next-line no-console
    console.warn("[Lexio] student_login failed:", error.message);
    return null;
  }
  const row = Array.isArray(data) && data.length > 0 ? data[0] : null;
  if (!row) return null;

  setStudentId(row.student_id);
  return row as StudentSession;
}
