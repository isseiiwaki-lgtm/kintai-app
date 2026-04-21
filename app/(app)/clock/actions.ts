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

export async function actionClockIn() {
  const userId = await getUserId()
  const today = todayJST()
  await prisma.attendanceRecord.upsert({
    where: { userId_date: { userId, date: today } },
    create: { userId, date: today, clockIn: new Date() },
    update: { clockIn: new Date() },
  })
  revalidatePath("/clock")
  revalidatePath("/")
}

export async function actionClockOut() {
  const userId = await getUserId()
  const today = todayJST()
  const now = new Date()

  const [record, user] = await Promise.all([
    prisma.attendanceRecord.findUnique({
      where: { userId_date: { userId, date: today } },
    }),
    prisma.user.findUnique({ where: { id: userId }, select: { employmentType: true } }),
  ])
  if (!record?.clockIn) throw new Error("出勤打刻がありません")

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
