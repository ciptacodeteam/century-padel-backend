-- Apply once before deploying the backend. Existing bookings/balances are unchanged.
BEGIN;
CREATE TABLE "booking_membership_corrections" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "bookingId" TEXT NOT NULL UNIQUE REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "targetMembershipUserId" TEXT NOT NULL REFERENCES "membership_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "adminId" TEXT NOT NULL REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "hours" INTEGER NOT NULL CHECK ("hours" > 0),
  "reason" TEXT NOT NULL CHECK (length(trim("reason")) BETWEEN 5 AND 500),
  "sources" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "booking_membership_corrections_target_created_idx"
  ON "booking_membership_corrections"("targetMembershipUserId", "createdAt");
COMMIT;
