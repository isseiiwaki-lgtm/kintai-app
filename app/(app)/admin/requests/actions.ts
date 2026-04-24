"use server"

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { revalidatePath } from "next/cache"
import { formatHHMMfromDate } from "@/lib/attendance"

async function checkAdmin() {
  const session = await auth()
  const role = session?.user?.role
  if (role !== "ADMIN" && role !== "APPROVER") throw new Error("Forbidden")
  return session!.user!.id!
}

export async function actionApproveRequest(id: string) {
  const changedById = await checkAdmin()

  const req = await prisma.request.findUnique({
    where: { id },
    include: { user: { select: { workStartTime: true, workEndTime: true } } },
  })
  if (!req) return

  await prisma.request.update({
    where: { id },
    data: { status: "APPROVED" },
  })

  const detail = req.detail as Record<string, string> | null

  // 欠勤承認時: AttendanceRecord に反映
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

  // 有給承認時: paidLeaveMinutes を AttendanceRecord に保存
  if (req.type === "LEAVE" && detail?.leaveType === "paid") {
    const scheduledMins = 480 // 所定勤務時間（将来的にユーザー設定から取得）
    const halfDay = detail?.halfDay
    const paidMins = halfDay === "am" || halfDay === "pm" ? scheduledMins / 2 : scheduledMins
    await prisma.attendanceRecord.upsert({
      where:  { userId_date: { userId: req.userId, date: req.targetDate } },
      update: { paidLeaveMinutes: paidMins },
      create: { userId: req.userId, date: req.targetDate, paidLeaveMinutes: paidMins },
    })
    revalidatePath("/records")
  }

  // 打刻修正承認時: AttendanceRecord の対象フィールドを更新 + ChangeLog
  if (req.type === "CORRECTION" && detail?.targetField && detail?.correctedTime) {
    const [hh, mm]   = detail.correctedTime.split(":").map(Number)
    const base        = new Date(req.targetDate)
    const correctedAt = new Date(Date.UTC(
      base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(),
      hh - 9, mm
    ))

    const allowedFields = ["clockIn", "clockOut", "goOutAt", "returnAt", "breakStart", "breakEnd"]
    const field = allowedFields.includes(detail.targetField) ? detail.targetField : null
    if (field) {
      const existing = await prisma.attendanceRecord.findUnique({
        where: { userId_date: { userId: req.userId, date: req.targetDate } },
      })

      const updateData: Record<string, Date | null> = { [field]: correctedAt }

      // 原打刻の保存（初回変更時のみ）
      if (field === "clockIn" && existing && !existing.originalClockIn && existing.clockIn) {
        updateData.originalClockIn = existing.clockIn
      }
      if (field === "clockOut" && existing && !existing.originalClockOut && existing.clockOut) {
        updateData.originalClockOut = existing.clockOut
      }

      const oldValue = existing ? formatHHMMfromDate(existing[field as keyof typeof existing] as Date | null) : null

      if (existing) {
        await prisma.$transaction([
          prisma.attendanceRecord.update({
            where: { id: existing.id },
            data:  updateData,
          }),
          prisma.attendanceChangeLog.create({
            data: {
              recordId:    existing.id,
              changedById,
              fieldName:   field,
              oldValue,
              newValue:    detail.correctedTime,
            },
          }),
        ])
      } else {
        await prisma.attendanceRecord.create({
          data: { userId: req.userId, date: req.targetDate, [field]: correctedAt },
        })
      }
      revalidatePath("/records")
    }
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
