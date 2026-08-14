-- ============================================================
-- MIGRATION: Employee PTO events
-- Any authenticated user can request PTO for themselves (start–end date
-- range). Visible to everyone on the calendar, no approval step. The
-- employee who owns an entry (or an admin) can edit/delete it; admins can
-- also add PTO on behalf of any employee.
-- Run in Supabase SQL Editor
-- ============================================================

create table if not exists public.pto_events (
  id           uuid primary key default gen_random_uuid(),
  employee_id  uuid not null references public.profiles(id) on delete cascade,
  start_date   date not null,
  end_date     date not null,
  reason       text,
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint pto_events_date_order check (end_date >= start_date)
);

create index if not exists pto_events_start_date_idx on public.pto_events(start_date);
create index if not exists pto_events_end_date_idx   on public.pto_events(end_date);
create index if not exists pto_events_employee_idx   on public.pto_events(employee_id);

alter table public.pto_events enable row level security;

-- Anyone logged in can view PTO (calendar needs to read it)
drop policy if exists "Authenticated users can view pto events" on public.pto_events;
create policy "Authenticated users can view pto events"
  on public.pto_events for select
  using (auth.uid() is not null);

-- Any user can add PTO for themselves; admins can add it for anyone
drop policy if exists "Users insert own pto; admins insert any" on public.pto_events;
create policy "Users insert own pto; admins insert any"
  on public.pto_events for insert
  with check (employee_id = auth.uid() or public.is_admin());

-- Owner or admin can edit
drop policy if exists "Owner or admin can update pto events" on public.pto_events;
create policy "Owner or admin can update pto events"
  on public.pto_events for update
  using (employee_id = auth.uid() or public.is_admin());

-- Owner or admin can delete
drop policy if exists "Owner or admin can delete pto events" on public.pto_events;
create policy "Owner or admin can delete pto events"
  on public.pto_events for delete
  using (employee_id = auth.uid() or public.is_admin());

-- View: PTO with employee name (for calendar display / admin panel)
create or replace view public.pto_events_with_details as
  select
    e.*,
    p.full_name as employee_name
  from public.pto_events e
  join public.profiles p on p.id = e.employee_id;

grant select on public.pto_events_with_details to authenticated;
