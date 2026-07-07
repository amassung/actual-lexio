// ─── Teacher auth ────────────────────────────────────────────────────────────
// Teachers use real Supabase Auth (email + password). On successful signup we
// atomically ensure a `teachers` row exists for that auth user, tied to their
// school (auto-created if new). RLS then scopes everything else.
//
// Kids do NOT use this service — they sign in with class_code + PIN via
// student_login (see studentSession.ts). Two totally separate paths.

import { supabase, supabaseConfigured } from "./supabase";

export type TeacherRow = {
  id: string;
  school_id: string;
  display_name: string;
  email: string;
};

export type SignUpPayload = {
  email: string;
  password: string;
  displayName: string;
  schoolName: string;
};

export type SignInPayload = {
  email: string;
  password: string;
};

// Local shorthand — every path checks this first.
function guard() {
  if (!supabaseConfigured) {
    throw new Error("Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.");
  }
}

// ─── Sign up ──────────────────────────────────────────────────────────────────
// Steps:
//   1. Supabase Auth create user
//   2. Ensure a school exists for this teacher (create if none given)
//   3. Insert into public.teachers referencing auth user's id
// If email confirmation is required in your Supabase project, step 3 will
// still run in the background once the user confirms their email + logs in
// again — we also run ensureTeacherRow() on every signIn as a safety net.
export async function signUpTeacher(payload: SignUpPayload): Promise<{ teacher: TeacherRow | null; needsEmailConfirmation: boolean; error: string | null }> {
  try {
    guard();
  } catch (e) {
    return { teacher: null, needsEmailConfirmation: false, error: (e as Error).message };
  }

  const email = payload.email.trim().toLowerCase();
  const password = payload.password;
  const displayName = payload.displayName.trim();
  const schoolName = payload.schoolName.trim() || "My School";

  if (!email || !password || !displayName) {
    return { teacher: null, needsEmailConfirmation: false, error: "Fill in your name, email, and password." };
  }
  if (password.length < 6) {
    return { teacher: null, needsEmailConfirmation: false, error: "Password must be at least 6 characters." };
  }

  const { data: authData, error: authErr } = await supabase.auth.signUp({
    email, password,
    options: { data: { display_name: displayName, school_name: schoolName } },
  });
  if (authErr) return { teacher: null, needsEmailConfirmation: false, error: authErr.message };

  const user = authData.user;
  const session = authData.session;
  // If email confirmations are ON in Supabase, session is null until the user
  // clicks the link. We surface that state so the UI can say so.
  if (!session) {
    return { teacher: null, needsEmailConfirmation: true, error: null };
  }
  if (!user) return { teacher: null, needsEmailConfirmation: false, error: "Signup succeeded but returned no user." };

  const teacher = await ensureTeacherRow({ userId: user.id, email, displayName, schoolName });
  return { teacher, needsEmailConfirmation: false, error: teacher ? null : "Could not create teacher record." };
}

// ─── Sign in ──────────────────────────────────────────────────────────────────
// Also runs ensureTeacherRow so the profile row is guaranteed to exist even
// if signup happened out-of-band (e.g. Supabase Auth admin panel).
export async function signInTeacher(payload: SignInPayload): Promise<{ teacher: TeacherRow | null; error: string | null }> {
  try { guard(); } catch (e) {
    return { teacher: null, error: (e as Error).message };
  }
  const email = payload.email.trim().toLowerCase();
  const password = payload.password;
  if (!email || !password) return { teacher: null, error: "Enter your email and password." };

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { teacher: null, error: error.message };
  const user = data.user;
  if (!user) return { teacher: null, error: "Sign-in succeeded but returned no user." };

  // Pull the profile row; if missing (e.g. row wasn't inserted at signup),
  // create a minimal one so the teacher isn't locked out of their own dashboard.
  const meta = (user.user_metadata ?? {}) as { display_name?: string; school_name?: string };
  const teacher = await ensureTeacherRow({
    userId: user.id,
    email,
    displayName: meta.display_name || email.split("@")[0],
    schoolName: meta.school_name || "My School",
  });
  return { teacher, error: teacher ? null : "Signed in but could not load teacher record." };
}

// ─── Sign out ─────────────────────────────────────────────────────────────────
export async function signOutTeacher(): Promise<void> {
  if (!supabaseConfigured) return;
  await supabase.auth.signOut();
}

// ─── Session helpers ──────────────────────────────────────────────────────────
export async function getCurrentTeacher(): Promise<TeacherRow | null> {
  if (!supabaseConfigured) return null;
  const { data } = await supabase.auth.getSession();
  const user = data.session?.user;
  if (!user) return null;
  const { data: row, error } = await supabase
    .from("teachers")
    .select("id, school_id, display_name, email")
    .eq("id", user.id)
    .maybeSingle();
  if (error || !row) return null;
  return row as TeacherRow;
}

export async function isTeacherSignedIn(): Promise<boolean> {
  if (!supabaseConfigured) return false;
  const { data } = await supabase.auth.getSession();
  return !!data.session;
}

// ─── Internal: ensure teachers row exists (idempotent) ────────────────────────
// Delegates to the bootstrap_teacher RPC (SECURITY DEFINER) so RLS on
// schools/teachers doesn't block a first-time signup. See
// supabase/migrations/002_teacher_bootstrap.sql for the SQL.
async function ensureTeacherRow(args: { userId: string; email: string; displayName: string; schoolName: string }): Promise<TeacherRow | null> {
  const { data, error } = await supabase.rpc("bootstrap_teacher", {
    p_display_name: args.displayName,
    p_email: args.email,
    p_school_name: args.schoolName,
  });
  if (error) {
    // eslint-disable-next-line no-console
    console.warn("[Lexio] bootstrap_teacher failed:", error.message);
    return null;
  }
  const row = Array.isArray(data) && data.length > 0 ? data[0] : null;
  return row ? (row as TeacherRow) : null;
}
