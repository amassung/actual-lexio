-- ─── Teacher dashboard: classroom creation ─────────────────────────────────
-- Adds:
--   generate_class_code() → uniqueness-guaranteed 6-char code from an
--     unambiguous alphabet (no 0/O/1/I/l). Retries up to 100x.
--   create_classroom(name) → SECURITY DEFINER RPC that resolves the
--     caller's school_id from the teachers table, generates a code, and
--     inserts the classroom in one shot.
--
-- Student CRUD does NOT need RPCs — the existing RLS policies already scope
-- teacher access to their own classrooms.

-- ─── Class code generator ────────────────────────────────────────────────────
create or replace function public.generate_class_code() returns text
language plpgsql
as $$
declare
  -- Alphabet omits ambiguous chars (0/O, 1/I/l) to keep posters readable.
  chars    constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  codelen  constant int  := 6;
  code     text;
  i        int;
  attempts int := 0;
begin
  loop
    code := '';
    for i in 1..codelen loop
      code := code || substr(chars, 1 + floor(random() * length(chars))::int, 1);
    end loop;
    if not exists (select 1 from public.classrooms where class_code = code) then
      return code;
    end if;
    attempts := attempts + 1;
    if attempts > 100 then
      raise exception 'unable to generate a unique class_code after 100 attempts';
    end if;
  end loop;
end;
$$;

-- Not directly exposed to clients — only called by create_classroom below.
revoke execute on function public.generate_class_code() from public, anon, authenticated;

-- ─── create_classroom RPC ────────────────────────────────────────────────────
create or replace function public.create_classroom(p_name text)
returns table (
  id         uuid,
  name       text,
  class_code text,
  teacher_id uuid,
  school_id  uuid,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_school_id uuid;
  v_code      text;
  v_name      text := coalesce(nullif(trim(p_name), ''), 'My Classroom');
begin
  if v_uid is null then
    raise exception 'must be authenticated to create a classroom' using errcode = '42501';
  end if;

  select t.school_id into v_school_id from public.teachers t where t.id = v_uid;
  if v_school_id is null then
    raise exception 'teacher profile not found — sign in again' using errcode = '42501';
  end if;

  v_code := public.generate_class_code();

  insert into public.classrooms (school_id, teacher_id, name, class_code)
    values (v_school_id, v_uid, v_name, v_code)
    returning
      classrooms.id, classrooms.name, classrooms.class_code,
      classrooms.teacher_id, classrooms.school_id, classrooms.created_at
    into id, name, class_code, teacher_id, school_id, created_at;

  return next;
end;
$$;

grant execute on function public.create_classroom(text) to authenticated;
