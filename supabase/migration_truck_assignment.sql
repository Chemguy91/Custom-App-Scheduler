-- ============================================================
-- MIGRATION: Truck Assignment on Appointments
-- Run in Supabase SQL Editor
-- ============================================================

-- 1. Add truck_id column to appointments
alter table public.appointments
  add column if not exists truck_id uuid references public.trucks(id) on delete set null;

-- 2. Add truck_id to approval_requests too (so requests carry truck context)
alter table public.approval_requests
  add column if not exists truck_id uuid references public.trucks(id) on delete set null;

-- 3. Recreate appointments_with_details view to include truck info
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
