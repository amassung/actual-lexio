// ─── Teacher API ─────────────────────────────────────────────────────────────
// CRUD for classrooms and students, used by the teacher dashboard.
//
// Classroom creation goes through the create_classroom RPC (needs unique
// class_code generation). Everything else is direct table access — the RLS
// policies (see supabase/migrations/001_initial_schema.sql) already scope
// reads/writes to the teacher's own classrooms.

import { supabase, supabaseConfigured } from "./supabase";

export type Classroom = {
  id: string;
  name: string;
  class_code: string;
  school_id: string;
  teacher_id: string;
  created_at: string;
  student_count?: number;
};

export type StudentRow = {
  id: string;
  classroom_id: string;
  first_name: string;
  pin: string;
  avatar_mascot: number;
  difficulty_tier: string;
  difficulty_level: number;
  created_at: string;
};

function guard() {
  if (!supabaseConfigured) throw new Error("Supabase is not configured.");
}

// ─── Classrooms ─────────────────────────────────────────────────────────────
export async function listClassrooms(): Promise<Classroom[]> {
  guard();
  const { data, error } = await supabase
    .from("classrooms")
    .select("id, name, class_code, school_id, teacher_id, created_at, students(count)")
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row: any) => ({
    id: row.id,
    name: row.name,
    class_code: row.class_code,
    school_id: row.school_id,
    teacher_id: row.teacher_id,
    created_at: row.created_at,
    student_count: row.students?.[0]?.count ?? 0,
  }));
}

export async function createClassroom(name: string): Promise<Classroom> {
  guard();
  const { data, error } = await supabase.rpc("create_classroom", { p_name: name });
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) && data.length > 0 ? data[0] : null;
  if (!row) throw new Error("Classroom creation returned no row.");
  return { ...(row as Classroom), student_count: 0 };
}

export async function deleteClassroom(id: string): Promise<void> {
  guard();
  const { error } = await supabase.from("classrooms").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function renameClassroom(id: string, name: string): Promise<void> {
  guard();
  const { error } = await supabase.from("classrooms").update({ name }).eq("id", id);
  if (error) throw new Error(error.message);
}

// ─── Students ────────────────────────────────────────────────────────────────
export async function listStudents(classroomId: string): Promise<StudentRow[]> {
  guard();
  const { data, error } = await supabase
    .from("students")
    .select("*")
    .eq("classroom_id", classroomId)
    .order("first_name", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as StudentRow[];
}

export async function addStudent(payload: {
  classroomId: string;
  firstName: string;
  pin: string;
}): Promise<StudentRow> {
  guard();
  const firstName = payload.firstName.trim();
  const pin = payload.pin.trim();
  if (!firstName) throw new Error("First name required.");
  if (!/^\d{4}$/.test(pin)) throw new Error("PIN must be 4 digits.");
  const { data, error } = await supabase
    .from("students")
    .insert({
      classroom_id: payload.classroomId,
      first_name: firstName,
      pin,
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as StudentRow;
}

export async function updateStudentPin(studentId: string, pin: string): Promise<void> {
  guard();
  if (!/^\d{4}$/.test(pin)) throw new Error("PIN must be 4 digits.");
  const { error } = await supabase.from("students").update({ pin }).eq("id", studentId);
  if (error) throw new Error(error.message);
}

export async function renameStudent(studentId: string, firstName: string): Promise<void> {
  guard();
  const trimmed = firstName.trim();
  if (!trimmed) throw new Error("First name required.");
  const { error } = await supabase.from("students").update({ first_name: trimmed }).eq("id", studentId);
  if (error) throw new Error(error.message);
}

export async function deleteStudent(studentId: string): Promise<void> {
  guard();
  const { error } = await supabase.from("students").delete().eq("id", studentId);
  if (error) throw new Error(error.message);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
export function randomPin(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}
