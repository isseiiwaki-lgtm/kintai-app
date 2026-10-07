-- スイッチ状態の保存値が無い既存の記録に、デプロイ時点の本番設定を1回だけ書き込む。
-- ①ON ②ON ③OFF ④OFF。これで、デプロイ後に①②の設定を切り替えても締め前の既存記録の計算結果が変わらない（原則5：遡及しない）。
-- 対象は出退勤の時刻がある記録だけ。時刻の無い記録（欠勤・有給だけなど）は、のちに打刻修正で時刻が入るとき
-- 「その時点の設定」を保存する流れ（snapshot: ifMissing）に任せるため、保存値を入れない。
-- 締め（LOCKED）は不要。保存値が1つでも欠けている記録を対象にし、4つとも上書きする。
UPDATE "AttendanceRecord"
SET "switchRoundEarly"   = true,
    "switchRoundNear"    = true,
    "switchRoundQuarter" = false,
    "switchCapOvertime"  = false
WHERE ("switchRoundEarly" IS NULL OR "switchRoundNear" IS NULL OR "switchRoundQuarter" IS NULL OR "switchCapOvertime" IS NULL)
  AND ("clockIn" IS NOT NULL OR "clockOut" IS NOT NULL OR "rawClockIn" IS NOT NULL OR "rawClockOut" IS NOT NULL);
