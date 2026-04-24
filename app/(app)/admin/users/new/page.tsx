import { actionCreateUser } from "../actions"

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

export default function NewUserPage() {
  const workTimes = timeOptions(6, 23)

  return (
    <div className="p-4 lg:p-6 max-w-lg">
      <div className="flex items-center gap-3 mb-5">
        <a href="/admin/users" className="text-gray-400 hover:text-gray-700 text-sm">← 一覧</a>
        <h1 className="text-base font-semibold text-gray-900">ユーザー事前登録</h1>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
        <p className="text-xs text-gray-500 mb-4 leading-relaxed">
          会社のメールアドレスで事前登録しておくと、本人がそのアドレスの Google アカウントでログインした際に自動で紐づけされます。
        </p>

        <form action={actionCreateUser as (fd: FormData) => Promise<void>} className="space-y-4">
          {/* メールアドレス */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              メールアドレス <span className="text-red-500">*</span>
            </label>
            <input type="email" name="email" required
              placeholder="例: yamada@company.com"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>

          {/* 氏名 */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">氏名</label>
            <input type="text" name="name"
              placeholder="例: 山田 太郎"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>

          {/* 権限 */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">権限</label>
            <select name="role" defaultValue="EMPLOYEE"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="EMPLOYEE">一般</option>
              <option value="APPROVER">承認者</option>
              <option value="ADMIN">管理者</option>
            </select>
          </div>

          {/* 雇用形態 */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">雇用形態</label>
            <select name="employmentType" defaultValue="full"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="full">社員</option>
              <option value="part">パート</option>
              <option value="employer">雇用者</option>
            </select>
          </div>

          {/* 部署 */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">部署</label>
            <input type="text" name="department"
              placeholder="例: 営業課"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>

          {/* 勤務時間（15分刻み）*/}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">出勤時刻</label>
              <select name="workStartTime" defaultValue="" className={selectCls}>
                {workTimes.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">退勤時刻</label>
              <select name="workEndTime" defaultValue="" className={selectCls}>
                {workTimes.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>

          {/* 所定出勤曜日 */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-2">所定出勤曜日</label>
            <div className="flex gap-3">
              {([
                { name: "workSun", label: "日", defaultChecked: false },
                { name: "workMon", label: "月", defaultChecked: true  },
                { name: "workTue", label: "火", defaultChecked: true  },
                { name: "workWed", label: "水", defaultChecked: true  },
                { name: "workThu", label: "木", defaultChecked: true  },
                { name: "workFri", label: "金", defaultChecked: true  },
                { name: "workSat", label: "土", defaultChecked: false },
              ] as const).map(({ name, label, defaultChecked }) => (
                <label key={name} className="flex flex-col items-center gap-1 cursor-pointer">
                  <input type="checkbox" name={name} defaultChecked={defaultChecked} className="w-4 h-4 accent-blue-600" />
                  <span className="text-xs text-gray-600">{label}</span>
                </label>
              ))}
            </div>
          </div>

          <button type="submit"
            className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors mt-2">
            登録
          </button>
        </form>
      </div>
    </div>
  )
}
