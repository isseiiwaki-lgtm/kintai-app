-- AlterTable
ALTER TABLE "Setting" ADD COLUMN     "roundEarlyClockIn" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "roundNearClockTime" BOOLEAN NOT NULL DEFAULT false;
