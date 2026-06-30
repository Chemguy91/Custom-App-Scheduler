-- ============================================================
-- MIGRATION: New Roles, Trucks, Days Off
-- Run in Supabase SQL Editor
-- ============================================================

-- 1. Update profiles role to support new roles
--    First update existing data, then change constraint

update public.profiles set role = 'sales_manager' where role = 'salesman';

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check
  check (role in ('admin', 'sales_manager', 'applicator', 'viewer'));

-- Update the trigger default for new users
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    coalesce(new.raw_user_meta_data->>'role', 'sales_manager')
  );
  return new;
end;
$$;


-- 2. TRUCKS table
create table public.trucks (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  applicator_id uuid references public.profiles(id) on delete set null,
  active_from date,               -- first date this truck is available
  active_to   date,               -- last date this truck is available (null = no end)
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now()
);

alter table public.trucks enable row level security;

create policy "Authenticated users can view trucks"
  on public.trucks for select using (auth.uid() is not null);

create policy "Admins can insert trucks"
  on public.trucks for insert with check (public.is_admin());

create policy "Admins can update trucks"
  on public.trucks for update using (public.is_admin());

create policy "Admins can delete trucks"
  on public.trucks for delete using (public.is_admin());


-- 3. DAYS OFF table
create table public.days_off (
  id            uuid primary key default gen_random_uuid(),
  applicator_id uuid not null references public.profiles(id) on delete cascade,
  truck_id      uuid references public.trucks(id) on delete set null,
  date          date not null,
  reason        text,
  status        text not null default 'pending'
                check (status in ('pending', 'approved', 'rejected')),
  admin_note    text,
  reviewed_by   uuid references public.profiles(id),
  reviewed_at   timestamptz,
  created_at    timestamptz not null default now(),
  unique (applicator_id, date)    -- one request per applicator per day
);

create index days_off_date_idx on public.days_off(date);
create index days_off_applicator_idx on public.days_off(applicator_id);

alter table public.days_off enable row level security;

-- Helper: is current user an applicator?
create or replace function public.is_applicator()
returns boolean language sql security definer as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'applicator'
  );
$$;

create policy "Applicators see their own days off; admins see all"
  on public.days_off for select
  using (applicator_id = auth.uid() or public.is_admin());

-- Sales managers can also see all days off (to know truck availability)
create policy "Sales managers can view all days off"
  on public.days_off for select
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('sales_manager', 'admin')
    )
  );

create policy "Applicators can insert their own days off"
  on public.days_off for insert
  with check (applicator_id = auth.uid());

create policy "Applicators can delete their own pending days off"
  on public.days_off for delete
  using (applicator_id = auth.uid() and status = 'pending');

create policy "Admins can update days off"
  on public.days_off for update using (public.is_admin());


-- 4. View: trucks with applicator name
create or replace view public.trucks_with_details as
  select
    t.*,
    p.full_name as applicator_name
  from public.trucks t
  left join public.profiles p on p.id = t.applicator_id;

grant select on public.trucks_with_details to authenticated;
