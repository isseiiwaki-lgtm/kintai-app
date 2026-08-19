# データ仕様変更履歴

AIが調査・実装を行う際の補助ドキュメント。
仕様変更がDBデータに及ぼした影響を時系列で記録する。

---

## 記録フォーマット

```
### YYYY-MM-DD: [変更タイトル]
**変更内容**: 何が変わったか
**影響カラム**: テーブル.カラム名
**既存データへの影響**: NULL 増加 / 再計算要 / 影響なし 等
**移行状態**: 済 / 未 / 不要
**補足**: 調査時に注意すべき点
```

---

## 履歴

### 2026-08-19: 近傍丸め（roundNear）を方向限定化 — 遅刻・早退の丸め消失
**変更内容**: `applyRounding()` の `roundNear` が前後対称（`|diff| <= 14`）だったため、遅刻側（出勤の定時後14分以内）と早退側（退勤の定時前14分以内）も定時へ丸められていた。`kind: "in" | "out"` を必須追加し、出勤=定時前のみ・退勤=定時後のみの丸めに変更。
**影響カラム**: `AttendanceRecord.clockIn` / `clockOut`（保存値）、および派生する `workingMinutes` / `overtimeMinutes` / `lateMinutes` / `earlyLeaveMinutes`
**既存データへの影響**: **あり（遡及未実施）**。設定 `roundNearClockTime` が ON の期間に打刻された日のうち、
- 出勤が定時後1〜14分だった日 → `clockIn` が定時に丸められ**遅刻が消えている**
- 退勤が定時前1〜14分だった日 → `clockOut` が定時に丸められ**早退が消えている**
該当日は打刻経路であれば `rawClockIn` / `rawClockOut` に実時刻が残っているため復元可能（生打刻の保存開始は 2026-07-29 デプロイのコミット `2d5d01d` 以降。それ以前の日は復元不可）。承認済・LOCKED の日は `lateMinutes` / `earlyLeaveMinutes` が保存値として確定済みのため、単純な再計算では上書き是非の判断が要る。
**移行状態**: 未（コード修正のみ本番反映。遡及補正は要判断）
**補足**: 調査用 SQL は本ファイル末尾「遡及候補の抽出」を参照。代理打刻（`actionAdminCreateRecord`）・打刻修正申請・管理者編集モーダル経由の日は丸めを通らないため対象外。

### 2026-05-26: workingMinutes の NULL 問題と overtimeMinutes の修正

**変更内容**:
1. 試験運用初期（2026-04 末〜05 初旬）に打刻されたレコードの一部で `workingMinutes` が NULL。
   `actionClockOut` が実装された時期以前の打刻、または計算が走らなかったケース。
2. `overtimeMinutes` が全レコードで保存されていなかった（`actionClockOut` に保存処理が未実装）。
3. `export/route.ts` でパートの残業時間を「全勤務時間=残業」と誤計算していた（所定=0固定のバグ）。

**修正内容**:
- `actionClockOut()` に `overtimeMinutes = max(0, workingMinutes - 480)` を追加・保存
- `export/route.ts` の overtime 計算を DB の `overtimeMinutes` 参照に修正
- `POST /api/admin/recalculate` を新規作成 — 過去レコードを一括再計算

**影響カラム**:
- `AttendanceRecord.workingMinutes` — NULL だった過去レコードが再計算で埋まる
- `AttendanceRecord.overtimeMinutes` — 全退勤済みレコードに値がセットされる

**既存データへの影響**:
- `workingMinutes` NULL レコード → 再計算 API 実行後に解消
- `overtimeMinutes` NULL → 再計算 API 実行後に解消（全退勤済みレコード対象）
- 打刻丸め処理（roundEarlyClockIn / roundNearClockTime）は打刻時に適用済みのため再計算不要

**移行状態**: 再計算 API 未実行（VPS 上で `POST /api/admin/recalculate` を管理者実行要）

**残業時間の定義（確定）**:
- 社員・パート共通: 1日の `workingMinutes` が 480分（8時間）を超えた分
- 週40時間超の残業集計は未実装（将来課題）
- 深夜残業（22:00〜5:00）・休日出勤は未実装（将来課題）

