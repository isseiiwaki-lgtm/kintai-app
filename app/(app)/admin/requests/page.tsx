import { prisma } from "@/lib/prisma"
import Link from "next/link"
import { RequestsTable } from "./_components/RequestsTable"

type SearchParams = Promise<{ year?: string; month?: string }>

function toJST(dt: Date) {
  return new Date(dt.getTime() + 9 * 60 * 60 * 1000)
}

export default async function AdminRequestsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams
  const now    = toJST(new Date())
  const year   = Number(params.year  ?? now.getUTCFullYear())
  const month  = Number(params.month ?? now.getUTCMonth() + 1)

  // 処理済みの月範囲（JST 月初〜月末）
  const firstDay = new Date(Date.UTC(year, month - 1, 1))
  const lastDay  = new Date(Date.UTC(year, month, 0, 14, 59, 59, 999)) // 月末 23:59:59 JST = UTC+14:59:59

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
