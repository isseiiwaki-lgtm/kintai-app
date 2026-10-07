-- 取り消しの変更履歴が、取り消した履歴を指すための列（管理者の修正の取り消し・打刻修正申請の削除）
ALTER TABLE "AttendanceChangeLog" ADD COLUMN "revertsLogId" TEXT;
