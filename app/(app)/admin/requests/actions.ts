"use server"

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { revalidatePath } from "next/cache"
import { formatHHMMfromDate, calcScheduledMinutes, parseBreakRequestMinutes } from "@/lib/attendance"
import { recomputeDay } from "@/lib/clock-pipeline-db"
import { getCurrentStep, isFinalStep, isStepApprover } from "@/lib/approval"
import { findCorrectionLog, planFieldRevert, planInputRevert } from "@/lib/clock-pipeline"
import { resolveRestKind, validateHolidayWorkTimes, validateRestDate } from "@/lib/holiday-work"

export type ActionResult = { ok: true } | { ok: false; error: string }

/** 打刻修正で直せる項目 */
const CORRECTION_FIELDS = ["clockIn", "clockOut", "goOutAt", "returnAt", "breakStart", "breakEnd"]

/** "HH:MM"（JST）を、その記録の日付（UTC 0時＝JST の暦日）の UTC の時刻にする */
function hhmmOnDate(date: Date, hhmm: string): Date {
  const [hh, mm] = hhmm.split(":").map(Number)
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), hh - 9, mm))
}

/** 承認の確定でその日の記録を書き換える申請（打刻修正・休憩申請・休日出勤申請） */
const RECORD_REWRITING_TYPES = ["CORRECTION", "BREAK", "HOLIDAY_WORK"]
const RECORD_REWRITING_LABEL: Record<string, string> = { CORRECTION: "打刻修正", BREAK: "休憩申請", HOLIDAY_WORK: "休日出勤申請" }

/** 対象の日が締め済み（LOCKED）か（記録が無い日は false） */
async function isLockedDay(userId: string, date: Date): Promise<boolean> {
  const rec = await prisma.attendanceRecord.findUnique({
    where: { userId_date: { userId, date } },
    select: { status: true },
  })
  return rec?.status === "LOCKED"
}

/**
 * 打刻修正・休憩申請・休日出勤申請の承認は記録を書き換えるので、対象の日が締め済み（LOCKED）なら拒否する。
 * 承認の操作を始める前に呼ぶ（承認の記録・申請の状態も変えない）
 */
async function lockedCorrectionError(req: { type: string; userId: string; targetDate: Date }): Promise<string | null> {
  if (!RECORD_REWRITING_TYPES.includes(req.type)) return null
  return (await isLockedDay(req.userId, req.targetDate))
    ? `締め済みの日の${RECORD_REWRITING_LABEL[req.type]}は承認できません（締め解除してから承認してください）`
    : null
}

/**
 * その日の休憩分数を、承認済みの休憩申請（最後に出した申請）に合わせて保存し、打刻パイプラインで計算し直す。
 * 承認済みの休憩申請を削除・修正したときに使う。承認済みの休憩申請が無くなった日は breakMinutes を空に戻す
 * （休憩ボタンの値は申請の承認で上書きされているため、戻せない）。締め済みの日は呼ぶ前に拒否すること
 */
async function syncBreakFromApprovedRequests(userId: string, date: Date) {
  const rec = await prisma.attendanceRecord.findUnique({ where: { userId_date: { userId, date } } })
  if (!rec) return
  const reqs = await prisma.request.findMany({
    where: { userId, type: "BREAK", status: "APPROVED", targetDate: date },
    orderBy: { createdAt: "desc" },
    select: { detail: true },
  })
  let minutes: number | null = null
  for (const r of reqs) {
    const m = parseBreakRequestMinutes((r.detail as { minutes?: string } | null)?.minutes)
    if (m !== null) { minutes = m; break }
  }
  await prisma.attendanceRecord.update({ where: { id: rec.id }, data: { breakMinutes: minutes } })
  await recomputeDay(userId, date)
  revalidatePath("/records")
}

/**
 * その日の休日出勤の印（AttendanceRecord.isHolidayWork）を、承認済みの休日出勤申請があるかどうかに合わせ、
 * 打刻パイプラインで計算し直す（段0：承認済みの申請の開始〜終了がその日の定時になる）。
 * - 承認済みの休日出勤申請がある日 → 印を付ける（記録が無ければ作る。打刻の前に承認されることが多い）
 * - 無くなった日（削除・日付や種別の変更）→ 印を外す。打刻も何も入っていない空の記録は消す
 * 締め済みの日は呼ぶ前に拒否すること（lockedCorrectionError / isLockedDay）。
 * 代理打刻の休日出勤チェックで付けた印も、申請の削除では外れる（印の出どころは区別しない）
 */
