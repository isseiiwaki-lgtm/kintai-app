import { prisma } from "@/lib/prisma"
import Link from "next/link"

const ROLE_LABEL: Record<string, { label: string; className: string }> = {
  EMPLOYEE: { label: "一般",   className: "bg-gray-100 text-gray-600" },
  APPROVER: { label: "承認者", className: "bg-blue-100 text-blue-700" },
  ADMIN:    { label: "管理者", className: "bg-purple-100 text-purple-700" },
}

export default async function AdminUsersPage() {
  const users = await prisma.user.findMany({
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
    select: {
      id: true, name: true, email: true,
      role: true, employmentType: true,
      department: true, workStartTime: true, workEndTime: true,
      isActive: true,
    },
  })

  return (
    <div className="p-4 lg:p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-base font-semibold text-gray-900">ユーザー管理</h1>
        <Link
          href="/admin/users/new"
          className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
        >
          + 新規登録
        </Link>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
        <table className="w-full text-sm min-w-[640px]">
          <thead>
            <tr className="border-b border-gray-100 text-xs text-gray-400 bg-gray-50">
              <th className="text-left px-4 py-3 font-medium">氏名</th>
              <th className="text-left px-3 py-3 font-medium">メール</th>
              <th className="text-center px-3 py-3 font-medium">権限</th>
              <th className="text-center px-3 py-3 font-medium">雇用形態</th>
              <th className="text-left px-3 py-3 font-medium">部署</th>
              <th className="text-center px-3 py-3 font-medium">勤務時間</th>
              <th className="text-center px-3 py-3 font-medium">状態</th>
              <th className="px-3 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const roleInfo = ROLE_LABEL[u.role] ?? ROLE_LABEL.EMPLOYEE
              return (
                <tr key={u.id} className={`border-b border-gray-50 last:border-0 hover:bg-gray-50 ${!u.isActive ? "opacity-50" : ""}`}>
                  <td className="px-4 py-2.5 font-medium text-gray-800">{u.name ?? "—"}</td>
                  <td className="px-3 py-2.5 text-gray-500 text-xs">{u.email}</td>
                  <td className="px-3 py-2.5 text-center">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${roleInfo.className}`}>
                      {roleInfo.label}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <span className={`inline-block px-2 py-0.5 rounded text-xs ${u.employmentType === "full" ? "bg-blue-50 text-blue-700" : "bg-orange-50 text-orange-700"}`}>
                      {u.employmentType === "full" ? "社員" : "パート"}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-gray-500 text-xs">{u.department ?? "—"}</td>
                  <td className="px-3 py-2.5 text-center text-xs text-gray-500 font-mono">
                    {u.workStartTime && u.workEndTime ? `${u.workStartTime}〜${u.workEndTime}` : "—"}
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    {u.isActive
                      ? <span className="text-xs text-green-600">在籍</span>
                      : <span className="text-xs text-gray-400">退職</span>}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <Link
                      href={`/admin/users/${u.id}/edit`}
                      className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                    >
                      編集
                    </Link>
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
