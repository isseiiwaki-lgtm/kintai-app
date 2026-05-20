"use server"

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"

export async function actionCreateRequest(formData: FormData) {
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
    case "ABSENCE":
      detail = {
        absenceType: formData.get("absenceType") as string,
        time:        formData.get("time")         as string,
      }
      break
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
      type:       dbType as "OVERTIME" | "LEAVE" | "ABSENCE" | "COMMENT" | "OTHER",
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
