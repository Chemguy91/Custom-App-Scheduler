-- Add is_demo flag to approval_requests
-- Keeps demo approval requests isolated from real ones
ALTER TABLE public.approval_requests
  ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS approval_requests_is_demo_idx ON public.approval_requests (is_demo);
