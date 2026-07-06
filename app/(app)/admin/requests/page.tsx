import { prisma } from "@/lib/prisma"
import Link from "next/link"
import { RequestsTable } from "./_components/RequestsTable"
import { getClosingPeriod, getDefaultClosingMonth } from "@/lib/closing"

type SearchParams = Promise<{ year?: string; month?: string }>

export default async function AdminRequestsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams
  const setting    = await prisma.setting.findUnique({ where: { id: 1 } })
  const closingDay = setting?.closingDay ?? 25
  const def    = getDefaultClosingMonth(closingDay)
  const year   = Number(params.year  ?? def.year)
  const month  = Number(params.month ?? def.month)

  // 処理済みの締め期間（前月 closingDay+1 日 〜 当月 closingDay 日の JST 終日まで）
  const { firstDay, lastDay: lastDayStart } = getClosingPeriod(year, month, closingDay)
  const lastDay = new Date(lastDayStart.getTime() + (14 * 60 + 59) * 60 * 1000 + 59999) // 締め日 23:59:59 JST

  const prevMonth = month === 1 ? 12 : month - 1
  const prevYear  = month === 1 ? year - 1 : year
  const nextMonth = month === 12 ? 1 : month + 1
  const nextYear  = month === 12 ? year + 1 : year
  const prevLink  = `/admin/requests?year=${prevYear}&month=${prevMonth}`
  const nextLink  = `/admin/requests?year=${nextYear}&month=${nextMonth}`

  const [pendingRaw, processedRaw] = await Promise.all([
    prisma.request.findMany({
      where:   { status: "PENDING" },
      orderBy: { createdAt: "asc" },
      include: { user: { select: { name: true, email: true } } },
    }),
    prisma.request.findMany({
      where: {
        status:     { in: ["APPROVED", "REJECTED"] },
        targetDate: { gte: firstDay, lte: lastDay },
      },
      orderBy: { targetDate: "desc" },
      include: { user: { select: { name: true, email: true } } },
    }),
  ])

  const serialize = <T extends typeof pendingRaw[number]>(r: T) => ({
    ...r,
    targetDate: r.targetDate.toISOString(),
    createdAt:  r.createdAt.toISOString(),
    detail:     r.detail as Record<string, string> | null,
  })

  const pending   = pendingRaw.map(serialize)
  const processed = processedRaw.map(serialize)

  return (
    <div className="p-4 lg:p-6">
      <h1 className="text-base font-semibold text-gray-900 mb-5">申請承認</h1>
      <RequestsTable
        pending={pending}
        processed={processed}
        processedNav={{ year, month, prevLink, nextLink }}
      />
    </div>
  )
}
