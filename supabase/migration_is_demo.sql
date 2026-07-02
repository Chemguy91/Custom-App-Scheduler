-- Add is_demo flag to appointments
-- Demo jobs only appear in demo mode, never in the real calendar
ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;

-- Index for fast filtering
CREATE INDEX IF NOT EXISTS appointments_is_demo_idx ON public.appointments (is_demo);

-- IMPORTANT: Recreate the view so it picks up the new is_demo column.
-- Must DROP first because CREATE OR REPLACE VIEW cannot change column order.
DROP VIEW IF EXISTS public.appointments_with_details;

CREATE VIEW public.appointments_with_details AS
  SELECT
    a.*,
    p.full_name  AS salesman_name,
    t.name       AS truck_name,
    tp.full_name AS applicator_name
  FROM public.appointments a
  LEFT JOIN public.profiles p  ON p.id  = a.salesman_id
  LEFT JOIN public.trucks   t  ON t.id  = a.truck_id
  LEFT JOIN public.profiles tp ON tp.id = t.applicator_id;

GRANT SELECT ON public.appointments_with_details TO authenticated;
