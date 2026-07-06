# ドメインリファレンス（詳細参照用）

`DOMAIN_MAP.md`（必読）の詳細版。**全読み禁止 — 該当する節だけ読む。**
初版: 2026-07-06 コード調査に基づく。file:line は当時点。修正後はズレる可能性あり。

---

## 1. 打刻丸め

- 本体: `lib/attendance.ts` `applyRounding(actual, scheduled, {roundEarly, roundNear})`
  - `roundEarly && diffMin < 0` → 定時を返す（定時前丸め）
  - `roundNear && |diffMin| <= 14` → 定時を返す（前後14分丸め）
  - 評価順: roundEarly → roundNear
- Setting キー: `roundEarlyClockIn` / `roundNearClockTime`（schema、default false）
- 適用（`app/(app)/clock/actions.ts`）
  - 出勤 `actionClockIn`: scheduled=`user.workStartTime`、roundEarly=設定値、roundNear=設定値
  - 退勤 `actionClockOut`: scheduled=`user.workEndTime`、roundEarly=**常にfalse**、roundNear=設定値
- 申請による無効化
  - 当日早出申請（OVERTIME + `detail.overtimeType=="earlyStart"`、PENDING/APPROVED）→ 出勤の丸め両方OFF・生時刻保存
  - 当日残業申請（OVERTIME + earlyStart以外）→ 退勤の roundNear OFF
- 却下時の再丸め: `admin/requests/actions.ts`（申請却下で丸め再適用）
- **過去バグ（2026-07-06修正済）**: todayUTC 算出が `getUTCDate()` 先行で JST 0:00〜8:59 打刻時に基準日が1日ズレ、朝の丸めが全滅していた。日付基準は「+9h→日付部品→-9h」で作ること

## 2. 打刻処理フロー（clock/actions.ts）

- `actionClockIn`: upsert で clockIn のみ保存。集計はしない
- `actionClockOut`:
  - 在席分 = (退勤−出勤) − 外出時間
  - part: 手動 breakStart/breakEnd を控除。full: `calcLegalBreak(rawMinutes)` 控除
  - `workingMinutes` 確定・`overtimeMinutes = max(0, workingMinutes − 480)`（法定8h固定）
- `calcLegalBreak`（`config/attendance.config.ts`）: 480分超→60分、360分超→45分、以下0。**Setting の break 閾値とは連動していない**
- lateMinutes / earlyLeaveMinutes は承認時（`admin/approval/[userId]/actions.ts`）に保存。未承認レコードは表示時にオンザフライ計算

## 3. 締め期間

- `Setting.closingDay`（default 25）
- 締め期間式: `firstDay = UTC(year, month-2, closingDay+1)` 〜 `lastDay = UTC(year, month-1, closingDay)`
- デフォルト表示月: 当日(JST) > closingDay なら翌月扱い
- 共通関数: `lib/closing.ts`（2026-07-06新設）。それ以前は records / admin/attendance / admin/approval / home の4箇所に同一式コピペ（→共通関数への置換は残タスク）
- admin/requests・export-xlsx は暦月だったのを 2026-07-06 締め期間へ修正
- `actionBulkApprove` / `actionBulkLock` は firstDay/lastDay を引数で受ける（呼び出し元の期間に追従）

## 4. 申請タイプ

- DB enum `RequestType`: OVERTIME / LEAVE / ABSENCE / CORRECTION / COMMENT / OTHER
- UI→DB 変換（`requests/new/page.tsx`・`requests/actions.ts`）
  - EARLY_START（早出）→ OVERTIME + `detail.overtimeType="earlyStart"`
  - LEAVE_PAID → LEAVE + `leaveType="paid"`、LEAVE_SUB（振休）→ LEAVE + `leaveType="substitute"`
  - ABSENCE_ABSENT → ABSENCE + `absenceType="absent"`
