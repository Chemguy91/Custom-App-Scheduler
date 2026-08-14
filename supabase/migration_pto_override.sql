-- ============================================================
-- MIGRATION: Per-user PTO override for viewer accounts
-- Supersedes the blanket viewer restriction from
-- migration_pto_viewer_restriction.sql. Some "viewer" accounts are actual
-- staff who need to log their own PTO — this adds a per-profile flag an
-- admin can flip on in the Users tab, instead of blocking every viewer.
-- Run in Supabase SQL Editor
-- ============================================================

alter table public.profiles
  add column if not exists pto_override boolean not null default false;

-- Replaces is_viewer(): true if this user is allowed to request PTO for
-- themselves — i.e. not a viewer, or a viewer with the override flag set.
create or replace function public.pto_allowed()
returns boolean language sql security definer as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and (role <> 'viewer' or pto_override = true)
  );
$$;

drop policy if exists "Users insert own pto; admins insert any" on public.pto_events;
create policy "Users insert own pto; admins insert any"
  on public.pto_events for insert
  with check ((employee_id = auth.uid() and public.pto_allowed()) or public.is_admin());
