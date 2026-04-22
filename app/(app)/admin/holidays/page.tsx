import { prisma } from "@/lib/prisma"
import { actionCreateHoliday, actionDeleteHoliday, actionSeedNationalHolidays } from "./actions"

const TYPE_LABEL: Record<string, { label: string; className: string }> = {
  NATIONAL:   { label: "祝日",       className: "bg-red-50 text-red-600" },
  COMPANY:    { label: "会社休日",   className: "bg-blue-50 text-blue-600" },
  SUBSTITUTE: { label: "振替休日",   className: "bg-orange-50 text-orange-600" },
}

function toJST(date: Date) {
  return new Date(date.getTime() + 9 * 60 * 60 * 1000)
}

export default async function HolidaysPage() {
  const holidays = await prisma.holiday.findMany({
    orderBy: { date: "asc" },
  })

  // 年ごとにグループ化
  const byYear = new Map<number, typeof holidays>()
  for (const h of holidays) {
    const y = toJST(h.date).getUTCFullYear()
    if (!byYear.has(y)) byYear.set(y, [])
    byYear.get(y)!.push(h)
  }

  const currentYear = new Date().getFullYear()

  return (
    <div className="p-4 lg:p-6 max-w-2xl">
      <h1 className="text-base font-semibold text-gray-900 mb-5">休日カレンダー</h1>

      {/* 祝日一括シード */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 mb-6">
        <p className="text-xs font-medium text-gray-600 mb-2">祝日を一括登録（年単位）</p>
        <form action={actionSeedNationalHolidays} className="flex gap-2 items-center">
          <select name="year" defaultValue={currentYear}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            {[currentYear - 1, currentYear, currentYear + 1].map((y) => (
              <option key={y} value={y}>{y}年</option>
            ))}
          </select>
          <button type="submit"
            className="px-3 py-2 bg-gray-700 hover:bg-gray-800 text-white text-sm font-medium rounded-lg transition-colors">
            祝日をシード
          </button>
          <span className="text-xs text-gray-400">※既存レコードは上書き</span>
        </form>
      </div>

      {/* 手動追加フォーム */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 mb-6">
        <p className="text-xs font-medium text-gray-600 mb-2">休日を追加</p>
        <form action={actionCreateHoliday} className="flex flex-wrap gap-2 items-end">
          <div>
            <label className="block text-xs text-gray-500 mb-1">日付</label>
            <input type="date" name="date" required
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">名称</label>
            <input type="text" name="name" required placeholder="例: 夏季休業"
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-40" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">種別</label>
            <select name="type" defaultValue="COMPANY"
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="NATIONAL">祝日</option>
              <option value="COMPANY">会社休日</option>
              <option value="SUBSTITUTE">振替休日</option>
            </select>
          </div>
          <button type="submit"
            className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors">
            追加
          </button>
        </form>
      </div>

      {/* 休日一覧（年別）*/}
      {byYear.size === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-8 text-center text-sm text-gray-400">
          登録された休日はありません
        </div>
      ) : (
        Array.from(byYear.entries()).sort((a, b) => b[0] - a[0]).map(([year, items]) => (
          <div key={year} className="mb-6">
            <h2 className="text-sm font-medium text-gray-700 mb-2">{year}年（{items.length}件）</h2>
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-xs text-gray-400 bg-gray-50">
                    <th className="text-left px-4 py-3 font-medium">日付</th>
                    <th className="text-left px-3 py-3 font-medium">名称</th>
                    <th className="text-left px-3 py-3 font-medium">種別</th>
                    <th className="px-3 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((h: typeof items[number]) => {
                    const jst  = toJST(h.date)
                    const dow  = ["日", "月", "火", "水", "木", "金", "土"][jst.getUTCDay()]
                    const dateStr = `${jst.getUTCMonth() + 1}/${jst.getUTCDate()}（${dow}）`
                    const typeInfo = TYPE_LABEL[h.type] ?? TYPE_LABEL.NATIONAL
                    return (
                      <tr key={h.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50">
                        <td className="px-4 py-2.5 text-gray-700 font-mono text-xs">{dateStr}</td>
                        <td className="px-3 py-2.5 text-gray-800">{h.name}</td>
                        <td className="px-3 py-2.5">
                          <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${typeInfo.className}`}>
                            {typeInfo.label}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <form action={actionDeleteHoliday.bind(null, h.id)}>
                            <button type="submit" className="text-xs text-red-400 hover:text-red-600">
                              削除
                            </button>
                          </form>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ))
      )}
    </div>
  )
}
