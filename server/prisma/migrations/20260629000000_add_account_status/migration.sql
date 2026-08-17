-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable: add status column (default PENDING for new rows)
ALTER TABLE "User" ADD COLUMN "status" "AccountStatus" NOT NULL DEFAULT 'PENDING';

-- Backfill: all existing users are already active, approve them
UPDATE "User" SET "status" = 'APPROVED';

-- AlterTable: drop isVerified (replaced by status)
ALTER TABLE "User" DROP COLUMN "isVerified";
