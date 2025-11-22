/*
  Warnings:

  - The values [DRAFT] on the enum `BookingStatus` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `tournamentRegistrationId` on the `invoices` table. All the data in the column will be lost.
  - You are about to drop the `tournament_registration_members` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `tournament_registrations` table. If the table is not empty, all the data it contains will be lost.

*/
-- Step 1: Update any DRAFT records to HOLD before altering the enum (idempotent)
DO $$ 
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'bookings' AND column_name = 'status') THEN
    UPDATE "bookings" SET "status" = 'HOLD' WHERE "status"::text = 'DRAFT';
  END IF;
  
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'class_bookings' AND column_name = 'status') THEN
    UPDATE "class_bookings" SET "status" = 'HOLD' WHERE "status"::text = 'DRAFT';
  END IF;
END $$;

-- Step 2: AlterEnum (idempotent - only if not already done)
DO $$ 
BEGIN
  -- Check if the new enum type already exists (migration already completed)
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t 
    WHERE t.typname = 'BookingStatus' 
    AND NOT EXISTS (
      SELECT 1 FROM pg_enum e 
      WHERE e.enumtypid = t.oid 
      AND e.enumlabel = 'DRAFT'
    )
  ) THEN
    -- Migration not yet complete, proceed with enum alteration
    IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BookingStatus_new') THEN
      DROP TYPE "BookingStatus_new";
    END IF;
    
    CREATE TYPE "BookingStatus_new" AS ENUM ('HOLD', 'CONFIRMED', 'CANCELLED');
    
    -- Drop defaults before altering columns
    ALTER TABLE "bookings" ALTER COLUMN "status" DROP DEFAULT;
    ALTER TABLE "class_bookings" ALTER COLUMN "status" DROP DEFAULT;
    
    -- Alter column types
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
    
    -- Rename types
    ALTER TYPE "BookingStatus" RENAME TO "BookingStatus_old";
    ALTER TYPE "BookingStatus_new" RENAME TO "BookingStatus";
    DROP TYPE IF EXISTS "BookingStatus_old";
    
    -- Restore defaults
    ALTER TABLE "bookings" ALTER COLUMN "status" SET DEFAULT 'HOLD';
    ALTER TABLE "class_bookings" ALTER COLUMN "status" SET DEFAULT 'HOLD';
  END IF;
END $$;

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

-- AlterTable (defaults already set above, but ensure they're set - idempotent)
DO $$ 
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'bookings' AND column_name = 'status') THEN
    ALTER TABLE "bookings" ALTER COLUMN "status" SET DEFAULT 'HOLD';
  END IF;
  
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'class_bookings' AND column_name = 'status') THEN
    ALTER TABLE "class_bookings" ALTER COLUMN "status" SET DEFAULT 'HOLD';
  END IF;
END $$;

-- AlterTable (idempotent)
ALTER TABLE "inventories" ADD COLUMN IF NOT EXISTS "price" INTEGER NOT NULL DEFAULT 0;

-- AlterTable (drop column only if it exists - idempotent)
DO $$ 
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'invoices' AND column_name = 'tournamentRegistrationId'
  ) THEN
    ALTER TABLE "invoices" DROP COLUMN "tournamentRegistrationId";
  END IF;
END $$;

-- AlterTable (idempotent)
ALTER TABLE "payment_methods" 
  ADD COLUMN IF NOT EXISTS "channel" TEXT,
  ADD COLUMN IF NOT EXISTS "percentage" DECIMAL(65,30) NOT NULL DEFAULT 0;

-- DropTable (idempotent)
DROP TABLE IF EXISTS "tournament_registration_members" CASCADE;
DROP TABLE IF EXISTS "tournament_registrations" CASCADE;

-- CreateTable (idempotent)
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'club_join_requests') THEN
    CREATE TABLE "club_join_requests" (
        "id" TEXT NOT NULL,
        "clubId" TEXT NOT NULL,
        "userId" TEXT NOT NULL,
        "status" TEXT NOT NULL DEFAULT 'PENDING',
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

        CONSTRAINT "club_join_requests_pkey" PRIMARY KEY ("id")
    );
  END IF;
END $$;

-- CreateTable (idempotent)
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'password_reset_tokens') THEN
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
  END IF;
END $$;

-- CreateIndex (idempotent)
CREATE INDEX IF NOT EXISTS "club_join_requests_clubId_status_idx" ON "club_join_requests"("clubId", "status");

-- CreateIndex (idempotent)
CREATE INDEX IF NOT EXISTS "club_join_requests_userId_status_idx" ON "club_join_requests"("userId", "status");

-- CreateIndex (idempotent)
CREATE UNIQUE INDEX IF NOT EXISTS "club_join_requests_clubId_userId_key" ON "club_join_requests"("clubId", "userId");

-- CreateIndex (idempotent)
CREATE UNIQUE INDEX IF NOT EXISTS "password_reset_tokens_token_key" ON "password_reset_tokens"("token");

-- CreateIndex (idempotent)
CREATE INDEX IF NOT EXISTS "password_reset_tokens_userId_idx" ON "password_reset_tokens"("userId");

-- CreateIndex (idempotent)
CREATE INDEX IF NOT EXISTS "password_reset_tokens_expiresAt_idx" ON "password_reset_tokens"("expiresAt");

-- AddForeignKey (idempotent - check table exists first and clean orphaned records)
DO $$ 
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'club_join_requests') THEN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'clubs') THEN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'club_join_requests_clubId_fkey' 
        AND table_name = 'club_join_requests'
      ) THEN
        -- Clean up any orphaned records before adding constraint
        DELETE FROM "club_join_requests" 
        WHERE "clubId" NOT IN (SELECT "id" FROM "clubs");
        
        ALTER TABLE "club_join_requests" ADD CONSTRAINT "club_join_requests_clubId_fkey" 
        FOREIGN KEY ("clubId") REFERENCES "clubs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
      END IF;
    END IF;
  END IF;
END $$;

-- AddForeignKey (idempotent - check table exists first and clean orphaned records)
DO $$ 
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'club_join_requests') THEN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'user') THEN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'club_join_requests_userId_fkey' 
        AND table_name = 'club_join_requests'
      ) THEN
        -- Clean up any orphaned records before adding constraint
        DELETE FROM "club_join_requests" 
        WHERE "userId" NOT IN (SELECT "id" FROM "user");
        
        ALTER TABLE "club_join_requests" ADD CONSTRAINT "club_join_requests_userId_fkey" 
        FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
      END IF;
    END IF;
  END IF;
END $$;

-- AddForeignKey (idempotent - check table exists first and clean orphaned records)
DO $$ 
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'password_reset_tokens') THEN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'user') THEN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'password_reset_tokens_userId_fkey' 
        AND table_name = 'password_reset_tokens'
      ) THEN
        -- Clean up any orphaned records before adding constraint
        DELETE FROM "password_reset_tokens" 
        WHERE "userId" NOT IN (SELECT "id" FROM "user");
        
        ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_userId_fkey" 
        FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
      END IF;
    END IF;
  END IF;
END $$;
