-- Apply before deploying the backend. Existing packages remain public.
ALTER TABLE "memberships"
  ADD COLUMN IF NOT EXISTS "isPublic" BOOLEAN NOT NULL DEFAULT true;
