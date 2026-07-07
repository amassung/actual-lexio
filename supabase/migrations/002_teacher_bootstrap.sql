-- ─── Teacher signup bootstrap ───────────────────────────────────────────────
-- Adds one SECURITY DEFINER RPC: bootstrap_teacher(display_name, school_name).
--
-- The rest of the app uses RLS to scope teacher writes ("classrooms where
-- teacher_id = auth.uid()"), but on the very first signup the teacher has no
-- profile row yet — so RLS blocks the schools insert AND the teachers insert
-- they need to create. This RPC runs as the definer, verifies the caller is
-- a real authenticated user (auth.uid() is non-null), then does both inserts
-- atomically and returns the teacher row.
--
-- Idempotent: if the teacher row already exists, we return it as-is and
-- don't create a duplicate school. Safe to call on every sign-in as a safety
-- net for out-of-band signup paths.

create or replace function public.bootstrap_teacher(
  p_display_name text,
  p_email        text,
  p_school_name  text default 'My School'
) returns table (
  id           uuid,
  school_id    uuid,
  display_name text,
  email        text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_school_id uuid;
  v_existing_school uuid;
begin
  if v_uid is null then
    raise exception 'must be authenticated to bootstrap teacher' using errcode = '42501';
  end if;

  -- Fast path: teacher already exists → return current row.
  select t.id, t.school_id, t.display_name, t.email
    into id, school_id, display_name, email
    from public.teachers t
    where t.id = v_uid;
  if found then
    return next;
    return;
  end if;

  -- Create a new school for this teacher.
  insert into public.schools (name)
    values (coalesce(nullif(trim(p_school_name), ''), 'My School'))
    returning schools.id into v_school_id;

  -- Insert the teacher profile.
  insert into public.teachers (id, school_id, display_name, email)
    values (
      v_uid,
      v_school_id,
      coalesce(nullif(trim(p_display_name), ''), split_part(p_email, '@', 1)),
      lower(trim(p_email))
    )
    returning teachers.id, teachers.school_id, teachers.display_name, teachers.email
    into id, school_id, display_name, email;

  return next;
end;
$$;

grant execute on function public.bootstrap_teacher(text, text, text) to authenticated;

-- Also: teachers need to be able to read their own school row. Add a select
-- policy that lets any teacher read the school row they belong to.
-- Postgres doesn't support `create policy if not exists`, so we drop-then-create.
drop policy if exists schools_select_own on public.schools;
create policy schools_select_own on public.schools
  for select using (
    exists (
      select 1 from public.teachers t
      where t.id = auth.uid() and t.school_id = schools.id
    )
  );
