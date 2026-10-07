import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import Link from "next/link"
import { notFound } from "next/navigation"
import { UserDetailTable } from "./_components/UserDetailTable"
import { ProxyPunchForm } from "./_components/ProxyPunchForm"
import { calcNeedsReview, getDisplayStatus, resolveDayMetrics, calcNightMinutes, calcScheduledMinutes, hasOvertimeRequest, needsOvertimeRequestNotice, pickOvertimeCapEnd } from "@/lib/attendance"
import { pickEarlyStartTime, resolveScheduleForDate, resolveSwitches, switchesFromSetting } from "@/lib/clock-pipeline"
import { loadScheduleInputs } from "@/lib/clock-pipeline-db"
import { getClosingPeriod, getDefaultClosingMonth, listClosingPeriodDates } from "@/lib/closing"

type Params      = Promise<{ userId: string }>
type SearchParams = Promise<{ year?: string; month?: string }>

const WEEKDAY = ["日", "月", "火", "水", "木", "金", "土"]

function toJST(dt: Date) {
  return new Date(dt.getTime() + 9 * 60 * 60 * 1000)
}
function formatHHMM(dt: Date | null | undefined): string | null {
  if (!dt) return null
  const j = toJST(dt)
  return `${String(j.getUTCHours()).padStart(2, "0")}:${String(j.getUTCMinutes()).padStart(2, "0")}`
}

