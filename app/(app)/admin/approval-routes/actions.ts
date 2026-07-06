"use server"

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { revalidatePath } from "next/cache"

async function checkAdminOnly() {
  const session = await auth()
  if (session?.user?.role !== "ADMIN") throw new Error("Forbidden")
}

/** 経路の追加・更新（部署×ステップは一意。既存があれば承認者を差し替え） */
export async function actionUpsertRoute(formData: FormData) {
  await checkAdminOnly()

  const department = (formData.get("department") as string)?.trim()
  const step       = Number(formData.get("step"))
  const approverId = formData.get("approverId") as string
  if (!department || !approverId || !Number.isInteger(step) || step < 1 || step > 9) return

  await prisma.approvalRoute.upsert({
    where:  { department_step: { department, step } },
    update: { approverId },
    create: { department, step, approverId },
  })
  revalidatePath("/admin/approval-routes")
  revalidatePath("/admin/requests")
}

export async function actionDeleteRoute(id: string) {
  await checkAdminOnly()
  await prisma.approvalRoute.delete({ where: { id } })
  revalidatePath("/admin/approval-routes")
  revalidatePath("/admin/requests")
}
