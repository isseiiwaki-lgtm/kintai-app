import { prisma } from "@/lib/prisma"
import { hasOvertimeRequest, needsOvertimeRequestNotice } from "@/lib/attendance"
import { resolveScheduleForDate, resolveSwitches } from "@/lib/clock-pipeline"
import { loadScheduleInputs } from "@/lib/clock-pipeline-db"

/**
 * その日の残業申請（申請中・承認済、早出申請を含む）を取得する。
 * 注意表示（残業申請が無いのに定時を過ぎた日）の判定に使う。早出申請の除外は JS 側（isNormalOvertime）で行う。
 * JSON の path フィルタで「overtimeType が無い（通常の残業申請）」を拾うと、PostgreSQL では
 * キー欠落が NULL になり一致しないおそれがあるため、DB には条件を持たせない。
 *
 * 記録時刻の計算（④の上限・早出の有効な開始）は承認済みの申請だけを入力にする。
 * それは lib/clock-pipeline-db.ts が読む。ここの取得はそれとは別
 */
export function fetchDayOvertimeRequests(userId: string, date: Date) {
  return prisma.request.findMany({
    where: { userId, targetDate: date, type: "OVERTIME", status: { in: ["PENDING", "APPROVED"] } },
    select: { type: true, status: true, createdAt: true, detail: true },
  })
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
      select: {
        rawClockOut: true, isHolidayWork: true,
        switchRoundEarly: true, switchRoundNear: true, switchRoundQuarter: true, switchCapOvertime: true,
      },
    }),
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        workStartTime: true, workEndTime: true, employmentType: true, breakMinutes: true,
        workSun: true, workMon: true, workTue: true, workWed: true, workThu: true, workFri: true, workSat: true,
      },
    }),
    prisma.setting.findUnique({ where: { id: 1 }, select: { roundEarlyClockIn: true, roundNearClockTime: true, capOvertimeByRequest: true } }),
    fetchDayOvertimeRequests(userId, today),
  ])
  // 段0：その日の定時（半休は前半/後半、休日は定時なし＝目印を出さない）
  const sched = await loadScheduleInputs([userId], today, today)
  const schedule = user
    ? resolveScheduleForDate({
        date: today, user, setting: sched.setting,
        isHoliday: sched.isHoliday(today), isHolidayWork: record?.isHolidayWork, requests: sched.requestsOf(userId, today),
      })
    : null
  return needsOvertimeRequestNotice({
    rawClockOut: record?.rawClockOut ?? null,
    workEndTime: schedule?.end ?? null,
    date: today,
    hasOvertimeRequest: hasOvertimeRequest(requests),
    // その日の記録に保存したスイッチ状態で判定する（保存値が無い記録は ④OFF）
    capEnabled: resolveSwitches(record, setting).capOvertime,
  })
}
