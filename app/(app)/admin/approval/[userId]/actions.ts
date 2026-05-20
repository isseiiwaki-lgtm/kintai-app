"use server"

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { revalidatePath } from "next/cache"
import { calcMetrics, formatHHMMfromDate } from "@/lib/attendance"
import { calcLegalBreak } from "@/config/attendance.config"

async function checkRole() {
  const session = await auth()
  const role    = session?.user?.role
  if (role !== "ADMIN" && role !== "APPROVER") throw new Error("Forbidden")
  return session!.user!.id!
}

function toUTC(dateISO: string, timeHHMM: string): Date {
  const [hh, mm] = timeHHMM.split(":").map(Number)
  const base = new Date(dateISO)
  return new Date(Date.UTC(
    base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(),
    hh - 9, mm
  ))
}

// 管理者による直接編集（自動 APPROVED）
export async function actionAdminUpdateRecord(
  recordId: string,
  dateISO: string,
  formData: FormData,
) {
  const changedById = await checkRole()

  const timeFields = ["clockIn", "clockOut", "breakStart", "breakEnd", "goOutAt", "returnAt"] as const

  // 現在のレコード + ユーザー情報を取得
  const current = await prisma.attendanceRecord.findUnique({
    where: { id: recordId },
    include: { user: { select: { workStartTime: true, workEndTime: true, employmentType: true } } },
  })
  if (!current) return

  // 変更するフィールドのみ data に含める（空値は元値を維持）
  const data: Record<string, Date | string | number> = { status: "APPROVED" }
  const logs: { fieldName: string; oldValue: string | null; newValue: string | null }[] = []

  for (const name of timeFields) {
    const v = formData.get(name) as string | null
    if (!v) continue
    const newDate = toUTC(dateISO, v)
    const oldDate = current[name] as Date | null
    const oldHHMM = formatHHMMfromDate(oldDate)
    if (oldHHMM === v) continue // 変更なし

    data[name] = newDate
    logs.push({ fieldName: name, oldValue: oldHHMM, newValue: v })

    // 原打刻の保存（clockIn/clockOut のみ、初回変更時のみ）
    if (name === "clockIn" && !current.originalClockIn && oldDate) {
      data.originalClockIn = oldDate
    }
    if (name === "clockOut" && !current.originalClockOut && oldDate) {
      data.originalClockOut = oldDate
    }
  }

  // 承認時の集計値を計算
  const newClockIn    = (data.clockIn    as Date | undefined) ?? current.clockIn
  const newClockOut   = (data.clockOut   as Date | undefined) ?? current.clockOut
  const newGoOutAt    = (data.goOutAt    as Date | undefined) ?? current.goOutAt
  const newReturnAt   = (data.returnAt   as Date | undefined) ?? current.returnAt
  const newBreakStart = (data.breakStart as Date | undefined) ?? current.breakStart
  const newBreakEnd   = (data.breakEnd   as Date | undefined) ?? current.breakEnd

  // workingMinutes を再計算
  let newWorkingMinutes: number | null = current.workingMinutes
  if (newClockIn && newClockOut) {
    const totalMs    = newClockOut.getTime() - newClockIn.getTime()
    const goOutMs    = newGoOutAt && newReturnAt
      ? newReturnAt.getTime() - newGoOutAt.getTime()
      : 0
    const rawMinutes = Math.floor((totalMs - goOutMs) / 60000)

    if (current.user.employmentType === "part") {
      const breakMs = newBreakStart && newBreakEnd
        ? newBreakEnd.getTime() - newBreakStart.getTime()
        : 0
      newWorkingMinutes = Math.max(0, rawMinutes - Math.floor(breakMs / 60000))
    } else {
      newWorkingMinutes = Math.max(0, rawMinutes - calcLegalBreak(rawMinutes))
    }
    data.workingMinutes = newWorkingMinutes
  }

  // 所定時間（休憩控除済み）
  const { workStartTime, workEndTime, employmentType } = current.user
  const scheduledMins = (() => {
    const parseHHMM = (s: string | null) => {
      if (!s) return null
      const [h, m] = s.split(":").map(Number)
      return h * 60 + m
    }
    const s = parseHHMM(workStartTime)
    const e = parseHHMM(workEndTime)
    if (s !== null && e !== null && e > s) {
      const raw = e - s
      return raw - calcLegalBreak(raw)
    }
    return employmentType === "full" ? 480 : 0
  })()

  const metrics = calcMetrics({
    clockIn:          newClockIn,
    clockOut:         newClockOut,
    workingMinutes:   newWorkingMinutes,
    workStartTime,
    workEndTime,
    scheduledMinutes: scheduledMins,
  })
  data.lateMinutes       = metrics.lateMinutes
  data.earlyLeaveMinutes = metrics.earlyLeaveMinutes
  data.overtimeMinutes   = metrics.overtimeMinutes

  await prisma.$transaction([
    prisma.attendanceRecord.update({ where: { id: recordId }, data }),
    ...logs.map((log) =>
      prisma.attendanceChangeLog.create({
        data: { recordId, changedById, ...log },
      })
    ),
  ])

  revalidatePath("/admin/approval")
  revalidatePath("/admin/attendance")
}

// 月一括承認（OPEN → APPROVED、各レコードの集計値を計算して保存）
export async function actionBulkApprove(userId: string, firstDay: string, lastDay: string) {
  await checkRole()

  const [records, user] = await Promise.all([
    prisma.attendanceRecord.findMany({
      where: {
        userId,
        date:   { gte: new Date(firstDay), lte: new Date(lastDay) },
        status: { in: ["OPEN", "SUBMITTED"] },
      },
    }),
    prisma.user.findUnique({
      where: { id: userId },
      select: { workStartTime: true, workEndTime: true, employmentType: true },
    }),
  ])
  if (!user) return

  const parseHHMM = (s: string | null) => {
    if (!s) return null
    const [h, m] = s.split(":").map(Number)
    return h * 60 + m
  }
  const sMin = parseHHMM(user.workStartTime)
  const eMin = parseHHMM(user.workEndTime)
  const scheduledMins = (() => {
    if (sMin !== null && eMin !== null && eMin > sMin) {
      const raw = eMin - sMin
      return raw - calcLegalBreak(raw)
    }
    return user.employmentType === "full" ? 480 : 0
  })()

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

  revalidatePath("/admin/approval")
  revalidatePath("/admin/attendance")
}

// 月一括締め（ADMIN のみ）
export async function actionBulkLock(userId: string, firstDay: string, lastDay: string) {
  const session = await auth()
  if (session?.user?.role !== "ADMIN") throw new Error("Forbidden")

  await prisma.attendanceRecord.updateMany({
    where: {
      userId,
      date:   { gte: new Date(firstDay), lte: new Date(lastDay) },
      status: "APPROVED",
    },
    data: { status: "LOCKED" },
  })

  revalidatePath("/admin/approval")
  revalidatePath("/admin/attendance")
}
