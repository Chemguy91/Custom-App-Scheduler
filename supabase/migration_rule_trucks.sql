-- ============================================================
-- MIGRATION: Add truck_ids to capacity_rules
-- Run in Supabase SQL Editor
-- ============================================================

-- Allow a rule to specify which trucks it governs (null = all trucks)
alter table public.capacity_rules
  add column if not exists truck_ids uuid[] default null;
