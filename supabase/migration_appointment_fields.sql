-- ============================================================
-- MIGRATION: Add storage_name, cwt, products to appointments
-- Run in Supabase SQL Editor
-- ============================================================

alter table public.appointments
  add column if not exists storage_name text,
  add column if not exists cwt numeric,
  add column if not exists products jsonb default '[]'::jsonb;

-- Also add to approval_requests so the full job info is captured there too
alter table public.approval_requests
  add column if not exists storage_name text,
  add column if not exists cwt numeric,
  add column if not exists products jsonb default '[]'::jsonb;

-- Refresh the view to include new columns
drop view if exists public.appointments_with_details;

create view public.appointments_with_details as
  select
    a.*,
    p.full_name as salesman_name
  from public.appointments a
  join public.profiles p on p.id = a.salesman_id;

grant select on public.appointments_with_details to authenticated;
