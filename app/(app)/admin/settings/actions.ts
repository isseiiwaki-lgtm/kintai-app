"use server"

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { validateSettingNumbers } from "@/lib/setting-validation"

async function checkAdmin() {
  const session = await auth()
  if (session?.user?.role !== "ADMIN") throw new Error("Forbidden")
}

export async function actionSaveSetting(formData: FormData) {
  await checkAdmin()

  // 数値の検証（空・非数・負・閾値0以下は保存せず、理由を付けて設定画面へ戻す）
  const numberError = validateSettingNumbers({
    closingDay: formData.get("closingDay"),
    break1Threshold: formData.get("break1Threshold"),
    break1Minutes: formData.get("break1Minutes"),
    break2Threshold: formData.get("break2Threshold"),
    break2Minutes: formData.get("break2Minutes"),
  })
  if (numberError) redirect(`/admin/settings?error=${encodeURIComponent(numberError)}`)

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
  // エラー表示つきの URL から保存した場合も、エラーの無い URL に戻す
  redirect("/admin/settings")
}
