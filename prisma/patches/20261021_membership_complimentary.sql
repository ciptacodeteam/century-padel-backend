-- Additive patch for existing installations (this repository has no migration
-- baseline). Apply once before deploying the backend; no existing balance changes.
BEGIN;
ALTER TABLE "membership_users"
  ADD COLUMN "remainingComplimentarySessions" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "totalComplimentarySessions" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "booking_details"
  ADD COLUMN "complimentaryMembershipHours" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "membershipHoursRestored" BOOLEAN NOT NULL DEFAULT false;
CREATE TABLE "membership_complimentary_grants" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "requestId" TEXT NOT NULL UNIQUE,
  "membershipUserId" TEXT NOT NULL REFERENCES "membership_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "hours" INTEGER NOT NULL CHECK ("hours" BETWEEN 1 AND 10000),
  "reason" TEXT NOT NULL CHECK (length(trim("reason")) BETWEEN 3 AND 500),
  "adminId" TEXT NOT NULL REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "membership_complimentary_grants_membershipUserId_createdAt_idx"
  ON "membership_complimentary_grants"("membershipUserId", "createdAt");
ALTER TABLE "membership_users" ADD CONSTRAINT "membership_complimentary_balance_check"
  CHECK ("remainingComplimentarySessions" >= 0
    AND "remainingComplimentarySessions" <= "remainingSessions"
    AND "remainingComplimentarySessions" <= "totalComplimentarySessions");
ALTER TABLE "booking_details" ADD CONSTRAINT "membership_complimentary_hours_check"
  CHECK ("complimentaryMembershipHours" >= 0);
COMMIT;
