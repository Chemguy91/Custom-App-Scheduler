-- ============================================================
-- MIGRATION: Track who actually created a job
-- Run in Supabase SQL Editor
-- ============================================================
--
-- salesman_id is who a job is ASSIGNED to, which isn't always who
-- actually scheduled it — an admin can book a job on behalf of a
-- different account manager. This adds a separate created_by column
-- so the admin panel can show "who scheduled this" reliably, as a
-- fallback that doesn't depend on the email notification succeeding.

alter table public.appointments
  add column if not exists created_by uuid references public.profiles(id);

-- Backfill existing rows: best guess is the assigned account manager
-- was also the one who created it.
update public.appointments
  set created_by = salesman_id
  where created_by is null;

-- Extend the appointments view with the creator's name so the UI can
-- show it without an extra round trip.
--
-- Note: can't use CREATE OR REPLACE here — the new created_by column
-- lands in the middle of `a.*`'s column order (right after updated_at,
-- before salesman_name), and Postgres only allows REPLACE to append
-- new columns at the very end, not reorder existing ones. Drop + create
-- instead.
drop view if exists public.appointments_with_details;

create view public.appointments_with_details as
  select
    a.*,
    p.full_name as salesman_name,
    cb.full_name as created_by_name
  from public.appointments a
  join public.profiles p on p.id = a.salesman_id
  left join public.profiles cb on cb.id = a.created_by;

grant select on public.appointments_with_details to authenticated;
