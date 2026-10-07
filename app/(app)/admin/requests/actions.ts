"use server"

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { revalidatePath } from "next/cache"
import { formatHHMMfromDate, calcScheduledMinutes } from "@/lib/attendance"
import { recomputeDay } from "@/lib/clock-pipeline-db"
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

  // 残業・早出申請の承認時: 承認済みの申請が入力に加わるので、その日の記録時刻・残業を打刻パイプラインで計算し直す
  // （残業申請 ＝ ④の上限、早出申請 ＝ 段2の有効な開始。出勤・退勤どちらが先でも同じ結果になる）
  if (req.type === "OVERTIME") {
    await recomputeDay(req.userId, req.targetDate)
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
    // 半休は段0の定時が変わる（正社員は昼休憩を除いた前半か後半）ので、打刻のある日は計算し直す
    if (halfDay === "am" || halfDay === "pm") await recomputeDay(req.userId, req.targetDate)
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

      // 修正後の記録時刻・勤務時間・残業は、保存のあとで打刻パイプラインが出し直す
      // （修正した時刻は変更履歴の「新しい値」として段1の入力になり、以降の段の丸めがかかる）

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
      // 修正前に出退勤（記録時刻・実打刻）がすべて空だった日（新設した記録を含む）は、この時点のスイッチ状態を保存する。
      // 出退勤がすでにある記録は保存値をそのまま使う（遡及しない）
      const hadNoPunch = !existing || (!existing.clockIn && !existing.clockOut && !existing.rawClockIn && !existing.rawClockOut)
      await recomputeDay(req.userId, req.targetDate, hadNoPunch ? { snapshot: "ifMissing" } : {})
      revalidatePath("/records")
    }
  }

  // 全休以外の半休（LEAVE の halfDay）は段0の定時が変わる。有給以外の休暇の半休もここで計算し直す
  if (req.type === "LEAVE" && detail?.leaveType !== "paid" && (detail?.halfDay === "am" || detail?.halfDay === "pm")) {
    await recomputeDay(req.userId, req.targetDate)
    revalidatePath("/records")
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

  // 残業・早出申請の却下: 入力に使うのは承認済みの申請だけなので結果は変わらないはずだが、
  // 早出申請を却下した日は、申請が無い日と同じ扱い（①②③）になっていることを同じパイプラインで確かめて保存し直す
  if (req.type === "OVERTIME") {
    await recomputeDay(req.userId, req.targetDate)
    revalidatePath("/records")
  }

  revalidatePath("/admin/requests")
}

export async function actionUpdateRequest(id: string, formData: FormData) {
  await checkAdmin()

  const type       = formData.get("type")       as string
  const targetDate = formData.get("targetDate") as string
  const reason     = formData.get("reason")     as string

  const before = await prisma.request.findUnique({ where: { id } })
  const beforeDetail = (before?.detail ?? {}) as Record<string, string>

  let detail: Record<string, string> = {}
  switch (type) {
    case "OVERTIME":
      if (before?.type === "OVERTIME" && beforeDetail.overtimeType === "earlyStart") {
        // 早出申請は overtimeType・定時（修正前ベースライン）を残したまま開始時刻だけ直す。
        // {endTime} で作り直すと overtimeType が消え、通常の残業申請に化ける
        detail = { ...beforeDetail, startTime: (formData.get("startTime") as string) || beforeDetail.startTime || "" }
      } else if (before?.type === "OVERTIME") {
        // 通常の残業申請も、申請時に記録した定時（scheduledEndTime）を消さない
        detail = { ...beforeDetail, endTime: formData.get("endTime") as string }
      } else {
        detail = { endTime: formData.get("endTime") as string }
      }
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

  // 承認済みの残業・早出・休暇（半休）申請の時刻・日付・種別を直したら、入力が変わるので記録を打刻パイプラインで計算し直す
  const affects = (t: string | undefined) => t === "OVERTIME" || t === "LEAVE"
  if (before?.status === "APPROVED" && (affects(before.type) || affects(type))) {
    await recomputeDay(before.userId, before.targetDate)
    const newDate = new Date(targetDate)
    if (newDate.getTime() !== before.targetDate.getTime()) {
      await recomputeDay(before.userId, newDate)
    }
    revalidatePath("/records")
  }
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

  // 承認済みの残業・早出・休暇（半休）申請を削除したら、入力から外れるので記録を打刻パイプラインで計算し直す
  if (req?.status === "APPROVED" && (req.type === "OVERTIME" || req.type === "LEAVE")) {
    await recomputeDay(req.userId, req.targetDate)
    revalidatePath("/records")
  }
  revalidatePath("/admin/requests")
  revalidatePath("/requests")
}
