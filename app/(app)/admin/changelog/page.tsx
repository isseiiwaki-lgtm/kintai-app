import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { notFound } from "next/navigation"
import Link from "next/link"

type SearchParams = Promise<{ year?: string; month?: string }>

const FIELD_LABEL: Record<string, string> = {
  clockIn:    "出勤",
  clockOut:   "退勤",
  goOutAt:    "外出",
  returnAt:   "戻り",
  breakStart: "休憩開始",
  breakEnd:   "休憩終了",
}

function toJST(dt: Date) {
  return new Date(dt.getTime() + 9 * 60 * 60 * 1000)
}

function formatDateTime(dt: Date) {
  const j = toJST(dt)
  return `${j.getUTCFullYear()}/${String(j.getUTCMonth() + 1).padStart(2, "0")}/${String(j.getUTCDate()).padStart(2, "0")} ${String(j.getUTCHours()).padStart(2, "0")}:${String(j.getUTCMinutes()).padStart(2, "0")}`
}

function formatDate(dt: Date) {
  const j = toJST(dt)
  return `${j.getUTCMonth() + 1}/${j.getUTCDate()}`
}

export default async function ChangeLogPage({ searchParams }: { searchParams: SearchParams }) {
  const session = await auth()
  const role    = session?.user?.role
  if (role !== "ADMIN" && role !== "APPROVER") notFound()

  const params = await searchParams
  const now    = toJST(new Date())
  const year   = Number(params.year  ?? now.getUTCFullYear())
  const month  = Number(params.month ?? now.getUTCMonth() + 1)

  const firstDay = new Date(Date.UTC(year, month - 1, 1))
  const lastDay  = new Date(Date.UTC(year, month, 0, 14, 59, 59, 999))

  const prevMonth = month === 1 ? 12 : month - 1
  const prevYear  = month === 1 ? year - 1 : year
  const nextMonth = month === 12 ? 1 : month + 1
  const nextYear  = month === 12 ? year + 1 : year

  const logs = await prisma.attendanceChangeLog.findMany({
    where:   { changedAt: { gte: firstDay, lte: lastDay } },
    orderBy: { changedAt: "desc" },
    include: {
      changedBy: { select: { name: true, email: true } },
      record:    { include: { user: { select: { name: true, email: true } } } },
    },
  })

  return (
    <div className="p-4 lg:p-6">
      <div className="flex items-center gap-3 mb-5">
        <Link href={`/admin/changelog?year=${prevYear}&month=${prevMonth}`}
          className="p-2 rounded-lg hover:bg-gray-100 text-gray-500">◀</Link>
        <h1 className="text-base font-semibold text-gray-900">{year}年{month}月 変更履歴</h1>
        <Link href={`/admin/changelog?year=${nextYear}&month=${nextMonth}`}
          className="p-2 rounded-lg hover:bg-gray-100 text-gray-500">▶</Link>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
        <table className="w-full text-sm min-w-[700px]">
          <thead>
            <tr className="border-b border-gray-100 text-xs text-gray-400 bg-gray-50">
              <th className="text-left px-4 py-3 font-medium">変更日時</th>
              <th className="text-left px-3 py-3 font-medium">変更者</th>
              <th className="text-left px-3 py-3 font-medium">対象者</th>
              <th className="text-center px-3 py-3 font-medium">対象日</th>
              <th className="text-center px-3 py-3 font-medium">項目</th>
              <th className="text-center px-3 py-3 font-medium">変更前</th>
              <th className="text-center px-3 py-3 font-medium">変更後</th>
            </tr>
          </thead>
          <tbody>
            {logs.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-sm text-gray-400">
                  この月の変更履歴はありません
                </td>
              </tr>
            ) : logs.map((log) => {
              const changedByName = log.changedBy.name ?? log.changedBy.email
              const targetName    = log.record.user.name ?? log.record.user.email
              const targetDate    = formatDate(log.record.date)
              return (
                <tr key={log.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50">
                  <td className="px-4 py-2.5 text-gray-600 text-xs font-mono whitespace-nowrap">
                    {formatDateTime(log.changedAt)}
                  </td>
                  <td className="px-3 py-2.5 text-gray-800 font-medium">{changedByName}</td>
                  <td className="px-3 py-2.5 text-gray-600">{targetName}</td>
                  <td className="px-3 py-2.5 text-center text-gray-600 font-mono">{targetDate}</td>
                  <td className="px-3 py-2.5 text-center">
                    <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
                      {FIELD_LABEL[log.fieldName] ?? log.fieldName}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-center font-mono text-gray-400 text-xs">
                    {log.oldValue ?? "—"}
                  </td>
                  <td className="px-3 py-2.5 text-center font-mono text-blue-700 text-xs font-medium">
                    {log.newValue ?? "—"}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
