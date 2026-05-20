import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import Link from "next/link"
import { ApprovalActions } from "./approval-actions"

type SearchParams = Promise<{ year?: string; month?: string }>

function toJST(dt: Date) {
  return new Date(dt.getTime() + 9 * 60 * 60 * 1000)
}

export default async function ApprovalPage({ searchParams }: { searchParams: SearchParams }) {
  const session = await auth()
  const isAdmin = session?.user?.role === "ADMIN"
  const params  = await searchParams
  const now     = toJST(new Date())

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

  // 締め日連動の集計期間
  const firstDay = new Date(Date.UTC(year, month - 2, closingDay + 1))
  const lastDay  = new Date(Date.UTC(year, month - 1, closingDay))

  const prevMonth = month === 1 ? 12 : month - 1
  const prevYear  = month === 1 ? year - 1 : year
  const nextMonth = month === 12 ? 1 : month + 1
  const nextYear  = month === 12 ? year + 1 : year
  const prevLink  = `/admin/approval?year=${prevYear}&month=${prevMonth}`
  const nextLink  = `/admin/approval?year=${nextYear}&month=${nextMonth}`

  const periodStart = `${firstDay.getUTCMonth() + 1}/${firstDay.getUTCDate()}`
  const periodEnd   = `${lastDay.getUTCMonth() + 1}/${lastDay.getUTCDate()}`

  const users = await prisma.user.findMany({
    where: { isActive: true, department: { notIn: ["管理者", "管理職"] } },
    orderBy: { employeeCode: "asc" },
    select: {
      id: true, name: true, email: true, department: true,
      attendanceRecords: {
        where: { date: { gte: firstDay, lte: lastDay }, clockIn: { not: null } },
        select: { status: true },
      },
    },
  })

  type UserRow = {
    id: string
    name: string
    dept: string
    total: number
    open: number
    approved: number
    locked: number
  }

  const rows: UserRow[] = users
    .map((u: typeof users[number]) => {
      const recs     = u.attendanceRecords
      const total    = recs.length
      const open     = recs.filter((r: { status: string }) => r.status === "OPEN" || r.status === "SUBMITTED").length
      const approved = recs.filter((r: { status: string }) => r.status === "APPROVED").length
      const locked   = recs.filter((r: { status: string }) => r.status === "LOCKED").length
      return { id: u.id, name: u.name ?? u.email ?? "?", dept: u.department ?? "—", total, open, approved, locked }
    })
    .filter((r: UserRow) => r.total > 0)

  return (
    <div className="p-4 lg:p-6">
      {/* ヘッダー */}
      <div className="flex items-center gap-3 mb-1">
        <Link href={prevLink} className="p-2 rounded-lg hover:bg-gray-100 text-gray-500">◀</Link>
        <div className="text-center">
          <h1 className="text-base font-semibold text-gray-900">{year}年{month}月 勤怠承認</h1>
          <p className="text-[10px] text-gray-400">{periodStart}〜{periodEnd}</p>
        </div>
        <Link href={nextLink} className="p-2 rounded-lg hover:bg-gray-100 text-gray-500">▶</Link>
      </div>

      {/* カード一覧 */}
      <div className="space-y-3 mt-5">
        {rows.length === 0 && (
          <p className="text-center text-sm text-gray-400 py-8">打刻レコードがありません</p>
        )}
        {rows.map((r) => {
          const allLocked = r.locked === r.total
          return (
            <div key={r.id} className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium text-gray-900">{r.name}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{r.dept}</p>
                </div>
                {/* ステータスバッジ */}
                <div className="flex gap-1.5 flex-wrap justify-end">
                  {r.open     > 0 && <span className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-600">未承認 {r.open}</span>}
                  {r.approved > 0 && <span className="px-2 py-0.5 rounded-full text-xs bg-green-100 text-green-700">承認済 {r.approved}</span>}
                  {r.locked   > 0 && <span className="px-2 py-0.5 rounded-full text-xs bg-purple-100 text-purple-700">締め済 {r.locked}</span>}
                </div>
              </div>

              {/* アクションボタン */}
              <ApprovalActions
                userId={r.id}
                year={year}
                month={month}
                hasOpen={r.open > 0}
                hasApproved={r.approved > 0}
                isAdmin={isAdmin}
                allLocked={allLocked}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
