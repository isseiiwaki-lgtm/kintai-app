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

  const req = await prisma.request.findUnique({
    where: { id },
    include: { user: { select: { workStartTime: true, workEndTime: true } } },
  })
  if (!req) return

  await prisma.request.update({
    where: { id },
    data: { status: "APPROVED" },
  })

  // 欠勤承認時: AttendanceRecord に反映
  const detail = req.detail as Record<string, string> | null
  if (req.type === "ABSENCE" && detail?.absenceType === "absent") {
    await prisma.attendanceRecord.upsert({
      where:  { userId_date: { userId: req.userId, date: req.targetDate } },
      update: {
        isAbsent:           true,
        scheduledStartTime: req.user.workStartTime,
        scheduledEndTime:   req.user.workEndTime,
      },
      create: {
        userId:             req.userId,
        date:               req.targetDate,
        isAbsent:           true,
        scheduledStartTime: req.user.workStartTime,
        scheduledEndTime:   req.user.workEndTime,
      },
    })
    revalidatePath("/records")
  }

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

export async function actionUpdateRequest(id: string, formData: FormData) {
  await checkAdmin()

  const type       = formData.get("type")       as string
  const targetDate = formData.get("targetDate") as string
  const reason     = formData.get("reason")     as string

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
        halfDay:   (formData.get("halfDay")   as string) || "full",
        workDate:  (formData.get("workDate")  as string) || "",
      }
      break
  }

  await prisma.request.update({
    where: { id },
    data: {
      type:       type as "OVERTIME" | "LEAVE" | "ABSENCE" | "COMMENT" | "OTHER",
      targetDate: new Date(targetDate),
      reason,
      detail,
    },
  })
  revalidatePath("/admin/requests")
  revalidatePath("/requests")
}

export async function actionDeleteRequest(id: string) {
  await checkAdmin()

  // 欠勤承認済みの場合は AttendanceRecord の isAbsent をリセット
  const req = await prisma.request.findUnique({ where: { id } })
  if (req?.status === "APPROVED" && req.type === "ABSENCE") {
    const detail = req.detail as Record<string, string> | null
    if (detail?.absenceType === "absent") {
      // 打刻なし（欠勤フラグのみ）のレコードは削除、打刻ありは isAbsent だけ戻す
      const ar = await prisma.attendanceRecord.findUnique({
        where: { userId_date: { userId: req.userId, date: req.targetDate } },
      })
      if (ar) {
        if (!ar.clockIn) {
          await prisma.attendanceRecord.delete({ where: { id: ar.id } })
        } else {
          await prisma.attendanceRecord.update({
            where: { id: ar.id },
            data:  { isAbsent: false, scheduledStartTime: null, scheduledEndTime: null },
          })
        }
      }
      revalidatePath("/records")
    }
  }

  await prisma.request.delete({ where: { id } })
  revalidatePath("/admin/requests")
  revalidatePath("/requests")
}
