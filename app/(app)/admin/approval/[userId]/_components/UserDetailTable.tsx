"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { actionAdminUpdateRecord, actionBulkApprove, actionBulkLock } from "../actions"

type Rec = {
  id: string
  dateISO: string          // YYYY-MM-DD（JST）
  dateLabel: string        // "4/1（月）"
  clockIn:    string | null
  clockOut:   string | null
  rawClockIn:  string | null   // 生打刻（丸め前）。丸めと差がある日のみ併記表示
  rawClockOut: string | null
  breakStart: string | null
  breakEnd:   string | null
  goOutAt:    string | null
  returnAt:   string | null
  workingMinutes:    number | null
  lateMinutes:       number
  earlyLeaveMinutes: number
  nightMinutes:      number
  goOutMins:         number | null   // null = 外出中
  note:          string | null   // 当日コメント（本人が打刻画面で入力）
  status:        string
  displayStatus: { label: string; className: string }
  isAbsent:      boolean
  requestId:  string | null
  scheduledMinutes: number  // 所定勤務時間（分）
  isWeekend:  boolean
}


function buildTimeOptions() {
  const opts: string[] = []
  for (let h = 0; h <= 23; h++) {
    for (const m of [0, 15, 30, 45]) {
      opts.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`)
    }
  }
  return opts
}
const TIME_OPTIONS = buildTimeOptions()

const selectClass = "border border-gray-200 rounded px-2 py-1 text-xs font-mono w-[72px] focus:outline-none focus:ring-1 focus:ring-blue-500"

type Props = {
  records:     Rec[]
  firstDayISO: string
  lastDayISO:  string
  userId:      string
  isAdmin:     boolean
  openCount:     number
  approvedCount: number
}

export function UserDetailTable({ records, firstDayISO, lastDayISO, userId, isAdmin, openCount, approvedCount }: Props) {
  const [editRec, setEditRec]   = useState<Rec | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleEdit(rec: Rec) {
    if (rec.status === "LOCKED") return
    setEditRec(rec)
  }

  function handleSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!editRec) return
    const fd = new FormData(e.currentTarget)
    startTransition(async () => {
      await actionAdminUpdateRecord(editRec.id, editRec.dateISO, fd)
      setEditRec(null)
    })
  }

  function handleBulkApprove() {
    startTransition(async () => {
      await actionBulkApprove(userId, firstDayISO, lastDayISO)
    })
  }

  function handleBulkLock() {
    startTransition(async () => {
      await actionBulkLock(userId, firstDayISO, lastDayISO)
    })
  }

  const fmtMin = (min: number | null) => {
    if (!min) return "—"
    return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, "0")}`
  }

  return (
    <>
      {/* アクションバー */}
      <div className="flex gap-2 mb-4 justify-end">
        {openCount > 0 && (
          <button
            onClick={handleBulkApprove}
            disabled={isPending}
            className="px-3 py-1.5 text-sm bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors disabled:opacity-40"
          >
            一括承認 ({openCount}件)
          </button>
        )}
        {isAdmin && approvedCount > 0 && (
          <button
            onClick={handleBulkLock}
            disabled={isPending}
            className="px-3 py-1.5 text-sm bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors disabled:opacity-40"
          >
            一括締め ({approvedCount}件)
          </button>
        )}
      </div>

      {/* テーブル */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
        <table className="w-full text-sm min-w-[960px]">
          <thead>
            <tr className="border-b border-gray-100 text-xs text-gray-400 bg-gray-50">
              <th className="text-left px-4 py-3 font-medium">日付</th>
              <th className="text-center px-3 py-3 font-medium">出勤</th>
              <th className="text-center px-3 py-3 font-medium">退勤</th>
              <th className="text-center px-3 py-3 font-medium">中抜</th>
              <th className="text-center px-3 py-3 font-medium">労働</th>
              <th className="text-center px-3 py-3 font-medium">所定</th>
              <th className="text-center px-3 py-3 font-medium">残業</th>
              <th className="text-center px-3 py-3 font-medium">深夜</th>
              <th className="text-center px-3 py-3 font-medium">遅刻</th>
              <th className="text-center px-3 py-3 font-medium">早退</th>
              <th className="text-left px-3 py-3 font-medium">備考</th>
              <th className="text-center px-3 py-3 font-medium">状態</th>
              <th className="px-3 py-3 font-medium w-[72px]"></th>
            </tr>
          </thead>
          <tbody>
            {records.map((rec) => {
              const overtimeMin = Math.max(0, (rec.workingMinutes ?? 0) - rec.scheduledMinutes)
              return (
                <tr
                  key={rec.dateISO}
                  onClick={() => handleEdit(rec)}
                  className={`border-b border-gray-50 last:border-0 ${
                    rec.status === "LOCKED" ? "opacity-60" :
                    rec.isWeekend ? "bg-gray-50/60 hover:bg-gray-100 cursor-pointer" : "hover:bg-blue-50 cursor-pointer"
                  }`}
                >
                  <td className="px-4 py-2.5 text-gray-700">{rec.dateLabel}</td>
                  <td className="px-3 py-2.5 text-center font-mono text-gray-700">
                    {rec.clockIn ?? "—"}
                    {rec.rawClockIn && rec.rawClockIn !== rec.clockIn && (
                      <span className="block text-[10px] text-gray-400 leading-tight">実 {rec.rawClockIn}</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-center font-mono text-gray-700">
                    {rec.clockOut ?? "—"}
                    {rec.rawClockOut && rec.rawClockOut !== rec.clockOut && (
                      <span className="block text-[10px] text-gray-400 leading-tight">実 {rec.rawClockOut}</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-center font-mono text-gray-500 text-xs">
                    {rec.goOutMins === null ? "外出中" : rec.goOutMins > 0 ? fmtMin(rec.goOutMins) : "—"}
                  </td>
                  <td className="px-3 py-2.5 text-center font-mono text-gray-700">{fmtMin(rec.workingMinutes)}</td>
                  <td className="px-3 py-2.5 text-center font-mono text-gray-400">
                    {rec.scheduledMinutes > 0 ? fmtMin(rec.scheduledMinutes) : "—"}
                  </td>
                  <td className={`px-3 py-2.5 text-center font-mono text-xs ${overtimeMin > 0 ? "text-blue-600 font-medium" : "text-gray-300"}`}>
                    {overtimeMin > 0 ? fmtMin(overtimeMin) : "—"}
                  </td>
                  <td className={`px-3 py-2.5 text-center font-mono text-xs ${rec.nightMinutes > 0 ? "text-purple-600 font-medium" : "text-gray-300"}`}>
                    {rec.nightMinutes > 0 ? fmtMin(rec.nightMinutes) : "—"}
                  </td>
                  <td className={`px-3 py-2.5 text-center font-mono text-xs ${rec.lateMinutes > 0 ? "text-amber-600 font-medium" : "text-gray-300"}`}>
                    {rec.lateMinutes > 0 ? fmtMin(rec.lateMinutes) : "—"}
                  </td>
                  <td className={`px-3 py-2.5 text-center font-mono text-xs ${rec.earlyLeaveMinutes > 0 ? "text-amber-600 font-medium" : "text-gray-300"}`}>
                    {rec.earlyLeaveMinutes > 0 ? fmtMin(rec.earlyLeaveMinutes) : "—"}
                  </td>
                  <td className="px-3 py-2.5 text-left text-xs text-gray-500 max-w-[160px]">
                    {rec.note
                      ? <span className="block truncate" title={rec.note}>{rec.note}</span>
                      : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    {rec.isAbsent ? (
                      <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-700">欠勤</span>
                    ) : (
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${rec.displayStatus.className}`}>
                        {rec.displayStatus.label}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-center" onClick={(e) => e.stopPropagation()}>
                    {rec.requestId && (
                      <Link
                        href={`/admin/requests?highlight=${rec.requestId}`}
                        className="text-xs text-blue-500 hover:underline whitespace-nowrap"
                      >
                        申請あり
                      </Link>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* 編集モーダル */}
      {editRec && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-900">{editRec.dateLabel} 編集</h3>
              <button onClick={() => setEditRec(null)} className="text-gray-400 hover:text-gray-600 text-lg leading-none">✕</button>
            </div>
            <form onSubmit={handleSave} className="space-y-3">
              {[
                { name: "clockIn",    label: "出勤" },
                { name: "clockOut",   label: "退勤" },
                { name: "goOutAt",    label: "外出" },
                { name: "returnAt",   label: "戻り" },
                { name: "breakStart", label: "休憩開始" },
                { name: "breakEnd",   label: "休憩終了" },
              ].map(({ name, label }) => {
                const current = editRec[name as keyof Rec] as string | null
                return (
                  <div key={name} className="flex items-center justify-between">
                    <label className="text-xs text-gray-600 w-20">{label}</label>
                    <select name={name} defaultValue={current ?? ""} className={selectClass}>
                      <option value="">—</option>
                      {TIME_OPTIONS.map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  </div>
                )
              })}
              <p className="text-xs text-amber-600 mt-2">※ 保存すると状態が「承認済」になります</p>
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setEditRec(null)}
                  className="flex-1 py-2 border border-gray-200 text-sm text-gray-600 rounded-lg hover:bg-gray-50"
                >
                  キャンセル
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className="flex-1 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg disabled:opacity-40"
                >
                  {isPending ? "保存中..." : "保存"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
