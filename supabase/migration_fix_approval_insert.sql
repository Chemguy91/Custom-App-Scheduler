-- ============================================================
-- MIGRATION: Fix appointments INSERT policy for admin approval flow
-- Run in Supabase SQL Editor
-- ============================================================

-- The original policy only allows salesman_id = auth.uid(), which blocks
-- admins from inserting appointments on behalf of salespeople during approval.

drop policy if exists "Salesmen can create their own appointments" on public.appointments;

create policy "Salesmen can create their own appointments"
  on public.appointments for insert
  with check (salesman_id = auth.uid() or public.is_admin());
