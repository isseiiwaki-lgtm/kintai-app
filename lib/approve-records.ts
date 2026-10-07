import { prisma } from "@/lib/prisma"
import { recomputeRecords } from "@/lib/clock-pipeline-db"

/**
 * 期間内の OPEN / SUBMITTED の勤怠を「承認済」にし、遅刻・早退・残業の分数を計算して保存する。
 * 承認詳細の一括承認（actionBulkApprove）と一覧の承認（actionApproveMonth）の共通処理。
 * 計算は打刻パイプライン（lib/clock-pipeline.ts）で最初から出し直す。承認のたびに結果が変わらないよう、
 * 入力（実打刻・承認済みの申請・記録に保存したスイッチ状態）は変えない。
 * 休日出勤の印がある日・休日の日は定時なしなので、遅刻・早退は0のまま（承認し直しても0を上書きしない）。
 */
export async function approveRecordsWithMetrics(userId: string, firstDay: Date, lastDay: Date) {
  const records = await prisma.attendanceRecord.findMany({
    where: {
      userId,
      date:   { gte: firstDay, lte: lastDay },
      status: { in: ["OPEN", "SUBMITTED"] },
    },
  })
  if (records.length === 0) return
  await recomputeRecords(userId, records, { status: "APPROVED" })
}
