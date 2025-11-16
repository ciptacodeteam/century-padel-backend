/*
  Warnings:

  - The values [DRAFT] on the enum `BookingStatus` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `tournamentRegistrationId` on the `invoices` table. All the data in the column will be lost.
  - You are about to drop the `tournament_registration_members` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `tournament_registrations` table. If the table is not empty, all the data it contains will be lost.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "BookingStatus_new" AS ENUM ('HOLD', 'CONFIRMED', 'CANCELLED');
ALTER TABLE "public"."bookings" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "public"."class_bookings" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "bookings" ALTER COLUMN "status" TYPE "BookingStatus_new" USING ("status"::text::"BookingStatus_new");
ALTER TABLE "class_bookings" ALTER COLUMN "status" TYPE "BookingStatus_new" USING ("status"::text::"BookingStatus_new");
ALTER TYPE "BookingStatus" RENAME TO "BookingStatus_old";
ALTER TYPE "BookingStatus_new" RENAME TO "BookingStatus";
DROP TYPE "public"."BookingStatus_old";
ALTER TABLE "bookings" ALTER COLUMN "status" SET DEFAULT 'HOLD';
ALTER TABLE "class_bookings" ALTER COLUMN "status" SET DEFAULT 'HOLD';
COMMIT;

-- DropForeignKey
ALTER TABLE "invoices" DROP CONSTRAINT "invoices_tournamentRegistrationId_fkey";

-- DropForeignKey
ALTER TABLE "tournament_registration_members" DROP CONSTRAINT "tournament_registration_members_tournamentRegistrationId_fkey";

-- DropForeignKey
ALTER TABLE "tournament_registration_members" DROP CONSTRAINT "tournament_registration_members_userId_fkey";

-- DropForeignKey
ALTER TABLE "tournament_registrations" DROP CONSTRAINT "tournament_registrations_clubId_fkey";

-- DropForeignKey
ALTER TABLE "tournament_registrations" DROP CONSTRAINT "tournament_registrations_tournamentId_fkey";

-- DropIndex
DROP INDEX "invoices_tournamentRegistrationId_key";

-- AlterTable
ALTER TABLE "bookings" ALTER COLUMN "status" SET DEFAULT 'HOLD';

-- AlterTable
ALTER TABLE "class_bookings" ALTER COLUMN "status" SET DEFAULT 'HOLD';

-- AlterTable
ALTER TABLE "inventories" ADD COLUMN     "price" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "invoices" DROP COLUMN "tournamentRegistrationId";

-- AlterTable
ALTER TABLE "payment_methods" ADD COLUMN     "channel" TEXT,
ADD COLUMN     "percentage" DECIMAL(65,30) NOT NULL DEFAULT 0;

-- DropTable
DROP TABLE "tournament_registration_members";

-- DropTable
DROP TABLE "tournament_registrations";

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
