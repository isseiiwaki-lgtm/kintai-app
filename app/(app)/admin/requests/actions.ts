"use server"

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { revalidatePath } from "next/cache"
import { formatHHMMfromDate, applyRounding, calcScheduledMinutes } from "@/lib/attendance"
import { calcLegalBreak } from "@/config/attendance.config"
import { getCurrentStep, isFinalStep, isStepApprover } from "@/lib/approval"

async function checkAdmin() {
  const session = await auth()
  const role = session?.user?.role
  if (role !== "ADMIN" && role !== "APPROVER") throw new Error("Forbidden")
  return { userId: session!.user!.id!, role }
}

function findRequest(id: string) {
  return prisma.request.findUnique({
    where: { id },
    include: { user: { select: { workStartTime: true, workEndTime: true, employmentType: true, department: true } } },
  })
}

/** 申請者の部署の承認経路（未設定なら空配列 = 従来の一段階承認） */
function findRoute(department: string | null) {
  if (!department) return Promise.resolve([])
  return prisma.approvalRoute.findMany({
    where: { department },
    orderBy: { step: "asc" },
    select: { step: true, approverId: true },
  })
}

/**
 * 承認確定時の勤怠反映（最終ステップ承認時のみ呼ぶ）
 * 欠勤 → isAbsent / 有給 → paidLeaveMinutes / 打刻修正 → 対象フィールド更新 + ChangeLog
 */
async function applyRequestEffects(
  req: NonNullable<Awaited<ReturnType<typeof findRequest>>>,
  changedById: string,
) {
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

  // 有給承認時: paidLeaveMinutes を AttendanceRecord に保存（本人所定時間ベース。半休は所定時間の半分を四捨五入）
  if (req.type === "LEAVE" && detail?.leaveType === "paid") {
    const scheduledMins = calcScheduledMinutes(req.user.workStartTime, req.user.workEndTime, req.user.employmentType)
    const halfDay = detail?.halfDay
    const paidMins = halfDay === "am" || halfDay === "pm" ? Math.round(scheduledMins / 2) : scheduledMins
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

      const updateData: Record<string, Date | null | number> = { [field]: correctedAt }

      // 原打刻の保存（初回変更時のみ）
      if (field === "clockIn" && existing && !existing.originalClockIn && existing.clockIn) {
        updateData.originalClockIn = existing.clockIn
      }
      if (field === "clockOut" && existing && !existing.originalClockOut && existing.clockOut) {
        updateData.originalClockOut = existing.clockOut
      }

      // 修正後の値で workingMinutes を再計算
      if (existing) {
        const newClockIn  = field === "clockIn"  ? correctedAt : existing.clockIn
        const newClockOut = field === "clockOut" ? correctedAt : existing.clockOut
        const newGoOutAt  = field === "goOutAt"  ? correctedAt : existing.goOutAt
        const newReturnAt = field === "returnAt" ? correctedAt : existing.returnAt
        const newBreakStart = field === "breakStart" ? correctedAt : existing.breakStart
        const newBreakEnd   = field === "breakEnd"   ? correctedAt : existing.breakEnd

        if (newClockIn && newClockOut) {
          const totalMs  = newClockOut.getTime() - newClockIn.getTime()
          const goOutMs  = newGoOutAt && newReturnAt
            ? newReturnAt.getTime() - newGoOutAt.getTime()
            : 0
          const rawMinutes = Math.floor((totalMs - goOutMs) / 60000)

          if (req.user.employmentType === "part") {
            const breakMs = newBreakStart && newBreakEnd
              ? newBreakEnd.getTime() - newBreakStart.getTime()
              : 0
            updateData.workingMinutes = Math.max(0, rawMinutes - Math.floor(breakMs / 60000))
          } else {
            updateData.workingMinutes = Math.max(0, rawMinutes - calcLegalBreak(rawMinutes))
          }
        }
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
        // 打刻ゼロの日への修正申請: レコードを新設する。作成後の id を使うため対話型トランザクション
        await prisma.$transaction(async (tx) => {
          const created = await tx.attendanceRecord.create({
            data: { userId: req.userId, date: req.targetDate, [field]: correctedAt },
          })
          await tx.attendanceChangeLog.create({
            data: {
              recordId:  created.id,
              changedById,
              fieldName: field,
              oldValue:  null,
              newValue:  detail.correctedTime,
            },
          })
        })
      }
      revalidatePath("/records")
    }
  }
}

