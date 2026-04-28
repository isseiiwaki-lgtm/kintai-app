"use client"

import { useState, useEffect } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { actionCreateRequest } from "../actions"

type RequestType = "OVERTIME" | "ABSENCE" | "ABSENCE_ABSENT" | "LEAVE_PAID" | "LEAVE_SUB" | "CORRECTION"

// 15分刻みの時刻オプション（HH:MM 形式）
function buildTimeOptions(startHour = 0, endHour = 23): { value: string; label: string }[] {
  const opts: { value: string; label: string }[] = []
  for (let h = startHour; h <= endHour; h++) {
    for (const m of [0, 15, 30, 45]) {
      const hh = String(h).padStart(2, "0")
      const mm = String(m).padStart(2, "0")
      opts.push({ value: `${hh}:${mm}`, label: `${hh}:${mm}` })
    }
  }
  return opts
}

const ALL_TIME_OPTIONS = buildTimeOptions(0, 23)

const selectClass = "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"

const TYPE_OPTIONS: { value: RequestType; label: string }[] = [
  { value: "OVERTIME",       label: "残業申請" },
  { value: "ABSENCE",        label: "遅刻・早退申請" },
  { value: "ABSENCE_ABSENT", label: "欠勤申請" },
  { value: "LEAVE_PAID",     label: "有給休暇申請" },
  { value: "LEAVE_SUB",      label: "代休申請" },
  { value: "CORRECTION",     label: "打刻修正申請" },
]

// 勤怠記録からの修正依頼モード用（2択のみ）
const CORRECTION_MODE_OPTIONS: { value: RequestType; label: string; description: string }[] = [
  { value: "ABSENCE",    label: "遅刻・早退",  description: "実際の出退勤時刻が所定と異なる" },
  { value: "CORRECTION", label: "打刻漏れ",    description: "出勤・退勤などの打刻を忘れた" },
]

const CORRECTION_FIELDS: { value: string; label: string }[] = [
  { value: "clockIn",    label: "出勤" },
  { value: "clockOut",   label: "退勤" },
  { value: "goOutAt",    label: "外出" },
  { value: "returnAt",   label: "戻り" },
  { value: "breakStart", label: "休憩開始" },
  { value: "breakEnd",   label: "休憩終了" },
]

export default function NewRequestPage() {
  const router       = useRouter()
  const searchParams = useSearchParams()
  const [type, setType]       = useState<RequestType>("OVERTIME")
  const [pending, setPending] = useState(false)

  // URL params からプリセット（/records の修正依頼リンク用）
  const presetDate      = searchParams.get("date")  ?? ""
  const presetField     = searchParams.get("field") ?? ""
  const correctionMode  = searchParams.get("mode") === "correction"

  useEffect(() => {
    if (correctionMode) {
      setType("ABSENCE") // 修正依頼モードのデフォルトは遅刻・早退
    } else if (presetField) {
      setType("CORRECTION")
    }
  }, [correctionMode, presetField])

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setPending(true)
    const fd = new FormData(e.currentTarget)
    // フロントのUI種別 → DBのtype/detail に変換
    if (fd.get("type") === "LEAVE_PAID") {
      fd.set("type", "LEAVE")
      fd.set("leaveType", "paid")
    } else if (fd.get("type") === "LEAVE_SUB") {
      fd.set("type", "LEAVE")
      fd.set("leaveType", "substitute")
    } else if (fd.get("type") === "ABSENCE_ABSENT") {
      fd.set("type", "ABSENCE")
      fd.set("absenceType", "absent")
    }
    await actionCreateRequest(fd)
  }

  return (
    <div className="p-4 lg:p-6 max-w-lg mx-auto">
      <div className="flex items-center gap-3 mb-5">
        <button onClick={() => router.back()} className="text-gray-400 hover:text-gray-700 text-sm">← 戻る</button>
        <h1 className="text-base font-semibold text-gray-900">新規申請</h1>
      </div>

      <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 space-y-4">
        {/* 申請種別 */}
        {correctionMode ? (
          /* 修正依頼モード: 2択ボタン */
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-2">修正の種類</label>
            <input type="hidden" name="type" value={type} />
            <div className="grid grid-cols-2 gap-2">
              {CORRECTION_MODE_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => setType(o.value)}
                  className={`flex flex-col items-start px-4 py-3 rounded-lg border text-left transition-colors ${
                    type === o.value
                      ? "border-blue-500 bg-blue-50 text-blue-700"
                      : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  <span className="text-sm font-medium">{o.label}</span>
                  <span className="text-xs text-gray-400 mt-0.5">{o.description}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          /* 通常モード: セレクト */
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">申請種別</label>
            <select
              name="type"
              value={type}
              onChange={(e) => setType(e.target.value as RequestType)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
        )}

        {/* 対象日 */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            {type === "LEAVE_SUB" ? "代休取得日" : "対象日"}
          </label>
          <input
            type="date" name="targetDate" required
            defaultValue={presetDate}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* 残業: 終了時刻 */}
        {type === "OVERTIME" && (
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">残業終了時刻</label>
            <select name="endTime" required defaultValue="" className={selectClass}>
              <option value="" disabled>-- 時刻を選択 --</option>
              {buildTimeOptions(13, 23).map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
        )}

        {/* 欠勤: インフォ */}
        {type === "ABSENCE_ABSENT" && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2 text-xs text-yellow-700">
            欠勤は全日欠勤（無給）として記録されます。対象日と申請理由を入力してください。
          </div>
        )}

        {/* 遅刻・早退: 種別 + 時刻 */}
        {type === "ABSENCE" && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">種別</label>
              <select name="absenceType" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="late">遅刻</option>
                <option value="early">早退</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">時刻</label>
              <select name="time" required defaultValue="" className={selectClass}>
                <option value="" disabled>-- 選択 --</option>
                {buildTimeOptions(6, 20).map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          </div>
        )}

        {/* 有給: 区分 */}
        {type === "LEAVE_PAID" && (
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">区分</label>
            <select name="halfDay" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="full">全休</option>
              <option value="am">午前半休</option>
              <option value="pm">午後半休</option>
            </select>
          </div>
        )}

        {/* 代休: 振替元出勤日 */}
        {type === "LEAVE_SUB" && (
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">振替元の休日出勤日</label>
            <input
              type="date" name="workDate" required
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        )}

        {/* 打刻修正: 対象項目 + 修正時刻 */}
        {type === "CORRECTION" && (
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">修正する打刻項目</label>
              <select name="targetField" required defaultValue={presetField} className={selectClass}>
                <option value="" disabled>-- 項目を選択 --</option>
                {CORRECTION_FIELDS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">修正後の時刻</label>
              <select name="correctedTime" required defaultValue="" className={selectClass}>
                <option value="" disabled>-- 時刻を選択 --</option>
                {ALL_TIME_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          </div>
        )}

        {/* 申請理由 */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">申請理由</label>
          <textarea
            name="reason" rows={5}
            placeholder="申請理由を入力してください"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
          />
        </div>

        <button
          type="submit" disabled={pending}
          className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-40"
        >
          {pending ? "送信中..." : "申請する"}
        </button>
      </form>
    </div>
  )
}
