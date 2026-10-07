-- AlterEnum
ALTER TYPE "RequestType" ADD VALUE 'BREAK';

-- AlterEnum（休日出勤申請。後続の休日出勤・振休代休の実装が使う）
ALTER TYPE "RequestType" ADD VALUE 'HOLIDAY_WORK';

-- AlterTable
ALTER TABLE "Setting" ADD COLUMN     "roundQuarterHour" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "capOvertimeByRequest" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lunchStartTime" TEXT NOT NULL DEFAULT '12:00',
ADD COLUMN     "legalHolidayWeekday" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "weekStartDay" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "breakMinutes" INTEGER;

-- AlterTable（switch* は打刻時点のスイッチ状態。NULL＝保存値なしの既存の記録）
ALTER TABLE "AttendanceRecord" ADD COLUMN     "breakMinutes" INTEGER,
ADD COLUMN     "isHolidayWork" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "switchRoundEarly" BOOLEAN,
ADD COLUMN     "switchRoundNear" BOOLEAN,
ADD COLUMN     "switchRoundQuarter" BOOLEAN,
ADD COLUMN     "switchCapOvertime" BOOLEAN;
