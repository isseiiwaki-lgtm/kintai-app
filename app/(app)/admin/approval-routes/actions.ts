"use server"

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { revalidatePath } from "next/cache"

async function checkAdminOnly() {
  const session = await auth()
  if (session?.user?.role !== "ADMIN") throw new Error("Forbidden")
}

/**
 * 経路に承認者を追加する。同じ部署・ステップに複数名を置ける（いずれか1名の承認で次のステップへ）。
 * 同じ人を同じステップに重ねて登録しようとしたときは何もしない。承認者を入れ替えるときは、追加してから古い行を削除する
 */
export async function actionUpsertRoute(formData: FormData) {
  await checkAdminOnly()

  const department = (formData.get("department") as string)?.trim()
  const step       = Number(formData.get("step"))
  const approverId = formData.get("approverId") as string
  if (!department || !approverId || !Number.isInteger(step) || step < 1 || step > 9) return

  await prisma.approvalRoute.upsert({
    where:  { department_step_approverId: { department, step, approverId } },
    update: {},
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
