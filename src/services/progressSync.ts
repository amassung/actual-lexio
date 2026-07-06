// ─── Progress sync ───────────────────────────────────────────────────────────
// Fire-and-forget writes to Supabase for signed-in students. Local UX never
// waits on the network — every function returns immediately (Promise resolves
// once the request is in flight, but callers use `void` and don't await).
//
// Contract:
//   - No signed-in student → all functions are no-ops.
//   - Errors are swallowed with a console.warn (kids never see network noise).
//   - update_student_progress is DEBOUNCED (2s trailing) so a burst of
//     hits/misses coalesces to one server write.

import { supabase, supabaseConfigured } from "./supabase";
import { getStudentId } from "./studentSession";

// ─── record_lesson_completion ────────────────────────────────────────────────
export async function syncLessonCompletion(phoneme: string, xp: number): Promise<void> {
  if (!supabaseConfigured) return;
  const student_id = getStudentId();
  if (!student_id) return;
  const { error } = await supabase.rpc("record_lesson_completion", {
    p_student_id: student_id,
    p_phoneme: phoneme,
    p_xp: Math.max(0, Math.round(xp)),
  });
  if (error) console.warn("[Lexio] record_lesson_completion failed:", error.message);
}

// ─── record_game_session ─────────────────────────────────────────────────────
export async function syncGameSession(payload: {
  gameKey: string;
  phoneme: string | null;
  correct: number;
  total: number;
  elapsedMs: number;
}): Promise<void> {
  if (!supabaseConfigured) return;
  const student_id = getStudentId();
  if (!student_id) return;
  const { error } = await supabase.rpc("record_game_session", {
    p_student_id: student_id,
    p_game_key: payload.gameKey,
    p_phoneme: payload.phoneme,
    p_correct: Math.max(0, Math.round(payload.correct)),
    p_total:   Math.max(0, Math.round(payload.total)),
    p_elapsed_ms: Math.max(0, Math.round(payload.elapsedMs)),
  });
  if (error) console.warn("[Lexio] record_game_session failed:", error.message);
}

// ─── update_student_progress (DEBOUNCED) ─────────────────────────────────────
// Every progress-shaped field the RPC accepts. All optional — pass only what
// changed. The debouncer buffers the latest value per key and flushes once
// after 2s of quiet.

export type ProgressPatch = {
  xp?: number;
  streak?: number;
  lessons_completed?: number;
  last_session_day?: string | null;
  last_shield_use_day?: string | null;
  hits_in_a_row?: number;
  misses_in_a_row?: number;
  last_lesson_id?: string | null;
  last_game_key?: string | null;
  difficulty_level?: 1 | 2 | 3;
  difficulty_tier?: "foundational" | "developing" | "advanced";
};

const DEBOUNCE_MS = 2000;
let pending: ProgressPatch = {};
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleFlush() {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(flushProgress, DEBOUNCE_MS);
}

async function flushProgress(): Promise<void> {
  flushTimer = null;
  const patch = pending;
  pending = {};
  if (!supabaseConfigured) return;
  const student_id = getStudentId();
  if (!student_id) return;
  // Nothing to send?
  if (Object.keys(patch).length === 0) return;

  const { error } = await supabase.rpc("update_student_progress", {
    p_student_id: student_id,
    p_xp: patch.xp ?? null,
    p_streak: patch.streak ?? null,
    p_lessons_completed: patch.lessons_completed ?? null,
    p_last_session_day: patch.last_session_day ?? null,
    p_last_shield_use_day: patch.last_shield_use_day ?? null,
    p_hits_in_a_row: patch.hits_in_a_row ?? null,
    p_misses_in_a_row: patch.misses_in_a_row ?? null,
    p_last_lesson_id: patch.last_lesson_id ?? null,
    p_last_game_key: patch.last_game_key ?? null,
    p_difficulty_level: patch.difficulty_level ?? null,
    p_difficulty_tier: patch.difficulty_tier ?? null,
  });
  if (error) console.warn("[Lexio] update_student_progress failed:", error.message);
}

// Public API: enqueue a patch. Later patches override earlier fields.
export function syncStudentProgress(patch: ProgressPatch): void {
  pending = { ...pending, ...patch };
  scheduleFlush();
}

// Fire the pending debounce right now — used before navigating away.
export function flushSyncNow(): Promise<void> {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  return flushProgress();
}

// Attach a "flush on hide" handler so kids closing the tab don't lose the
// last ~2 seconds of progress. Safe to call multiple times — idempotent.
let hideHooked = false;
export function attachFlushOnHide() {
  if (hideHooked || typeof document === "undefined") return;
  hideHooked = true;
  const handler = () => {
    if (document.visibilityState === "hidden") void flushSyncNow();
  };
  document.addEventListener("visibilitychange", handler);
  window.addEventListener("pagehide", () => void flushSyncNow());
}
