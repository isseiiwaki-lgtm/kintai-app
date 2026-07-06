"use server"

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { calcLegalBreak } from "@/config/attendance.config"
import { applyRounding } from "@/lib/attendance"
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

export async function actionClockIn() {
  const userId = await getUserId()
  const today = todayJST()
  const [user, setting, earlyStartReq] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { workStartTime: true } }),
    prisma.setting.findUnique({ where: { id: 1 } }),
    // 当日に早出申請（申請中 or 承認済）があれば roundEarly を無効にする
    prisma.request.findFirst({
      where: {
        userId,
        targetDate: today,
        type:       "OVERTIME",
        status:     { in: ["PENDING", "APPROVED"] },
        detail:     { path: ["overtimeType"], equals: "earlyStart" },
      },
      select: { id: true },
    }),
  ])
  const clockIn = applyRounding(new Date(), user?.workStartTime ?? null, {
    roundEarly: earlyStartReq ? false : (setting?.roundEarlyClockIn ?? false),
    // 早出申請がある日は roundNear も無効（定時前打刻を定時に吸収しないため）
    roundNear:  earlyStartReq ? false : (setting?.roundNearClockTime ?? false),
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

  const [record, user, setting, overtimeReq] = await Promise.all([
    prisma.attendanceRecord.findUnique({
      where: { userId_date: { userId, date: today } },
    }),
    prisma.user.findUnique({ where: { id: userId }, select: { employmentType: true, workEndTime: true } }),
    prisma.setting.findUnique({ where: { id: 1 } }),
    // 当日に残業申請（申請中 or 承認済）があれば roundNear を無効にする
    prisma.request.findFirst({
      where: {
        userId,
        targetDate: today,
        type:   "OVERTIME",
        status: { in: ["PENDING", "APPROVED"] },
        detail: { path: ["overtimeType"], not: "earlyStart" },
      },
      select: { id: true },
    }),
  ])
  if (!record?.clockIn) throw new Error("出勤打刻がありません")
  const now = applyRounding(new Date(), user?.workEndTime ?? null, {
    roundEarly: false,
    // 残業申請がある日は roundNear を無効（定時付近の打刻を定時に吸収しないため）
    roundNear:  overtimeReq ? false : (setting?.roundNearClockTime ?? false),
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

  // 法定残業: 1日8時間(480分)超の分（パート・フルタイム共通）
  const overtimeMinutes = Math.max(0, workingMinutes - 480)

  await prisma.attendanceRecord.update({
    where: { userId_date: { userId, date: today } },
    data: { clockOut: now, workingMinutes, overtimeMinutes },
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

/** 当日コメント保存（申請にならない当日事情の連絡用。出勤打刻前でも保存できるよう upsert） */
export async function actionSaveNote(note: string) {
  const userId = await getUserId()
  const today = todayJST()
  const trimmed = note.trim().slice(0, 200)
  await prisma.attendanceRecord.upsert({
    where: { userId_date: { userId, date: today } },
    create: { userId, date: today, note: trimmed || null },
    update: { note: trimmed || null },
  })
  revalidatePath("/clock")
}
