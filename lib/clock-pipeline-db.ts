/**
 * 打刻パイプライン（lib/clock-pipeline.ts）の DB 側の入口。
 *
 * 打刻・申請の承認／却下／削除／編集・打刻修正・管理者の直接編集・代理打刻・勤怠承認は、
 * 記録を書いたあと必ずここの recomputeDay / recomputeRecords を呼ぶ。
 * 記録時刻・勤務時間・残業（と承認済みの日の遅刻・早退）を、同じ計算で最初から出し直して保存する。
 *
 * 計算し直さないもの
 * - 締め済み（LOCKED）の日
 * - 出勤・退勤のどちらの時刻も無い記録（欠勤・有給だけの記録など）
 */

import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { calcWorkingMinutes } from "@/lib/attendance"
import {
  computeClockPipeline,
  isRestDay,
  pickHalfDay,
  resolveBreakMinutes,
  resolveInputTime,
  resolveScheduleForDate,
  resolveSwitches,
  switchesFromSetting,
  switchesToColumns,
  type ApprovedCorrection,
  type PipelineOutput,
} from "@/lib/clock-pipeline"

type SettingRow = NonNullable<Awaited<ReturnType<typeof prisma.setting.findUnique>>>
type RecordRow = NonNullable<Awaited<ReturnType<typeof prisma.attendanceRecord.findUnique>>>

type UserRow = {
  workStartTime: string | null
  workEndTime: string | null
  employmentType: string | null
  breakMinutes: number | null
  workSun: boolean; workMon: boolean; workTue: boolean; workWed: boolean
  workThu: boolean; workFri: boolean; workSat: boolean
}

type ContextRequest = { type: string; status: string; createdAt: Date; detail: unknown; targetDate: Date }
type ContextLog = { recordId: string; fieldName: string; newValue: string | null; changedAt: Date }

/** 計算に必要な周辺データ（1人分・期間内） */
export type PipelineContext = {
  user: UserRow
  setting: SettingRow | null
  /** 休日カレンダーの日付（"YYYY-MM-DD"） */
  holidayKeys: Set<string>
  /** 期間内の承認済み OVERTIME / LEAVE / HOLIDAY_WORK */
  requests: ContextRequest[]
  /** 期間内の記録の出退勤の変更履歴 */
  logs: ContextLog[]
}

const dateKey = (d: Date) => d.toISOString().slice(0, 10)

/** records の日付範囲ぶんの周辺データをまとめて読む */
export async function loadPipelineContext(userId: string, records: { id: string; date: Date }[]): Promise<PipelineContext | null> {
  if (records.length === 0) return null
  const times = records.map((r) => r.date.getTime())
  const from = new Date(Math.min(...times))
  const to = new Date(Math.max(...times))
  const [user, setting, holidays, requests, logs] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        workStartTime: true, workEndTime: true, employmentType: true, breakMinutes: true,
        workSun: true, workMon: true, workTue: true, workWed: true, workThu: true, workFri: true, workSat: true,
      },
    }),
    prisma.setting.findUnique({ where: { id: 1 } }),
    prisma.holiday.findMany({ where: { date: { gte: from, lte: to } }, select: { date: true } }),
    prisma.request.findMany({
      where: { userId, targetDate: { gte: from, lte: to }, status: "APPROVED", type: { in: ["OVERTIME", "LEAVE", "HOLIDAY_WORK"] } },
      select: { type: true, status: true, createdAt: true, detail: true, targetDate: true },
    }),
    prisma.attendanceChangeLog.findMany({
      where: { recordId: { in: records.map((r) => r.id) }, fieldName: { in: ["clockIn", "clockOut"] } },
      select: { recordId: true, fieldName: true, newValue: true, changedAt: true },
    }),
  ])
  if (!user) return null
  return { user, setting, holidayKeys: new Set(holidays.map((h) => dateKey(h.date))), requests, logs }
}

/** 画面・Excel で「保存値が無いときの計算」に使う定時（段0）の材料を、期間・複数人ぶんまとめて読む */
export async function loadScheduleInputs(userIds: string[], from: Date, to: Date) {
  const [setting, holidays, requests] = await Promise.all([
    prisma.setting.findUnique({ where: { id: 1 } }),
    prisma.holiday.findMany({ where: { date: { gte: from, lte: to } }, select: { date: true } }),
    prisma.request.findMany({
      where: { userId: { in: userIds }, targetDate: { gte: from, lte: to }, type: { in: ["OVERTIME", "LEAVE", "HOLIDAY_WORK"] }, status: "APPROVED" },
      select: { userId: true, type: true, status: true, createdAt: true, detail: true, targetDate: true },
    }),
  ])
  const holidayKeys = new Set(holidays.map((h) => dateKey(h.date)))
  return {
    setting,
    isHoliday: (date: Date) => holidayKeys.has(dateKey(date)),
    /** その人・その日の承認済み OVERTIME / LEAVE / HOLIDAY_WORK（半休・休日出勤の定時・④の打ち切りの判定に使う） */
    requestsOf: (userId: string, date: Date) =>
      requests.filter((l) => l.userId === userId && l.targetDate.getTime() === date.getTime()),
  }
}

