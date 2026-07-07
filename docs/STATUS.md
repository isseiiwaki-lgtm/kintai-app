# 実装状況 & タスク管理

最終更新: 2026-07-07

---

## 機能一覧（実装済み）

### 一般ユーザー
- **ホーム** `/` — 打刻状態・月次実績。インフォメーション（退勤漏れ・却下・要確認・審査中）。クイック打刻ボタン
- **打刻** `/clock` — 出勤・退勤・外出・戻り・休憩開始/終了（2×2グリッド）。当日コメント欄（申請にならない当日事情を管理者へ連絡。`note` カラム使用・承認詳細の備考列に表示）
- **勤怠記録** `/records` — 月次一覧（出勤〜早退・状態バッジ）。修正依頼リンク。CORRECTION申請状態に連動したバッジ（申請中/修正済）。丸めと差がある日は生打刻を「実 H:MM」で併記
- **申請** `/requests` — 申請一覧・取り下げ
- **申請 新規** `/requests/new` — 残業・早出・遅刻早退・欠勤・休暇（有給/振休/半日）・打刻修正・その他
- **マニュアル** `/manual`

### 管理者 (ADMIN/APPROVER)
- **勤務状況一覧** `/admin/attendance` — 全ユーザー月次一覧・締め日連動・従業員コード順・管理系部署除外
- **勤怠承認** `/admin/approval` — ユーザー別承認状況（未承認/承認済/締め済）。承認/承認取消/締め。個人詳細: 編集モーダル・一括承認・一括締め・生打刻併記（丸めと差がある日のみ）
- **申請承認** `/admin/requests` — 承認/却下/修正/削除。修正前値表示（CORRECTION: 修正前時刻、OVERTIME: 定時）。**多段階承認対応**（経路設定部署のみ。進捗バッジ・担当外は操作不可・ADMIN飛び越し承認）。処理済み一覧は申請者順（人ごと→対象日降順グルーピング）/対象日順の切替可
- **承認経路管理** `/admin/approval-routes` — ADMIN専用。部署×step×承認者の登録/上書き/削除。経路未設定部署は一段階承認
- **休日カレンダー** `/admin/holidays` — 祝日一括シード・手動追加/削除
- **ユーザー管理** `/admin/users` — CRUD・複製・CSVインポート/エクスポート
- **設定** `/admin/settings` — 締め日・休憩控除ルール・打刻丸めスイッチ（定時前打刻→定時扱い・定時前後14分→定時きっかり）
- **Excel出力** `/api/admin/export-xlsx` — 個人別日別勤務報告書（1ファイル・人別シート）。33列・未実装列は空欄。締め期間単位。管理系部署（管理者/管理職）・管理外雇用形態を除外・従業員コード昇順・有給使用合計（日/時間）表示
- **変更履歴** `/admin/changelog`
- **打刻異常検知** `GET /api/admin/anomaly-check?date=YYYY-MM-DD` — 退勤漏れ・戻り漏れ・パート休憩打刻漏れ（6h超）・workingMinutes NULL を JSON で返す。ADMIN セッション or `ANOMALY_CHECK_TOKEN`（Bearer、n8n 日次バッチ用）で認証。省略時は JST 昨日

### 認証
- Google OAuth (NextAuth v5) + JWT。ADMIN/APPROVER/EMPLOYEE の3ロール

---

## 未完了タスク

### 優先①: 仕様確認・小修正
- [x] **実データ仕様確認** — 2026-05-26完了。`docs/SESSION_2026-05-26_data-audit.md` 参照。workingMinutes NULL / パート残業計算バグを修正。`POST /api/admin/recalculate` 新規作成（VPS で実行要）
- [ ] **COMMENT 申請タイプ存続** — CORRECTION と別に残す（テキストのみの連絡用途）
- [ ] **LeaveBalance テーブル確認** — migration 済みか未確認。`actionDeleteUser` で `.catch(()=>{})` で握り潰し中
- [ ] **外出・休憩の複数回対応（仕様決定）** — `goOutAt/returnAt`・`breakStart/breakEnd` は各1ペアのみ。2回目で上書き消滅。A) 現行のまま（修正依頼で対応）/ B) `GoOutLog[]` テーブル追加

