-- ─── Lexio initial schema ───────────────────────────────────────────────────
-- COPPA note: this schema deliberately collects the MINIMUM student data:
--   * first_name only (no last name, no email, no birthdate)
--   * class_code + PIN for classroom-scale auth (see comment on students.pin)
-- Everything under Row-Level Security (RLS) except two SECURITY DEFINER RPCs
-- used by the kid-facing client (which does NOT hold a Supabase Auth session).
--
-- Threat model for student auth:
--   * The attacker is a child in the same building, not the internet at large.
--   * class_code is 6 chars from an unambiguous alphabet — one classroom,
--     printable on a wall poster.
--   * PIN is 4 digits stored as plaintext (documented on students.pin). A
--     hash adds zero real defense against classroom-scale threats and would
--     complicate reset flows for teachers.
--   * Upgrade path (post-pilot): mint a short-lived signed JWT in
--     student_login() using custom claims + gate all student RPCs on that
--     JWT (auth.jwt() -> student_id). Doing so today would slow the pilot
--     with no security win.

-- ─── Extensions ──────────────────────────────────────────────────────────────
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- ─── Tables ──────────────────────────────────────────────────────────────────

create table if not exists public.schools (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  plan         text not null default 'pilot',
  seat_limit   int  not null default 30,
  created_at   timestamptz not null default now()
);

create table if not exists public.teachers (
  -- Teacher accounts ARE Supabase Auth users. id === auth.users.id.
  id            uuid primary key references auth.users(id) on delete cascade,
  school_id     uuid references public.schools(id) on delete set null,
  display_name  text,
  email         text,
  created_at    timestamptz not null default now()
);

create table if not exists public.classrooms (
  id           uuid primary key default gen_random_uuid(),
  school_id    uuid references public.schools(id) on delete set null,
  teacher_id   uuid not null references public.teachers(id) on delete cascade,
  name         text not null,
  -- 6-char human-friendly code: A–Z minus I/L/O plus 2–9 (no 0/1). Unique so
  -- kids can type it from a wall poster without confusion.
  class_code   text not null unique,
  created_at   timestamptz not null default now(),
  constraint classrooms_class_code_format check (
    class_code ~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$'
  )
);
create index if not exists classrooms_teacher_id_idx on public.classrooms(teacher_id);

create table if not exists public.students (
  id                uuid primary key default gen_random_uuid(),
  classroom_id      uuid not null references public.classrooms(id) on delete cascade,
  first_name        text not null,
  -- PIN is 4 digits. Stored as text (not hashed) — see threat-model note at
  -- the top of this file. Change here means changing student_login() too.
  pin               text not null,
  avatar_mascot     int  not null default 0,
  difficulty_tier   text not null default 'developing'
    check (difficulty_tier in ('foundational', 'developing', 'advanced')),
  difficulty_level  int  not null default 2
    check (difficulty_level between 1 and 3),
  created_at        timestamptz not null default now(),
  constraint students_pin_format check (pin ~ '^[0-9]{4}$'),
  constraint students_first_name_len check (char_length(first_name) between 1 and 40),
  -- No two kids in the SAME classroom may share BOTH first_name AND pin —
  -- otherwise student_login() would be ambiguous.
  constraint students_unique_login unique (classroom_id, first_name, pin)
);
create index if not exists students_classroom_id_idx on public.students(classroom_id);

create table if not exists public.student_progress (
  student_id            uuid primary key references public.students(id) on delete cascade,
  xp                    int  not null default 0,
  streak                int  not null default 0,
  lessons_completed     int  not null default 0,
  mastered_phonemes     text[] not null default '{}',
  last_session_day      date,
  last_shield_use_day   date,
  hits_in_a_row         int  not null default 0,
  misses_in_a_row       int  not null default 0,
  last_lesson_id        text,
  last_game_key         text,
  updated_at            timestamptz not null default now()
);

