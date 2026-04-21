"use server"

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { revalidatePath } from "next/cache"

async function checkRole() {
  const session = await auth()
  const role    = session?.user?.role
  if (role !== "ADMIN" && role !== "APPROVER") throw new Error("Forbidden")
}

export async function actionApproveMonth(userId: string, year: number, month: number) {
  await checkRole()
  const firstDay = new Date(Date.UTC(year, month - 1, 1))
  const lastDay  = new Date(Date.UTC(year, month,     0))
  await prisma.attendanceRecord.updateMany({
    where: { userId, date: { gte: firstDay, lte: lastDay }, status: "SUBMITTED" },
    data:  { status: "APPROVED" },
  })
  revalidatePath("/admin/approval")
  revalidatePath("/admin/attendance")
}

export async function actionRejectMonth(userId: string, year: number, month: number) {
  await checkRole()
  const firstDay = new Date(Date.UTC(year, month - 1, 1))
  const lastDay  = new Date(Date.UTC(year, month,     0))
  await prisma.attendanceRecord.updateMany({
    where: { userId, date: { gte: firstDay, lte: lastDay }, status: "SUBMITTED" },
    data:  { status: "OPEN" },
  })
  revalidatePath("/admin/approval")
}

export async function actionLockMonth(userId: string, year: number, month: number) {
  await checkRole()
  const session = await auth()
  if (session?.user?.role !== "ADMIN") throw new Error("Forbidden: ADMIN only")
  const firstDay = new Date(Date.UTC(year, month - 1, 1))
  const lastDay  = new Date(Date.UTC(year, month,     0))
  await prisma.attendanceRecord.updateMany({
    where: { userId, date: { gte: firstDay, lte: lastDay }, status: "APPROVED" },
    data:  { status: "LOCKED" },
  })
  revalidatePath("/admin/approval")
}
