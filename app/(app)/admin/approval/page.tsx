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
  const year    = Number(params.year  ?? now.getUTCFullYear())
  const month   = Number(params.month ?? now.getUTCMonth() + 1)

  const firstDay = new Date(Date.UTC(year, month - 1, 1))
  const lastDay  = new Date(Date.UTC(year, month,     0))

  const prevDate = new Date(Date.UTC(year, month - 2, 1))
  const nextDate = new Date(Date.UTC(year, month,     1))
  const prevLink = `/admin/approval?year=${prevDate.getUTCFullYear()}&month=${prevDate.getUTCMonth() + 1}`
  const nextLink = `/admin/approval?year=${nextDate.getUTCFullYear()}&month=${nextDate.getUTCMonth() + 1}`

  const users = await prisma.user.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
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
    submitted: number
    approved: number
    locked: number
  }

  const rows: UserRow[] = users
    .map((u) => {
      const recs     = u.attendanceRecords
      const total    = recs.length
      const open     = recs.filter((r) => r.status === "OPEN").length
      const submitted= recs.filter((r) => r.status === "SUBMITTED").length
      const approved = recs.filter((r) => r.status === "APPROVED").length
      const locked   = recs.filter((r) => r.status === "LOCKED").length
      return { id: u.id, name: u.name ?? u.email ?? "?", dept: u.department ?? "—", total, open, submitted, approved, locked }
    })
    .filter((r) => r.total > 0)

  return (
    <div className="p-4 lg:p-6">
      {/* ヘッダー */}
      <div className="flex items-center gap-3 mb-5">
        <Link href={prevLink} className="p-2 rounded-lg hover:bg-gray-100 text-gray-500">◀</Link>
        <h1 className="text-base font-semibold text-gray-900">{year}年{month}月 勤怠承認</h1>
        <Link href={nextLink} className="p-2 rounded-lg hover:bg-gray-100 text-gray-500">▶</Link>
      </div>

      {/* カード一覧 */}
      <div className="space-y-3">
        {rows.length === 0 && (
          <p className="text-center text-sm text-gray-400 py-8">打刻レコードがありません</p>
        )}
        {rows.map((r) => {
          const allApproved = r.submitted === 0 && r.open === 0 && r.approved + r.locked === r.total
          const allLocked   = r.locked === r.total
          return (
            <div key={r.id} className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium text-gray-900">{r.name}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{r.dept}</p>
                </div>
                {/* ステータスバッジ */}
                <div className="flex gap-1.5 flex-wrap justify-end">
                  {r.open       > 0 && <span className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-600">未確認 {r.open}</span>}
                  {r.submitted  > 0 && <span className="px-2 py-0.5 rounded-full text-xs bg-blue-100 text-blue-700">提出済 {r.submitted}</span>}
                  {r.approved   > 0 && <span className="px-2 py-0.5 rounded-full text-xs bg-green-100 text-green-700">承認済 {r.approved}</span>}
                  {r.locked     > 0 && <span className="px-2 py-0.5 rounded-full text-xs bg-purple-100 text-purple-700">締め済 {r.locked}</span>}
                </div>
              </div>

              {/* アクションボタン */}
              <ApprovalActions
                userId={r.id}
                year={year}
                month={month}
                hasSubmitted={r.submitted > 0}
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
