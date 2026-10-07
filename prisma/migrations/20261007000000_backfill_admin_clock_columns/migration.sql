-- リリース2より前の管理者修正・代理打刻を、段6.5の admin 列（adminClockIn / adminClockOut）へ1回だけ移す。
-- 目的：移したあとの再計算で、管理者が入力した時刻が①②で丸められず、入力値のまま残るようにする。
--
-- 管理者による変更の見分け方
--   AttendanceChangeLog には「誰が」の区別がなく（changedById は打刻修正申請の承認者＝管理者でも入る）、
--   管理者の直接編集・代理打刻・打刻修正の承認はどれも同じ形（fieldName が clockIn / clockOut）で残る。
--   そこで、打刻修正申請（CORRECTION・承認済み）の承認操作と一致する変更履歴を「申請の承認」とみなして除き、
--   残りを管理者の変更とする。一致の規則（lib/clock-pipeline.ts の findCorrectionLog と同じ）：
--   (1) 承認の記録（Approval）がある申請：同じ人・同じ日・同じ項目・同じ時刻で、承認の記録（Approval.actedAt）が
--       変更履歴の記録時刻の前後2分以内
--   (2) 承認の記録が1件も無い申請（承認の記録は 2026-07-06 以降しか無い。それ以前に承認したもの）：
--       同じ人・同じ日・同じ項目・同じ時刻の変更履歴のうち、申請の作成（Request.createdAt）以後で最も早い1件
--       （承認は申請の作成後。同じ時刻を管理者があとから入れ直した履歴は、承認より遅いので管理者の変更のまま残る）
--       同じ記録・同じ項目・同じ時刻の申請が複数あるときは1対1：申請を作成順（createdAt, id）に並べ、それぞれが
--       「先の申請に割り当て済みでない履歴」のうち、作成以後で最も早い1件を取る（2件目の承認の履歴が1件目と重ならない）
--   ※承認済みの申請そのものが削除された場合は承認の記録も消えているため、管理者の変更として扱う（一致を取れない）
-- 値の選び方
--   記録ごと・項目ごとに、出退勤の変更履歴のうち最新の1件だけを見る。それが管理者の変更なら admin 列へ写す。
--   最新が打刻修正の承認なら、現在の記録時刻はその承認で決まっているので写さない（打刻修正が勝つ現状を保つ）。
--   最新の履歴が実打刻の時刻より前なら、パイプライン（resolveInputTime の raw <= changedAt）でも実打刻が勝つので写さない。
-- 締め済み（LOCKED）の記録も対象にする：LOCKED は計算し直されないので、この更新で記録時刻は変わらない。
--   解除後に計算し直されたとき、管理者の入力値が丸められないようにするため。
-- 変更履歴の値は "HH:MM"（JST）。記録の date は JST の暦日の UTC 0時なので、date + 時刻 - 9時間 が UTC の時刻になる。
-- 既に admin 列に値がある記録は触らない（再実行しても同じ結果）。

