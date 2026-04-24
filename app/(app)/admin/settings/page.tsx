import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { actionSaveSetting } from "./actions"

const DEFAULT_SETTING = {
  closingDay:      25,
  break1Threshold: 360,
  break1Minutes:   45,
  break2Threshold: 480,
  break2Minutes:   60,
}

export default async function SettingsPage() {
  const session = await auth()
  if (session?.user?.role !== "ADMIN") redirect("/")

  const setting = await prisma.setting.findUnique({ where: { id: 1 } }) ?? DEFAULT_SETTING

  const inputClass = "border border-gray-200 rounded-lg px-3 py-2 text-sm w-24 focus:outline-none focus:ring-2 focus:ring-blue-500"

  return (
    <div className="p-4 lg:p-6 max-w-lg">
      <h1 className="text-base font-semibold text-gray-900 mb-6">会社設定</h1>

      <form action={actionSaveSetting} className="space-y-6">

        {/* 締め日 */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
          <h2 className="text-sm font-semibold text-gray-800 mb-1">締め日</h2>
          <p className="text-xs text-gray-400 mb-4">
            例: 25日設定 → 3/26〜4/25 が「4月」の集計期間
          </p>
          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-600">毎月</label>
            <input
              type="number" name="closingDay"
              defaultValue={setting.closingDay}
              min={1} max={28} required
              className={inputClass}
            />
            <span className="text-sm text-gray-600">日締め</span>
          </div>
          <p className="text-xs text-gray-400 mt-2">※ 28日以内で設定してください（月末日対応のため）</p>
        </div>

        {/* 休憩時間控除ルール */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
          <h2 className="text-sm font-semibold text-gray-800 mb-1">休憩時間控除ルール</h2>
          <p className="text-xs text-gray-400 mb-4">
            拘束時間（出勤〜退勤）が閾値を超えた場合、労働時間から控除します。
            法定基準: 6時間超→45分、8時間超→60分。
          </p>
          <div className="space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm text-gray-600 w-16">ルール1</span>
              <input
                type="number" name="break1Threshold"
                defaultValue={setting.break1Threshold}
                min={1} step={15} required
                className={inputClass}
              />
              <span className="text-sm text-gray-500">分超で</span>
              <input
                type="number" name="break1Minutes"
                defaultValue={setting.break1Minutes}
                min={1} step={5} required
                className={inputClass}
              />
              <span className="text-sm text-gray-500">分控除</span>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm text-gray-600 w-16">ルール2</span>
              <input
                type="number" name="break2Threshold"
                defaultValue={setting.break2Threshold}
                min={1} step={15} required
                className={inputClass}
              />
              <span className="text-sm text-gray-500">分超で</span>
              <input
                type="number" name="break2Minutes"
                defaultValue={setting.break2Minutes}
                min={1} step={5} required
                className={inputClass}
              />
              <span className="text-sm text-gray-500">分控除</span>
            </div>
          </div>
          <p className="text-xs text-gray-400 mt-3">
            ※ ルール2が優先（8時間超はルール1ではなくルール2を適用）
          </p>
        </div>

        <button
          type="submit"
          className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
        >
          保存
        </button>
      </form>
    </div>
  )
}
