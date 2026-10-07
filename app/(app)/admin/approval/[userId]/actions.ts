"use server"

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { revalidatePath } from "next/cache"
import { formatHHMMfromDate } from "@/lib/attendance"
import { recomputeDay } from "@/lib/clock-pipeline-db"
import { approveRecordsWithMetrics } from "@/lib/approve-records"

async function checkRole() {
  const session = await auth()
  const role    = session?.user?.role
  if (role !== "ADMIN" && role !== "APPROVER") throw new Error("Forbidden")
  return session!.user!.id!
}

function toUTC(dateISO: string, timeHHMM: string): Date {
  const [hh, mm] = timeHHMM.split(":").map(Number)
  const base = new Date(dateISO)
  return new Date(Date.UTC(
    base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(),
    hh - 9, mm
  ))
}

// 管理者による直接編集（自動 APPROVED）
export async function actionAdminUpdateRecord(
  recordId: string,
  dateISO: string,
  formData: FormData,
) {
  const changedById = await checkRole()

  const timeFields = ["clockIn", "clockOut", "breakStart", "breakEnd", "goOutAt", "returnAt"] as const

  // 現在のレコード + ユーザー情報を取得
  const current = await prisma.attendanceRecord.findUnique({
    where: { id: recordId },
    include: { user: { select: { workStartTime: true, workEndTime: true, employmentType: true } } },
  })
  if (!current) return
  // 締め済み（LOCKED）の日はサーバー側でも直接修正を受け付けない（画面の制限に頼らない）
  if (current.status === "LOCKED") return

  // 変更するフィールドのみ data に含める（空値は元値を維持）
  const data: Record<string, Date | string | number> = { status: "APPROVED" }
  const logs: { fieldName: string; oldValue: string | null; newValue: string | null }[] = []

  for (const name of timeFields) {
    const v = formData.get(name) as string | null
    if (!v) continue
    const newDate = toUTC(dateISO, v)
    const oldDate = current[name] as Date | null
    const oldHHMM = formatHHMMfromDate(oldDate)
    if (oldHHMM === v) continue // 変更なし

    data[name] = newDate
    // 段6.5：出勤・退勤は管理者の確定修正として別の列にも保存する（段0〜6の結果を最後に上書き。後の再計算でも残る）
    if (name === "clockIn") data.adminClockIn = newDate
    if (name === "clockOut") data.adminClockOut = newDate
    logs.push({ fieldName: name, oldValue: oldHHMM, newValue: v })

    // 原打刻の保存（clockIn/clockOut のみ、初回変更時のみ）
    if (name === "clockIn" && !current.originalClockIn && oldDate) {
      data.originalClockIn = oldDate
    }
    if (name === "clockOut" && !current.originalClockOut && oldDate) {
      data.originalClockOut = oldDate
    }
  }

  await prisma.$transaction([
    prisma.attendanceRecord.update({ where: { id: recordId }, data }),
    ...logs.map((log) =>
      prisma.attendanceChangeLog.create({
        data: { recordId, changedById, ...log },
      })
    ),
  ])

  // 入力した時刻（変更履歴の新しい値）が段1の入力になる。記録時刻・勤務時間・遅刻・早退・残業は打刻パイプラインが出し直す
  // （保存した記録は承認済みなので遅刻・早退も保存される）。スイッチ状態は記録に保存済みの値を使う
  await recomputeDay(current.userId, current.date)

  revalidatePath("/admin/approval")
  revalidatePath("/admin/attendance")
}

export type ProxyPunchResult = { ok: true } | { ok: false; error: string }

/**
 * 管理者による代理打刻（出退勤いずれの打刻もなかった日に、後日レコードを作成する）
 *
 * - 対象は打刻ゼロの日のみ。既に出勤/退勤がある日・締め済（LOCKED）の日は拒否し、表の編集モーダルへ誘導する
 * - 生打刻（rawClockIn/rawClockOut）は書かない。実際の打刻があった日にしか残さない証跡のため（DOMAIN_MAP 参照）
 * - 休日出勤フラグが立つ日は遅刻・早退を 0 とする（所定時刻起算の機械計算で架空の遅刻が出るのを防ぐ）
 * - 保存後の状態は「承認済」（既存の管理者直接編集と同じ扱い）
 */
