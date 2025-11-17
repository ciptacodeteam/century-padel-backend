/*
  Warnings:

  - The values [DRAFT] on the enum `BookingStatus` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `tournamentRegistrationId` on the `invoices` table. All the data in the column will be lost.
  - You are about to drop the `tournament_registration_members` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `tournament_registrations` table. If the table is not empty, all the data it contains will be lost.

*/
-- Step 1: Update any DRAFT records to HOLD before altering the enum
UPDATE "bookings" SET "status" = 'HOLD' WHERE "status" = 'DRAFT';
UPDATE "class_bookings" SET "status" = 'HOLD' WHERE "status" = 'DRAFT';

-- Step 2: AlterEnum (wrap in transaction for atomicity)
BEGIN;
CREATE TYPE "BookingStatus_new" AS ENUM ('HOLD', 'CONFIRMED', 'CANCELLED');
ALTER TABLE "public"."bookings" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "public"."class_bookings" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "bookings" ALTER COLUMN "status" TYPE "BookingStatus_new" USING (
  CASE 
    WHEN "status"::text = 'DRAFT' THEN 'HOLD'::"BookingStatus_new"
    WHEN "status"::text = 'HOLD' THEN 'HOLD'::"BookingStatus_new"
    WHEN "status"::text = 'CONFIRMED' THEN 'CONFIRMED'::"BookingStatus_new"
    WHEN "status"::text = 'CANCELLED' THEN 'CANCELLED'::"BookingStatus_new"
    ELSE 'HOLD'::"BookingStatus_new"
  END
);
ALTER TABLE "class_bookings" ALTER COLUMN "status" TYPE "BookingStatus_new" USING (
  CASE 
    WHEN "status"::text = 'DRAFT' THEN 'HOLD'::"BookingStatus_new"
    WHEN "status"::text = 'HOLD' THEN 'HOLD'::"BookingStatus_new"
    WHEN "status"::text = 'CONFIRMED' THEN 'CONFIRMED'::"BookingStatus_new"
    WHEN "status"::text = 'CANCELLED' THEN 'CANCELLED'::"BookingStatus_new"
    ELSE 'HOLD'::"BookingStatus_new"
  END
);
ALTER TYPE "BookingStatus" RENAME TO "BookingStatus_old";
ALTER TYPE "BookingStatus_new" RENAME TO "BookingStatus";
DROP TYPE IF EXISTS "public"."BookingStatus_old";
ALTER TABLE "bookings" ALTER COLUMN "status" SET DEFAULT 'HOLD';
ALTER TABLE "class_bookings" ALTER COLUMN "status" SET DEFAULT 'HOLD';
COMMIT;

-- DropForeignKey (use DO block to handle cases where constraints might not exist)
DO $$ 
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'invoices_tournamentRegistrationId_fkey' 
    AND table_name = 'invoices'
  ) THEN
    ALTER TABLE "invoices" DROP CONSTRAINT "invoices_tournamentRegistrationId_fkey";
  END IF;
END $$;

-- DropForeignKey (only if tables and constraints exist)
DO $$ 
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'tournament_registration_members') THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.table_constraints 
      WHERE constraint_name = 'tournament_registration_members_tournamentRegistrationId_fkey' 
      AND table_name = 'tournament_registration_members'
    ) THEN
      ALTER TABLE "tournament_registration_members" DROP CONSTRAINT "tournament_registration_members_tournamentRegistrationId_fkey";
    END IF;
    IF EXISTS (
      SELECT 1 FROM information_schema.table_constraints 
      WHERE constraint_name = 'tournament_registration_members_userId_fkey' 
      AND table_name = 'tournament_registration_members'
    ) THEN
      ALTER TABLE "tournament_registration_members" DROP CONSTRAINT "tournament_registration_members_userId_fkey";
    END IF;
  END IF;
  
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'tournament_registrations') THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.table_constraints 
      WHERE constraint_name = 'tournament_registrations_clubId_fkey' 
      AND table_name = 'tournament_registrations'
    ) THEN
      ALTER TABLE "tournament_registrations" DROP CONSTRAINT "tournament_registrations_clubId_fkey";
    END IF;
    IF EXISTS (
      SELECT 1 FROM information_schema.table_constraints 
      WHERE constraint_name = 'tournament_registrations_tournamentId_fkey' 
      AND table_name = 'tournament_registrations'
    ) THEN
      ALTER TABLE "tournament_registrations" DROP CONSTRAINT "tournament_registrations_tournamentId_fkey";
    END IF;
  END IF;
END $$;

-- DropIndex (use IF EXISTS)
DROP INDEX IF EXISTS "invoices_tournamentRegistrationId_key";

-- AlterTable (defaults already set above, but ensure they're set)
ALTER TABLE "bookings" ALTER COLUMN "status" SET DEFAULT 'HOLD';

-- AlterTable
ALTER TABLE "class_bookings" ALTER COLUMN "status" SET DEFAULT 'HOLD';

-- AlterTable
ALTER TABLE "inventories" ADD COLUMN IF NOT EXISTS "price" INTEGER NOT NULL DEFAULT 0;

-- AlterTable (drop column only if it exists)
DO $$ 
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'invoices' AND column_name = 'tournamentRegistrationId'
  ) THEN
    ALTER TABLE "invoices" DROP COLUMN "tournamentRegistrationId";
  END IF;
END $$;

-- AlterTable
ALTER TABLE "payment_methods" 
  ADD COLUMN IF NOT EXISTS "channel" TEXT,
  ADD COLUMN IF NOT EXISTS "percentage" DECIMAL(65,30) NOT NULL DEFAULT 0;

-- DropTable (use IF EXISTS to handle partial migrations)
DROP TABLE IF EXISTS "tournament_registration_members";
DROP TABLE IF EXISTS "tournament_registrations";

-- CreateTable
CREATE TABLE "club_join_requests" (
    "id" TEXT NOT NULL,
    "clubId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "club_join_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "requestIp" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "club_join_requests_clubId_status_idx" ON "club_join_requests"("clubId", "status");

-- CreateIndex
CREATE INDEX "club_join_requests_userId_status_idx" ON "club_join_requests"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "club_join_requests_clubId_userId_key" ON "club_join_requests"("clubId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_token_key" ON "password_reset_tokens"("token");

-- CreateIndex
CREATE INDEX "password_reset_tokens_userId_idx" ON "password_reset_tokens"("userId");

-- CreateIndex
CREATE INDEX "password_reset_tokens_expiresAt_idx" ON "password_reset_tokens"("expiresAt");

-- AddForeignKey
ALTER TABLE "club_join_requests" ADD CONSTRAINT "club_join_requests_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "clubs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "club_join_requests" ADD CONSTRAINT "club_join_requests_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
