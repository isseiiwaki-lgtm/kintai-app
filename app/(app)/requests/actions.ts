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
    case "OVERTIME":
      detail = { endTime: formData.get("endTime") as string }
      break
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
    case "CORRECTION":
      detail = {
        targetField:   formData.get("targetField")   as string,
        correctedTime: formData.get("correctedTime") as string,
      }
      break
  }

  await prisma.request.create({
    data: {
      userId,
      type:       type as "OVERTIME" | "LEAVE" | "ABSENCE" | "COMMENT" | "OTHER",
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
