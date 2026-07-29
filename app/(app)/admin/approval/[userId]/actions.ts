"use server"

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { revalidatePath } from "next/cache"
import { calcMetrics, formatHHMMfromDate, calcScheduledMinutes, calcWorkingMinutes } from "@/lib/attendance"
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

export type ProxyPunchResult = { ok: true } | { ok: false; error: string }

/**
 * 管理者による代理打刻（出退勤いずれの打刻もなかった日に、後日レコードを作成する）
 *
 * - 対象は打刻ゼロの日のみ。既に出勤/退勤がある日・締め済（LOCKED）の日は拒否し、表の編集モーダルへ誘導する
 * - 生打刻（rawClockIn/rawClockOut）は書かない。実際の打刻があった日にしか残さない証跡のため（DOMAIN_MAP 参照）
 * - 休日出勤フラグが立つ日は遅刻・早退を 0 とする（所定時刻起算の機械計算で架空の遅刻が出るのを防ぐ）
 * - 保存後の状態は「承認済」（既存の管理者直接編集と同じ扱い）
 */
export async function actionAdminCreateRecord(
  userId: string,
  dateISO: string,
  formData: FormData,
): Promise<ProxyPunchResult> {
  const changedById = await checkRole()

  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateISO)) return { ok: false, error: "対象日が不正です" }

  const user = await prisma.user.findUnique({
    where:  { id: userId },
    select: { workStartTime: true, workEndTime: true, employmentType: true },
  })
  if (!user) return { ok: false, error: "対象ユーザーが見つかりません" }

  // date は「JST の暦日の UTC 深夜0時」で保存する（打刻・申請承認と同じ基準）
  const date = new Date(`${dateISO}T00:00:00.000Z`)

  const existing = await prisma.attendanceRecord.findUnique({
    where: { userId_date: { userId, date } },
  })
  if (existing) {
    if (existing.status === "LOCKED") {
      return { ok: false, error: "締め済みの日のため代理打刻できません" }
    }
    if (existing.clockIn || existing.clockOut) {
      return { ok: false, error: "既に打刻がある日です。表の編集から修正してください" }
    }
  }

  // 入力された時刻のみを拾う（未入力は書かない）
  const timeFields = ["clockIn", "clockOut", "breakStart", "breakEnd", "goOutAt", "returnAt"] as const
  const values: Partial<Record<(typeof timeFields)[number], Date>> = {}
  const logs: { fieldName: string; newValue: string }[] = []

  for (const name of timeFields) {
    const v = formData.get(name) as string | null
    if (!v) continue
    values[name] = toUTC(dateISO, v)
    logs.push({ fieldName: name, newValue: v })
  }

  const clockIn = values.clockIn ?? null
  if (!clockIn) return { ok: false, error: "出勤時刻は必須です" }

  const clockOut = values.clockOut ?? null
  if (clockOut && clockOut.getTime() <= clockIn.getTime()) {
    return { ok: false, error: "退勤時刻は出勤時刻より後にしてください" }
  }

  const goOutAt    = values.goOutAt    ?? null
  const returnAt   = values.returnAt   ?? null
  const breakStart = values.breakStart ?? null
  const breakEnd   = values.breakEnd   ?? null

  // workingMinutes（既存の管理者編集と同じ規則。part は実休憩打刻、full は法定休憩を控除）
  const workingMinutes = calcWorkingMinutes({
    clockIn, clockOut, goOutAt, returnAt, breakStart, breakEnd,
    employmentType: user.employmentType,
  })

  const scheduledMins = calcScheduledMinutes(user.workStartTime, user.workEndTime, user.employmentType)
  const metrics = calcMetrics({
    clockIn,
    clockOut,
    workingMinutes,
    workStartTime: user.workStartTime,
    workEndTime:   user.workEndTime,
    scheduledMinutes: scheduledMins,
  })

  // 休日出勤: 所定時刻を持たない日なので遅刻・早退は計上しない
  const isHolidayWork    = formData.get("isHolidayWork") === "on"
  const lateMinutes      = isHolidayWork ? 0 : metrics.lateMinutes
  const earlyLeaveMinutes = isHolidayWork ? 0 : metrics.earlyLeaveMinutes

  const data = {
    clockIn,
    clockOut,
    breakStart,
    breakEnd,
    goOutAt,
    returnAt,
    workingMinutes,
    lateMinutes,
    earlyLeaveMinutes,
    overtimeMinutes: metrics.overtimeMinutes,
    status: "APPROVED" as const,
  }

  // 作成後の id を ChangeLog に使うため、対話型トランザクションを使う
  await prisma.$transaction(async (tx) => {
    const record = existing
      ? await tx.attendanceRecord.update({ where: { id: existing.id }, data })
      : await tx.attendanceRecord.create({ data: { userId, date, ...data } })

    await tx.attendanceChangeLog.createMany({
      data: logs.map((log) => ({
        recordId:  record.id,
        changedById,
        fieldName: log.fieldName,
        oldValue:  null,
        newValue:  log.newValue,
      })),
    })
  })

  revalidatePath("/admin/approval")
  revalidatePath("/admin/attendance")
  revalidatePath("/records")
  return { ok: true }
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