### 優先②: 計算・ロジック
- [x] **パート残業計算（1日法定ベース）** — 1日8h超を残業として `overtimeMinutes` に保存（`actionClockOut` + 一括再計算 API）。週40h超・深夜・月60h超は未実装
- [ ] **パート残業計算（週40h超・割増賃金）** — 週40h超・深夜×1.25・月60h超×1.5は将来実装
- [ ] **設定: 時刻丸め処理** — 日次は1分毎カウント・切り上げのみ可。月次合計は30分単位（31〜59分は切り上げ）
- [x] **申請承認の並び順・ソート** — 2026-07-06実装。申請者順（人ごと→対象日降順・グルーピング表示）/対象日順の切替UI
- [x] **打刻画面に当日コメント欄** — 2026-07-06実装。既存 `note` カラム使用（migration不要）。承認詳細（/admin/approval/[userId]）に備考列追加
- [ ] **半休を本人所定時間の半分で計算** — 現在一律240分（8h÷2）。0.5日×2回=1日消化ルールは将来の有給カウント機能で前提化（ISSUE 2026-07昇格）
- [x] **締め期間計算の共通関数化** — 2026-07-06完了。records / admin/attendance / admin/approval / admin/approval/[userId] / home の5箇所を `lib/closing.ts` へ置換（インライン式全廃）
- [x] **生打刻（丸め前実時刻）の保存・表示** — 2026-07-07実装（ISSUE昇格・優先高）。`rawClockIn/rawClockOut` に打刻時の実時刻を常時保存。労使問題・労災時の証跡用。表示は差がある日のみ /records と承認詳細に小さく併記（Excel には出さない・有事は DB から取り出す運用）

### 優先③: 大規模機能
- [x] **多段階承認（申請承認）** — 2026-07-06実装。承認経路管理（部署ごと・可変段数）・飛び越し承認・最終step承認で確定。設計: `docs/DESIGN_MULTISTAGE_APPROVAL.md`。勤怠承認（/admin/approval）の多段階化は将来拡張（実質不要と判断）
- [ ] **メール通知** — 承認依頼 > 打刻漏れ（管理者向け） > 却下通知 > 承認完了通知。`companyEmail` 優先
- [x] **xlsx出力** — 個人別日別勤務報告書（exceljs）実装済み。未実装列（法定内/外残業・深夜・休日出勤系）は空欄

### 優先④: 将来機能
- [ ] **申請データ削除時「削除済」表示** — 管理側削除後もユーザー側に記録を残す
- [ ] **キャリブレーション機能** — 対象日付範囲のデータ補正。変更前後プレビュー・警告・バックアップ付き
- [ ] **パート曜日ごと定時設定** — 曜日により所定終業が異なるケース。DBカラム増加が許容できる段階で実装
- [ ] **代休機能の新設** — 現「振休」（`leaveType="substitute"`）とは法的に別概念の「代休」を別機能として追加（ISSUE 2026-07昇格）

---

## 懸念事項

- **勤務時間計算** — `workingMinutes` の更新タイミングと外出/休憩控除のロジックを要確認
- **出勤日判定の優先順位** — 休暇申請承認済 > 休日カレンダー > 個人所定出勤曜日設定（矛盾は事前バリデーションで排除）
- **【要仕様確認】パート休憩打刻漏れ時の法定休憩** — パートが休憩打刻を忘れると `workingMinutes` 過大計上。フォールバックとして `calcLegalBreak` 適用するか管理担当者に確認（`clock/actions.ts:93-104`）

---

## 変更履歴

### 2026-07-07
- **機能追加: 生打刻（丸め前実時刻）の保存・表示** — ISSUE 昇格（優先高）。`rawClockIn/rawClockOut` カラム新設（migration `20260707000000_add_raw_clock_times`）。打刻時に丸め適用前の実時刻を常時保存（手入力・修正申請承認では書き込まれない＝実打刻が存在した日だけ残る）。表示は丸めと差がある日のみ /records（PC表・SPカード）と承認詳細（/admin/approval/[userId]）の出勤/退勤セルに「実 H:MM」を小さく併記（列追加なし・横幅不変）。Excel には出力しない（有事は DB 参照）。既存の `originalClockIn/Out`（修正前値）とは別概念で併存。**migration 本番未適用（デプロイ時に `prisma migrate deploy` 要）**