export default async function UserApprovalPage({
  params: paramsPromise,
  searchParams,
}: {
  params: Params
  searchParams: SearchParams
}) {
  const session = await auth()
  const role    = session?.user?.role
  if (role !== "ADMIN" && role !== "APPROVER") notFound()

  const { userId } = await paramsPromise
  const params     = await searchParams

  const now        = toJST(new Date())
  const setting    = await prisma.setting.findUnique({ where: { id: 1 } })
  const closingDay = setting?.closingDay ?? 25

  const def   = getDefaultClosingMonth(closingDay)
  const year  = Number(params.year  ?? def.year)
  const month = Number(params.month ?? def.month)

  const { firstDay, lastDay } = getClosingPeriod(year, month, closingDay)

  const prevMonth = month === 1 ? 12 : month - 1
  const prevYear  = month === 1 ? year - 1 : year
  const nextMonth = month === 12 ? 1 : month + 1
  const nextYear  = month === 12 ? year + 1 : year
  const prevLink  = `/admin/approval/${userId}?year=${prevYear}&month=${prevMonth}`
  const nextLink  = `/admin/approval/${userId}?year=${nextYear}&month=${nextMonth}`

  const [user, records, requests, overtimeRequests] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true, name: true, email: true, department: true,
        employmentType: true, workStartTime: true, workEndTime: true, breakMinutes: true,
        workSun: true, workMon: true, workTue: true, workWed: true, workThu: true, workFri: true, workSat: true,
      },
    }),
    prisma.attendanceRecord.findMany({
      where: { userId, date: { gte: firstDay, lte: lastDay } },
      orderBy: { date: "asc" },
    }),
    prisma.request.findMany({
      where: { userId, targetDate: { gte: firstDay, lte: lastDay } },
      select: { id: true, targetDate: true },
    }),
    // 残業申請（申請中・承認済）。④の上限（申請終了）と「申請なし」の目印に使う
    prisma.request.findMany({
      where: {
        userId, type: "OVERTIME", status: { in: ["PENDING", "APPROVED"] },
        targetDate: { gte: firstDay, lte: lastDay },
      },
      select: { targetDate: true, type: true, status: true, createdAt: true, detail: true },
    }),
  ])
  const overtimeReqByDate = new Map<string, typeof overtimeRequests>()
  for (const q of overtimeRequests) {
    const k = q.targetDate.toISOString()
    overtimeReqByDate.set(k, [...(overtimeReqByDate.get(k) ?? []), q])
  }

  if (!user) notFound()

  // 段0：その日の定時（休日は定時なし・半休は前半/後半）。遅刻・早退・残業・要確認の判定に使う
  const sched = await loadScheduleInputs([userId], firstDay, lastDay)

  // 申請を日付キーでマップ
  const requestMap = new Map(
    requests.map((r) => {
      const jst = toJST(r.targetDate)
      return [`${jst.getUTCFullYear()}-${jst.getUTCMonth() + 1}-${jst.getUTCDate()}`, r.id]
    })
  )

  // 所定勤務時間（分）: workStartTime/workEndTime から算出。未設定時は employmentType で fallback
  const scheduledMinutes = calcScheduledMinutes(user.workStartTime, user.workEndTime, user.employmentType)

  // レコードを日付キーでマップ
  const recordMap = new Map(
    records.map((r) => {
      const jst = toJST(r.date)
      return [`${jst.getUTCFullYear()}-${jst.getUTCMonth() + 1}-${jst.getUTCDate()}`, r]
    })
  )

  const todayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))

  // 代理打刻の対象候補: 締め期間内・本日以前で、出勤も退勤も打刻がない日
  // （欠勤・有給・締め済の日は対象外。当日コメントだけ残った日は候補に含める）
  const missingDates = listClosingPeriodDates(firstDay, lastDay)
    .filter((d) => d.getTime() <= todayUTC.getTime())
    .filter((d) => {
      const r = recordMap.get(`${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`)
      if (!r) return true
      return !r.clockIn && !r.clockOut && !r.isAbsent && !r.paidLeaveMinutes && r.status !== "LOCKED"
    })
    .map((d) => {
      const dm = d.getUTCMonth() + 1
      const dd = d.getUTCDate()
      const approvedReqs = sched.requestsOf(userId, d)
      return {
        iso:   `${d.getUTCFullYear()}-${String(dm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`,
        label: `${dm}/${dd}（${WEEKDAY[d.getUTCDay()]}）`,
        // 代理打刻はこの時点の設定のスイッチで保存される。選択肢もそれに合わせる（段6.5）
        constraint: {
          schedule: resolveScheduleForDate({
            date: d, user, setting: sched.setting, isHoliday: sched.isHoliday(d), requests: approvedReqs,
          }),
          switches: switchesFromSetting(setting),
          earlyStartTime: pickEarlyStartTime(approvedReqs),
          overtimeCapEnd: pickOvertimeCapEnd(approvedReqs),
        },
      }
    })

  // 集計期間の全日程を生成（レコードある日のみ表示）
  const tableRows = records.map((r) => {
    const jst = toJST(r.date)
    const dy  = jst.getUTCFullYear()
    const dm  = jst.getUTCMonth() + 1
    const dd  = jst.getUTCDate()
    const dow = jst.getUTCDay()
    const key = `${dy}-${dm}-${dd}`
    const schedule = resolveScheduleForDate({
      date: r.date, user, setting: sched.setting,
      isHoliday: sched.isHoliday(r.date), isHolidayWork: r.isHolidayWork, requests: sched.requestsOf(userId, r.date),
    })
    const needsReview = calcNeedsReview({
      clockIn: r.clockIn, clockOut: r.clockOut, date: r.date, today: todayUTC,
      workStartTime: schedule?.start ?? null, workEndTime: schedule?.end ?? null,
    })
    // 遅刻・早退・残業: 保存値があればそれ、無ければ記録時刻と定時の差から計算（段4・段8）
    const metrics = resolveDayMetrics(r, schedule)
    const nightMinutes = calcNightMinutes(r.clockIn, r.clockOut)
    // ④（残業の申請上限）: 実打刻・申請終了・記録時刻の3つを管理者に見せる。一般社員の画面には出さない
    const dayOvertimeReqs = overtimeReqByDate.get(r.date.toISOString()) ?? []
    // ④の判定は、その日の記録に保存したスイッチ状態で行う（④を後から ON にしても、④OFF で保存した過去の日には出さない）
    const switches = resolveSwitches(r, setting)
    const capEnabled = switches.capOvertime
    const requestEndTime = capEnabled ? pickOvertimeCapEnd(dayOvertimeReqs) : null
    const noOvertimeRequest = needsOvertimeRequestNotice({
      // 段0の定時（半休・休日を反映）。日をまたぐ退勤でも記録の日付の定時で判定する
      rawClockOut: r.rawClockOut, workEndTime: schedule?.end ?? null, date: r.date,
      hasOvertimeRequest: hasOvertimeRequest(dayOvertimeReqs), capEnabled,
    })
    const goOutMins =
      r.goOutAt && r.returnAt
        ? Math.round((r.returnAt.getTime() - r.goOutAt.getTime()) / 60000)
        : r.goOutAt ? null : 0
    return {
      id:          r.id,
      dateISO:     `${dy}-${String(dm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`,
      dateLabel:   `${dm}/${dd}（${WEEKDAY[dow]}）`,
      clockIn:     formatHHMM(r.clockIn),
      clockOut:    formatHHMM(r.clockOut),
      rawClockIn:  formatHHMM(r.rawClockIn),
      rawClockOut: formatHHMM(r.rawClockOut),
      requestEndTime,
      noOvertimeRequest,
      breakStart:  formatHHMM(r.breakStart),
      breakEnd:    formatHHMM(r.breakEnd),
      goOutAt:     formatHHMM(r.goOutAt),
      returnAt:    formatHHMM(r.returnAt),
      workingMinutes:    r.workingMinutes,
      // 休日出勤の日・休日は定時なしなので0（resolveScheduleForDate が null を返す）
      lateMinutes:       metrics.lateMinutes,
      earlyLeaveMinutes: metrics.earlyLeaveMinutes,
      overtimeMinutes:   metrics.overtimeMinutes,
      nightMinutes,
      goOutMins,
      note:        r.note,
      status:      r.status,
      displayStatus: getDisplayStatus(r.status, needsReview),
      isAbsent:    r.isAbsent,
      requestId:   requestMap.get(key) ?? null,
      scheduledMinutes,
      // 管理者の入力画面の選択肢（段6.5）：その日のスイッチ・定時・承認済みの申請
      timeConstraint: (() => {
        const approvedReqs = sched.requestsOf(userId, r.date)
        return {
          schedule, switches,
          earlyStartTime: pickEarlyStartTime(approvedReqs),
          overtimeCapEnd: pickOvertimeCapEnd(approvedReqs),
        }
      })(),
      isWeekend:   dow === 0 || dow === 6,
    }
  })

  const openCount     = records.filter((r) => r.status === "OPEN" || r.status === "SUBMITTED").length
  const approvedCount = records.filter((r) => r.status === "APPROVED").length

  const periodStart = `${firstDay.getUTCMonth() + 1}/${firstDay.getUTCDate()}`
  const periodEnd   = `${lastDay.getUTCMonth() + 1}/${lastDay.getUTCDate()}`

  return (
    <div className="p-4 lg:p-6">
      {/* ヘッダー */}
      <div className="flex items-center gap-3 mb-1">
        <Link href={`/admin/attendance?year=${year}&month=${month}`} className="text-sm text-gray-400 hover:text-gray-700">
          ← 一覧
        </Link>
      </div>
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          <Link href={prevLink} className="p-2 rounded-lg hover:bg-gray-100 text-gray-500">◀</Link>
          <div>
            <h1 className="text-base font-semibold text-gray-900">
              {user.name ?? user.email} — {year}年{month}月
            </h1>
            <p className="text-[10px] text-gray-400">{periodStart}〜{periodEnd}　{user.department ?? ""}</p>
          </div>
          <Link href={nextLink} className="p-2 rounded-lg hover:bg-gray-100 text-gray-500">▶</Link>
        </div>
      </div>

      <ProxyPunchForm userId={userId} missingDates={missingDates} />

      <UserDetailTable
        records={tableRows}
        firstDayISO={firstDay.toISOString()}
        lastDayISO={lastDay.toISOString()}
        userId={userId}
        isAdmin={role === "ADMIN"}
        openCount={openCount}
        approvedCount={approvedCount}
      />
    </div>
  )
}
