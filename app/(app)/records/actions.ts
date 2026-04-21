"use server"

import { prisma } from "@/lib/prisma"
import { revalidatePath } from "next/cache"

export async function actionSubmitMonth(userId: string, year: number, month: number) {
  const firstDay = new Date(Date.UTC(year, month - 1, 1))
  const lastDay  = new Date(Date.UTC(year, month,     0))
  await prisma.attendanceRecord.updateMany({
    where: { userId, date: { gte: firstDay, lte: lastDay }, status: "OPEN", clockIn: { not: null } },
    data:  { status: "SUBMITTED" },
  })
  revalidatePath("/records")
}

export async function actionUnsubmitMonth(userId: string, year: number, month: number) {
  const firstDay = new Date(Date.UTC(year, month - 1, 1))
  const lastDay  = new Date(Date.UTC(year, month,     0))
  await prisma.attendanceRecord.updateMany({
    where: { userId, date: { gte: firstDay, lte: lastDay }, status: "SUBMITTED" },
    data:  { status: "OPEN" },
  })
  revalidatePath("/records")
}
