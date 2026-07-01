-- ============================================================
-- MIGRATION: Blackout Days (holidays, closures, etc.)
-- Run in Supabase SQL Editor
-- ============================================================

create table if not exists public.blackout_days (
  id          uuid primary key default gen_random_uuid(),
  date        date not null unique,
  reason      text,           -- e.g. "Thanksgiving", "Christmas", "Company Holiday"
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);

create index if not exists blackout_days_date_idx on public.blackout_days(date);

alter table public.blackout_days enable row level security;

-- Anyone logged in can view blackout days (calendar needs to read them)
create policy "Authenticated users can view blackout days"
  on public.blackout_days for select
  using (auth.uid() is not null);

-- Only admins can manage blackout days
create policy "Admins can insert blackout days"
  on public.blackout_days for insert
  with check (public.is_admin());

create policy "Admins can delete blackout days"
  on public.blackout_days for delete
  using (public.is_admin());

create policy "Admins can update blackout days"
  on public.blackout_days for update
  using (public.is_admin());
