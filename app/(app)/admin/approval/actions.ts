"use server"

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { revalidatePath } from "next/cache"
import { approveRecordsWithMetrics } from "@/lib/approve-records"
import { unlockRecords } from "@/lib/unlock-records"

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

// OPEN/SUBMITTED → APPROVED（月次一括承認）。遅刻・早退・残業の分数も保存する（承認詳細の一括承認と同じ）
export async function actionApproveMonth(userId: string, year: number, month: number) {
  await checkRole()
  const { firstDay, lastDay } = await getPeriod(year, month)
  await approveRecordsWithMetrics(userId, firstDay, lastDay)
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

// LOCKED → APPROVED（締め解除、ADMIN のみ）。誰がいつ解除したかを変更履歴に残す
export async function actionUnlockMonth(userId: string, year: number, month: number) {
  const session = await auth()
  if (session?.user?.role !== "ADMIN") throw new Error("Forbidden: ADMIN only")
  const { firstDay, lastDay } = await getPeriod(year, month)
  await unlockRecords(userId, firstDay, lastDay, session.user.id!)
  revalidatePath("/admin/approval")
  revalidatePath("/admin/attendance")
  revalidatePath("/admin/changelog")
}
