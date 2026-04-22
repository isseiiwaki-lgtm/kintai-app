import { prisma } from "@/lib/prisma"
import { notFound } from "next/navigation"
import { actionUpdateUser } from "../../actions"
import { DeleteUserButton } from "./DeleteUserButton"

type Params = Promise<{ id: string }>

// 15分刻みの時刻オプション
function timeOptions(startH: number, endH: number) {
  const opts: { value: string; label: string }[] = [{ value: "", label: "— 未設定 —" }]
  for (let h = startH; h <= endH; h++) {
    for (const m of [0, 15, 30, 45]) {
      const hh = String(h).padStart(2, "0")
      const mm = String(m).padStart(2, "0")
      opts.push({ value: `${hh}:${mm}`, label: `${hh}:${mm}` })
    }
  }
  return opts
}

const selectCls = "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"

export default async function UserEditPage({ params }: { params: Params }) {
  const { id } = await params
  const user   = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true, name: true, email: true,
      employeeCode: true, jobTitle: true, hireDate: true, salaryCode: true,
      role: true, employmentType: true,
      department: true, workStartTime: true, workEndTime: true,
      isActive: true,
    },
  })
  if (!user) notFound()

  const workTimes = timeOptions(6, 23)

  return (
    <div className="p-4 lg:p-6 max-w-lg">
      <div className="flex items-center gap-3 mb-5">
        <a href="/admin/users" className="text-gray-400 hover:text-gray-700 text-sm">← 一覧</a>
        <h1 className="text-base font-semibold text-gray-900">ユーザー編集</h1>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
        <div className="mb-4 pb-4 border-b border-gray-100">
          <p className="text-xs text-gray-400">{user.email}</p>
        </div>

        <form action={actionUpdateUser} className="space-y-4">
          <input type="hidden" name="id" value={user.id} />

          {/* 氏名 */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">氏名</label>
            <input type="text" name="name" defaultValue={user.name ?? ""}
              placeholder="例: 山田 太郎"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>

          {/* 従業員コード・役職 */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">従業員コード</label>
              <input type="text" name="employeeCode" defaultValue={user.employeeCode ?? ""}
                placeholder="例: EMP001"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">役職名</label>
              <input type="text" name="jobTitle" defaultValue={user.jobTitle ?? ""}
                placeholder="例: 主任"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>

          {/* 入社日・給与コード */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">入社日</label>
              <input type="date" name="hireDate"
                defaultValue={user.hireDate ? user.hireDate.toISOString().slice(0, 10) : ""}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">給与個人コード</label>
              <input type="text" name="salaryCode" defaultValue={user.salaryCode ?? ""}
                placeholder="給与ソフト連携用"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>

          {/* 権限 */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">権限</label>
            <select name="role" defaultValue={user.role}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="EMPLOYEE">一般</option>
              <option value="APPROVER">承認者</option>
              <option value="ADMIN">管理者</option>
            </select>
          </div>

          {/* 雇用形態 */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">雇用形態</label>
            <select name="employmentType" defaultValue={user.employmentType}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="full">社員</option>
              <option value="part">パート</option>
              <option value="employer">雇用者</option>
            </select>
          </div>

          {/* 部署 */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">部署</label>
            <input type="text" name="department" defaultValue={user.department ?? ""}
              placeholder="例: 営業課"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>

          {/* 勤務時間（15分刻み）*/}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">出勤時刻</label>
              <select name="workStartTime" defaultValue={user.workStartTime ?? ""} className={selectCls}>
                {workTimes.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">退勤時刻</label>
              <select name="workEndTime" defaultValue={user.workEndTime ?? ""} className={selectCls}>
                {workTimes.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>

          {/* 在籍状態 */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">在籍状態</label>
            <select name="isActive" defaultValue={user.isActive ? "true" : "false"}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="true">在籍中</option>
              <option value="false">退職</option>
            </select>
          </div>

          <button type="submit"
            className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors mt-2">
            保存
          </button>
        </form>

        <div className="mt-6 pt-5 border-t border-gray-100">
          <DeleteUserButton userId={user.id} />
        </div>
      </div>
    </div>
  )
}
