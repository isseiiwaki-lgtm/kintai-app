import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import Link from "next/link"
import { calcNeedsReview } from "@/lib/attendance"

type SearchParams = Promise<{ year?: string; month?: string }>

function toJST(dt: Date) {
  return new Date(dt.getTime() + 9 * 60 * 60 * 1000)
}
function formatTime(dt: Date | null | undefined) {
  if (!dt) return "--:--"
  const j = toJST(dt)
  return `${String(j.getUTCHours()).padStart(2, "0")}:${String(j.getUTCMinutes()).padStart(2, "0")}`
}
function fmtMin(min: number) {
  return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, "0")}`
}

export default async function AdminAttendancePage({ searchParams }: { searchParams: SearchParams }) {
  const params     = await searchParams
  const now        = toJST(new Date())
  const setting    = await prisma.setting.findUnique({ where: { id: 1 } })
  const closingDay = setting?.closingDay ?? 25

  // 締め日考慮のデフォルト月
  const todayDate    = now.getUTCDate()
  const defaultYear  = todayDate > closingDay
    ? (now.getUTCMonth() === 11 ? now.getUTCFullYear() + 1 : now.getUTCFullYear())
    : now.getUTCFullYear()
  const defaultMonth = todayDate > closingDay
    ? (now.getUTCMonth() + 2 > 12 ? 1 : now.getUTCMonth() + 2)
    : now.getUTCMonth() + 1

  const year  = Number(params.year  ?? defaultYear)
  const month = Number(params.month ?? defaultMonth)

  // 集計期間: 前月(closingDay+1) 〜 当月(closingDay)
  const firstDay = new Date(Date.UTC(year, month - 2, closingDay + 1))
  const lastDay  = new Date(Date.UTC(year, month - 1, closingDay))

  const prevMonth = month === 1 ? 12 : month - 1
  const prevYear  = month === 1 ? year - 1 : year
  const nextMonth = month === 12 ? 1 : month + 1
  const nextYear  = month === 12 ? year + 1 : year
  const prevLink  = `/admin/attendance?year=${prevYear}&month=${prevMonth}`
  const nextLink  = `/admin/attendance?year=${nextYear}&month=${nextMonth}`

  const periodStart = `${firstDay.getUTCMonth() + 1}/${firstDay.getUTCDate()}`
  const periodEnd   = `${lastDay.getUTCMonth() + 1}/${lastDay.getUTCDate()}`

  // 全アクティブユーザー + 集計期間の打刻レコード
  const users = await prisma.user.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
    select: {
      id: true, name: true, email: true, employmentType: true, department: true,
      workStartTime: true, workEndTime: true,
      attendanceRecords: {
        where: { date: { gte: firstDay, lte: lastDay } },
        select: { workingMinutes: true, clockIn: true, clockOut: true, date: true, status: true },
      },
    },
  })

  const todayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))

  function parseHHMM(s: string | null | undefined): number | null {
    if (!s) return null
    const [h, m] = s.split(":").map(Number)
    return h * 60 + m
  }

  // 集計
  type Row = {
    id: string
    name: string
    dept: string
    empType: string
    workDays: number
    totalMin: number
    scheduledTotalMin: number
    overtimeMin: number
    unapprovedDays: number
    approvedDays: number
  }
  type Rec = { clockIn: Date | null; clockOut: Date | null; date: Date; workingMinutes: number | null; status: string }
  const rows: Row[] = users.map((u: typeof users[number]) => {
    const recs = u.attendanceRecords as Rec[]
    const startM = parseHHMM(u.workStartTime)
    const endM   = parseHHMM(u.workEndTime)
    const scheduledPerDay = startM !== null && endM !== null && endM > startM
      ? endM - startM
      : u.employmentType === "full" ? 480 : 0

    const workDays          = recs.filter((r) => r.clockIn).length
    const totalMin          = recs.reduce((s, r) => s + (r.workingMinutes ?? 0), 0)
    const scheduledTotalMin = workDays * scheduledPerDay
    const overtimeMin       = recs.reduce((s, r) => s + Math.max(0, (r.workingMinutes ?? 0) - scheduledPerDay), 0)
    const unapprovedDays    = recs.filter((r) =>
      r.status === "OPEN" && calcNeedsReview({
        clockIn: r.clockIn, clockOut: r.clockOut, date: r.date, today: todayUTC,
        workStartTime: u.workStartTime, workEndTime: u.workEndTime,
      }) || r.status === "SUBMITTED"
    ).length
    const approvedDays      = recs.filter((r) => r.status === "APPROVED" || r.status === "LOCKED").length
    return {
      id: u.id,
      name: u.name ?? u.email ?? "?",
      dept: u.department ?? "—",
      empType: u.employmentType,
      workDays, totalMin, scheduledTotalMin, overtimeMin,
      unapprovedDays, approvedDays,
    }
  })

  return (
    <div className="p-4 lg:p-6">
      {/* ヘッダー */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <Link href={prevLink} className="p-2 rounded-lg hover:bg-gray-100 text-gray-500">◀</Link>
          <div>
            <h1 className="text-base font-semibold text-gray-900">{year}年{month}月 勤務状況一覧</h1>
            <p className="text-[10px] text-gray-400 text-center">{periodStart}〜{periodEnd}</p>
          </div>
          <Link href={nextLink} className="p-2 rounded-lg hover:bg-gray-100 text-gray-500">▶</Link>
        </div>
        <a
          href={`/api/admin/export?year=${year}&month=${month}`}
          className="flex items-center gap-1.5 px-3 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
          </svg>
          CSV出力
        </a>
      </div>

      {/* テーブル（横スクロール対応） */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
        <table className="w-full text-sm min-w-[700px]">
          <thead>
            <tr className="border-b border-gray-100 text-xs text-gray-400 bg-gray-50">
              <th className="text-left px-4 py-3 font-medium">氏名</th>
              <th className="text-left px-3 py-3 font-medium">部署</th>
              <th className="text-center px-3 py-3 font-medium">雇用</th>
              <th className="text-center px-3 py-3 font-medium">出勤日数</th>
              <th className="text-center px-3 py-3 font-medium">総勤務</th>
              <th className="text-center px-3 py-3 font-medium">所定</th>
              <th className="text-center px-3 py-3 font-medium">残業</th>
              <th className="text-center px-3 py-3 font-medium">未承認</th>
              <th className="text-center px-3 py-3 font-medium">承認済</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50">
                <td className="px-4 py-2.5">
                  <Link
                    href={`/admin/approval/${r.id}?year=${year}&month=${month}`}
                    className="font-medium text-blue-600 hover:underline"
                  >
                    {r.name}
                  </Link>
                </td>
                <td className="px-3 py-2.5 text-gray-500 text-xs">{r.dept}</td>
                <td className="px-3 py-2.5 text-center">
                  <span className={`inline-block px-1.5 py-0.5 rounded text-xs ${r.empType === "full" ? "bg-blue-50 text-blue-700" : "bg-orange-50 text-orange-700"}`}>
                    {r.empType === "full" ? "社員" : r.empType === "part" ? "パート" : "雇用者"}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-center text-gray-700">{r.workDays}</td>
                <td className="px-3 py-2.5 text-center font-mono text-gray-700">{r.totalMin > 0 ? fmtMin(r.totalMin) : "—"}</td>
                <td className="px-3 py-2.5 text-center font-mono text-gray-500">{r.scheduledTotalMin > 0 ? fmtMin(r.scheduledTotalMin) : "—"}</td>
                <td className={`px-3 py-2.5 text-center font-mono ${r.overtimeMin > 0 ? "text-blue-600 font-medium" : "text-gray-300"}`}>
                  {r.overtimeMin > 0 ? fmtMin(r.overtimeMin) : "—"}
                </td>
                <td className="px-3 py-2.5 text-center">
                  {r.unapprovedDays > 0 ? <span className="text-amber-600 font-medium">{r.unapprovedDays}日</span> : <span className="text-gray-300">—</span>}
                </td>
                <td className="px-3 py-2.5 text-center">
                  {r.approvedDays > 0 ? <span className="text-green-600 font-medium">{r.approvedDays}日</span> : <span className="text-gray-300">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
