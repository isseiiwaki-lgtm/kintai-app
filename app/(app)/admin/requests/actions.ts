"use server"

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { revalidatePath } from "next/cache"

async function checkAdmin() {
  const session = await auth()
  const role = session?.user?.role
  if (role !== "ADMIN" && role !== "APPROVER") throw new Error("Forbidden")
}

export async function actionApproveRequest(id: string) {
  await checkAdmin()
  await prisma.request.update({
    where: { id },
    data: { status: "APPROVED" },
  })
  revalidatePath("/admin/requests")
}

export async function actionRejectRequest(id: string) {
  await checkAdmin()
  await prisma.request.update({
    where: { id },
    data: { status: "REJECTED" },
  })
  revalidatePath("/admin/requests")
}