### 2026-07-06
- **機能追加: 申請承認の並び順切替** — 処理済み一覧を申請者順（人ごと→対象日降順・同一申請者は「〃」でグルーピング表示）/対象日順で切替（デフォルト申請者順）。申請者・種別列の折り返し防止も実施
- **機能追加: 当日コメント欄** — 打刻画面に当日コメント（200字・出勤前でも保存可）。既存 `note` カラム使用で migration 不要。承認詳細画面に備考列追加
- **リファクタ: 締め期間の共通関数化完了** — 残り5箇所（records / admin/attendance / admin/approval / admin/approval/[userId] / home）のインライン式を `lib/closing.ts` に置換。挙動不変（回帰テストで担保）
- **VPSデプロイ完了** — 本日分すべて本番反映済み（migration `add_approval_route` 適用確認済み）。障害対応: pm2 管理外の野良 next-server（6/17起動）がポート3000を占有し旧ビルドを配信していたのを除去・`pm2 save`。詳細 `docs/DEPLOY_CHECKLIST.md` §5。多段階承認は経路未登録＝従来動作のまま、実地確認後に経路登録して運用開始予定
- **バグ修正: 打刻丸めTZズレ** — `applyRounding` の基準日算出が `getUTCDate()` 先行で JST 0:00〜8:59 の打刻（=UTC前日）時に1日ズレ、朝の丸め（定時前丸め・前後14分丸め）が全滅していた。+9h→日付部品→−9h 方式に修正（`lib/attendance.ts`）。境界値7ケース検証済
- **締め期間の共通化・統一** — `lib/closing.ts` 新設（`getClosingPeriod`/`getDefaultClosingMonth`/`listClosingPeriodDates`）。暦月だった `/admin/requests`（申請承認）と `/api/admin/export-xlsx` を締め期間単位に統一
- **Excel出力改善** — ①対象者を role 基準（ADMIN/APPROVER除外）→部署基準（管理者/管理職のみ除外）に変更し一覧・承認画面と統一。②有給使用合計（日/時間）をヘッダに追加。③日次有給日数の半日判定 truthy バグ修正（全日 "full" が 0.5 と誤カウントされていた）
- **文言修正: 代休→振休** — `leaveType="substitute"` の表示名を「振休」に統一（Excel列名・申請フォーム・申請一覧・承認画面の4ファイル。DB値は不変）
- **改修体制の整備** — `docs/DOMAIN_MAP.md`（修正時必読・短い）/ `docs/DOMAIN_REFERENCE.md`（詳細参照）/ skill `kintai-fix`（修正指示ワークフロー: 5軸確認→before/after合意→実装→検証）新設。CLAUDE.md に参照ルール追記。`docs/IMPROVEMENT_BACKLOG.md`（改善案15件）新設
- **回帰テスト導入（vitest）** — `tests/` に丸め・要確認判定・集計・深夜・法定休憩・締め期間の境界値32テスト。`npm run test` で実行。TZ回帰（JST深夜打刻の丸め）を恒久ガード
- **機能追加: 打刻異常検知 API** — `GET /api/admin/anomaly-check` 新規作成（退勤漏れ・戻り漏れ・パート休憩漏れ・workingMinutes NULL）。n8n 日次通知の土台（`ANOMALY_CHECK_TOKEN` 環境変数で Bearer 認証可）
- **ドキュメント新規** — `docs/DEPLOY_CHECKLIST.md`（デプロイ前チェックリスト）・`docs/DESIGN_MULTISTAGE_APPROVAL.md`（多段階承認設計書）
- **機能追加: 多段階承認（申請承認）** — `ApprovalRoute` テーブル新設（部署×step×承認者）・`Approval` ログ運用開始（`SKIPPED` 追加・Cascade化）。経路設定部署の申請は step 順承認、最終 step で APPROVED+勤怠反映。担当外は操作不可・ADMIN 飛び越し承認・進捗バッジ。経路管理画面 `/admin/approval-routes` 新設。**migration `20260706000000_add_approval_route` 未適用（dev/本番とも。デプロイ時に `prisma migrate deploy` 要）**

