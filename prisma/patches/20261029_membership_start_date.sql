-- Apply before deploying the backend. Existing membership dates are unchanged.
BEGIN;
CREATE TABLE "membership_start_date_changes" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "membershipUserId" TEXT NOT NULL REFERENCES "membership_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "previousStartDate" TIMESTAMP(3) NOT NULL,
  "previousEndDate" TIMESTAMP(3) NOT NULL,
  "startDate" TIMESTAMP(3) NOT NULL,
  "endDate" TIMESTAMP(3) NOT NULL,
  "reason" TEXT NOT NULL CHECK (length(trim("reason")) BETWEEN 3 AND 500),
  "adminId" TEXT NOT NULL REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "membership_start_date_changes_membershipUserId_createdAt_idx"
  ON "membership_start_date_changes"("membershipUserId", "createdAt");
COMMIT;