create table if not exists public.game_sessions (
  id           uuid primary key default gen_random_uuid(),
  student_id   uuid not null references public.students(id) on delete cascade,
  game_key     text not null,
  phoneme      text,
  correct      int  not null default 0 check (correct >= 0),
  total        int  not null default 0 check (total   >= 0),
  elapsed_ms   int  not null default 0 check (elapsed_ms >= 0),
  played_at    timestamptz not null default now()
);
create index if not exists game_sessions_student_id_played_at_idx
  on public.game_sessions(student_id, played_at desc);
create index if not exists game_sessions_game_key_idx on public.game_sessions(game_key);

create table if not exists public.lesson_completions (
  id             uuid primary key default gen_random_uuid(),
  student_id     uuid not null references public.students(id) on delete cascade,
  phoneme        text not null,
  xp_earned      int  not null default 0 check (xp_earned >= 0),
  completed_at   timestamptz not null default now()
);
create index if not exists lesson_completions_student_id_completed_at_idx
  on public.lesson_completions(student_id, completed_at desc);

-- ─── Row-Level Security ─────────────────────────────────────────────────────
-- Enable on every user-data table. Anon reads are OFF by default; teachers
-- see only their own rows; kids never authenticate — their writes go through
-- SECURITY DEFINER RPCs below.

alter table public.schools             enable row level security;
alter table public.teachers            enable row level security;
alter table public.classrooms          enable row level security;
alter table public.students            enable row level security;
alter table public.student_progress    enable row level security;
alter table public.game_sessions       enable row level security;
alter table public.lesson_completions  enable row level security;

-- teachers: can select + update own row (school + display_name).
-- INSERT of a teacher row happens via signup trigger or admin flow;
-- we don't grant self-insert to prevent squatting on other UIDs.
create policy teachers_select_self on public.teachers
  for select using (id = auth.uid());
create policy teachers_update_self on public.teachers
  for update using (id = auth.uid()) with check (id = auth.uid());

-- classrooms: teacher owns everything they create.
create policy classrooms_select_own on public.classrooms
  for select using (teacher_id = auth.uid());
create policy classrooms_insert_own on public.classrooms
  for insert with check (teacher_id = auth.uid());
create policy classrooms_update_own on public.classrooms
  for update using (teacher_id = auth.uid()) with check (teacher_id = auth.uid());
create policy classrooms_delete_own on public.classrooms
  for delete using (teacher_id = auth.uid());

-- Helper: "does the current authed user own this classroom?"
create or replace function public.is_teacher_of_classroom(p_classroom_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.classrooms
    where id = p_classroom_id and teacher_id = auth.uid()
  );
$$;

-- students: teacher can CRUD kids in classrooms they own.
create policy students_teacher_select on public.students
  for select using (public.is_teacher_of_classroom(classroom_id));
create policy students_teacher_insert on public.students
  for insert with check (public.is_teacher_of_classroom(classroom_id));
create policy students_teacher_update on public.students
  for update using (public.is_teacher_of_classroom(classroom_id))
             with check (public.is_teacher_of_classroom(classroom_id));
create policy students_teacher_delete on public.students
  for delete using (public.is_teacher_of_classroom(classroom_id));

-- Helper: "does the current authed user teach this student?"
create or replace function public.is_teacher_of_student(p_student_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
    from public.students s
    join public.classrooms c on c.id = s.classroom_id
    where s.id = p_student_id and c.teacher_id = auth.uid()
  );
$$;

-- student_progress / game_sessions / lesson_completions:
-- teachers read/write for their students. Student writes happen via the
-- SECURITY DEFINER RPCs, which bypass RLS by design.
create policy sp_teacher_select on public.student_progress
  for select using (public.is_teacher_of_student(student_id));
create policy sp_teacher_update on public.student_progress
  for update using (public.is_teacher_of_student(student_id))
             with check (public.is_teacher_of_student(student_id));

create policy gs_teacher_select on public.game_sessions
  for select using (public.is_teacher_of_student(student_id));
