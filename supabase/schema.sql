-- ============================================================
-- TRUCK SCHEDULING APP - SUPABASE SCHEMA
-- Run this in your Supabase SQL editor (Project > SQL Editor)
-- ============================================================

-- 1. PROFILES (extends Supabase auth.users)
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text not null,
  role        text not null default 'salesman' check (role in ('admin', 'salesman')),
  created_at  timestamptz not null default now()
);

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    coalesce(new.raw_user_meta_data->>'role', 'salesman')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- 2. DAILY CAPACITY (admin sets max trucks per day)
create table public.daily_capacity (
  id          uuid primary key default gen_random_uuid(),
  date        date not null unique,
  max_trucks  int not null default 5 check (max_trucks > 0),
  set_by      uuid references public.profiles(id),
  updated_at  timestamptz not null default now()
);

-- Default capacity used when no row exists for a date
-- (app reads this from a settings table or hardcodes a fallback)
create table public.settings (
  key   text primary key,
  value text not null
);
insert into public.settings (key, value) values ('default_daily_capacity', '5');


-- 3. APPOINTMENTS
create table public.appointments (
  id              uuid primary key default gen_random_uuid(),
  date            date not null,
  salesman_id     uuid not null references public.profiles(id) on delete cascade,
  customer_name   text not null,
  notes           text,
  status          text not null default 'confirmed'
                  check (status in ('confirmed', 'pending_approval', 'approved', 'rejected')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index appointments_date_idx on public.appointments(date);
create index appointments_salesman_idx on public.appointments(salesman_id);


-- 4. APPROVAL REQUESTS (when day is full, salesman can request override)
create table public.approval_requests (
  id              uuid primary key default gen_random_uuid(),
  appointment_id  uuid references public.appointments(id) on delete cascade,
  salesman_id     uuid not null references public.profiles(id) on delete cascade,
  date            date not null,
  customer_name   text not null,
  notes           text,
  status          text not null default 'pending'
                  check (status in ('pending', 'approved', 'rejected')),
  admin_note      text,
  reviewed_by     uuid references public.profiles(id),
  reviewed_at     timestamptz,
  created_at      timestamptz not null default now()
);


-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

alter table public.profiles enable row level security;
alter table public.daily_capacity enable row level security;
alter table public.appointments enable row level security;
alter table public.approval_requests enable row level security;
alter table public.settings enable row level security;

-- Helper function: is the current user an admin?
create or replace function public.is_admin()
returns boolean language sql security definer as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;


-- PROFILES policies
create policy "Users can view all profiles"
  on public.profiles for select using (auth.uid() is not null);

create policy "Users can update their own profile"
  on public.profiles for update using (id = auth.uid());

create policy "Admins can update any profile"
  on public.profiles for update using (public.is_admin());


-- DAILY CAPACITY policies
create policy "Anyone logged in can view capacity"
  on public.daily_capacity for select using (auth.uid() is not null);

create policy "Admins can insert capacity"
  on public.daily_capacity for insert with check (public.is_admin());

create policy "Admins can update capacity"
  on public.daily_capacity for update using (public.is_admin());

create policy "Admins can delete capacity"
  on public.daily_capacity for delete using (public.is_admin());


-- APPOINTMENTS policies
create policy "Anyone logged in can view all appointments"
  on public.appointments for select using (auth.uid() is not null);

create policy "Salesmen can create their own appointments"
  on public.appointments for insert
  with check (salesman_id = auth.uid());

create policy "Salesmen can update their own appointments"
  on public.appointments for update
  using (salesman_id = auth.uid() or public.is_admin());

create policy "Salesmen can delete their own appointments"
  on public.appointments for delete
  using (salesman_id = auth.uid() or public.is_admin());


-- APPROVAL REQUESTS policies
create policy "Salesmen see their own requests; admins see all"
  on public.approval_requests for select
  using (salesman_id = auth.uid() or public.is_admin());

create policy "Salesmen can create approval requests"
  on public.approval_requests for insert
  with check (salesman_id = auth.uid());

create policy "Admins can update approval requests"
  on public.approval_requests for update
  using (public.is_admin());


-- SETTINGS policies
create policy "Anyone logged in can read settings"
  on public.settings for select using (auth.uid() is not null);

create policy "Admins can update settings"
  on public.settings for update using (public.is_admin());


-- ============================================================
-- HELPER VIEW: appointments with salesman name
-- ============================================================
create or replace view public.appointments_with_details as
  select
    a.*,
    p.full_name as salesman_name
  from public.appointments a
  join public.profiles p on p.id = a.salesman_id;

-- Grant view access
grant select on public.appointments_with_details to authenticated;
