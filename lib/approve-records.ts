import { prisma } from "@/lib/prisma"
import { calcMetrics, calcScheduledMinutes } from "@/lib/attendance"

/**
 * 期間内の OPEN / SUBMITTED の勤怠を「承認済」にし、遅刻・早退・残業の分数を計算して保存する。
 * 承認詳細の一括承認（actionBulkApprove）と一覧の承認（actionApproveMonth）の共通処理。
 * 計算は記録時刻（clockIn/clockOut）基準。実打刻は使わない。
 */
export async function approveRecordsWithMetrics(userId: string, firstDay: Date, lastDay: Date) {
  const [records, user] = await Promise.all([
    prisma.attendanceRecord.findMany({
      where: {
        userId,
        date:   { gte: firstDay, lte: lastDay },
        status: { in: ["OPEN", "SUBMITTED"] },
      },
    }),
    prisma.user.findUnique({
      where: { id: userId },
      select: { workStartTime: true, workEndTime: true, employmentType: true },
    }),
  ])
  if (!user) return

  const scheduledMins = calcScheduledMinutes(user.workStartTime, user.workEndTime, user.employmentType)

  await prisma.$transaction(
    records.map((r) => {
      const metrics = calcMetrics({
        clockIn:          r.clockIn,
        clockOut:         r.clockOut,
        workingMinutes:   r.workingMinutes,
        workStartTime:    user.workStartTime,
        workEndTime:      user.workEndTime,
        scheduledMinutes: scheduledMins,
      })
      return prisma.attendanceRecord.update({
        where: { id: r.id },
        data: {
          status: "APPROVED",
          lateMinutes:       metrics.lateMinutes,
          earlyLeaveMinutes: metrics.earlyLeaveMinutes,
          overtimeMinutes:   metrics.overtimeMinutes,
        },
      })
    })
  )
}
