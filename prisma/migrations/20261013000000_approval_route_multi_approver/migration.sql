-- 承認経路：同じ部署・ステップに複数の承認者を置けるようにする（いずれか1名の承認で次のステップへ）
DROP INDEX "ApprovalRoute_department_step_key";

CREATE UNIQUE INDEX "ApprovalRoute_department_step_approverId_key" ON "ApprovalRoute"("department", "step", "approverId");
