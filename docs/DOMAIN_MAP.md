# ドメインマップ（必読）

勤怠ロジックの修正指示を受けたら**コード変更前に必ずこのファイルを読む**。
詳細（file:line 一覧・列構成・全条件分岐）は `docs/DOMAIN_REFERENCE.md` — 必要な節だけ参照し全読み禁止。

---

## 修正指示を受けたら確認する5軸

修正指示は暗黙の適用範囲を含む。着手前に以下を特定し、不明ならユーザーに質問する。

1. **出勤か退勤か** — 丸めルールは非対称。出勤=roundEarly+roundNear、退勤=roundNearのみ
2. **申請有無で変わるか** — 早出申請→出勤丸め全OFF、残業申請→退勤roundNear OFF
3. **雇用形態で変わるか** — part=手動休憩打刻を控除、full=calcLegalBreak(法定)を控除
4. **期間は暦月か締め期間か** — 「今月」=原則締め期間（前月26日〜当月25日）。暦月と混同しない
5. **保存値か表示値か** — workingMinutes/overtimeMinutes=退勤時にDB保存、late/earlyLeave=承認時保存・未承認は表示時計算

## コアルール

- **丸めスイッチ**（Setting、両方 default OFF）
  - `roundEarlyClockIn`: 定時前打刻→定時扱い。**出勤のみ**
  - `roundNearClockTime`: 定時±14分→定時きっかり。出勤・退勤両方
  - 実体は `lib/attendance.ts` `applyRounding()`。roundEarly→roundNear の順で評価
  - **生打刻**: 丸め前の実時刻を `rawClockIn/rawClockOut` に打刻時のみ常時保存（証跡用・手入力や修正申請では書かれない）。`originalClockIn/Out`（修正前値）とは別概念。表示は差がある日のみ /records・承認詳細に併記、Excel 非出力
- **代理打刻**: 出退勤いずれの打刻もなかった日は `AttendanceRecord` 行自体が存在せず、表にも `/records` にも出ない。管理者は `/admin/approval/[userId]` の代理打刻フォーム（`actionAdminCreateRecord`）で後日打刻する。**生打刻は書かない**・保存後は APPROVED・**休日出勤チェック時のみ遅刻/早退を0**（`calcMetrics` は休日を判定しないため）。既に打刻がある日・LOCKED の日は拒否＝表の編集モーダルの担当
- **締め日**: `Setting.closingDay`（既定25）。締め期間 = 前月(closingDay+1)日〜当月closingDay日。
  計算は `lib/closing.ts` の共通関数を使う。**新規に日付範囲を書くとき暦月ベタ書き禁止**
- **残業の二重基準**: 打刻時保存値=法定8h(480分)超過分。承認・表示時=所定時間超過分。「残業計算を直す」は両方の確認要
- **LEAVE反映**: `leaveType="paid"`（有給）のみ勤怠へ反映（paidLeaveMinutes）。substitute（振休）・special・遅刻早退報告は AttendanceRecord 非反映
- **半日有給**: `lib/attendance.ts` の `calcScheduledMinutes()` で算出した本人所定時間の半分（四捨五入）。全休も同関数で本人所定時間そのまま（2026-07-10〜、旧仕様は480/240固定）。半休判定は `halfDay === "am" || === "pm"`（"full" が truthy な点に注意）
- **申請タイプはUIとDBで別**: UI `EARLY_START`→DB `OVERTIME`+`detail.overtimeType="earlyStart"`、UI `LEAVE_PAID/LEAVE_SUB`→DB `LEAVE`+`leaveType="paid"/"substitute"`。DB enum だけ grep すると見落とす
- **除外ユーザー基準**: 一覧/承認/Excel とも部署名 `department notIn ["管理者","管理職"]` に統一（2026-07-06〜）。Excel は加えて `employmentType in ["full","part"]`
- **申請承認は部署により多段階**: `ApprovalRoute` に経路がある部署は step 順の承認が必要（最終 step 承認で APPROVED + 勤怠反映）。経路なし部署は一段階。判定は `lib/approval.ts`
- **JST↔UTC**: DB は UTC 保存。日付基準を作るとき「+9hしてから日付部品を取り、-9h」する。`getUTCDate()` を先に呼ぶと JST 0:00〜8:59 で前日にズレる（過去に丸め全滅バグの根因）

## ファイルマップ（要点）

- `lib/attendance.ts` — 丸め・calcNeedsReview・getDisplayStatus・calcMetrics・calcScheduledMinutes・calcWorkingMinutes
- `lib/closing.ts` — 締め期間計算の共通関数
- `lib/approval.ts` — 申請の多段階承認判定（経路・現在ステップ・進捗）
- `config/attendance.config.ts` — 法定休憩ルール（ハードコード。Setting の閾値とは別物）
- `app/(app)/clock/actions.ts` — 打刻サーバーアクション（丸め適用・workingMinutes確定）
- `app/(app)/admin/requests/actions.ts` — 申請承認時の勤怠反映
- `app/(app)/admin/approval/[userId]/actions.ts` — 承認・締め・直接編集（late/earlyLeave確定）
- `app/api/admin/export-xlsx/route.ts` — Excel出力（33列）
- 期間基準: records / admin/attendance / admin/approval / home / admin/requests / export-xlsx すべて締め期間

## 修正時の作法

- 変更前に `.claude/skills/kintai-fix` のワークフローに従い、仕様理解を before/after 具体例でユーザーと合意する
- 修正後、このファイルと `DOMAIN_REFERENCE.md` の該当箇所が古くなっていないか確認・更新する
