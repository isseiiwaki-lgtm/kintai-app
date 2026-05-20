"use server"

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { revalidatePath } from "next/cache"

async function checkRole() {
  const session = await auth()
  const role    = session?.user?.role
  if (role !== "ADMIN" && role !== "APPROVER") throw new Error("Forbidden")
}

// 締め日を考慮した集計期間を返す
async function getPeriod(year: number, month: number) {
  const setting    = await prisma.setting.findUnique({ where: { id: 1 } })
  const closingDay = setting?.closingDay ?? 25
  return {
    firstDay: new Date(Date.UTC(year, month - 2, closingDay + 1)),
    lastDay:  new Date(Date.UTC(year, month - 1, closingDay)),
  }
}

// OPEN → APPROVED（月次一括承認）
export async function actionApproveMonth(userId: string, year: number, month: number) {
  await checkRole()
  const { firstDay, lastDay } = await getPeriod(year, month)
  await prisma.attendanceRecord.updateMany({
    where: { userId, date: { gte: firstDay, lte: lastDay }, status: "OPEN" },
    data:  { status: "APPROVED" },
  })
  revalidatePath("/admin/approval")
  revalidatePath("/admin/attendance")
}

// APPROVED → OPEN（承認取消）
export async function actionRejectMonth(userId: string, year: number, month: number) {
  await checkRole()
  const { firstDay, lastDay } = await getPeriod(year, month)
  await prisma.attendanceRecord.updateMany({
    where: { userId, date: { gte: firstDay, lte: lastDay }, status: "APPROVED" },
    data:  { status: "OPEN" },
  })
  revalidatePath("/admin/approval")
  revalidatePath("/admin/attendance")
}

// APPROVED → LOCKED（締め、ADMIN のみ）
export async function actionLockMonth(userId: string, year: number, month: number) {
  await checkRole()
  const session = await auth()
  if (session?.user?.role !== "ADMIN") throw new Error("Forbidden: ADMIN only")
  const { firstDay, lastDay } = await getPeriod(year, month)
  await prisma.attendanceRecord.updateMany({
    where: { userId, date: { gte: firstDay, lte: lastDay }, status: "APPROVED" },
    data:  { status: "LOCKED" },
  })
  revalidatePath("/admin/approval")
  revalidatePath("/admin/attendance")
}
