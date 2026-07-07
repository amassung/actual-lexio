// ─── Supabase client ─────────────────────────────────────────────────────────
// Singleton Supabase client used by the Lexio app.
//
// Env vars (both required in .env.local for dev, and in Vercel for prod):
//   VITE_SUPABASE_URL       — e.g. https://xxxxx.supabase.co
//   VITE_SUPABASE_ANON_KEY  — the "anon" (public) API key
//
// These two are SAFE to expose client-side. All real security lives in
// Postgres via RLS policies and SECURITY DEFINER RPC functions (see
// supabase/migrations/001_initial_schema.sql).
//
// Two auth modes are used across the app:
//   1. Teacher auth  — Supabase Auth (email/password), used by educators.
//      RLS grants teachers access only to rows in their own classrooms.
//   2. Student auth  — NO Supabase Auth. Kids sign in with class_code + PIN
//      via the `student_login` RPC and the client keeps `student_id` in
//      localStorage. All student writes go through SECURITY DEFINER RPCs
//      (record_lesson_completion, record_game_session, update_student_progress).
//      This is deliberate: kids don't have email accounts, and any auth
//      artifact on a shared device would be lifted immediately.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// NOTE: Vite's env replacement is a static text substitution of the exact
// pattern `import.meta.env.VITE_XXX`. Do NOT split it across lines or wrap
// with intermediate type-cast parens — Vite silently skips the replacement
// and both values come out empty at runtime.
// The supabase-js client already appends "/rest/v1/..." internally, so the
// URL we pass must be JUST the project origin (https://xxxxx.supabase.co).
// This normalizer defends against three common Vercel-paste mistakes:
//   - trailing slash              → https://xxxxx.supabase.co/
//   - trailing "/rest/v1" segment → https://xxxxx.supabase.co/rest/v1
//   - trailing "/rest/v1/"        → both combined
// Any of the above would produce a doubled path (PGRST125) at request time.
function normalizeSupabaseUrl(raw: string | undefined): string | undefined {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return undefined;
  try {
    // Prefer real URL parsing → discards any stray path/query/hash.
    const u = new URL(trimmed);
    return `${u.protocol}//${u.host}`;
  } catch {
    // Fallback for values that URL() rejects — still strip common suffixes.
    return trimmed.replace(/\/+$/, "").replace(/\/rest\/v1$/i, "");
  }
}

const SUPABASE_URL = normalizeSupabaseUrl(
  (import.meta as any).env?.VITE_SUPABASE_URL as string | undefined,
);
const SUPABASE_ANON_KEY = (
  ((import.meta as any).env?.VITE_SUPABASE_ANON_KEY as string | undefined) ?? ""
).trim() || undefined;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  // We warn instead of throwing so local dev without the env still boots.
  // Any call to the client will surface a clear network error at that point.
  // eslint-disable-next-line no-console
  console.warn(
    "[Lexio] Supabase env vars missing — set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.local",
  );
}

// Session persistence is left ON for teachers (Supabase Auth handles it).
// Kids don't use Supabase Auth so their "session" is just `student_id` we
// stash in localStorage from student_login() — see src/services/studentSession.ts
// (to be added when we wire the flow).
export const supabase: SupabaseClient = createClient(
  SUPABASE_URL ?? "http://localhost:54321",
  SUPABASE_ANON_KEY ?? "public-anon-key",
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: "lexio.teacher.auth",
    },
  },
);

// Convenience — read once so callers can guard cleanly on missing config.
export const supabaseConfigured =
  Boolean(SUPABASE_URL) && Boolean(SUPABASE_ANON_KEY);