---

### 2026-04-28: P2 ステータス刷新 / 打刻丸めスイッチ追加

**変更内容**:
- `AttendanceStatus` の `OPEN` 廃止的変更（表示上 "未確認" → "打刻済 / 要確認" に統一）
- `Setting` テーブルに `roundEarlyClockIn`・`roundNearClockTime` カラム追加

**影響カラム**:
- `Setting.roundEarlyClockIn` (新規)
- `Setting.roundNearClockTime` (新規)
- `AttendanceRecord.status` の表示ロジック変更（DB 値自体は変更なし）

**既存データへの影響**:
- Setting テーブルは両フラグ `false`（デフォルト）で migration 追加 → 既存打刻への遡及影響なし
- 既存レコードの `clockIn`/`clockOut` は生時刻のまま保持

**移行状態**: 済（migration 適用済み）

---

### 2026-04-24: lateMinutes / earlyLeaveMinutes / overtimeMinutes / paidLeaveMinutes カラム追加

**変更内容**: `AttendanceRecord` に集計値カラムを追加

**影響カラム**:
- `AttendanceRecord.lateMinutes` (新規)
- `AttendanceRecord.earlyLeaveMinutes` (新規)
- `AttendanceRecord.overtimeMinutes` (新規)
- `AttendanceRecord.paidLeaveMinutes` (新規)

**既存データへの影響**:
- 追加前の全レコードは NULL のまま
- `overtimeMinutes` は 2026-05-26 の一括再計算 API で補完
- `lateMinutes`・`earlyLeaveMinutes`・`paidLeaveMinutes` は現時点で未セット
  → 承認・締め処理での自動計算は未実装（将来課題）

**移行状態**: migration 済・データ補完は部分的

---

## 未解決の既知 NULL 問題（調査用 SQL）

### workingMinutes が NULL のレコード確認
```sql
SELECT u.name, ar.date, ar."clockIn", ar."clockOut", ar."workingMinutes"
FROM "AttendanceRecord" ar
JOIN "User" u ON u.id = ar."userId"
WHERE ar."workingMinutes" IS NULL AND ar."clockOut" IS NOT NULL
ORDER BY u.name, ar.date;
```

### overtimeMinutes が NULL のレコード確認
```sql
SELECT COUNT(*) FROM "AttendanceRecord"
WHERE "clockOut" IS NOT NULL AND "overtimeMinutes" IS NULL;
```

### lateMinutes が NULL のレコード確認（将来の集計実装時に参照）
```sql
SELECT COUNT(*) FROM "AttendanceRecord"
WHERE "clockIn" IS NOT NULL AND "lateMinutes" IS NULL;
```

### 遡及候補の抽出（2026-08-19 丸め方向限定化の影響日）

出勤が丸めで遅刻を失った日（生打刻が定時後 1〜14 分）:
```sql
SELECT u.name, ar.date, ar."rawClockIn", ar."clockIn", ar.status
FROM "AttendanceRecord" ar
JOIN "User" u ON u.id = ar."userId"
WHERE ar."rawClockIn" IS NOT NULL
  AND ar."clockIn" IS NOT NULL
  AND ar."rawClockIn" > ar."clockIn"
ORDER BY ar.date DESC;
```

退勤が丸めで早退を失った日（生打刻が定時前 1〜14 分）:
```sql
SELECT u.name, ar.date, ar."rawClockOut", ar."clockOut", ar.status
FROM "AttendanceRecord" ar
JOIN "User" u ON u.id = ar."userId"
WHERE ar."rawClockOut" IS NOT NULL
  AND ar."clockOut" IS NOT NULL
  AND ar."rawClockOut" < ar."clockOut"
ORDER BY ar.date DESC;
```
※ 上記条件は「丸めで勤務時間が長くなる方向にズレた日」＝旧仕様で遅刻・早退が消えた日と一致する（早出丸め `roundEarly` は逆方向のズレになるため混入しない）。
