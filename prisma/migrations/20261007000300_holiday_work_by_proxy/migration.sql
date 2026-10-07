-- 休日出勤の印の出どころ（代理打刻のチェック）。休日出勤申請の削除では、この印は外さない
ALTER TABLE "AttendanceRecord" ADD COLUMN "holidayWorkByProxy" BOOLEAN NOT NULL DEFAULT false;
-- 休日出勤申請は未リリースなので、いま印が付いている記録はすべて代理打刻のチェックで付けたもの
UPDATE "AttendanceRecord" SET "holidayWorkByProxy" = true WHERE "isHolidayWork" = true;
