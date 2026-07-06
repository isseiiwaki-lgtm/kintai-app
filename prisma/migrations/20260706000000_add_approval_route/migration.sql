-- AlterEnum
ALTER TYPE "ApprovalAction" ADD VALUE 'SKIPPED';

-- CreateTable
CREATE TABLE "ApprovalRoute" (
    "id" TEXT NOT NULL,
    "department" TEXT NOT NULL,
    "step" INTEGER NOT NULL,
    "approverId" TEXT NOT NULL,

    CONSTRAINT "ApprovalRoute_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalRoute_department_step_key" ON "ApprovalRoute"("department", "step");

-- AddForeignKey
ALTER TABLE "ApprovalRoute" ADD CONSTRAINT "ApprovalRoute_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterForeignKey: 申請削除時に承認ログも削除（多段階承認でログが必ず付くため）
ALTER TABLE "Approval" DROP CONSTRAINT "Approval_requestId_fkey";
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "Request"("id") ON DELETE CASCADE ON UPDATE CASCADE;