export type RecomputeOptions = {
  /** 計算し直したあとの状態。承認処理は "APPROVED"。APPROVED になる日は遅刻・早退も保存する */
  status?: "APPROVED"
  /**
   * スイッチ状態の保存。
   * "overwrite"：現在の設定で保存し直す（出勤打刻）。"ifMissing"：保存値が無いときだけ現在の設定で保存する（代理打刻・修正申請での新規作成）
   * 指定なしは保存しない（保存値をそのまま使う）
   */
  snapshot?: "overwrite" | "ifMissing"
}

/**
 * 1件の記録をパイプラインに通した結果と、保存する更新内容を作る（DB 書き込みなし）
 * 書くものが無い記録（LOCKED・出退勤の時刻なし）は null
 */
export function buildRecordUpdate(
  rec: RecordRow,
  ctx: PipelineContext,
  opts: RecomputeOptions = {},
): { data: Prisma.AttendanceRecordUncheckedUpdateInput; out: PipelineOutput } | null {
  if (rec.status === "LOCKED") return null
  if (!rec.clockIn && !rec.clockOut && !rec.rawClockIn && !rec.rawClockOut) return null

  // スイッチ状態：保存値（無ければ ③④OFF・①②は現在値）。打刻時の保存では現在の設定
  const snapshotNow = opts.snapshot === "overwrite" || (opts.snapshot === "ifMissing" && rec.switchRoundEarly == null)
  const switches = snapshotNow ? switchesFromSetting(ctx.setting) : resolveSwitches(rec, ctx.setting)

  // 段1：入力の時刻
  const logsOf = (field: string) => ctx.logs.filter((l) => l.recordId === rec.id && l.fieldName === field)
  const inIn  = resolveInputTime({ date: rec.date, raw: rec.rawClockIn,  recorded: rec.clockIn,  logs: logsOf("clockIn") })
  const inOut = resolveInputTime({ date: rec.date, raw: rec.rawClockOut, recorded: rec.clockOut, logs: logsOf("clockOut") })

  // 段0：その日の定時
  const dayRequests = ctx.requests.filter((r) => r.targetDate.getTime() === rec.date.getTime())
  const schedule = resolveScheduleForDate({
    date: rec.date,
    user: ctx.user,
    setting: ctx.setting,
    isHoliday: ctx.holidayKeys.has(dateKey(rec.date)),
    isHolidayWork: rec.isHolidayWork,
    requests: dayRequests,
  })

  const out = computeClockPipeline({
    inputClockIn: inIn.time,
    inputClockOut: inOut.time,
    clockInIsFinal: inIn.source === "recorded",
    clockOutIsFinal: inOut.source === "recorded",
    adminClockIn: rec.adminClockIn,
    adminClockOut: rec.adminClockOut,
    date: rec.date,
    schedule,
    switches,
    requests: dayRequests,
  })

  const data: Prisma.AttendanceRecordUncheckedUpdateInput = {}
  if (out.clockIn) data.clockIn = out.clockIn
  if (out.clockOut) data.clockOut = out.clockOut
  if (out.clockIn && out.clockOut) {
    // 段6：④の上限が出勤より前の日は勤務0分
    // 段7：休憩分数（その日の breakMinutes → 半休・パート → 規定値）を決めて控除する
    const breakMinutes = resolveBreakMinutes({
      savedBreakMinutes: rec.breakMinutes,
      breakStart: rec.breakStart, breakEnd: rec.breakEnd,
      halfDay: pickHalfDay(dayRequests),
      employmentType: ctx.user.employmentType,
      userBreakMinutes: ctx.user.breakMinutes,
      workStartTime: ctx.user.workStartTime, workEndTime: ctx.user.workEndTime,
      daySchedule: schedule,
      presenceMinutes: Math.floor((out.clockOut.getTime() - out.clockIn.getTime() - (rec.goOutAt && rec.returnAt ? rec.returnAt.getTime() - rec.goOutAt.getTime() : 0)) / 60000),
      setting: ctx.setting,
    })
    data.workingMinutes = out.capBeforeClockIn
      ? 0
      : calcWorkingMinutes({
          clockIn: out.clockIn, clockOut: out.clockOut,
          goOutAt: rec.goOutAt, returnAt: rec.returnAt,
          breakMinutes,
        })
    // 段8：残業 ＝ 早出 ＋ 終業後（退勤時の保存・承認時の保存・画面の計算で同じ式）
    data.overtimeMinutes = out.overtimeMinutes
  }
  // 遅刻・早退は承認時に保存する（承認前は保存値が無く、表示時に記録時刻から計算される）
  // 承認取り消しで OPEN に戻った記録など、保存値が残っている日は古い値が残らないよう保存し直す
  if ((opts.status ?? rec.status) === "APPROVED" || rec.lateMinutes != null || rec.earlyLeaveMinutes != null) {
    data.lateMinutes = out.lateMinutes
    data.earlyLeaveMinutes = out.earlyLeaveMinutes
  }
  if (opts.status) data.status = opts.status
  if (snapshotNow) Object.assign(data, switchesToColumns(switches))
  return { data, out }
}

