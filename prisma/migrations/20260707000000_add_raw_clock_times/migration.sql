-- 生打刻（丸め適用前の実打刻時刻）を保存する列を追加
ALTER TABLE "AttendanceRecord" ADD COLUMN "rawClockIn" TIMESTAMP(3),
ADD COLUMN "rawClockOut" TIMESTAMP(3);
