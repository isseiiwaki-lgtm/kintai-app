# 設計書: 多段階承認（C-13）

作成: 2026-07-06 / ステータス: **実装済み（申請承認ベース）**
ユーザー決定（2026-07-06）: 段数=可変（運用は2段想定）・決裁者=部署別登録（共通運用可）・対象=**申請承認（/admin/requests）がメイン**。勤怠承認（/admin/approval）は主に決裁者が行っており多段階化は実質不要 → 将来拡張として分離。

---

## 1. データモデル（実装済み）

- `ApprovalRoute { department, step, approverId }` — 部署ごとの承認経路。`@@unique([department, step])`。段数可変（UI上は1〜3）
- `Approval`（既存・従来未使用）を承認ログとして使用。`ApprovalAction` に `SKIPPED` を追加（飛び越し消化の記録）
- `Approval.request` に `onDelete: Cascade` 追加（申請削除時にログも削除）
- `Request.status` は従来のまま（PENDING/APPROVED/REJECTED）。**最終ステップ承認時のみ** APPROVED + 勤怠反映
- migration: `prisma/migrations/20260706000000_add_approval_route/`（テーブル追加+enum追加+FK変更のみ。既存データ無影響）

## 2. 承認フロー（実装済み）

- 経路未設定の部署 → **従来どおり一段階承認**（ADMIN/APPROVER が承認・監査用に Approval ログは残す）。部署ごとに段階導入可
- 経路あり → step 昇順に現在ステップの担当承認者（or ADMIN）のみ承認/却下可。中間承認では PENDING のまま「審査中 1/2」表示
- 最終ステップ承認 → status=APPROVED + 勤怠反映（欠勤/有給/打刻修正 — `applyRequestEffects()` に集約）
- 却下 → どのステップでも REJECTED で即終了（早出申請却下時の丸め再適用は従来どおり）
- **飛び越し承認** = ADMIN 専用「飛越承認」ボタン（confirm付き）。未消化の中間ステップを SKIPPED、最終を APPROVED で一括消化

## 3. 実装ファイル

- `lib/approval.ts` — 経路判定の純粋関数（getCurrentStep / isFinalStep / isStepApprover / approvalProgress）。`tests/approval.test.ts` で境界値担保
- `app/(app)/admin/requests/actions.ts` — actionApproveRequest（多段階対応）/ actionForceApproveRequest（新設）/ actionRejectRequest（権限ゲート追加）
- `app/(app)/admin/requests/page.tsx` + `_components/RequestsTable.tsx` — 進捗バッジ・担当外は「他の承認者待ち」表示・飛越承認ボタン
- `app/(app)/admin/approval-routes/` — 経路管理 UI（ADMIN 専用。部署×step×承認者の登録/上書き/削除）。サイドバー「承認経路」

## 4. 運用メモ

- 承認者に指定できるのは ADMIN/APPROVER ロールのみ（申請承認画面のアクセス権が必要なため）
- 決裁者を全社共通にする場合は同一人物を各部署の最終 step に登録する
- 経路の最終 step が「決裁」扱い（経路管理画面に（決裁）表示）
- 途中で経路を変更した場合、消化済みステップのログはそのまま・未消化分は新経路で判定される

## 5. 将来拡張（未実装）

- 勤怠承認（/admin/approval・月次締めフロー）の多段階化 — 必要になったら PeriodApproval テーブル案（本設計書の旧案）を再検討
- 承認取消（中間ステップの取り消し）— 現状は却下→再申請で運用
- 承認依頼のメール通知（バックログ #14 と接続）
