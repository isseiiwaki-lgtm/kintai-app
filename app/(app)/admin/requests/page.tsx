import { prisma } from "@/lib/prisma"
import { RequestsTable } from "./_components/RequestsTable"

export default async function AdminRequestsPage() {
  const raw = await prisma.request.findMany({
    orderBy: { createdAt: "desc" },
    include: { user: { select: { name: true, email: true } } },
  })

  const requests = raw.map(r => ({
    ...r,
    targetDate: r.targetDate.toISOString(),
    createdAt:  r.createdAt.toISOString(),
    detail:     r.detail as Record<string, string> | null,
  }))

  return (
    <div className="p-4 lg:p-6">
      <h1 className="text-base font-semibold text-gray-900 mb-5">申請承認</h1>
      <RequestsTable requests={requests} />
    </div>
  )
}
