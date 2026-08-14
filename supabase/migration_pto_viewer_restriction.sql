-- ============================================================
-- MIGRATION: Viewers cannot create PTO
-- Follow-up to migration_pto_events.sql. Locks down the insert policy so
-- viewer-role accounts can't add PTO for themselves via the API even if the
-- UI restriction were bypassed. Viewers can still see all PTO (unchanged).
-- Run in Supabase SQL Editor
-- ============================================================

create or replace function public.is_viewer()
returns boolean language sql security definer as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'viewer'
  );
$$;

drop policy if exists "Users insert own pto; admins insert any" on public.pto_events;
create policy "Users insert own pto; admins insert any"
  on public.pto_events for insert
  with check ((employee_id = auth.uid() and not public.is_viewer()) or public.is_admin());
