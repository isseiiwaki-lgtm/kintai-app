/**
 * POST /api/admin/recalculate
 * 過去レコードの workingMinutes(NULL) と overtimeMinutes を一括再計算・保存する。
 *
 * workingMinutes : NULL かつ clockOut あり のレコードのみ更新
 * overtimeMinutes: clockOut あり の全レコードを更新。残業 ＝ 早出（定時の始業 − 記録した出勤）＋ 残業（記録した退勤 − 定時の終業）
 *                  （docs/CLOCK_PIPELINE.md 段8。打刻時・承認時・画面と同じ式。定時は段0の結果）
 *
 * 注意: 記録済みの clockIn/clockOut をそのまま使う。再計算で丸めは適用しない（記録時刻の出し直しは lib/clock-pipeline-db.ts の担当）。
 *       締め済み（LOCKED）の日は計算し直さない。
 */
import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { calcLegalBreak } from "@/config/attendance.config"
import { calcMetrics } from "@/lib/attendance"
import { resolveScheduleForDate } from "@/lib/clock-pipeline"
import { loadScheduleInputs } from "@/lib/clock-pipeline-db"

export async function POST() {
  const session = await auth()
  if (session?.user?.role !== "ADMIN") {
    return new NextResponse("Forbidden", { status: 403 })
  }

  // clockOut がある全レコード（締め済みを除く）を取得
  const records = await prisma.attendanceRecord.findMany({
    where: { clockOut: { not: null }, status: { not: "LOCKED" } },
    select: {
      id: true,
      userId: true,
      date: true,
      isHolidayWork: true,
      clockIn: true,
      clockOut: true,
      goOutAt: true,
      returnAt: true,
      breakStart: true,
      breakEnd: true,
      workingMinutes: true,
      user: {
        select: {
          employmentType: true, workStartTime: true, workEndTime: true, breakMinutes: true,
          workSun: true, workMon: true, workTue: true, workWed: true, workThu: true, workFri: true, workSat: true,
        },
      },
    },
  })

  // 段0の材料（休日・半休）。全期間をまとめて読む
  const userIds = [...new Set(records.map((r) => r.userId))]
  const times = records.map((r) => r.date.getTime())
  const sched = records.length > 0
    ? await loadScheduleInputs(userIds, new Date(Math.min(...times)), new Date(Math.max(...times)))
    : null

  let updatedWorking = 0
  let updatedOvertime = 0
  const errorIds: string[] = []

  for (const r of records) {
    if (!r.clockIn || !r.clockOut || !sched) continue

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

    // 残業は記録時刻と定時の差（段8）
    const schedule = resolveScheduleForDate({
      date: r.date, user: r.user, setting: sched.setting,
      isHoliday: sched.isHoliday(r.date), isHolidayWork: r.isHolidayWork, requests: sched.requestsOf(r.userId, r.date),
    })
    const calcedOvertimeMinutes = calcMetrics({
      clockIn: r.clockIn, clockOut: r.clockOut,
      workStartTime: schedule?.start ?? null, workEndTime: schedule?.end ?? null,
    }).overtimeMinutes

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
