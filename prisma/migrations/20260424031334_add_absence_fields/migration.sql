-- AlterTable
ALTER TABLE "AttendanceRecord" ADD COLUMN     "isAbsent" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "scheduledEndTime" TEXT,
ADD COLUMN     "scheduledStartTime" TEXT;
