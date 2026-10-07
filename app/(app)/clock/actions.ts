"use server"

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { recomputeDay } from "@/lib/clock-pipeline-db"
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
  // 生打刻（丸め前の実時刻）は証跡として常に保存する。記録時刻はパイプライン（CLOCK_PIPELINE 段0〜段8）が出す
  // 出勤打刻時点のスイッチ状態（①〜④）を記録に保存する（snapshot: "overwrite"）。以降の計算し直しはその保存値を使う
  const rawClockIn = new Date()
  // 記録時刻の仮置きとして実打刻を入れておき、直後にパイプラインが出し直す
  await prisma.attendanceRecord.upsert({
    where: { userId_date: { userId, date: today } },
    create: { userId, date: today, clockIn: rawClockIn, rawClockIn },
    update: { clockIn: rawClockIn, rawClockIn },
  })
  await recomputeDay(userId, today, { snapshot: "overwrite" })
  revalidatePath("/clock")
  revalidatePath("/")
}

export async function actionClockOut() {
  const userId = await getUserId()
  const today = todayJST()

  const record = await prisma.attendanceRecord.findUnique({
    where: { userId_date: { userId, date: today } },
  })
  if (!record?.clockIn) throw new Error("出勤打刻がありません")
  // 生打刻（丸め前の実時刻）は証跡として常に保存する。実打刻は書き換えない
  const rawClockOut = new Date()
  // 記録時刻の仮置きとして実打刻を入れておき、直後にパイプラインが出し直す
  // （記録時刻・勤務時間・残業。出勤打刻時に保存したスイッチ状態を使う。承認済みの残業申請の上限もここで反映される）
  await prisma.attendanceRecord.update({
    where: { userId_date: { userId, date: today } },
    data: { clockOut: rawClockOut, rawClockOut },
  })
  await recomputeDay(userId, today)
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