### 2026-05-27
- **機能追加: Excel出力** — `GET /api/admin/export-xlsx` 新規作成。個人別日別勤務報告書（1ファイル・人別シート・33列）。`exceljs` 追加。ADMIN/APPROVER除外・従業員コード数値昇順・休日行色分け・A4横印刷設定
- **バグ修正: 打刻丸め** — `roundNear` の適用範囲を定時後のみ→**前後14分以内**に修正（`lib/attendance.ts`）。早出申請・残業申請がある日は `roundNear` を無効化（`clock/actions.ts`）。設定ページ説明文を実態に合わせて更新

### 2026-05-26
- **データ監査** — 1ヶ月試験運用データを精査。旧システム（勤怠RECO）サンプルとの対応確認
- **バグ修正: パート残業** — `export/route.ts` の `scheduled=0` バグ修正。DB の `overtimeMinutes` を参照するよう変更
- **機能追加: 退勤時残業保存** — `actionClockOut` で `overtimeMinutes`（法定1日8h超）を保存
- **機能追加: 一括再計算 API** — `POST /api/admin/recalculate` 新規作成。過去の NULL `workingMinutes` 補完・全退勤済みレコードの `overtimeMinutes` 再計算
- **ドキュメント新規** — `docs/DATA_SPEC_HISTORY.md`（仕様変更×データ影響履歴）・`docs/SESSION_2026-05-26_data-audit.md`（セッション引継ぎ）

### 2026-05-20
- **バグ修正** — 所定9時間バグ（`calcLegalBreak`適用）・打刻修正承認後の集計未更新・申請フロー齟齬（ホームのアラート抑制）・当日遅刻時の修正依頼リンク未表示
- **`/admin/approval` 修正** — SUBMITTED 依存で機能停止 → OPEN→APPROVED→LOCKED に統一。締め日連動。承認取消ボタン追加。管理系部署除外・詳細リンク追加
- **`/records` ステータスバッジ** — CORRECTION申請: PENDING→「申請中」・APPROVED→「修正済」。申請中は修正依頼ボタン非表示（`getDisplayStatus` に `correctionStatus` 第3引数追加）
- **機能追加** — 勤務状況ページ: 従業員コード順・管理系部署非表示 / 打刻修正申請フォーム統一 / 申請承認画面に修正前値表示 / 早出申請（OVERTIME + `overtimeType="earlyStart"`）

### 2026-04-28
- **バグ修正** — トップ未確認判定・`/requests` 種別表記・`scheduledMinutes` 固定値
- **P2 ステータス刷新** — OPEN=未確認廃止。「打刻済」「要確認」表示に統一（`calcNeedsReview`/`getDisplayStatus`）
- **表示項目整理** — `/records` 13列・`/admin/attendance` 所定列追加・`/admin/approval/[userId]` 12列
- **P3 打刻丸めスイッチ** — 定時前打刻→定時・定時±14分→定時きっかり の2スイッチ（Setting テーブル拡張）
- **ホームにクイック打刻ボタン** / **残業申請 終了時刻を 13:00〜 に変更**（パート対応）

### 2026-04-24
- **打刻修正申請フロー完成** — 修正依頼リンク追加・管理者承認でDB自動反映
- **欠勤処理** / **申請 修正・削除機能** / **申請承認 UI改善**（申請日列・月別切替）
- **ホーム インフォメーション** — 4種アラート追加・月次提出ボタン削除
- **AttendanceRecord スキーマ拡張** — `lateMinutes`・`overtimeMinutes`・`originalClockIn/Out`・`AttendanceChangeLog`
- **設定ページ完成**（締め日・休憩控除ルール）/ **変更履歴ページ** / **マニュアル画面**

### 2026-04-23 以前
- DB同期・デプロイ整備（`sync-to-dev.sh`・`deploy.sh`・prismaベースライン）
- VPSデプロイ完了（`https://kintai.iwaki-i.online`）/ Google OAuth `/link` フロー修正
- 打刻UI 2×2グリッド改修 / TypeScript 型エラー一括修正 / CSVインポート/エクスポート実装
