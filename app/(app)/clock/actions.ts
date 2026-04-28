"use server"

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { calcLegalBreak } from "@/config/attendance.config"
import { revalidatePath } from "next/cache"

function todayJST(): Date {
  const now = new Date()
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000)
  return new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate()))
}

async function getUserId(): Promise<string> {
  const session = await auth()
  if (!session?.user?.id) throw new Error("Unauthorized")
  return session.user.id
}

/** HH:MM 文字列を当日の UTC Date に変換 */
function hhmmToDate(hhmm: string, todayUTC: Date): Date {
  const [h, m] = hhmm.split(":").map(Number)
  return new Date(todayUTC.getTime() + (h * 60 + m) * 60 * 1000)
}

/** 打刻丸め: 設定に従い clockIn/clockOut を補正して返す */
function applyRounding(
  actual: Date,
  scheduled: string | null,
  opts: { roundEarly: boolean; roundNear: boolean },
): Date {
  if (!scheduled) return actual
  const todayUTC = new Date(Date.UTC(
    actual.getUTCFullYear(), actual.getUTCMonth(), actual.getUTCDate(),
  ) - 9 * 60 * 60 * 1000)
  const scheduledDate = hhmmToDate(scheduled, todayUTC)
  const diffMin = Math.round((actual.getTime() - scheduledDate.getTime()) / 60000)

  // 定時前打刻→定時扱い（diffMin < 0 = 定時より前）
  if (opts.roundEarly && diffMin < 0) return scheduledDate
  // 定時から14分以内→定時きっかり（0 <= diffMin <= 14）
  if (opts.roundNear && diffMin >= 0 && diffMin <= 14) return scheduledDate

  return actual
}

export async function actionClockIn() {
  const userId = await getUserId()
  const today = todayJST()
  const [user, setting] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { workStartTime: true } }),
    prisma.setting.findUnique({ where: { id: 1 } }),
  ])
  const clockIn = applyRounding(new Date(), user?.workStartTime ?? null, {
    roundEarly: setting?.roundEarlyClockIn ?? false,
    roundNear:  setting?.roundNearClockTime ?? false,
  })
  await prisma.attendanceRecord.upsert({
    where: { userId_date: { userId, date: today } },
    create: { userId, date: today, clockIn },
    update: { clockIn },
  })
  revalidatePath("/clock")
  revalidatePath("/")
}

export async function actionClockOut() {
  const userId = await getUserId()
  const today = todayJST()

  const [record, user, setting] = await Promise.all([
    prisma.attendanceRecord.findUnique({
      where: { userId_date: { userId, date: today } },
    }),
    prisma.user.findUnique({ where: { id: userId }, select: { employmentType: true, workEndTime: true } }),
    prisma.setting.findUnique({ where: { id: 1 } }),
  ])
  if (!record?.clockIn) throw new Error("出勤打刻がありません")
  const now = applyRounding(new Date(), user?.workEndTime ?? null, {
    roundEarly: false, // 退勤は早め打刻→定時扱い不要
    roundNear:  setting?.roundNearClockTime ?? false,
  })

  // 外出中の時間を除いた在席時間（分）
  const totalMs = now.getTime() - record.clockIn.getTime()
  const goOutMs =
    record.goOutAt && record.returnAt
      ? record.returnAt.getTime() - record.goOutAt.getTime()
      : 0
  const rawMinutes = Math.floor((totalMs - goOutMs) / 60000)

  let workingMinutes: number
  if (user?.employmentType === "part") {
    // パート: 手動休憩を差し引き
    const breakMs =
      record.breakStart && record.breakEnd
        ? record.breakEnd.getTime() - record.breakStart.getTime()
        : 0
    workingMinutes = Math.max(0, rawMinutes - Math.floor(breakMs / 60000))
  } else {
    // フルタイム: 法定休憩を自動差し引き
    const legalBreak = calcLegalBreak(rawMinutes)
    workingMinutes = Math.max(0, rawMinutes - legalBreak)
  }

  await prisma.attendanceRecord.update({
    where: { userId_date: { userId, date: today } },
    data: { clockOut: now, workingMinutes },
  })
  revalidatePath("/clock")
  revalidatePath("/")
}

export async function actionGoOut() {
  const userId = await getUserId()
  const today = todayJST()
  await prisma.attendanceRecord.update({
    where: { userId_date: { userId, date: today } },
    data: { goOutAt: new Date(), returnAt: null },
  })
  revalidatePath("/clock")
}

export async function actionReturn() {
  const userId = await getUserId()
  const today = todayJST()
  await prisma.attendanceRecord.update({
    where: { userId_date: { userId, date: today } },
    data: { returnAt: new Date() },
  })
  revalidatePath("/clock")
}

export async function actionBreakStart() {
  const userId = await getUserId()
  const today = todayJST()
  await prisma.attendanceRecord.update({
    where: { userId_date: { userId, date: today } },
    data: { breakStart: new Date(), breakEnd: null },
  })
  revalidatePath("/clock")
}

export async function actionBreakEnd() {
  const userId = await getUserId()
  const today = todayJST()
  await prisma.attendanceRecord.update({
    where: { userId_date: { userId, date: today } },
    data: { breakEnd: new Date() },
  })
  revalidatePath("/clock")
}
