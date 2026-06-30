-- ============================================================
-- MIGRATION: Capacity Rules
-- Run this in Supabase SQL Editor after the initial schema.sql
-- ============================================================

create table public.capacity_rules (
  id              uuid primary key default gen_random_uuid(),
  name            text,                          -- optional label e.g. "Summer 2026"
  start_date      date not null,
  end_date        date not null,
  days_of_week    integer[] not null,            -- 0=Sun,1=Mon,2=Tue,3=Wed,4=Thu,5=Fri,6=Sat
  max_applications integer not null default 2 check (max_applications >= 0),
  created_by      uuid references public.profiles(id),
  created_at      timestamptz not null default now(),
  constraint valid_date_range check (end_date >= start_date)
);

-- RLS
alter table public.capacity_rules enable row level security;

create policy "Anyone logged in can view capacity rules"
  on public.capacity_rules for select using (auth.uid() is not null);

create policy "Admins can insert capacity rules"
  on public.capacity_rules for insert with check (public.is_admin());

create policy "Admins can update capacity rules"
  on public.capacity_rules for update using (public.is_admin());

create policy "Admins can delete capacity rules"
  on public.capacity_rules for delete using (public.is_admin());
