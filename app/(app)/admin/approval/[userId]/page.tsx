import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import Link from "next/link"
import { notFound } from "next/navigation"
import { UserDetailTable } from "./_components/UserDetailTable"
import { calcNeedsReview, getDisplayStatus, calcMetrics, calcNightMinutes } from "@/lib/attendance"
import { calcLegalBreak } from "@/config/attendance.config"
import { getClosingPeriod, getDefaultClosingMonth } from "@/lib/closing"

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

  const [user, records, requests] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true, name: true, email: true, department: true,
        employmentType: true, workStartTime: true, workEndTime: true,
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
  ])

  if (!user) notFound()

  // 申請を日付キーでマップ
  const requestMap = new Map(
    requests.map((r) => {
      const jst = toJST(r.targetDate)
      return [`${jst.getUTCFullYear()}-${jst.getUTCMonth() + 1}-${jst.getUTCDate()}`, r.id]
    })
  )

  // 所定勤務時間（分）: workStartTime/workEndTime から算出。未設定時は employmentType で fallback
  function parseHHMM(s: string | null | undefined): number | null {
    if (!s) return null
    const [h, m] = s.split(":").map(Number)
    return h * 60 + m
  }
  const startMins = parseHHMM(user.workStartTime)
  const endMins   = parseHHMM(user.workEndTime)
  const scheduledMinutes = (() => {
    if (startMins !== null && endMins !== null && endMins > startMins) {
      const raw = endMins - startMins
      return raw - calcLegalBreak(raw)
    }
    return user.employmentType === "full" ? 480 : 0
  })()

  // レコードを日付キーでマップ
  const recordMap = new Map(
    records.map((r) => {
      const jst = toJST(r.date)
      return [`${jst.getUTCFullYear()}-${jst.getUTCMonth() + 1}-${jst.getUTCDate()}`, r]
    })
  )

  const todayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))

  // 集計期間の全日程を生成（レコードある日のみ表示）
  const tableRows = records.map((r) => {
    const jst = toJST(r.date)
    const dy  = jst.getUTCFullYear()
    const dm  = jst.getUTCMonth() + 1
    const dd  = jst.getUTCDate()
    const dow = jst.getUTCDay()
    const key = `${dy}-${dm}-${dd}`
    const needsReview = calcNeedsReview({
      clockIn: r.clockIn, clockOut: r.clockOut, date: r.date, today: todayUTC,
      workStartTime: user.workStartTime, workEndTime: user.workEndTime,
    })
    const metrics = calcMetrics({
      clockIn: r.clockIn, clockOut: r.clockOut,
      workingMinutes: r.workingMinutes,
      workStartTime: user.workStartTime, workEndTime: user.workEndTime,
      scheduledMinutes,
    })
    const nightMinutes = calcNightMinutes(r.clockIn, r.clockOut)
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
      breakStart:  formatHHMM(r.breakStart),
      breakEnd:    formatHHMM(r.breakEnd),
      goOutAt:     formatHHMM(r.goOutAt),
      returnAt:    formatHHMM(r.returnAt),
      workingMinutes:    r.workingMinutes,
      lateMinutes:       metrics.lateMinutes,
      earlyLeaveMinutes: metrics.earlyLeaveMinutes,
      nightMinutes,
      goOutMins,
      note:        r.note,
      status:      r.status,
      displayStatus: getDisplayStatus(r.status, needsReview),
      isAbsent:    r.isAbsent,
      requestId:   requestMap.get(key) ?? null,
      scheduledMinutes,
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
