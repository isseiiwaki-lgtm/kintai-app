"use server"

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { parseBreakRequestMinutes } from "@/lib/attendance"
import { holidayWorkDateError } from "@/lib/clock-pipeline-db"
import { resolveRestKind, validateHolidayWorkTimes, validateRestDate } from "@/lib/holiday-work"

/** 申請の入力エラー（フォームに出す）。それ以外の失敗は例外 */
export type CreateRequestResult = { ok: false; error: string } | void

export async function actionCreateRequest(formData: FormData): Promise<CreateRequestResult> {
  const session = await auth()
  if (!session?.user?.id) throw new Error("Unauthorized")
  const userId = session.user.id

  const type       = formData.get("type")       as string
  const targetDate = formData.get("targetDate") as string
  const reason     = formData.get("reason")     as string

  // 種別ごとの追加情報
  let detail: Record<string, string> = {}
  switch (type) {
    case "OVERTIME": {
      // 定時（修正前ベースライン）を記録
      const user = await prisma.user.findUnique({ where: { id: userId }, select: { workEndTime: true } })
      detail = {
        endTime:          formData.get("endTime") as string,
        scheduledEndTime: user?.workEndTime ?? "",
      }
      break
    }
    case "EARLY_START": {
      // DBタイプはOVERTIMEに収める。overtimeTypeで区別
      const user = await prisma.user.findUnique({ where: { id: userId }, select: { workStartTime: true } })
      detail = {
        overtimeType:       "earlyStart",
        startTime:          formData.get("startTime") as string,
        scheduledStartTime: user?.workStartTime ?? "",
      }
      break
    }
    case "BREAK": {
      // 休憩申請（60分超・押し忘れ用）。15分刻みの分数。承認されたらその日の休憩の合計（上書き）になる
      const minutes = parseBreakRequestMinutes(formData.get("minutes"))
      if (minutes === null) throw new Error("休憩の分数が正しくありません")
      detail = { minutes: String(minutes) }
      break
    }
    case "HOLIDAY_WORK": {
      // 休日出勤申請：予定の開始〜終了・代わりに休む日（任意）。休む日を一緒に決めた＝振休、空欄＝後から決める代休
      const startTime = formData.get("startTime") as string
      const endTime = formData.get("endTime") as string
      const restDate = ((formData.get("restDate") as string) ?? "").trim()
      const timeErr = validateHolidayWorkTimes(startTime, endTime)
      if (timeErr) throw new Error(timeErr)
      const restErr = validateRestDate(restDate, targetDate)
      if (restErr) throw new Error(restErr)
      // 対象日が休日か（休日カレンダー・本人の休みの曜日）はサーバーでも確かめる。画面に出して申請させない
      const dateErr = await holidayWorkDateError(userId, new Date(targetDate))
      if (dateErr) return { ok: false, error: dateErr }
      detail = { startTime, endTime }
      if (restDate) {
        detail.restDate = restDate
        detail.restKind = resolveRestKind({ nextRestDate: restDate, decidedWithRequest: true }) as string
      }
      break
    }
    case "ABSENCE": {
      detail = {
        absenceType: formData.get("absenceType") as string,
        time:        formData.get("time")         as string,
      }
      // 正社員の早退申請は「休憩を取りましたか」が必須（0＝取らなかった／15分刻みの分数）。パート・遅刻・欠勤は聞かない
      if (detail.absenceType === "early") {
        const me = await prisma.user.findUnique({ where: { id: userId }, select: { employmentType: true } })
        if (me?.employmentType !== "part") {
          const minutes = parseBreakRequestMinutes(formData.get("breakMinutes"))
          if (minutes === null) return { ok: false, error: "休憩を取ったかどうか（取った場合は15分刻みの分数）を選んでください" }
          detail.breakMinutes = String(minutes)
        }
      }
      break
    }
    case "LEAVE":
      detail = {
        leaveType: formData.get("leaveType") as string,
        halfDay:   (formData.get("halfDay") as string) || "full",
        workDate:  (formData.get("workDate") as string) || "",
      }
      break
    case "CORRECTION": {
      const tf = formData.get("targetField")   as string
      const ct = formData.get("correctedTime") as string
      detail = { targetField: tf, correctedTime: ct }

      // 修正前の現在値を記録
      const allowedFields = ["clockIn", "clockOut", "goOutAt", "returnAt", "breakStart", "breakEnd"]
      if (allowedFields.includes(tf) && targetDate) {
        const record = await prisma.attendanceRecord.findUnique({
          where: { userId_date: { userId, date: new Date(targetDate) } },
          select: { clockIn: true, clockOut: true, goOutAt: true, returnAt: true, breakStart: true, breakEnd: true },
        })
        const current = record?.[tf as keyof typeof record] as Date | null | undefined
        if (current instanceof Date) {
          const jst = new Date(current.getTime() + 9 * 60 * 60 * 1000)
          detail.originalValue = `${String(jst.getUTCHours()).padStart(2, "0")}:${String(jst.getUTCMinutes()).padStart(2, "0")}`
        }
      }
      break
    }
  }

  // EARLY_START は UI専用タイプ → DB は OVERTIME として保存
  const dbType = type === "EARLY_START" ? "OVERTIME" : type

  await prisma.request.create({
    data: {
      userId,
      type:       dbType as "OVERTIME" | "LEAVE" | "ABSENCE" | "COMMENT" | "OTHER" | "BREAK" | "HOLIDAY_WORK",
      targetDate: new Date(targetDate),
      reason,
      detail,
    },
  })

  revalidatePath("/requests")
  redirect("/requests")
}

export async function actionCancelRequest(id: string) {
  const session = await auth()
  if (!session?.user?.id) throw new Error("Unauthorized")

  await prisma.request.deleteMany({
    where: { id, userId: session.user.id, status: "PENDING" },
  })
  revalidatePath("/requests")
}