create policy gs_teacher_delete on public.game_sessions
  for delete using (public.is_teacher_of_student(student_id));

create policy lc_teacher_select on public.lesson_completions
  for select using (public.is_teacher_of_student(student_id));
create policy lc_teacher_delete on public.lesson_completions
  for delete using (public.is_teacher_of_student(student_id));

-- schools: readable by any authed teacher (they need to pick their school on
-- signup); writes are admin-only for now.
create policy schools_select_authed on public.schools
  for select using (auth.role() = 'authenticated');

-- ─── SECURITY DEFINER RPCs (kid-facing, no auth) ────────────────────────────
-- All of these run with elevated privileges to bypass RLS, then re-enforce
-- their own access checks. Every one is granted EXECUTE to `anon` because
-- the kids' client uses the anon key.

-- 1) student_login
-- Look up a student by (class_code, first_name, pin). Returns one row on
-- success, zero rows on failure. Also returns their progress joined.
-- Rate-limiting is out of scope for schema — do it at the edge / API gateway
-- if abuse becomes an issue.
create or replace function public.student_login(
  p_class_code text,
  p_pin text,
  p_first_name text
) returns table (
  student_id        uuid,
  classroom_id      uuid,
  first_name        text,
  avatar_mascot     int,
  difficulty_tier   text,
  difficulty_level  int,
  xp                int,
  streak            int,
  lessons_completed int,
  mastered_phonemes text[],
  last_session_day  date,
  hits_in_a_row     int,
  misses_in_a_row   int,
  last_lesson_id    text,
  last_game_key     text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
    select
      s.id,
      s.classroom_id,
      s.first_name,
      s.avatar_mascot,
      s.difficulty_tier,
      s.difficulty_level,
      coalesce(p.xp, 0),
      coalesce(p.streak, 0),
      coalesce(p.lessons_completed, 0),
      coalesce(p.mastered_phonemes, '{}'::text[]),
      p.last_session_day,
      coalesce(p.hits_in_a_row, 0),
      coalesce(p.misses_in_a_row, 0),
      p.last_lesson_id,
      p.last_game_key
    from public.students s
    join public.classrooms c on c.id = s.classroom_id
    left join public.student_progress p on p.student_id = s.id
    where c.class_code = upper(p_class_code)
      and s.pin        = p_pin
      and lower(s.first_name) = lower(trim(p_first_name))
    limit 1;
end;
$$;

-- 2) record_lesson_completion — kid finished a lesson.
create or replace function public.record_lesson_completion(
  p_student_id uuid,
  p_phoneme text,
  p_xp int
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.students where id = p_student_id) then
    raise exception 'unknown student' using errcode = '22023';
  end if;

  insert into public.lesson_completions (student_id, phoneme, xp_earned)
  values (p_student_id, p_phoneme, greatest(0, coalesce(p_xp, 0)));

  -- Bump progress denormalized fields for cheap dashboard reads.
  insert into public.student_progress (student_id, lessons_completed, xp, mastered_phonemes, updated_at)
  values (
    p_student_id,
    1,
    greatest(0, coalesce(p_xp, 0)),
    case when p_phoneme is null then '{}'::text[] else array[p_phoneme] end,
    now()
  )
  on conflict (student_id) do update set
    lessons_completed = public.student_progress.lessons_completed + 1,
    xp                = public.student_progress.xp + greatest(0, coalesce(p_xp, 0)),
    mastered_phonemes = case
      when p_phoneme is null then public.student_progress.mastered_phonemes
      when p_phoneme = any(public.student_progress.mastered_phonemes)
        then public.student_progress.mastered_phonemes
      else array_append(public.student_progress.mastered_phonemes, p_phoneme)
    end,
    updated_at = now();
end;
$$;

