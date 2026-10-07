"use server"

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { revalidatePath } from "next/cache"

async function checkAdmin() {
  const session = await auth()
  if (session?.user?.role !== "ADMIN") throw new Error("Forbidden")
}

export async function actionSaveSetting(formData: FormData) {
  await checkAdmin()

  const closingDay         = Number(formData.get("closingDay"))
  const break1Threshold    = Number(formData.get("break1Threshold"))
  const break1Minutes      = Number(formData.get("break1Minutes"))
  const break2Threshold    = Number(formData.get("break2Threshold"))
  const break2Minutes      = Number(formData.get("break2Minutes"))
  const roundEarlyClockIn  = formData.get("roundEarlyClockIn") === "true"
  const roundNearClockTime = formData.get("roundNearClockTime") === "true"
  const roundQuarterHour   = formData.get("roundQuarterHour") === "true"
  const capOvertimeByRequest = formData.get("capOvertimeByRequest") === "true"
  const newCalcMethod      = formData.get("newCalcMethod") === "true"
  // 昼休憩の開始時刻（正社員の半休の境目。HH:MM 以外は既定値）
  const lunchRaw = String(formData.get("lunchStartTime") ?? "")
  const lunchStartTime = /^([01]\d|2[0-3]):[0-5]\d$/.test(lunchRaw) ? lunchRaw : "12:00"

  await prisma.setting.upsert({
    where:  { id: 1 },
    update: { closingDay, break1Threshold, break1Minutes, break2Threshold, break2Minutes, roundEarlyClockIn, roundNearClockTime, roundQuarterHour, capOvertimeByRequest, newCalcMethod, lunchStartTime },
    create: { id: 1, closingDay, break1Threshold, break1Minutes, break2Threshold, break2Minutes, roundEarlyClockIn, roundNearClockTime, roundQuarterHour, capOvertimeByRequest, newCalcMethod, lunchStartTime },
  })

  revalidatePath("/admin/settings")
  revalidatePath("/records")
  revalidatePath("/admin/attendance")
}
