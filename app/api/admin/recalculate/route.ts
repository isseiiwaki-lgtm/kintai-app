/**
 * POST /api/admin/recalculate
 * 過去レコードの workingMinutes(NULL) と overtimeMinutes を一括再計算・保存する。
 *
 * workingMinutes : NULL かつ clockOut あり のレコードのみ更新
 * overtimeMinutes: clockOut あり の全レコードを更新（法定1日8h超）
 *
 * 注意: 打刻時に丸め処理済みの clockIn/clockOut をそのまま使う。再計算で丸めは適用しない。
 */
import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { calcLegalBreak } from "@/config/attendance.config"

const LEGAL_DAILY_LIMIT = 480  // 8時間（分）

export async function POST() {
  const session = await auth()
  if (session?.user?.role !== "ADMIN") {
    return new NextResponse("Forbidden", { status: 403 })
  }

  // clockOut がある全レコードを取得
  const records = await prisma.attendanceRecord.findMany({
    where: { clockOut: { not: null } },
    select: {
      id: true,
      clockIn: true,
      clockOut: true,
      goOutAt: true,
      returnAt: true,
      breakStart: true,
      breakEnd: true,
      workingMinutes: true,
      user: { select: { employmentType: true } },
    },
  })

  let updatedWorking = 0
  let updatedOvertime = 0
  const errorIds: string[] = []

  for (const r of records) {
    if (!r.clockIn || !r.clockOut) continue

    const totalMs  = r.clockOut.getTime() - r.clockIn.getTime()
    const goOutMs  = r.goOutAt && r.returnAt
      ? r.returnAt.getTime() - r.goOutAt.getTime()
      : 0
    const rawMinutes = Math.floor((totalMs - goOutMs) / 60000)

    // 勤務時間を計算（雇用形態で分岐）
    let calcedWorkingMinutes: number
    if (r.user.employmentType === "part") {
      const breakMs = r.breakStart && r.breakEnd
        ? r.breakEnd.getTime() - r.breakStart.getTime()
        : 0
      calcedWorkingMinutes = Math.max(0, rawMinutes - Math.floor(breakMs / 60000))
    } else {
      calcedWorkingMinutes = Math.max(0, rawMinutes - calcLegalBreak(rawMinutes))
    }

    const calcedOvertimeMinutes = Math.max(0, calcedWorkingMinutes - LEGAL_DAILY_LIMIT)

    // 更新データを組み立て
    const data: { workingMinutes?: number; overtimeMinutes: number } = {
      overtimeMinutes: calcedOvertimeMinutes,
    }
    if (r.workingMinutes === null) {
      data.workingMinutes = calcedWorkingMinutes
    }

    try {
      await prisma.attendanceRecord.update({ where: { id: r.id }, data })
      if (r.workingMinutes === null) updatedWorking++
      updatedOvertime++
    } catch {
      errorIds.push(r.id)
    }
  }

  return NextResponse.json({
    total: records.length,
    updatedWorking,
    updatedOvertime,
    errors: errorIds.length,
    ...(errorIds.length > 0 ? { errorIds } : {}),
  })
}
