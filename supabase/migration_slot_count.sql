-- ============================================================
-- MIGRATION: slot_count on appointments
-- Tracks how many truck slots an appointment occupies.
-- Applications default to 1; disinfects default to 0.
-- Run in Supabase SQL Editor
-- ============================================================

alter table public.appointments
  add column if not exists slot_count integer not null default 1;

-- Existing disinfect appointments occupy 0 slots by default
update public.appointments
  set slot_count = 0
  where job_type = 'stg_disinfect' and slot_count = 1;

-- Recreate view so it includes the new column
drop view if exists public.appointments_with_details;

create view public.appointments_with_details as
  select
    a.*,
    p.full_name  as salesman_name,
    t.name       as truck_name,
    tp.full_name as applicator_name
  from public.appointments a
  left join public.profiles p  on p.id  = a.salesman_id
  left join public.trucks   t  on t.id  = a.truck_id
  left join public.profiles tp on tp.id = t.applicator_id;

grant select on public.appointments_with_details to authenticated;
