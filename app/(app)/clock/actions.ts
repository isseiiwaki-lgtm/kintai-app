"use server"

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import {
  calcWorkingMinutes,
  computeRecordedClockIn,
  computeRecordedClockOut,
  hasOvertimeRequest,
  pickOvertimeCapEnd,
} from "@/lib/attendance"
import { fetchDayOvertimeRequests } from "@/lib/clock-out-cap"
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
  // 生打刻（丸め前の実時刻）は証跡として常に保存する
  const rawClockIn = new Date()
  // ①→②→③の順に丸める。早出申請がある日は①②を無効にする（定時前打刻を定時に吸収しないため）が、③は効かせる
  const clockIn = computeRecordedClockIn(rawClockIn, {
    workStartTime: user?.workStartTime ?? null,
    setting,
    hasEarlyStartRequest: !!earlyStartReq,
  })
  await prisma.attendanceRecord.upsert({
    where: { userId_date: { userId, date: today } },
    create: { userId, date: today, clockIn, rawClockIn },
    update: { clockIn, rawClockIn },
  })
  revalidatePath("/clock")
  revalidatePath("/")
}

export async function actionClockOut() {
  const userId = await getUserId()
  const today = todayJST()

  const [record, user, setting, overtimeRequests] = await Promise.all([
    prisma.attendanceRecord.findUnique({
      where: { userId_date: { userId, date: today } },
    }),
    prisma.user.findUnique({ where: { id: userId }, select: { employmentType: true, workEndTime: true } }),
    prisma.setting.findUnique({ where: { id: 1 } }),
    // 当日の残業申請（申請中 or 承認済）。②の無効化（申請中を含む）と④の上限（承認済みのみ）に使う
    fetchDayOvertimeRequests(userId, today),
  ])
  if (!record?.clockIn) throw new Error("出勤打刻がありません")
  // 生打刻（丸め前の実時刻）は証跡として常に保存する
  const rawClockOut = new Date()
  // 記録時刻 ＝ ①→②→③を適用し、④ON なら min(③まで適用した退勤, 上限)。実打刻は rawClockOut にそのまま残す
  // 残業申請がある日は②を無効（③は効かせる）。上限は承認済み残業申請のうち最後に出した申請の終了時刻、無ければ定時
  const now = computeRecordedClockOut(rawClockOut, {
    workEndTime: user?.workEndTime ?? null,
    clockIn: record.clockIn,
    setting,
    hasOvertimeRequest: hasOvertimeRequest(overtimeRequests),
    capEndTime: pickOvertimeCapEnd(overtimeRequests),
  })

  // 外出中の時間を除いた在席時間から休憩を控除（パートは休憩打刻、フルタイムは法定休憩）
  const workingMinutes = calcWorkingMinutes({
    clockIn: record.clockIn, clockOut: now,
    goOutAt: record.goOutAt, returnAt: record.returnAt,
    breakStart: record.breakStart, breakEnd: record.breakEnd,
    employmentType: user?.employmentType,
  }) ?? 0

  // 法定残業: 1日8時間(480分)超の分（パート・フルタイム共通）
  const overtimeMinutes = Math.max(0, workingMinutes - 480)

  await prisma.attendanceRecord.update({
    where: { userId_date: { userId, date: today } },
    data: { clockOut: now, rawClockOut, workingMinutes, overtimeMinutes },
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
