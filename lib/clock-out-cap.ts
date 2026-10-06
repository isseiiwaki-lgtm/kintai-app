import { prisma } from "@/lib/prisma"
import {
  calcMetrics,
  calcScheduledMinutes,
  calcWorkingMinutes,
  computeRecordedClockOut,
  hasOvertimeRequest,
  needsOvertimeRequestNotice,
  pickOvertimeCapEnd,
} from "@/lib/attendance"

/**
 * その日の残業申請（申請中・承認済、早出申請を含む）を取得する。
 * 早出申請の除外は JS 側（isNormalOvertime）で行う。
 * JSON の path フィルタで「overtimeType が無い（通常の残業申請）」を拾うと、PostgreSQL では
 * キー欠落が NULL になり一致しないおそれがあるため、DB には条件を持たせない。
 */
export function fetchDayOvertimeRequests(userId: string, date: Date) {
  return prisma.request.findMany({
    where: { userId, targetDate: date, type: "OVERTIME", status: { in: ["PENDING", "APPROVED"] } },
    select: { type: true, status: true, createdAt: true, detail: true },
  })
}

/**
 * 残業申請が承認・削除・終了時刻の変更をされたとき、その日の退勤の記録時刻・勤務時間・遅刻・早退・残業を計算し直す。
 * ④（残業の申請上限）がONのときだけ動く。実打刻（rawClockOut）から ③④ を適用し直す。
 *
 * 次の場合は触らない:
 * - ④OFF（上限が無いので申請の有無で退勤の記録時刻は変わらない）
 * - 締め済み（LOCKED）。遡及しない
 * - 実打刻が無い／退勤時刻が人の手で直されている（originalClockOut・変更履歴あり）。人の修正を上書きしない
 * 変更履歴（AttendanceChangeLog）と originalClockOut は作らない（打刻時の丸め・上限と同じ扱い）。
 */
export async function recomputeClockOutForDay(userId: string, date: Date): Promise<void> {
  const [record, user, setting, requests] = await Promise.all([
    prisma.attendanceRecord.findUnique({ where: { userId_date: { userId, date } } }),
    prisma.user.findUnique({
      where: { id: userId },
      select: { workStartTime: true, workEndTime: true, employmentType: true },
    }),
    prisma.setting.findUnique({ where: { id: 1 } }),
    fetchDayOvertimeRequests(userId, date),
  ])
  if (!record || !user || !setting?.capOvertimeByRequest) return
  if (record.status === "LOCKED") return
  if (!record.clockIn || !record.clockOut || !record.rawClockOut) return
  if (record.originalClockOut) return
  const edited = await prisma.attendanceChangeLog.count({
    where: { recordId: record.id, fieldName: "clockOut" },
  })
  if (edited > 0) return

  const newClockOut = computeRecordedClockOut(record.rawClockOut, {
    workEndTime: user.workEndTime,
    clockIn: record.clockIn,
    setting,
    hasOvertimeRequest: hasOvertimeRequest(requests),
    capEndTime: pickOvertimeCapEnd(requests),
  })
  if (newClockOut.getTime() === record.clockOut.getTime()) return

  const workingMinutes = calcWorkingMinutes({
    clockIn: record.clockIn, clockOut: newClockOut,
    goOutAt: record.goOutAt, returnAt: record.returnAt,
    breakStart: record.breakStart, breakEnd: record.breakEnd,
    employmentType: user.employmentType,
  })
  if (workingMinutes === null) return

  const data: {
    clockOut: Date
    workingMinutes: number
    overtimeMinutes: number
    lateMinutes?: number
    earlyLeaveMinutes?: number
  } = {
    clockOut: newClockOut,
    workingMinutes,
    // 残業の基準は変えない: 承認前は退勤時と同じ 480 基準、承認済みは承認処理と同じ所定基準
    overtimeMinutes: Math.max(0, workingMinutes - 480),
  }

  if (record.status === "APPROVED") {
    // 承認済みの日は遅刻・早退・残業が保存されているので、承認処理（approve-records）と同じ計算で保存し直す
    const metrics = calcMetrics({
      clockIn: record.clockIn,
      clockOut: newClockOut,
      workingMinutes,
      workStartTime: user.workStartTime,
      workEndTime: user.workEndTime,
      scheduledMinutes: calcScheduledMinutes(user.workStartTime, user.workEndTime, user.employmentType),
    })
    data.overtimeMinutes = metrics.overtimeMinutes
    data.lateMinutes = record.isHolidayWork ? 0 : metrics.lateMinutes
    data.earlyLeaveMinutes = record.isHolidayWork ? 0 : metrics.earlyLeaveMinutes
  }
  // OPEN / SUBMITTED の遅刻・早退は保存値が無く、表示時に記録時刻（clockOut）から計算されるので書かない

  await prisma.attendanceRecord.update({ where: { id: record.id }, data })
}

/**
 * 本人向けの注意表示（残業申請が無いのに定時を15分以上過ぎて退勤した当日）を出すか。
 * 出すのは当日の画面（退勤直後の打刻画面・ホーム）だけ。呼び出し側が today を渡すので、翌日以降は出ない。
 * 要確認の状態・件数には入れない。削った時間は出さない（内訳は管理者画面のみ）。
 */
export async function shouldShowOvertimeNotice(userId: string, today: Date): Promise<boolean> {
  const [record, user, setting, requests] = await Promise.all([
    prisma.attendanceRecord.findUnique({
      where: { userId_date: { userId, date: today } },
      select: { rawClockOut: true },
    }),
    prisma.user.findUnique({ where: { id: userId }, select: { workEndTime: true } }),
    prisma.setting.findUnique({ where: { id: 1 }, select: { capOvertimeByRequest: true } }),
    fetchDayOvertimeRequests(userId, today),
  ])
  return needsOvertimeRequestNotice({
    rawClockOut: record?.rawClockOut ?? null,
    workEndTime: user?.workEndTime ?? null,
    hasOvertimeRequest: hasOvertimeRequest(requests),
    capEnabled: setting?.capOvertimeByRequest ?? false,
  })
}
