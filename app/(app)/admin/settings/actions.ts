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

  await prisma.setting.upsert({
    where:  { id: 1 },
    update: { closingDay, break1Threshold, break1Minutes, break2Threshold, break2Minutes, roundEarlyClockIn, roundNearClockTime },
    create: { id: 1, closingDay, break1Threshold, break1Minutes, break2Threshold, break2Minutes, roundEarlyClockIn, roundNearClockTime },
  })

  revalidatePath("/admin/settings")
  revalidatePath("/records")
  revalidatePath("/admin/attendance")
}