-- (2) の割り当て：承認の記録が無い申請 → 承認由来とみなす変更履歴（1対1）。再帰で申請を作成順に1件ずつ処理する
CREATE TEMP TABLE "_approvalless_matches" AS
WITH RECURSIVE reqs AS (
  SELECT q."id" AS "qid", r."id" AS "rid",
         q."detail"->>'targetField' AS "fld", q."detail"->>'correctedTime' AS "tm", q."createdAt" AS "cat",
         row_number() OVER (
           PARTITION BY r."id", q."detail"->>'targetField', q."detail"->>'correctedTime'
           ORDER BY q."createdAt", q."id"
         ) AS "rn"
  FROM "Request" q
  JOIN "AttendanceRecord" r ON r."userId" = q."userId" AND r."date" = q."targetDate"
  WHERE q."type" = 'CORRECTION'
    AND q."status" = 'APPROVED'
    AND q."detail"->>'targetField' IN ('clockIn', 'clockOut')
    AND NOT EXISTS (SELECT 1 FROM "Approval" a2 WHERE a2."requestId" = q."id" AND a2."action" = 'APPROVED')
), walk AS (
  SELECT s."rid", s."fld", s."tm", s."rn", m."id" AS "logId",
         CASE WHEN m."id" IS NULL THEN ARRAY[]::text[] ELSE ARRAY[m."id"] END AS "taken"
  FROM reqs s
  LEFT JOIN LATERAL (
    SELECT y."id" FROM "AttendanceChangeLog" y
    WHERE y."recordId" = s."rid" AND y."fieldName" = s."fld" AND y."newValue" = s."tm" AND y."changedAt" >= s."cat"
    ORDER BY y."changedAt", y."id" LIMIT 1
  ) m ON true
  WHERE s."rn" = 1
  UNION ALL
  SELECT s."rid", s."fld", s."tm", s."rn", m."id",
         w."taken" || CASE WHEN m."id" IS NULL THEN ARRAY[]::text[] ELSE ARRAY[m."id"] END
  FROM walk w
  JOIN reqs s ON s."rid" = w."rid" AND s."fld" = w."fld" AND s."tm" = w."tm" AND s."rn" = w."rn" + 1
  LEFT JOIN LATERAL (
    SELECT y."id" FROM "AttendanceChangeLog" y
    WHERE y."recordId" = s."rid" AND y."fieldName" = s."fld" AND y."newValue" = s."tm" AND y."changedAt" >= s."cat"
      AND NOT (y."id" = ANY (w."taken"))
    ORDER BY y."changedAt", y."id" LIMIT 1
  ) m ON true
)
SELECT DISTINCT "logId" FROM walk WHERE "logId" IS NOT NULL;

CREATE TEMP TABLE "_admin_clock_values" AS
WITH latest AS (
  SELECT DISTINCT ON (l."recordId", l."fieldName")
         l."id", l."recordId", l."fieldName", l."newValue", l."changedAt"
  FROM "AttendanceChangeLog" l
  WHERE l."fieldName" IN ('clockIn', 'clockOut')
    AND l."newValue" ~ '^[0-9]{1,2}:[0-9]{2}$'
  ORDER BY l."recordId", l."fieldName", l."changedAt" DESC, l."id" DESC
)
SELECT x."recordId", x."fieldName",
       r."date"
         + (split_part(x."newValue", ':', 1)::int * 60 + split_part(x."newValue", ':', 2)::int) * interval '1 minute'
         - interval '9 hours' AS "value"
FROM latest x
JOIN "AttendanceRecord" r ON r."id" = x."recordId"
WHERE (
  CASE x."fieldName" WHEN 'clockIn' THEN r."rawClockIn" ELSE r."rawClockOut" END IS NULL
  OR CASE x."fieldName" WHEN 'clockIn' THEN r."rawClockIn" ELSE r."rawClockOut" END <= x."changedAt"
)
AND NOT EXISTS (
  SELECT 1
  FROM "Request" q
  JOIN "Approval" a ON a."requestId" = q."id" AND a."action" = 'APPROVED'
  WHERE q."userId" = r."userId"
    AND q."type" = 'CORRECTION'
    AND q."status" = 'APPROVED'
    AND q."targetDate" = r."date"
    AND q."detail"->>'targetField' = x."fieldName"
    AND q."detail"->>'correctedTime' = x."newValue"
    AND a."actedAt" BETWEEN x."changedAt" - interval '2 minutes' AND x."changedAt" + interval '2 minutes'
)
AND NOT EXISTS (
  -- (2) 承認の記録が無い申請：1対1の割り当て（_approvalless_matches）で承認由来になった履歴は除く
  SELECT 1 FROM "_approvalless_matches" mm WHERE mm."logId" = x."id"
);

UPDATE "AttendanceRecord" r
SET "adminClockIn" = v."value"
FROM "_admin_clock_values" v
WHERE v."recordId" = r."id" AND v."fieldName" = 'clockIn' AND r."adminClockIn" IS NULL;

UPDATE "AttendanceRecord" r
SET "adminClockOut" = v."value"
FROM "_admin_clock_values" v
WHERE v."recordId" = r."id" AND v."fieldName" = 'clockOut' AND r."adminClockOut" IS NULL;

DROP TABLE "_admin_clock_values";
DROP TABLE "_approvalless_matches";