async function syncHolidayWorkMark(userId: string, date: Date) {
  const count = await prisma.request.count({ where: { userId, type: "HOLIDAY_WORK", status: "APPROVED", targetDate: date } })
  const rec = await prisma.attendanceRecord.findUnique({ where: { userId_date: { userId, date } } })
  if (count > 0) {
    if (rec) {
      if (!rec.isHolidayWork) await prisma.attendanceRecord.update({ where: { id: rec.id }, data: { isHolidayWork: true } })
    } else {
      await prisma.attendanceRecord.create({ data: { userId, date, isHolidayWork: true } })
    }
  } else if (rec) {
    if (rec.isHolidayWork) await prisma.attendanceRecord.update({ where: { id: rec.id }, data: { isHolidayWork: false } })
    const empty =
      !rec.clockIn && !rec.clockOut && !rec.rawClockIn && !rec.rawClockOut && !rec.goOutAt && !rec.returnAt &&
      !rec.breakStart && !rec.breakEnd && rec.breakMinutes == null && !rec.note && !rec.isAbsent &&
      !rec.paidLeaveMinutes && rec.status === "OPEN"
    if (empty) {
      await prisma.attendanceRecord.delete({ where: { id: rec.id } })
      revalidatePath("/records")
      return
    }
  }
  await recomputeDay(userId, date)
  revalidatePath("/records")
}

/**
 * 承認済みの打刻修正申請を削除するとき、記録を修正前の時刻に戻して打刻パイプラインで計算し直す。
 *
 * 「修正前」の決め方
 * - 出勤・退勤：その修正の変更履歴を取り除いた入力（1つ前の有効な打刻修正があればその時刻、無ければ実打刻）。
 *   変更履歴に「項目: 修正した時刻 → 戻した時刻（無ければ空＝取り消しの印）」を1件書く（履歴は消さない）。
 *   書いた履歴は revertsLogId で取り消した履歴を指す。取り消し済みの履歴は、あとの取り消しの戻し先に数えない
 *   （同じ項目の修正を2件とも削除したとき、古いほうの時刻が残らず実打刻に戻る）。
 *   あとの修正・管理者の編集が同じ項目に入っている場合は、それが優先なので入力は動かさない（取り消し済みの印だけ書く）。
 *   実打刻も他の修正も無い日は、承認時に変更履歴へ残した「修正前の値」を記録時刻の列へ戻す（無ければ空）。
 *   先に取り消した修正があれば、その履歴をさかのぼった値（例：9:00 → 8:50 と直した2件を、9:00 → 8:50 の順に消すと空に戻る）
 * - 外出・戻り・休憩：承認時に変更履歴へ残した「修正前の値」（先に取り消した修正があれば、その前の値）を列へ戻す。
 *   特定できなければ削除を拒否する
 * - 承認の変更履歴の見つけ方は findCorrectionLog を参照（承認の記録が無い 2026-07-06 より前の承認は、申請の作成以後で
 *   同じ時刻の最も早い履歴）。変更履歴に操作の種別が無いための規則
 * 締め済み（LOCKED）の日は拒否する
 */
