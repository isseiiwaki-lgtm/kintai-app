import { prisma } from "@/lib/prisma"

/**
 * 期間内の締め済（LOCKED）の勤怠を承認済（APPROVED）に戻し、変更履歴に残す。
 * 変更履歴（AttendanceChangeLog）は recordId 必須のため、解除した勤怠1件ごとに1レコード残す
 * （fieldName="status"、oldValue="締め済"、newValue="承認済"、changedBy=解除した管理者、changedAt=解除時刻）。
 * 権限チェック（ADMIN のみ）は呼び出し側で行う。戻り値は解除した件数。
 */
export async function unlockRecords(
  userId: string,
  firstDay: Date,
  lastDay: Date,
  changedById: string,
): Promise<number> {
  const locked = await prisma.attendanceRecord.findMany({
    where: { userId, date: { gte: firstDay, lte: lastDay }, status: "LOCKED" },
    select: { id: true },
  })
  if (locked.length === 0) return 0
  const ids = locked.map((r) => r.id)

  await prisma.$transaction([
    prisma.attendanceRecord.updateMany({
      where: { id: { in: ids }, status: "LOCKED" },
      data:  { status: "APPROVED" },
    }),
    prisma.attendanceChangeLog.createMany({
      data: ids.map((recordId) => ({
        recordId,
        changedById,
        fieldName: "status",
        oldValue:  "締め済",
        newValue:  "承認済",
      })),
    }),
  ])
  return ids.length
}
