-- ============================================================
-- MIGRATION: Stg Disinfect job type
-- Run in Supabase SQL Editor
-- ============================================================

-- 1. Add job_type and storage_capacity to appointments
alter table public.appointments
  add column if not exists job_type text not null default 'application'
    check (job_type in ('application', 'stg_disinfect')),
  add column if not exists storage_capacity numeric;

-- 2. Add same fields to approval_requests
alter table public.approval_requests
  add column if not exists job_type text not null default 'application'
    check (job_type in ('application', 'stg_disinfect')),
  add column if not exists storage_capacity numeric;

-- 3. Recreate appointments_with_details view to include new fields
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