/** 複数の記録（同じ人）を計算し直して保存する。勤怠承認の一括処理と、1日分の再計算が使う */
export async function recomputeRecords(userId: string, records: RecordRow[], opts: RecomputeOptions = {}) {
  const ctx = await loadPipelineContext(userId, records)
  if (!ctx) return
  const updates: Prisma.PrismaPromise<unknown>[] = []
  for (const rec of records) {
    const built = buildRecordUpdate(rec, ctx, opts)
    if (!built) {
      // 時刻の無い記録でも、承認なら状態だけは変える（出退勤なしの有給・欠勤の記録など）
      if (opts.status && rec.status !== "LOCKED") {
        updates.push(prisma.attendanceRecord.update({ where: { id: rec.id }, data: { status: opts.status } }))
      }
      continue
    }
    updates.push(prisma.attendanceRecord.update({ where: { id: rec.id }, data: built.data }))
  }
  if (updates.length > 0) await prisma.$transaction(updates)
}

/**
 * その日の記録時刻・勤務時間・残業（承認済みの日は遅刻・早退も）を計算し直す。
 * 入力が変わったとき（打刻・申請の承認／却下／削除／編集・打刻修正・直接編集・代理打刻）に呼ぶ。
 * 記録が無い日・LOCKED の日は何もしない。
 */
export async function recomputeDay(userId: string, date: Date, opts: RecomputeOptions = {}): Promise<void> {
  const rec = await prisma.attendanceRecord.findUnique({ where: { userId_date: { userId, date } } })
  if (!rec) return
  await recomputeRecords(userId, [rec], opts)
}

/**
 * 休日出勤申請の対象日が休日か（休日カレンダー・本人の休みの曜日）をサーバーで確かめる。休日でなければエラーメッセージ。
 * 振替で労働日になった休日の除外は、振替の記録がまだ無いので見ていない（isRestDay の isSubstituteWorkday）。
 * 申請時と承認時（画面の入力だけに頼らない）、管理者の修正で日付を変えたときに使う
 */
export async function holidayWorkDateError(userId: string, date: Date): Promise<string | null> {
  const [user, holiday] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { workSun: true, workMon: true, workTue: true, workWed: true, workThu: true, workFri: true, workSat: true },
    }),
    prisma.holiday.findUnique({ where: { date }, select: { id: true } }),
  ])
  if (!user) return "対象ユーザーが見つかりません"
  return isRestDay(date, user, !!holiday)
    ? null
    : "休日出勤申請は休日（休日カレンダー・本人の休みの曜日）の日だけ出せます。対象日を確かめてください"
}

/** loadApprovedCorrections の結果の引き方（日付・項目ごと） */
export const correctionKey = (date: Date, field: string) => `${date.getTime()}:${field}`

/**
 * 期間内の承認済みの打刻修正申請を、日付・項目ごとにまとめて返す（どの変更履歴が承認由来かを見分ける材料）。
 * 承認の記録（Approval）は 2026-07-06 以降しか無いので、approvedAts が空の申請もある（見分け方は findCorrectionLog）
 */
export async function loadApprovedCorrections(userId: string, from: Date, to: Date): Promise<Map<string, ApprovedCorrection[]>> {
  const reqs = await prisma.request.findMany({
    where: { userId, type: "CORRECTION", status: "APPROVED", targetDate: { gte: from, lte: to } },
    select: {
      targetDate: true, detail: true, createdAt: true,
      approvals: { where: { action: "APPROVED" }, select: { actedAt: true } },
    },
  })
  const map = new Map<string, ApprovedCorrection[]>()
  for (const r of reqs) {
    const d = r.detail as Record<string, string> | null
    if (!d?.targetField || !d?.correctedTime) continue
    const key = correctionKey(r.targetDate, d.targetField)
    const list = map.get(key) ?? []
    list.push({ correctedTime: d.correctedTime, createdAt: r.createdAt, approvedAts: r.approvals.map((a) => a.actedAt) })
    map.set(key, list)
  }
  return map
}
