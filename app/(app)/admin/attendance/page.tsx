import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import Link from "next/link"

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
  const params = await searchParams
  const now    = toJST(new Date())
  const year   = Number(params.year  ?? now.getUTCFullYear())
  const month  = Number(params.month ?? now.getUTCMonth() + 1)

  const firstDay = new Date(Date.UTC(year, month - 1, 1))
  const lastDay  = new Date(Date.UTC(year, month,     0))

  const prevDate = new Date(Date.UTC(year, month - 2, 1))
  const nextDate = new Date(Date.UTC(year, month,     1))
  const prevLink = `/admin/attendance?year=${prevDate.getUTCFullYear()}&month=${prevDate.getUTCMonth() + 1}`
  const nextLink = `/admin/attendance?year=${nextDate.getUTCFullYear()}&month=${nextDate.getUTCMonth() + 1}`

  // 全アクティブユーザー + その月の打刻レコード
  const users = await prisma.user.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
    select: {
      id: true, name: true, email: true, employmentType: true, department: true,
      attendanceRecords: {
        where: { date: { gte: firstDay, lte: lastDay } },
        select: { workingMinutes: true, clockIn: true, status: true },
      },
    },
  })

  // 集計
  type Row = {
    id: string
    name: string
    dept: string
    empType: string
    workDays: number
    totalMin: number
    overtimeMin: number
    openDays: number
    submittedDays: number
    approvedDays: number
  }
  const rows: Row[] = users.map((u) => {
    const recs = u.attendanceRecords
    const workDays     = recs.filter((r) => r.clockIn).length
    const totalMin     = recs.reduce((s, r) => s + (r.workingMinutes ?? 0), 0)
    const overtimeMin  = recs.reduce((s, r) => {
      const scheduled = u.employmentType === "full" ? 480 : 0
      return s + Math.max(0, (r.workingMinutes ?? 0) - scheduled)
    }, 0)
    const openDays      = recs.filter((r) => r.status === "OPEN").length
    const submittedDays = recs.filter((r) => r.status === "SUBMITTED").length
    const approvedDays  = recs.filter((r) => r.status === "APPROVED" || r.status === "LOCKED").length
    return {
      id: u.id,
      name: u.name ?? u.email ?? "?",
      dept: u.department ?? "—",
      empType: u.employmentType,
      workDays, totalMin, overtimeMin,
      openDays, submittedDays, approvedDays,
    }
  })

  return (
    <div className="p-4 lg:p-6">
      {/* ヘッダー */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <Link href={prevLink} className="p-2 rounded-lg hover:bg-gray-100 text-gray-500">◀</Link>
          <h1 className="text-base font-semibold text-gray-900">{year}年{month}月 勤務状況一覧</h1>
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
              <th className="text-center px-3 py-3 font-medium">総勤務時間</th>
              <th className="text-center px-3 py-3 font-medium">残業時間</th>
              <th className="text-center px-3 py-3 font-medium">未確認</th>
              <th className="text-center px-3 py-3 font-medium">提出済</th>
              <th className="text-center px-3 py-3 font-medium">承認済</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50">
                <td className="px-4 py-2.5 font-medium text-gray-800">{r.name}</td>
                <td className="px-3 py-2.5 text-gray-500 text-xs">{r.dept}</td>
                <td className="px-3 py-2.5 text-center">
                  <span className={`inline-block px-1.5 py-0.5 rounded text-xs ${r.empType === "full" ? "bg-blue-50 text-blue-700" : "bg-orange-50 text-orange-700"}`}>
                    {r.empType === "full" ? "社員" : "パート"}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-center text-gray-700">{r.workDays}</td>
                <td className="px-3 py-2.5 text-center font-mono text-gray-700">{r.totalMin > 0 ? fmtMin(r.totalMin) : "—"}</td>
                <td className={`px-3 py-2.5 text-center font-mono ${r.overtimeMin > 0 ? "text-red-600 font-medium" : "text-gray-400"}`}>
                  {r.overtimeMin > 0 ? fmtMin(r.overtimeMin) : "—"}
                </td>
                <td className="px-3 py-2.5 text-center">
                  {r.openDays > 0 ? <span className="text-gray-500">{r.openDays}</span> : <span className="text-gray-300">—</span>}
                </td>
                <td className="px-3 py-2.5 text-center">
                  {r.submittedDays > 0 ? <span className="text-blue-600 font-medium">{r.submittedDays}</span> : <span className="text-gray-300">—</span>}
                </td>
                <td className="px-3 py-2.5 text-center">
                  {r.approvedDays > 0 ? <span className="text-green-600 font-medium">{r.approvedDays}</span> : <span className="text-gray-300">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
