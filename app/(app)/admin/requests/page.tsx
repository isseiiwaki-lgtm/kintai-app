import { prisma } from "@/lib/prisma"
import { actionApproveRequest, actionRejectRequest } from "./actions"

const TYPE_LABEL: Record<string, string> = {
  OVERTIME: "残業申請",
  ABSENCE:  "遅刻・早退",
  LEAVE:    "休暇申請",
  COMMENT:  "修正依頼",
  OTHER:    "その他",
}

const STATUS_LABEL: Record<string, { label: string; className: string }> = {
  PENDING:  { label: "審査中", className: "bg-yellow-100 text-yellow-700" },
  APPROVED: { label: "承認済", className: "bg-green-100  text-green-700"  },
  REJECTED: { label: "却下",   className: "bg-red-100    text-red-600"    },
}

function detailSummary(type: string, detail: unknown): string {
  const d = detail as Record<string, string> | null
  if (!d) return ""
  switch (type) {
    case "OVERTIME": return d.endTime ? `終了: ${d.endTime}` : ""
    case "ABSENCE":  return `${d.absenceType === "late" ? "遅刻" : "早退"} ${d.time ?? ""}`
    case "LEAVE": {
      const lt = d.leaveType === "substitute" ? "代休" : "有給"
      const hd = d.halfDay === "am" ? "（午前）" : d.halfDay === "pm" ? "（午後）" : ""
      const wb = d.workDate ? ` ← ${d.workDate}` : ""
      return `${lt}${hd}${wb}`
    }
    default: return ""
  }
}

export default async function AdminRequestsPage() {
  const requests = await prisma.request.findMany({
    orderBy: { createdAt: "desc" },
    include: { user: { select: { name: true, email: true } } },
  })

  type Req = typeof requests[number]
  const pending  = requests.filter((r: Req) => r.status === "PENDING")
  const resolved = requests.filter((r: Req) => r.status !== "PENDING")

  const Row = ({ r, showActions }: { r: typeof requests[0]; showActions: boolean }) => {
    const status  = STATUS_LABEL[r.status] ?? STATUS_LABEL.PENDING
    const tgt     = new Date(r.targetDate.getTime() + 9 * 60 * 60 * 1000)
    const tgtStr  = `${tgt.getUTCFullYear()}/${String(tgt.getUTCMonth() + 1).padStart(2, "0")}/${String(tgt.getUTCDate()).padStart(2, "0")}`
    return (
      <tr className="border-b border-gray-50 last:border-0 hover:bg-gray-50">
        <td className="px-4 py-2.5 text-gray-800 font-medium">{r.user.name ?? r.user.email}</td>
        <td className="px-3 py-2.5 text-gray-700">{TYPE_LABEL[r.type] ?? r.type}</td>
        <td className="px-3 py-2.5 text-gray-600 font-mono text-xs">{tgtStr}</td>
        <td className="px-3 py-2.5 text-gray-500 text-xs">{detailSummary(r.type, r.detail)}</td>
        <td className="px-3 py-2.5 text-gray-500 text-xs max-w-[160px] truncate">{r.reason ?? ""}</td>
        <td className="px-3 py-2.5 text-center">
          <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${status.className}`}>
            {status.label}
          </span>
        </td>
        {showActions && (
          <td className="px-3 py-2.5">
            <div className="flex gap-1.5">
              <form action={actionApproveRequest.bind(null, r.id)}>
                <button type="submit" className="px-2.5 py-1 rounded text-xs font-medium bg-green-600 hover:bg-green-700 text-white transition-colors">
                  承認
                </button>
              </form>
              <form action={actionRejectRequest.bind(null, r.id)}>
                <button type="submit" className="px-2.5 py-1 rounded text-xs font-medium bg-red-500 hover:bg-red-600 text-white transition-colors">
                  却下
                </button>
              </form>
            </div>
          </td>
        )}
      </tr>
    )
  }

  const TableHeader = ({ showActions }: { showActions: boolean }) => (
    <tr className="border-b border-gray-100 text-xs text-gray-400 bg-gray-50">
      <th className="text-left px-4 py-3 font-medium">申請者</th>
      <th className="text-left px-3 py-3 font-medium">種別</th>
      <th className="text-left px-3 py-3 font-medium">対象日</th>
      <th className="text-left px-3 py-3 font-medium">内容</th>
      <th className="text-left px-3 py-3 font-medium">理由</th>
      <th className="text-center px-3 py-3 font-medium">状態</th>
      {showActions && <th className="px-3 py-3"></th>}
    </tr>
  )

  return (
    <div className="p-4 lg:p-6">
      <h1 className="text-base font-semibold text-gray-900 mb-5">申請承認</h1>

      {/* 審査中 */}
      <h2 className="text-sm font-medium text-gray-700 mb-2">審査中 ({pending.length}件)</h2>
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto mb-6">
        <table className="w-full text-sm min-w-[640px]">
          <thead><TableHeader showActions={true} /></thead>
          <tbody>
            {pending.length === 0
              ? <tr><td colSpan={7} className="px-4 py-6 text-center text-sm text-gray-400">審査中の申請はありません</td></tr>
              : pending.map((r) => <Row key={r.id} r={r} showActions={true} />)
            }
          </tbody>
        </table>
      </div>

      {/* 処理済み */}
      <h2 className="text-sm font-medium text-gray-700 mb-2">処理済み ({resolved.length}件)</h2>
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
        <table className="w-full text-sm min-w-[560px]">
          <thead><TableHeader showActions={false} /></thead>
          <tbody>
            {resolved.length === 0
              ? <tr><td colSpan={6} className="px-4 py-6 text-center text-sm text-gray-400">処理済みの申請はありません</td></tr>
              : resolved.map((r) => <Row key={r.id} r={r} showActions={false} />)
            }
          </tbody>
        </table>
      </div>
    </div>
  )
}
