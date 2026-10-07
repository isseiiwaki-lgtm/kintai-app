-- ⑤「新しい計算方式」（正社員の休憩の規定値と残業の式）。設定は OFF で始め、記録ごとに打刻時点の状態を保存する
ALTER TABLE "Setting" ADD COLUMN "newCalcMethod" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "AttendanceRecord" ADD COLUMN "switchNewCalc" BOOLEAN;

-- 既存の記録は旧方式（OFF）で保存する。対象は①〜④の保存値がある記録と、出退勤の時刻がある記録
-- （時刻の無い欠勤・有給だけの記録は、のちに時刻が入るとき「その時点の設定」を保存する流れに任せる）
UPDATE "AttendanceRecord"
SET "switchNewCalc" = false
WHERE "switchNewCalc" IS NULL
  AND ("switchRoundEarly" IS NOT NULL OR "switchRoundNear" IS NOT NULL OR "switchRoundQuarter" IS NOT NULL OR "switchCapOvertime" IS NOT NULL
       OR "clockIn" IS NOT NULL OR "clockOut" IS NOT NULL OR "rawClockIn" IS NOT NULL OR "rawClockOut" IS NOT NULL);
