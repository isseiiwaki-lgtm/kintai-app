import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import Link from "next/link"
import { actionCancelRequest } from "./actions"

const TYPE_LABEL: Record<string, string> = {
  OVERTIME: "残業申請",
  ABSENCE:  "遅刻・早退",
  LEAVE:    "休暇申請",
  COMMENT:  "修正依頼",
  OTHER:    "その他",
}

const STATUS_LABEL: Record<string, { label: string; className: string }> = {
  PENDING:  { label: "審査中",   className: "bg-yellow-100 text-yellow-700" },
  APPROVED: { label: "承認済",   className: "bg-green-100  text-green-700"  },
  REJECTED: { label: "却下",     className: "bg-red-100    text-red-600"    },
}

function detailSummary(type: string, detail: unknown): string {
  const d = detail as Record<string, string> | null
  if (!d) return ""
  switch (type) {
    case "OVERTIME": return d.endTime ? `残業終了: ${d.endTime}` : ""
    case "ABSENCE":  return `${d.absenceType === "late" ? "遅刻" : "早退"} ${d.time ?? ""}`
    case "LEAVE": {
      const lt = d.leaveType === "substitute" ? "代休" : "有給"
      const hd = d.halfDay === "am" ? "（午前）" : d.halfDay === "pm" ? "（午後）" : ""
      return `${lt}${hd}`
    }
    default: return ""
  }
}

export default async function RequestsPage() {
  const session = await auth()
  const userId  = session!.user!.id!

  const requests = await prisma.request.findMany({
    where:   { userId },
    orderBy: { createdAt: "desc" },
  })

  return (
    <div className="p-4 lg:p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-base font-semibold text-gray-900">申請</h1>
        <Link
          href="/requests/new"
          className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
        >
          + 新規申請
        </Link>
      </div>

      {requests.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-8 text-center text-sm text-gray-400">
          申請はありません
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
          <table className="w-full text-sm min-w-[560px]">
            <thead>
              <tr className="border-b border-gray-100 text-xs text-gray-400 bg-gray-50">
                <th className="text-left px-4 py-3 font-medium">申請日</th>
                <th className="text-left px-3 py-3 font-medium">種別</th>
                <th className="text-left px-3 py-3 font-medium">対象日</th>
                <th className="text-left px-3 py-3 font-medium">内容</th>
                <th className="text-center px-3 py-3 font-medium">状態</th>
                <th className="px-3 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {requests.map((r) => {
                const status = STATUS_LABEL[r.status] ?? STATUS_LABEL.PENDING
                const tgt    = new Date(r.targetDate.getTime() + 9 * 60 * 60 * 1000)
                const tgtStr = `${tgt.getUTCFullYear()}/${String(tgt.getUTCMonth() + 1).padStart(2, "0")}/${String(tgt.getUTCDate()).padStart(2, "0")}`
                const createdAt = new Date(r.createdAt.getTime() + 9 * 60 * 60 * 1000)
                const createdStr = `${createdAt.getUTCMonth() + 1}/${createdAt.getUTCDate()}`
                return (
                  <tr key={r.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50">
                    <td className="px-4 py-2.5 text-gray-500 text-xs">{createdStr}</td>
                    <td className="px-3 py-2.5 text-gray-800">{TYPE_LABEL[r.type] ?? r.type}</td>
                    <td className="px-3 py-2.5 text-gray-600 font-mono text-xs">{tgtStr}</td>
                    <td className="px-3 py-2.5 text-gray-500 text-xs">{detailSummary(r.type, r.detail)}</td>
                    <td className="px-3 py-2.5 text-center">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${status.className}`}>
                        {status.label}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      {r.status === "PENDING" && (
                        <form action={actionCancelRequest.bind(null, r.id)}>
                          <button type="submit" className="text-xs text-red-400 hover:text-red-600">
                            取消
                          </button>
                        </form>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