export async function actionApproveRequest(id: string) {
  const { userId: changedById, role } = await checkAdmin()

  const req = await findRequest(id)
  if (!req || req.status !== "PENDING") return

  const route = await findRoute(req.user.department)

  if (route.length > 0) {
    // 多段階承認: 現在ステップの担当承認者（or ADMIN）のみ承認可
    const approvals = await prisma.approval.findMany({
      where: { requestId: id },
      select: { step: true, action: true },
    })
    const cur = getCurrentStep(route, approvals)
    if (cur === null) return // 全ステップ消化済み（通常到達しない）
    if (role !== "ADMIN" && !isStepApprover(route, cur, changedById)) {
      throw new Error("Forbidden: 現在の承認ステップの担当者ではありません")
    }
    await prisma.approval.create({
      data: { requestId: id, approverId: changedById, step: cur, action: "APPROVED" },
    })
    if (!isFinalStep(route, cur)) {
      // 中間承認: 申請は PENDING のまま次ステップの承認待ち
      revalidatePath("/admin/requests")
      return
    }
  } else {
    // 経路未設定の部署: 従来の一段階承認（監査用にログは残す）
    await prisma.approval.create({
      data: { requestId: id, approverId: changedById, step: 1, action: "APPROVED" },
    })
  }

  await prisma.request.update({ where: { id }, data: { status: "APPROVED" } })
  await applyRequestEffects(req, changedById)
  revalidatePath("/admin/requests")
}

/** 飛び越し承認（ADMIN 専用）: 未消化ステップを SKIPPED で一括消化し最終承認まで進める */
export async function actionForceApproveRequest(id: string) {
  const { userId: changedById, role } = await checkAdmin()
  if (role !== "ADMIN") throw new Error("Forbidden: 飛び越し承認は ADMIN のみ")

  const req = await findRequest(id)
  if (!req || req.status !== "PENDING") return

  const route = await findRoute(req.user.department)
  if (route.length > 0) {
    const approvals = await prisma.approval.findMany({
      where: { requestId: id },
      select: { step: true, action: true },
    })
    const done = new Set(
      approvals.filter(a => a.action === "APPROVED" || a.action === "SKIPPED").map(a => a.step),
    )
    const finalStep = Math.max(...route.map(r => r.step))
    const logs = route
      .filter(r => !done.has(r.step))
      .map(r => ({
        requestId:  id,
        approverId: changedById,
        step:       r.step,
        action:     (r.step === finalStep ? "APPROVED" : "SKIPPED") as "APPROVED" | "SKIPPED",
      }))
    if (logs.length > 0) await prisma.approval.createMany({ data: logs })
  } else {
    await prisma.approval.create({
      data: { requestId: id, approverId: changedById, step: 1, action: "APPROVED" },
    })
  }

  await prisma.request.update({ where: { id }, data: { status: "APPROVED" } })
  await applyRequestEffects(req, changedById)
  revalidatePath("/admin/requests")
}

export async function actionRejectRequest(id: string) {
  const { userId: changedById, role } = await checkAdmin()

  const req = await findRequest(id)
  if (!req || req.status !== "PENDING") return

  // 多段階経路がある場合、却下も現在ステップの担当承認者（or ADMIN）のみ
  const route = await findRoute(req.user.department)
  let step = 1
  if (route.length > 0) {
    const approvals = await prisma.approval.findMany({
      where: { requestId: id },
      select: { step: true, action: true },
    })
    const cur = getCurrentStep(route, approvals)
    if (cur !== null) {
      if (role !== "ADMIN" && !isStepApprover(route, cur, changedById)) {
        throw new Error("Forbidden: 現在の承認ステップの担当者ではありません")
      }
      step = cur
    }
  }

  await prisma.approval.create({
    data: { requestId: id, approverId: changedById, step, action: "REJECTED" },
  })
  await prisma.request.update({
    where: { id },
    data: { status: "REJECTED" },
  })

  // 早出申請却下時: clockIn に丸め処理を適用（スキップしていた分を補正）
  if (req?.type === "OVERTIME") {
    const detail = req.detail as Record<string, string> | null
    if (detail?.overtimeType === "earlyStart") {
      const setting = await prisma.setting.findUnique({ where: { id: 1 } })
      if (setting?.roundEarlyClockIn || setting?.roundNearClockTime) {
        const existing = await prisma.attendanceRecord.findUnique({
          where: { userId_date: { userId: req.userId, date: req.targetDate } },
        })
        if (existing?.clockIn) {
          const corrected = applyRounding(existing.clockIn, req.user.workStartTime, {
            roundEarly: setting.roundEarlyClockIn  ?? false,
            roundNear:  setting.roundNearClockTime ?? false,
          })
          if (corrected.getTime() !== existing.clockIn.getTime()) {
            const updateData: Record<string, Date | number> = { clockIn: corrected }
            // clockOut があれば workingMinutes も再計算
            if (existing.clockOut) {
              const totalMs    = existing.clockOut.getTime() - corrected.getTime()
              const goOutMs    = existing.goOutAt && existing.returnAt
                ? existing.returnAt.getTime() - existing.goOutAt.getTime()
                : 0
              const rawMinutes = Math.floor((totalMs - goOutMs) / 60000)
              if (req.user.employmentType === "part") {
                const breakMs = existing.breakStart && existing.breakEnd
                  ? existing.breakEnd.getTime() - existing.breakStart.getTime()
                  : 0
                updateData.workingMinutes = Math.max(0, rawMinutes - Math.floor(breakMs / 60000))
              } else {
                updateData.workingMinutes = Math.max(0, rawMinutes - calcLegalBreak(rawMinutes))
              }
            }
            await prisma.attendanceRecord.update({
              where: { id: existing.id },
              data:  updateData,
            })
            revalidatePath("/records")
          }
        }
      }
    }
  }

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