export async function actionAdminCreateRecord(
  userId: string,
  dateISO: string,
  formData: FormData,
): Promise<ProxyPunchResult> {
  const changedById = await checkRole()

  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateISO)) return { ok: false, error: "対象日が不正です" }

  const user = await prisma.user.findUnique({
    where:  { id: userId },
    select: { workStartTime: true, workEndTime: true, employmentType: true },
  })
  if (!user) return { ok: false, error: "対象ユーザーが見つかりません" }

  // date は「JST の暦日の UTC 深夜0時」で保存する（打刻・申請承認と同じ基準）
  const date = new Date(`${dateISO}T00:00:00.000Z`)

  const existing = await prisma.attendanceRecord.findUnique({
    where: { userId_date: { userId, date } },
  })
  if (existing) {
    if (existing.status === "LOCKED") {
      return { ok: false, error: "締め済みの日のため代理打刻できません" }
    }
    if (existing.clockIn || existing.clockOut) {
      return { ok: false, error: "既に打刻がある日です。表の編集から修正してください" }
    }
  }

  // 入力された時刻のみを拾う（未入力は書かない）
  const timeFields = ["clockIn", "clockOut", "breakStart", "breakEnd", "goOutAt", "returnAt"] as const
  const values: Partial<Record<(typeof timeFields)[number], Date>> = {}
  const logs: { fieldName: string; newValue: string }[] = []

  for (const name of timeFields) {
    const v = formData.get(name) as string | null
    if (!v) continue
    values[name] = toUTC(dateISO, v)
    logs.push({ fieldName: name, newValue: v })
  }

  const clockIn = values.clockIn ?? null
  if (!clockIn) return { ok: false, error: "出勤時刻は必須です" }

  const clockOut = values.clockOut ?? null
  if (clockOut && clockOut.getTime() <= clockIn.getTime()) {
    return { ok: false, error: "退勤時刻は出勤時刻より後にしてください" }
  }

  const goOutAt    = values.goOutAt    ?? null
  const returnAt   = values.returnAt   ?? null
  const breakStart = values.breakStart ?? null
  const breakEnd   = values.breakEnd   ?? null

  // 休日出勤: 所定時刻を持たない日なので定時なし（遅刻・早退は計上しない）
  const isHolidayWork = formData.get("isHolidayWork") === "on"

  // 記録時刻は入力した時刻を仮置きし、保存後に打刻パイプラインが出し直す
  const data = {
    clockIn,
    clockOut,
    // 段6.5：代理打刻の時刻は管理者の確定修正（丸め・④を通さない）
    adminClockIn: clockIn,
    adminClockOut: clockOut,
    breakStart,
    breakEnd,
    goOutAt,
    returnAt,
    isHolidayWork,
    status: "APPROVED" as const,
  }

  // 作成後の id を ChangeLog に使うため、対話型トランザクションを使う
  await prisma.$transaction(async (tx) => {
    const record = existing
      ? await tx.attendanceRecord.update({ where: { id: existing.id }, data })
      : await tx.attendanceRecord.create({ data: { userId, date, ...data } })

    await tx.attendanceChangeLog.createMany({
      data: logs.map((log) => ({
        recordId:  record.id,
        changedById,
        fieldName: log.fieldName,
        oldValue:  null,
        newValue:  log.newValue,
      })),
    })
  })

  // 代理打刻の時刻（変更履歴の新しい値）が段1の入力。記録時刻・勤務時間・遅刻・早退・残業は打刻パイプラインが出し直す。
  // 休日出勤の印がある日は定時なし（遅刻・早退は付かない）。スイッチ状態はこの時点の設定を保存する（代理打刻の保存時が「打刻時点」）
  await recomputeDay(userId, date, { snapshot: "ifMissing" })

  revalidatePath("/admin/approval")
  revalidatePath("/admin/attendance")
  revalidatePath("/records")
  return { ok: true }
}

// 月一括承認（OPEN → APPROVED、各レコードの集計値を計算して保存）
export async function actionBulkApprove(userId: string, firstDay: string, lastDay: string) {
  await checkRole()

  // 承認 + 遅刻・早退・残業の分数保存（一覧画面の承認と共通）
  await approveRecordsWithMetrics(userId, new Date(firstDay), new Date(lastDay))

  revalidatePath("/admin/approval")
  revalidatePath("/admin/attendance")
}

// 月一括締め（ADMIN のみ）
export async function actionBulkLock(userId: string, firstDay: string, lastDay: string) {
  const session = await auth()
  if (session?.user?.role !== "ADMIN") throw new Error("Forbidden")

  await prisma.attendanceRecord.updateMany({
    where: {
      userId,
      date:   { gte: new Date(firstDay), lte: new Date(lastDay) },
      status: "APPROVED",
    },
    data: { status: "LOCKED" },
  })

  revalidatePath("/admin/approval")
  revalidatePath("/admin/attendance")
}
