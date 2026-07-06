import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { actionUpsertRoute, actionDeleteRoute } from "./actions"

/**
 * 承認経路管理（ADMIN 専用）
 * 部署ごとに step 昇順の承認経路を設定する。経路を設定した部署の申請は
 * step1 → step2 … の順に担当承認者が承認し、最終ステップ承認で確定する。
 * 経路未設定の部署は従来どおり一段階承認。
 */
export default async function ApprovalRoutesPage() {
  const session = await auth()
  if (session?.user?.role !== "ADMIN") redirect("/")

  const [routes, approverUsers, departments] = await Promise.all([
    prisma.approvalRoute.findMany({
      orderBy: [{ department: "asc" }, { step: "asc" }],
      include: { approver: { select: { name: true, email: true, role: true } } },
    }),
    // 承認者候補: 申請承認画面へアクセスできる ADMIN / APPROVER のみ
    prisma.user.findMany({
      where:   { isActive: true, role: { in: ["ADMIN", "APPROVER"] } },
      orderBy: { name: "asc" },
      select:  { id: true, name: true, email: true, role: true },
    }),
    prisma.user.findMany({
      where:    { isActive: true, department: { not: null } },
      distinct: ["department"],
      select:   { department: true },
      orderBy:  { department: "asc" },
    }),
  ])

  // 部署ごとにグルーピング
  const byDept = new Map<string, typeof routes>()
  for (const r of routes) {
    const list = byDept.get(r.department) ?? []
    list.push(r)
    byDept.set(r.department, list)
  }

  const inputClass = "border border-gray-200 rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:border-blue-400"

  return (
    <div className="p-4 lg:p-6 max-w-3xl">
      <h1 className="text-base font-semibold text-gray-900 mb-1">承認経路（申請承認の多段階化）</h1>
      <p className="text-xs text-gray-500 mb-5">
        経路を設定した部署の申請は step 順に承認が必要になります（最終ステップの承認で確定）。
        未設定の部署は従来どおり一段階承認です。承認者に指定できるのは ADMIN / APPROVER のみ。
      </p>

      {/* 既存経路 */}
      <div className="space-y-4 mb-8">
        {byDept.size === 0 && (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm px-4 py-6 text-center text-sm text-gray-400">
            承認経路は未設定です（全部署が一段階承認）
          </div>
        )}
        {[...byDept.entries()].map(([dept, list]) => (
          <div key={dept} className="bg-white rounded-xl border border-gray-200 shadow-sm">
            <div className="px-4 py-2.5 border-b border-gray-100 text-sm font-medium text-gray-800">{dept}</div>
            <table className="w-full text-sm">
              <tbody>
                {list.map(r => (
                  <tr key={r.id} className="border-b border-gray-50 last:border-0">
                    <td className="px-4 py-2 w-24 text-gray-500 text-xs">step {r.step}{r.step === Math.max(...list.map(x => x.step)) ? "（決裁）" : ""}</td>
                    <td className="px-3 py-2 text-gray-800">{r.approver.name ?? r.approver.email}</td>
                    <td className="px-3 py-2 text-gray-400 text-xs">{r.approver.role}</td>
                    <td className="px-3 py-2 w-20 text-right">
                      <form action={actionDeleteRoute.bind(null, r.id)}>
                        <button type="submit" className="px-2.5 py-1 rounded text-xs font-medium bg-white border border-red-300 hover:bg-red-50 text-red-500 transition-colors">
                          削除
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>

      {/* 追加フォーム */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm px-4 py-4">
        <h2 className="text-sm font-medium text-gray-700 mb-3">経路を追加 / 変更（同じ部署×stepは上書き）</h2>
        <form action={actionUpsertRoute} className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">部署</label>
            <select name="department" required className={inputClass}>
              {departments.map(d => (
                <option key={d.department} value={d.department!}>{d.department}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">step</label>
            <select name="step" required className={inputClass}>
              {[1, 2, 3].map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">承認者</label>
            <select name="approverId" required className={inputClass}>
              {approverUsers.map(u => (
                <option key={u.id} value={u.id}>{u.name ?? u.email}（{u.role}）</option>
              ))}
            </select>
          </div>
          <button type="submit" className="px-4 py-1.5 text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors">
            保存
          </button>
        </form>
      </div>
    </div>
  )
}
