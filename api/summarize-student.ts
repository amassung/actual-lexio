// ─── /api/summarize-student — Vercel Serverless Function ─────────────────────
// Generates an AI-written learning profile for a single student, using
// Claude Opus 4.8. The Anthropic API key stays server-side.
//
// Auth: caller sends `Authorization: Bearer <teacher_session_access_token>`.
// We create a Supabase client with that token — RLS enforces that the caller
// can only fetch students in their own classrooms. No custom auth needed.
//
// Response shape (JSON):
//   { summary, strengths[], focus_areas[], best_games[], next_focus }

import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

// Vercel Functions run on Node — export default handler(req, res).
export default async function handler(req: any, res: any) {
  // ── CORS + method guards ──
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return res.status(500).json({ error: "Supabase env vars not set on the server." });
  }
  if (!ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: "ANTHROPIC_API_KEY not set. Add it in Vercel → Env Vars." });
  }

  const authHeader = (req.headers?.authorization || req.headers?.Authorization) as string | undefined;
  const accessToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!accessToken) {
    return res.status(401).json({ error: "Missing bearer token." });
  }

  let studentId: string | undefined;
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    studentId = body?.studentId;
  } catch {
    return res.status(400).json({ error: "Invalid JSON body." });
  }
  if (!studentId || typeof studentId !== "string") {
    return res.status(400).json({ error: "Missing studentId." });
  }

  // ── Fetch data via Supabase, scoped by the teacher's own session token.
  //    RLS ensures we can only read students in the teacher's classrooms. ──
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const [studentR, progressR, sessionsR, completionsR] = await Promise.all([
    supabase.from("students").select("*").eq("id", studentId).single(),
    supabase.from("student_progress").select("*").eq("student_id", studentId).maybeSingle(),
    supabase.from("game_sessions").select("*").eq("student_id", studentId).order("played_at", { ascending: false }).limit(500),
    supabase.from("lesson_completions").select("*").eq("student_id", studentId).order("completed_at", { ascending: false }).limit(200),
  ]);
  if (studentR.error) {
    return res.status(403).json({ error: "Not authorized to read that student, or student not found." });
  }
  const student: any = studentR.data;
  const progress: any = progressR.data;
  const sessions: any[] = sessionsR.data ?? [];
  const completions: any[] = completionsR.data ?? [];

  // ── Build structured data snapshot for Claude ──
  const perGame: Record<string, { correct: number; total: number; sessions: number; time_min: number }> = {};
  for (const s of sessions) {
    const g = perGame[s.game_key] ?? { correct: 0, total: 0, sessions: 0, time_min: 0 };
    g.correct += s.correct;
    g.total += s.total;
    g.sessions += 1;
    g.time_min += Math.round(s.elapsed_ms / 60000);
    perGame[s.game_key] = g;
  }
  const perGameSummary = Object.entries(perGame)
    .map(([k, v]) => ({
      game: k,
      accuracy_pct: v.total > 0 ? Math.round((v.correct / v.total) * 100) : null,
      sessions: v.sessions,
      time_min: v.time_min,
    }))
    .sort((a, b) => b.sessions - a.sessions);

  const perPhoneme: Record<string, { correct: number; total: number; sessions: number }> = {};
  for (const s of sessions) {
    if (!s.phoneme) continue;
    const p = s.phoneme.toLowerCase();
    const g = perPhoneme[p] ?? { correct: 0, total: 0, sessions: 0 };
    g.correct += s.correct;
    g.total += s.total;
    g.sessions += 1;
    perPhoneme[p] = g;
  }
  const perPhonemeSummary = Object.entries(perPhoneme)
    .filter(([, v]) => v.total >= 3)
    .map(([k, v]) => ({
      phoneme: k,
      accuracy_pct: Math.round((v.correct / v.total) * 100),
      sessions: v.sessions,
    }))
    .sort((a, b) => a.accuracy_pct - b.accuracy_pct);

  const data = {
    first_name: student.first_name,
    xp: progress?.xp ?? 0,
    streak_days: progress?.streak ?? 0,
    lessons_completed: progress?.lessons_completed ?? 0,
    mastered_phonemes: progress?.mastered_phonemes ?? [],
    difficulty_tier: student.difficulty_tier ?? "developing",
    per_game: perGameSummary,
    per_phoneme_accuracy: perPhonemeSummary,
    recent_lessons: completions.slice(0, 10).map(c => ({
      phoneme: c.phoneme,
      xp: c.xp_earned,
      completed_at: c.completed_at,
    })),
    total_sessions_played: sessions.length,
  };

  // ── Ask Claude for a structured, parent-friendly readout ──
  const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

  const systemPrompt = `You are a reading-progress analyst for Lexio, a phonics reading app for K-2 dyslexic students.
Given a student's structured stats, write a short, warm, specific parent/teacher-facing profile.

Rules:
- Ground every claim in the data. Do not invent phonics they haven't practiced.
- Keep the summary 2–3 sentences.
- 2–3 strengths, 1–3 focus areas, 1–3 best games (by accuracy AND session count).
- Recommended next focus: one concrete lesson or phoneme suggestion, tied to the lowest-accuracy phoneme with meaningful volume.
- Use game_key values from the data verbatim in best_games (they will be pretty-printed downstream).
- If data is thin, say so honestly rather than inventing insights.

Return ONLY valid JSON matching this exact shape (no markdown, no code fences):
{"summary": string, "strengths": string[], "focus_areas": string[], "best_games": string[], "next_focus": string}`;

  const userPrompt = `Student data:\n\n${JSON.stringify(data, null, 2)}\n\nGenerate the profile now.`;

  try {
    const message = await anthropic.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    });

    // Extract text from the response
    const textBlock = message.content.find(b => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      return res.status(500).json({ error: "AI returned no text content." });
    }
    let raw = textBlock.text.trim();
    // Some models wrap in ```json — strip it defensively
    if (raw.startsWith("```")) {
      raw = raw.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    }
    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch (parseErr) {
      return res.status(500).json({
        error: "AI returned invalid JSON.",
        detail: raw.slice(0, 200),
      });
    }

    // Defensive shape enforcement
    const clean = {
      summary: String(parsed.summary ?? ""),
      strengths: Array.isArray(parsed.strengths) ? parsed.strengths.map(String).slice(0, 5) : [],
      focus_areas: Array.isArray(parsed.focus_areas) ? parsed.focus_areas.map(String).slice(0, 5) : [],
      best_games: Array.isArray(parsed.best_games) ? parsed.best_games.map(String).slice(0, 5) : [],
      next_focus: String(parsed.next_focus ?? ""),
    };
    return res.status(200).json(clean);
  } catch (e: any) {
    // Distinguish Anthropic API errors from network errors for clearer UI messages
    const msg = e?.message || String(e);
    // eslint-disable-next-line no-console
    console.error("[Lexio] /api/summarize-student failed:", msg);
    return res.status(500).json({ error: `AI generation failed: ${msg}` });
  }
}
