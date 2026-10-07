import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import { RequestsTable } from "./_components/RequestsTable"
import { getClosingPeriod, getDefaultClosingMonth } from "@/lib/closing"
import { getCurrentStep, isStepApprover, approvalProgress, type RouteStep } from "@/lib/approval"

type SearchParams = Promise<{ year?: string; month?: string; sort?: string }>

export default async function AdminRequestsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams
  const session = await auth()
  const sessionUserId = session?.user?.id ?? ""
  const isAdmin = session?.user?.role === "ADMIN"

  const setting    = await prisma.setting.findUnique({ where: { id: 1 } })
  const closingDay = setting?.closingDay ?? 25
  const def    = getDefaultClosingMonth(closingDay)
  const year   = Number(params.year  ?? def.year)
  const month  = Number(params.month ?? def.month)
  const sort   = params.sort === "date" ? "date" as const : "user" as const // 既定は申請者順

  // 処理済みの締め期間（前月 closingDay+1 日 〜 当月 closingDay 日の JST 終日まで）
  const { firstDay, lastDay: lastDayStart } = getClosingPeriod(year, month, closingDay)
  const lastDay = new Date(lastDayStart.getTime() + (14 * 60 + 59) * 60 * 1000 + 59999) // 締め日 23:59:59 JST

  const prevMonth = month === 1 ? 12 : month - 1
  const prevYear  = month === 1 ? year - 1 : year
  const nextMonth = month === 12 ? 1 : month + 1
  const nextYear  = month === 12 ? year + 1 : year
  const prevLink  = `/admin/requests?year=${prevYear}&month=${prevMonth}&sort=${sort}`
  const nextLink  = `/admin/requests?year=${nextYear}&month=${nextMonth}&sort=${sort}`
  const sortUserLink = `/admin/requests?year=${year}&month=${month}&sort=user`
  const sortDateLink = `/admin/requests?year=${year}&month=${month}&sort=date`

  const [pendingRaw, processedRaw, routesRaw] = await Promise.all([
    prisma.request.findMany({
      where:   { status: "PENDING" },
      orderBy: { createdAt: "asc" },
      include: {
        user:      { select: { name: true, email: true, department: true, employmentType: true } },
        approvals: { select: { step: true, action: true } },
      },
    }),
    prisma.request.findMany({
      where: {
        status:     { in: ["APPROVED", "REJECTED"] },
        targetDate: { gte: firstDay, lte: lastDay },
      },
      // 対象日降順で取得 → 申請者順表示時は下で従業員コード数値昇順に安定ソート（対象日降順は維持）
      orderBy: [{ targetDate: "desc" as const }],
      include: { user: { select: { name: true, email: true, employeeCode: true, employmentType: true } } },
    }),
    prisma.approvalRoute.findMany({ select: { department: true, step: true, approverId: true } }),
  ])

  // 部署 → 承認経路
  const routesByDept = new Map<string, RouteStep[]>()
  for (const r of routesRaw) {
    const list = routesByDept.get(r.department) ?? []
    list.push({ step: r.step, approverId: r.approverId })
    routesByDept.set(r.department, list)
  }

  const pending = pendingRaw.map(r => {
    const route = (r.user.department && routesByDept.get(r.user.department)) || []
    const cur = getCurrentStep(route, r.approvals)
    const progress = approvalProgress(route, r.approvals)
    // 承認可否: ADMIN は常に可。経路ありは現在ステップ担当者のみ、経路なしは従来どおり APPROVER も可
    const canApprove =
      isAdmin ||
      (route.length > 0
        ? cur !== null && isStepApprover(route, cur, sessionUserId)
        : true)
    return {
      id:         r.id,
      type:       r.type as string,
      status:     r.status as string,
      targetDate: r.targetDate.toISOString(),
      createdAt:  r.createdAt.toISOString(),
      reason:     r.reason,
      detail:     r.detail as Record<string, string> | null,
      user:       { name: r.user.name, email: r.user.email, employmentType: r.user.employmentType },
      approvalDone:  route.length > 0 ? progress.done  : null,
      approvalTotal: route.length > 0 ? progress.total : null,
      canApprove,
      canForce: isAdmin && route.length > 0 && progress.total - progress.done > 1, // 残り2ステップ以上で飛び越しに意味がある
    }
  })

  // 申請者順: 従業員コード数値昇順で安定ソート（同一人は取得順＝対象日降順のまま維持）
  // employeeCode は文字列型のため文字列比較だと "10" が "2" より前に来る → export-xlsx と同じ数値変換ソートに統一
  if (sort === "user") {
    processedRaw.sort((a, b) => {
      const na = parseInt(a.user.employeeCode ?? "", 10)
      const nb = parseInt(b.user.employeeCode ?? "", 10)
      if (!isNaN(na) && !isNaN(nb)) return na - nb
      return (a.user.employeeCode ?? "").localeCompare(b.user.employeeCode ?? "")
    })
  }

  const processed = processedRaw.map(r => ({
    id:         r.id,
    type:       r.type as string,
    status:     r.status as string,
    targetDate: r.targetDate.toISOString(),
    createdAt:  r.createdAt.toISOString(),
    reason:     r.reason,
    detail:     r.detail as Record<string, string> | null,
    user:       { name: r.user.name, email: r.user.email, employmentType: r.user.employmentType },
  }))

  return (
    <div className="p-4 lg:p-6">
      <h1 className="text-base font-semibold text-gray-900 mb-5">申請承認</h1>
      <RequestsTable
        pending={pending}
        processed={processed}
        processedNav={{ year, month, prevLink, nextLink, sort, sortUserLink, sortDateLink }}
      />
    </div>
  )
}
