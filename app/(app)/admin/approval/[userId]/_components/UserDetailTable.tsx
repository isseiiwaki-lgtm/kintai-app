"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { actionAdminUpdateRecord, actionBulkApprove, actionBulkLock, actionClearAdminEdit } from "../actions"
import type { AdminTimeConstraint } from "@/lib/clock-pipeline"
import { AdminTimeSelect } from "./AdminTimeSelect"
import { BREAK_REQUEST_MAX_MINUTES, BREAK_REQUEST_STEP_MINUTES } from "@/config/attendance.config"

type Rec = {
  id: string
  dateISO: string          // YYYY-MM-DD（JST）
  dateLabel: string        // "4/1（月）"
  clockIn:    string | null
  clockOut:   string | null
  rawClockIn:  string | null   // 生打刻（丸め前）。丸めと差がある日のみ併記表示
  rawClockOut: string | null
  hasAdminEdit: boolean        // 管理者の確定修正（段6.5）に取り消し先がある日。「管理者の修正を取り消す」を出す
  requestEndTime: string | null   // ④: 承認済み残業申請（最後に出した申請）の終了時刻。④OFF・申請なしは null
  noOvertimeRequest: boolean      // ④ON で残業申請が無いのに実打刻が定時を15分以上過ぎた日の目印
  breakMinutes: number | null        // その日の休憩の合計（休憩ボタン・承認済みの休憩申請）
  pendingBreakRequest: boolean       // 承認待ちの休憩申請がある日（まだ差し引いていない）
  noBreakRecord: boolean             // パートの休憩申請漏れ（所定休憩が設定されているのに記録が無い／実働6時間超で記録が無い）の目印
  noHolidayWorkRequest: boolean      // 休日に休日出勤申請が無いまま打刻があった日の目印
  breakStart: string | null
  breakEnd:   string | null
  goOutAt:    string | null
  returnAt:   string | null
  workingMinutes:    number | null
  lateMinutes:       number
  earlyLeaveMinutes: number
  overtimeMinutes:   number   // 残業（早出＋終業後）
  nightMinutes:      number
  goOutMins:         number | null   // null = 外出中
  note:          string | null   // 当日コメント（本人が打刻画面で入力）
  status:        string
  displayStatus: { label: string; className: string }
  isAbsent:      boolean
  requestId:  string | null
  scheduledMinutes: number  // 所定勤務時間（分）
  timeConstraint: AdminTimeConstraint  // 管理者の入力画面の選択肢を決める、その日のスイッチ・定時・申請の条件（段6.5）
  isWeekend:  boolean
}


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
  const [unrestricted, setUnrestricted] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [editError, setEditError] = useState<string | null>(null)

  function handleEdit(rec: Rec) {
    if (rec.status === "LOCKED") return
    setUnrestricted(false)
    setEditError(null)
    setEditRec(rec)
  }

  function handleSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!editRec) return
    const fd = new FormData(e.currentTarget)
    startTransition(async () => {
      const res = await actionAdminUpdateRecord(editRec.id, editRec.dateISO, fd)
      if (!res.ok) { setEditError(res.error); return }
      setEditRec(null)
    })
  }

  // 管理者の確定修正（出勤・退勤）を取り消し、その日をパイプラインで計算し直す
  function handleClearAdminEdit() {
    if (!editRec) return
    if (!window.confirm(`${editRec.dateLabel} の管理者の修正（出勤・退勤）を取り消しますか？\n1つ前の時刻（実打刻・打刻修正・代理打刻の時刻）に戻して計算し直します。`)) return
    startTransition(async () => {
      const res = await actionClearAdminEdit(editRec.id)
      if (!res.ok) { setEditError(res.error); return }
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
              // 残業 ＝ 早出 ＋ 終業後（保存値、無ければ記録時刻と定時の差。サーバー側で計算済み。CLOCK_PIPELINE 段8）
              const overtimeMin = rec.overtimeMinutes
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
                    {rec.requestEndTime && (
                      <span className="block text-[10px] text-gray-400 leading-tight">申請終了 {rec.requestEndTime}</span>
                    )}
                    {rec.noOvertimeRequest && (
                      <span
                        className="block text-[10px] text-amber-600 leading-tight"
                        title="残業申請が無いのに、実打刻が定時を15分以上過ぎています（退勤の記録は定時で頭打ち）"
                      >
                        申請なし
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-center font-mono text-gray-500 text-xs">
                    {rec.goOutMins === null ? "外出中" : rec.goOutMins > 0 ? fmtMin(rec.goOutMins) : "—"}
                  </td>
                  <td className="px-3 py-2.5 text-center font-mono text-gray-700">
                    {fmtMin(rec.workingMinutes)}
                    {rec.breakMinutes != null && (
                      <span className="block text-[10px] text-gray-400 leading-tight">休憩 {rec.breakMinutes}分</span>
                    )}
                    {rec.pendingBreakRequest && (
                      <span className="block text-[10px] text-amber-600 leading-tight" title="休憩申請は承認されるまで勤務時間から差し引きません">承認待ちの休憩申請あり</span>
                    )}
                    {rec.noBreakRecord && (
                      <span className="block text-[10px] text-amber-600 leading-tight" title="パートで、所定休憩が設定されているか実働が6時間を超えているのに、休憩の記録がありません">休憩の記録なし</span>
                    )}
                    {rec.noHolidayWorkRequest && (
                      <span className="block text-[10px] text-amber-600 leading-tight" title="休日に打刻がありますが、休日出勤申請がありません（定時なしのため遅刻・早退・残業は付きません）">休日出勤申請なし</span>
                    )}
                  </td>
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
              ].map(({ name, label }) => {
                const current = editRec[name as keyof Rec] as string | null
                return (
                  <div key={`${name}-${unrestricted}`} className="flex items-center justify-between">
                    <label className="text-xs text-gray-600 w-20">{label}</label>
                    <AdminTimeSelect
                      name={name}
                      kind={name === "clockIn" ? "clockIn" : name === "clockOut" ? "clockOut" : "other"}
                      constraint={editRec.timeConstraint}
                      unrestricted={unrestricted}
                      current={current}
                      className={selectClass}
                    />
                  </div>
                )
              })}
              <div key={`break-${editRec.id}`} className="flex items-center justify-between">
                <label className="text-xs text-gray-600 w-20">休憩（分）</label>
                <select name="breakMinutes" defaultValue={editRec.breakMinutes != null ? String(editRec.breakMinutes) : ""} className={selectClass}>
                  <option value="">変更なし</option>
                  {editRec.breakMinutes != null && <option value="unset">未設定に戻す（規定値）</option>}
                  {Array.from({ length: BREAK_REQUEST_MAX_MINUTES / BREAK_REQUEST_STEP_MINUTES + 1 }, (_, i) => i * BREAK_REQUEST_STEP_MINUTES).map((m) => (
                    <option key={m} value={m}>{m}分</option>
                  ))}
                </select>
              </div>
              <label className="flex items-center gap-1.5 text-xs text-gray-600">
                <input type="checkbox" checked={unrestricted} onChange={(e) => setUnrestricted(e.target.checked)} className="accent-blue-600" />
                制限なしで入力する（1分単位・全時間帯）
              </label>
              <p className="text-[10px] text-gray-400">※ 出勤・退勤は、その日のスイッチ（丸め・申請上限）に合う時刻だけを表示しています。入力した出勤・退勤は丸め・上限を通さず、そのまま記録されます</p>
              <p className="text-xs text-amber-600 mt-2">※ 保存すると状態が「承認済」になります</p>
              {editRec.hasAdminEdit && (
                <button
                  type="button"
                  onClick={handleClearAdminEdit}
                  disabled={isPending}
                  className="w-full py-1.5 border border-red-300 text-xs text-red-600 rounded-lg hover:bg-red-50 disabled:opacity-40"
                >
                  管理者の修正を取り消す
                </button>
              )}
              {editError && <p role="alert" className="text-xs text-red-600">{editError}</p>}
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