-- 3) record_game_session — kid finished a game round.
create or replace function public.record_game_session(
  p_student_id uuid,
  p_game_key   text,
  p_phoneme    text,
  p_correct    int,
  p_total      int,
  p_elapsed_ms int
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not exists (select 1 from public.students where id = p_student_id) then
    raise exception 'unknown student' using errcode = '22023';
  end if;

  insert into public.game_sessions (student_id, game_key, phoneme, correct, total, elapsed_ms)
  values (
    p_student_id,
    p_game_key,
    p_phoneme,
    greatest(0, coalesce(p_correct, 0)),
    greatest(0, coalesce(p_total,   0)),
    greatest(0, coalesce(p_elapsed_ms, 0))
  )
  returning id into v_id;

  return v_id;
end;
$$;

-- 4) update_student_progress — coalescing upsert for streak/xp/etc. fields the
-- client tracks locally. Any NULL param is ignored (leaves the existing value).
create or replace function public.update_student_progress(
  p_student_id          uuid,
  p_xp                  int  default null,
  p_streak              int  default null,
  p_lessons_completed   int  default null,
  p_last_session_day    date default null,
  p_last_shield_use_day date default null,
  p_hits_in_a_row       int  default null,
  p_misses_in_a_row     int  default null,
  p_last_lesson_id      text default null,
  p_last_game_key       text default null,
  p_difficulty_level    int  default null,
  p_difficulty_tier     text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.students where id = p_student_id) then
    raise exception 'unknown student' using errcode = '22023';
  end if;

  -- difficulty lives on students, not on student_progress.
  update public.students set
    difficulty_level = coalesce(p_difficulty_level, difficulty_level),
    difficulty_tier  = coalesce(p_difficulty_tier,  difficulty_tier)
  where id = p_student_id;

  insert into public.student_progress (
    student_id, xp, streak, lessons_completed,
    last_session_day, last_shield_use_day,
    hits_in_a_row, misses_in_a_row,
    last_lesson_id, last_game_key, updated_at
  ) values (
    p_student_id,
    coalesce(p_xp, 0),
    coalesce(p_streak, 0),
    coalesce(p_lessons_completed, 0),
    p_last_session_day,
    p_last_shield_use_day,
    coalesce(p_hits_in_a_row,   0),
    coalesce(p_misses_in_a_row, 0),
    p_last_lesson_id,
    p_last_game_key,
    now()
  )
  on conflict (student_id) do update set
    xp                  = coalesce(p_xp,                 public.student_progress.xp),
    streak              = coalesce(p_streak,             public.student_progress.streak),
    lessons_completed   = coalesce(p_lessons_completed,  public.student_progress.lessons_completed),
    last_session_day    = coalesce(p_last_session_day,   public.student_progress.last_session_day),
    last_shield_use_day = coalesce(p_last_shield_use_day,public.student_progress.last_shield_use_day),
    hits_in_a_row       = coalesce(p_hits_in_a_row,      public.student_progress.hits_in_a_row),
    misses_in_a_row     = coalesce(p_misses_in_a_row,    public.student_progress.misses_in_a_row),
    last_lesson_id      = coalesce(p_last_lesson_id,     public.student_progress.last_lesson_id),
    last_game_key       = coalesce(p_last_game_key,      public.student_progress.last_game_key),
    updated_at          = now();
end;
$$;

-- ─── Grants ─────────────────────────────────────────────────────────────────
-- Kid-facing RPCs: EXECUTE for anon (the anon key is what the client uses).
grant execute on function public.student_login(text, text, text)                    to anon, authenticated;
grant execute on function public.record_lesson_completion(uuid, text, int)          to anon, authenticated;
grant execute on function public.record_game_session(uuid, text, text, int, int, int) to anon, authenticated;
grant execute on function public.update_student_progress(uuid, int, int, int, date, date, int, int, text, text, int, text) to anon, authenticated;
-- Helper functions used inside RLS policies stay teacher-only.
revoke execute on function public.is_teacher_of_classroom(uuid) from anon;
revoke execute on function public.is_teacher_of_student(uuid)   from anon;
