-- ============================================================
-- MIGRATION: Company Events (misc events — meetings, company events, etc.)
-- Admin-only to create/edit/delete; visible to everyone.
-- Run in Supabase SQL Editor
-- ============================================================

create table if not exists public.company_events (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  date        date not null,
  notes       text,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists company_events_date_idx on public.company_events(date);

alter table public.company_events enable row level security;

-- Anyone logged in can view company events (calendar needs to read them)
drop policy if exists "Authenticated users can view company events" on public.company_events;
create policy "Authenticated users can view company events"
  on public.company_events for select
  using (auth.uid() is not null);

-- Only admins can manage company events
drop policy if exists "Admins can insert company events" on public.company_events;
create policy "Admins can insert company events"
  on public.company_events for insert
  with check (public.is_admin());

drop policy if exists "Admins can update company events" on public.company_events;
create policy "Admins can update company events"
  on public.company_events for update
  using (public.is_admin());

drop policy if exists "Admins can delete company events" on public.company_events;
create policy "Admins can delete company events"
  on public.company_events for delete
  using (public.is_admin());
