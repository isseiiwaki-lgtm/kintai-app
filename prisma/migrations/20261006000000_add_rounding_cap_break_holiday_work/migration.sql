-- AlterEnum
ALTER TYPE "RequestType" ADD VALUE 'BREAK';

-- AlterTable
ALTER TABLE "Setting" ADD COLUMN     "roundQuarterHour" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "capOvertimeByRequest" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "breakMinutes" INTEGER;

-- AlterTable
ALTER TABLE "AttendanceRecord" ADD COLUMN     "breakMinutes" INTEGER,
ADD COLUMN     "isHolidayWork" BOOLEAN NOT NULL DEFAULT false;
