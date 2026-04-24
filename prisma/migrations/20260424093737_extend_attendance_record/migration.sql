-- AlterTable
ALTER TABLE "AttendanceRecord" ADD COLUMN     "earlyLeaveMinutes" INTEGER,
ADD COLUMN     "lateMinutes" INTEGER,
ADD COLUMN     "originalClockIn" TIMESTAMP(3),
ADD COLUMN     "originalClockOut" TIMESTAMP(3),
ADD COLUMN     "overtimeMinutes" INTEGER,
ADD COLUMN     "paidLeaveMinutes" INTEGER;

-- CreateTable
CREATE TABLE "AttendanceChangeLog" (
    "id" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "changedById" TEXT NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fieldName" TEXT NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT,

    CONSTRAINT "AttendanceChangeLog_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "AttendanceChangeLog" ADD CONSTRAINT "AttendanceChangeLog_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "AttendanceRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceChangeLog" ADD CONSTRAINT "AttendanceChangeLog_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
