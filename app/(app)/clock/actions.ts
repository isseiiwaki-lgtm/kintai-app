"use server"

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { recomputeDay } from "@/lib/clock-pipeline-db"
import { revalidatePath } from "next/cache"
import { BREAK_BUTTON_MINUTES } from "@/config/attendance.config"

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

/**
 * パートの休憩ボタン：押した値がその日の休憩の合計（足し算ではなく上書き）。承認は不要。
 * 休憩開始・終了のボタンは廃止した（過去の休憩打刻のデータは消さない）。
 * 保存したあと、段7（休憩）を含めて打刻パイプラインで勤務時間を出し直す。
 */
export async function actionSetBreak(minutes: number): Promise<{ ok: true } | { ok: false; error: string }> {
  const userId = await getUserId()
  const today = todayJST()
  if (!(BREAK_BUTTON_MINUTES as readonly number[]).includes(minutes)) {
    return { ok: false, error: "休憩の分数が正しくありません" }
  }
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { employmentType: true } })
  if (user?.employmentType !== "part") return { ok: false, error: "休憩ボタンはパートのみ使えます" }
  const record = await prisma.attendanceRecord.findUnique({ where: { userId_date: { userId, date: today } } })
  if (!record?.clockIn) return { ok: false, error: "出勤打刻がありません" }
  if (record.status === "LOCKED") return { ok: false, error: "締め済みの日のため変更できません" }
  // 承認済みの休憩申請（休憩つきの休日出勤申請を含む）がある日は、その申請が休憩を決めている。ボタンで上書きすると申請と記録が食い違うので断る
  const approvedBreak = await prisma.request.count({
    where: {
      userId, status: "APPROVED", targetDate: today,
      OR: [{ type: "BREAK" }, { type: "HOLIDAY_WORK", detail: { path: ["breakMinutes"], string_starts_with: "" } }],
    },
  })
  if (approvedBreak > 0) return { ok: false, error: "この日は承認済みの休憩の申告（休憩申請・早退申請・休日出勤申請）があるため、ボタンでは変えられません。変える場合は管理者に修正を依頼してください" }
  await prisma.attendanceRecord.update({
    where: { userId_date: { userId, date: today } },
    data: { breakMinutes: minutes },
  })
  await recomputeDay(userId, today)
  revalidatePath("/clock")
  revalidatePath("/")
  return { ok: true }
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