async function revertApprovedCorrection(
  req: { id: string; userId: string; targetDate: Date; detail: unknown; createdAt: Date; approvals: { actedAt: Date }[] },
  changedById: string,
): Promise<ActionResult> {
  const detail = req.detail as Record<string, string> | null
  const field = detail?.targetField
  const correctedTime = detail?.correctedTime
  if (!field || !correctedTime || !CORRECTION_FIELDS.includes(field)) return { ok: true }

  const rec = await prisma.attendanceRecord.findUnique({
    where: { userId_date: { userId: req.userId, date: req.targetDate } },
  })
  if (!rec) return { ok: true }
  if (rec.status === "LOCKED") {
    return { ok: false, error: "締め済みの日の打刻修正は削除できません（締め解除してから削除してください）" }
  }

  const logs = await prisma.attendanceChangeLog.findMany({
    where: { recordId: rec.id, fieldName: field },
    select: { id: true, oldValue: true, newValue: true, changedAt: true, revertsLogId: true },
  })
  // 承認の記録が無い申請は、同じ項目・同じ時刻の先に作成された申請と履歴を取り合わないよう1対1で照合する（findCorrectionLog 参照）
  let earlierSameTime: Date[] = []
  if (req.approvals.length === 0) {
    const sibs = await prisma.request.findMany({
      where: {
        userId: req.userId, type: "CORRECTION", status: "APPROVED", targetDate: req.targetDate,
        id: { not: req.id }, createdAt: { lte: req.createdAt }, approvals: { none: { action: "APPROVED" } },
      },
      select: { id: true, detail: true, createdAt: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    })
    earlierSameTime = sibs
      .filter((q) => {
        const d = q.detail as Record<string, string> | null
        return d?.targetField === field && d?.correctedTime === correctedTime
          && (q.createdAt.getTime() < req.createdAt.getTime() || q.id < req.id)
      })
      .map((q) => q.createdAt)
  }
  const matched = findCorrectionLog(logs, correctedTime, req.approvals.map((a) => a.actedAt), req.createdAt, earlierSameTime)

  const data: Record<string, Date | null> = {}
  let logNewValue: string | null
  if (field === "clockIn" || field === "clockOut") {
    // 承認の変更履歴が見つからなければ、入力は動かさない
    if (!matched) return { ok: true }
    const raw = field === "clockIn" ? rec.rawClockIn : rec.rawClockOut
    const plan = planInputRevert({ date: rec.date, raw, logs, removeId: matched.id })
    logNewValue = plan.logNewValue
    if (plan.noInput) data[field] = plan.noInputValue ? hhmmOnDate(rec.date, plan.noInputValue) : null
  } else {
    if (!matched) {
      return { ok: false, error: "修正前の値を特定できないため削除できません。勤怠の編集で直してから削除してください" }
    }
    const plan = planFieldRevert({ logs, removeId: matched.id })
    logNewValue = plan.value
    if (plan.changeColumn) data[field] = plan.value ? hhmmOnDate(rec.date, plan.value) : null
  }

  // 勤務時間・残業・遅刻・早退は古い値が残らないよう空にし、このあとの計算し直しで出し直す
  await prisma.$transaction([
    prisma.attendanceRecord.update({
      where: { id: rec.id },
      data: { ...data, workingMinutes: null, overtimeMinutes: null, lateMinutes: null, earlyLeaveMinutes: null },
    }),
    prisma.attendanceChangeLog.create({
      data: {
        recordId: rec.id, changedById, changedAt: new Date(), fieldName: field,
        oldValue: correctedTime, newValue: logNewValue, revertsLogId: matched.id,
      },
    }),
  ])
  await recomputeDay(req.userId, req.targetDate)
  revalidatePath("/records")
  return { ok: true }
}

async function checkAdmin() {
  const session = await auth()
  const role = session?.user?.role
  if (role !== "ADMIN" && role !== "APPROVER") throw new Error("Forbidden")
  return { userId: session!.user!.id!, role }
}

function findRequest(id: string) {
  return prisma.request.findUnique({
    where: { id },
    include: { user: { select: { workStartTime: true, workEndTime: true, employmentType: true, breakMinutes: true, department: true } } },
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

  // 休憩申請の承認時: その日の休憩の合計（上書き）として breakMinutes に入れ、勤務時間を打刻パイプラインで計算し直す
  // （審査中の間は差し引かない。複数承認されたら最後に承認されたものが残る）
  if (req.type === "BREAK") {
    const minutes = parseBreakRequestMinutes(detail?.minutes)
    if (minutes !== null) {
      await prisma.attendanceRecord.upsert({
        where:  { userId_date: { userId: req.userId, date: req.targetDate } },
        update: { breakMinutes: minutes },
        create: { userId: req.userId, date: req.targetDate, breakMinutes: minutes },
      })
      await recomputeDay(req.userId, req.targetDate)
      revalidatePath("/records")
    }
  }

  // 休日出勤申請の承認時: その日に休日出勤の印を付け（記録が無ければ作る）、打刻パイプラインで計算し直す
  // （段0：申請の開始〜終了がその日の定時の代わりになる。出勤・退勤どちらが先でも同じ結果になる）
  if (req.type === "HOLIDAY_WORK") {
    await syncHolidayWorkMark(req.userId, req.targetDate)
  }

  // 有給承認時: paidLeaveMinutes を AttendanceRecord に保存（本人所定時間ベース。半休は所定時間の半分を四捨五入）
  if (req.type === "LEAVE" && detail?.leaveType === "paid") {
    const setting = await prisma.setting.findUnique({ where: { id: 1 } })
    const scheduledMins = calcScheduledMinutes(req.user.workStartTime, req.user.workEndTime, req.user.employmentType, {
      userBreakMinutes: req.user.breakMinutes, setting,
    })
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

export async function actionApproveRequest(id: string): Promise<ActionResult> {
  const { userId: changedById, role } = await checkAdmin()

  const req = await findRequest(id)
  if (!req || req.status !== "PENDING") return { ok: true }
  const locked = await lockedCorrectionError(req)
  if (locked) return { ok: false, error: locked }

  const route = await findRoute(req.user.department)

  if (route.length > 0) {
    // 多段階承認: 現在ステップの担当承認者（or ADMIN）のみ承認可
    const approvals = await prisma.approval.findMany({
      where: { requestId: id },
      select: { step: true, action: true },
    })
    const cur = getCurrentStep(route, approvals)
    if (cur === null) return { ok: true } // 全ステップ消化済み（通常到達しない）
    if (role !== "ADMIN" && !isStepApprover(route, cur, changedById)) {
      throw new Error("Forbidden: 現在の承認ステップの担当者ではありません")
    }
    await prisma.approval.create({
      data: { requestId: id, approverId: changedById, step: cur, action: "APPROVED" },
    })
    if (!isFinalStep(route, cur)) {
      // 中間承認: 申請は PENDING のまま次ステップの承認待ち
      revalidatePath("/admin/requests")
      return { ok: true }
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
  return { ok: true }
}

/** 飛び越し承認（ADMIN 専用）: 未消化ステップを SKIPPED で一括消化し最終承認まで進める */
export async function actionForceApproveRequest(id: string): Promise<ActionResult> {
  const { userId: changedById, role } = await checkAdmin()
  if (role !== "ADMIN") throw new Error("Forbidden: 飛び越し承認は ADMIN のみ")

  const req = await findRequest(id)
  if (!req || req.status !== "PENDING") return { ok: true }
  const locked = await lockedCorrectionError(req)
  if (locked) return { ok: false, error: locked }

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
  return { ok: true }
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

export async function actionUpdateRequest(id: string, formData: FormData): Promise<ActionResult> {
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
    case "BREAK": {
      const minutes = parseBreakRequestMinutes(formData.get("minutes"))
      if (minutes === null) return { ok: false, error: "休憩の分数が正しくありません（15分刻み）" }
      detail = { minutes: String(minutes) }
      break
    }
    case "HOLIDAY_WORK": {
      const startTime = formData.get("startTime") as string
      const endTime = formData.get("endTime") as string
      const restDate = ((formData.get("restDate") as string) ?? "").trim()
      const timeErr = validateHolidayWorkTimes(startTime, endTime)
      if (timeErr) return { ok: false, error: timeErr }
      const restErr = validateRestDate(restDate, targetDate)
      if (restErr) return { ok: false, error: restErr }
      // 振休か代休かは「いつ決めたか」。すでに区別が決まっていれば変えず、休む日を初めて足すのは管理者の操作＝代休
      const prev = before?.type === "HOLIDAY_WORK" ? beforeDetail : {}
      detail = { startTime, endTime }
      if (restDate) {
        detail.restDate = restDate
        detail.restKind = resolveRestKind({
          prevRestDate: prev.restDate, prevRestKind: prev.restKind, nextRestDate: restDate, decidedWithRequest: false,
        }) as string
      }
      break
    }
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

  // 承認済みの休憩申請・休日出勤申請の修正は、記録（休憩分数・休日出勤の印・定時）を書き換えるので、締め済みの日は拒否する
  // （修正前・修正後どちらの日も）。記録に影響しない修正（休日出勤の「休む日」だけを後から足す・直すなど）は締め済みの日でも通す
  const newTargetDate = new Date(targetDate)
  const recordAffected = (kind: string) => {
    if (!before || before.status !== "APPROVED" || (before.type !== kind && type !== kind)) return false
    if (before.type !== type || before.targetDate.getTime() !== newTargetDate.getTime()) return true
    return JSON.stringify([beforeDetail.minutes, beforeDetail.startTime, beforeDetail.endTime]) !==
      JSON.stringify([detail.minutes, detail.startTime, detail.endTime])
  }
  const breakInvolved = recordAffected("BREAK")
  const holidayWorkInvolved = recordAffected("HOLIDAY_WORK")
  if (before && (breakInvolved || holidayWorkInvolved)) {
    if ((await isLockedDay(before.userId, before.targetDate)) || (await isLockedDay(before.userId, newTargetDate))) {
      return { ok: false, error: `締め済みの日の${breakInvolved ? "休憩申請" : "休日出勤申請"}は修正できません（締め解除してから修正してください）` }
    }
  }

  await prisma.request.update({
    where: { id },
    data: {
      type:       type as "OVERTIME" | "LEAVE" | "ABSENCE" | "COMMENT" | "OTHER" | "BREAK" | "HOLIDAY_WORK",
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
  // 承認済みの休憩申請の分数・日付・種別を直したら、修正前・修正後の日の休憩分数を承認済みの申請から出し直す
  if (before && breakInvolved) {
    await syncBreakFromApprovedRequests(before.userId, before.targetDate)
    if (newTargetDate.getTime() !== before.targetDate.getTime()) {
      await syncBreakFromApprovedRequests(before.userId, newTargetDate)
    }
  }
  // 承認済みの休日出勤申請の時刻・日付・種別を直したら、修正前・修正後の日の印と記録時刻を出し直す
  if (before && holidayWorkInvolved) {
    await syncHolidayWorkMark(before.userId, before.targetDate)
    if (newTargetDate.getTime() !== before.targetDate.getTime()) {
      await syncHolidayWorkMark(before.userId, newTargetDate)
    }
  }
  revalidatePath("/admin/requests")
  revalidatePath("/requests")
  return { ok: true }
}

export async function actionDeleteRequest(id: string): Promise<ActionResult> {
  const { userId: changedById } = await checkAdmin()

  // 欠勤承認済みの場合は AttendanceRecord の isAbsent をリセット
  const req = await prisma.request.findUnique({
    where: { id },
    include: { approvals: { where: { action: "APPROVED" }, select: { actedAt: true } } },
  })
  // 承認済みの打刻修正を削除するときは、先に記録を修正前の時刻に戻す（締め済みの日は拒否）
  if (req?.status === "APPROVED" && req.type === "CORRECTION") {
    const reverted = await revertApprovedCorrection(req, changedById)
    if (!reverted.ok) return reverted
  }
  // 承認済みの休憩申請を削除するときは、記録を書き換えるので締め済みの日は拒否する
  if (req?.status === "APPROVED" && req.type === "BREAK" && (await isLockedDay(req.userId, req.targetDate))) {
    return { ok: false, error: "締め済みの日の休憩申請は削除できません（締め解除してから削除してください）" }
  }
  // 承認済みの休日出勤申請を削除するときも、印と定時が変わるので締め済みの日は拒否する
  if (req?.status === "APPROVED" && req.type === "HOLIDAY_WORK" && (await isLockedDay(req.userId, req.targetDate))) {
    return { ok: false, error: "締め済みの日の休日出勤申請は削除できません（締め解除してから削除してください）" }
  }
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

  // 承認済みの休憩申請を削除したら、その日の休憩分数を残りの承認済みの申請から出し直す（無ければ空に戻す）
  if (req?.status === "APPROVED" && req.type === "BREAK") {
    await syncBreakFromApprovedRequests(req.userId, req.targetDate)
  }
  // 承認済みの休日出勤申請を削除したら、休日出勤の印を外して（ほかに承認済みの申請が無ければ）打刻パイプラインで計算し直す
  if (req?.status === "APPROVED" && req.type === "HOLIDAY_WORK") {
    await syncHolidayWorkMark(req.userId, req.targetDate)
  }

  // 承認済みの残業・早出・休暇（半休）申請を削除したら、入力から外れるので記録を打刻パイプラインで計算し直す
  if (req?.status === "APPROVED" && (req.type === "OVERTIME" || req.type === "LEAVE")) {
    await recomputeDay(req.userId, req.targetDate)
    revalidatePath("/records")
  }
  revalidatePath("/admin/requests")
  revalidatePath("/requests")
  return { ok: true }
}