- 承認時反映（`admin/requests/actions.ts` `actionApproveRequest`）
  - ABSENCE(absent): `isAbsent=true`
  - LEAVE(paid): `paidLeaveMinutes` 反映。半日(am/pm)=240分・全日=480分（**一律8hベース、所定非連動 — 既知課題**）
  - CORRECTION: 対象フィールド更新 + workingMinutes 再計算 + ChangeLog
  - LEAVE(substitute)・special・ABSENCE(late/early): **勤怠へ非反映**（記録のみ）
- `leaveType="special"`（特別休暇）は Excel に列があるが UI 作成導線なし
- `halfDay`: "full" / "am" / "pm"。**"full" は truthy** — 半休判定は `=== "am" || === "pm"` で書く（過去に Excel 側で `halfDay ?` 判定して全日を0.5日誤カウントするバグ）
- 用語: `substitute` の表示名は「振休（振替休日）」（2026-07-06に代休から改称。法的に代休は別概念・将来別機能）

## 5. ステータス

- `calcNeedsReview`（lib/attendance.ts）: 遅刻(clockIn>start+1分)→要確認／date>=today は以降省略／昨日以前退勤なし→要確認／早退(clockOut<end-1分)→要確認
- `getDisplayStatus`: LOCKED→締め済／APPROVED→承認済（correctionStatus=APPROVED なら修正済）／SUBMITTED→確認済／OPEN: correction PENDING→申請中・needsReview→要確認・他→打刻済
- 承認遷移: OPEN→APPROVED→LOCKED。APPROVED化=一括承認 or 管理者直接編集。LOCK=ADMINのみ

## 6. Excel出力（export-xlsx/route.ts）

- 対象: `isActive` + `department notIn ["管理者","管理職"]` + `employmentType in ["full","part"]`（2026-07-06に role 基準から部署基準へ統一。経営者レベル=管理系部署のみ除外）
- 33列: 1日付/2承認/3勤務/4休日/5振替日/6勤務時間/7時間内/8休憩/9中抜け/10残業/11法定内残業/12法定外残業/13時間外深夜/14時間内深夜/15-18法定休日出勤系/19-22休日出勤系/23有給(日)/24有給(時間)/25特休(有給)/26特休(無給)/27振休/28遅刻早退/29欠勤/30出勤/31退勤/32変更出勤/33変更退勤
- 11〜22列は未実装・空欄
- 期間: 締め期間（2026-07-06〜）。ヘッダ部に有給使用合計（日/時間）表示
- 休日行色分け・A4横印刷・従業員コード数値昇順

## 7. 除外ユーザー基準の履歴

- 〜2026-07-02: 一覧/承認=部署名基準、Excel=role(ADMIN/APPROVER除外)+employmentType 基準で**不一致**
- 2026-07-06〜: 部署名基準に統一。「管理者を除外」という指示が来たら「どの画面か・部署基準かrole基準か」を確認する

## 8. AIが誤解しやすいポイント一覧（調査時点の12項目）

1. 出勤と退勤で丸め条件が違う（出勤=early+near、退勤=nearのみ）
2. TZ起因バグは朝の打刻だけ顕在化する（退勤で動く≠出勤も動く）
3. 申請有無で丸めが動的に無効化される（「丸めが効かない」は仕様の可能性）
4. overtimeMinutes の基準が二重（保存=法定480分、表示=所定）
5. workingMinutes は退勤時、late/earlyLeave は承認時に確定（タイミング分離）
6. 雇用形態で休憩控除が違う（part=手動、full=法定）。同分岐が複数ファイルに重複
7. 除外ユーザー基準が画面ごとに違った（→部署基準に統一済。ただし今後も要注意）
8. 月単位 vs 締め期間の混在（→統一済。新規実装で暦月ベタ書き禁止）
9. 半日有給judge非対称（`=== "am"||"pm"` が正。truthy判定は誤り）
10. LEAVE種別で勤怠反映有無が違う（paidのみ反映）
11. UI申請タイプとDB enum が別物（grep 時に注意）
12. special（特別休暇）は列があるがデータ源（UI導線）がない
