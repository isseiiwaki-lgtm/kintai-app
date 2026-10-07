"use client"

import { useState, useTransition } from "react"
import { actionAdminCreateRecord } from "../actions"
import type { AdminTimeConstraint } from "@/lib/clock-pipeline"
import { AdminTimeSelect } from "./AdminTimeSelect"
import { BREAK_REQUEST_MAX_MINUTES, BREAK_REQUEST_STEP_MINUTES } from "@/config/attendance.config"

// constraint: その日のスイッチ（現在の設定）・定時・承認済みの申請。時刻の選択肢を決める（段6.5）
export type MissingDate = { iso: string; label: string; constraint: AdminTimeConstraint }

const selectClass =
  "border border-gray-200 rounded px-2 py-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-blue-500"

const TIME_FIELDS: { name: string; label: string; required?: boolean }[] = [
  { name: "clockIn",    label: "出勤", required: true },
  { name: "clockOut",   label: "退勤" },
  { name: "goOutAt",    label: "外出" },
  { name: "returnAt",   label: "戻り" },
]

/**
 * 代理打刻フォーム（打刻ゼロの日に管理者が後日打刻する）
 * 対象日の候補は締め期間内で出退勤いずれの打刻もない日のみ。既存の表・集計には手を触れない。
 */
export function ProxyPunchForm({
  userId,
  missingDates,
}: {
  userId: string
  missingDates: MissingDate[]
}) {
  const [open, setOpen]     = useState(false)
  const [error, setError]   = useState<string | null>(null)
  const [done, setDone]     = useState<string | null>(null)
  const [dateISO, setDateISO] = useState("")
  const [unrestricted, setUnrestricted] = useState(false)
  const [holidayWork, setHolidayWork] = useState(false)
  const dayConstraint = missingDates.find((d) => d.iso === dateISO)?.constraint ?? missingDates[0]?.constraint
  // 休日出勤にチェックした日は定時なし（丸め・④の対象外）なので、選択肢も制限しない
  const constraint = dayConstraint && holidayWork ? { ...dayConstraint, schedule: null } : dayConstraint
  const [isPending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const fd   = new FormData(form)
    if (!dateISO) {
      setError("対象日を選択してください")
      return
    }
    setError(null)
    setDone(null)
    startTransition(async () => {
      const res = await actionAdminCreateRecord(userId, dateISO, fd)
      if (res.ok) {
        setDone(`${dateISO} の打刻を登録しました`)
        form.reset()
        setDateISO("")
        setHolidayWork(false)
      } else {
        setError(res.error)
      }
    })
  }

  if (missingDates.length === 0) {
    return (
      <div className="mb-4 text-xs text-gray-400">
        この期間に打刻漏れの日はありません
      </div>
    )
  }

  return (
    <div className="mb-4 border border-gray-200 rounded-xl bg-white">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 rounded-xl"
      >
        <span className="font-medium">
          代理打刻
          <span className="ml-2 text-xs font-normal text-amber-600">
            打刻なし {missingDates.length}日
          </span>
        </span>
        <span className="text-gray-400 text-xs">{open ? "▲ 閉じる" : "▼ 開く"}</span>
      </button>

      {open && (
        <form onSubmit={handleSubmit} className="px-4 pb-4 pt-1 border-t border-gray-100">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-[10px] text-gray-500 mb-1">対象日</label>
              <select name="dateISO" value={dateISO} onChange={(e) => setDateISO(e.target.value)} required className={selectClass}>
                <option value="">選択</option>
                {missingDates.map((d) => (
                  <option key={d.iso} value={d.iso}>{d.label}</option>
                ))}
              </select>
            </div>

            {TIME_FIELDS.map(({ name, label, required }) => (
              <div key={name}>
                <label className="block text-[10px] text-gray-500 mb-1">
                  {label}{required && <span className="text-red-500">*</span>}
                </label>
                <AdminTimeSelect
                  key={`${name}-${dateISO}-${unrestricted}-${holidayWork}`}
                  name={name}
                  kind={name === "clockIn" ? "clockIn" : name === "clockOut" ? "clockOut" : "other"}
                  constraint={constraint!}
                  unrestricted={unrestricted}
                  current={null}
                  required={required}
                  className={`${selectClass} w-[72px]`}
                />
              </div>
            ))}


              <div>
                <label className="block text-[10px] text-gray-500 mb-1">休憩（分）</label>
                <select name="breakMinutes" defaultValue="" className={`${selectClass} w-[88px]`}>
                  <option value="">未設定</option>
                  {Array.from({ length: BREAK_REQUEST_MAX_MINUTES / BREAK_REQUEST_STEP_MINUTES + 1 }, (_, i) => i * BREAK_REQUEST_STEP_MINUTES).map((m) => (
                    <option key={m} value={m}>{m}分</option>
                  ))}
                </select>
              </div>

            <label className="flex items-center gap-1.5 text-xs text-gray-600 pb-1.5">
              <input type="checkbox" checked={unrestricted} onChange={(e) => setUnrestricted(e.target.checked)} className="accent-blue-600" />
              制限なしで入力する
            </label>

            <label className="flex items-center gap-1.5 text-xs text-gray-600 pb-1.5">
              <input type="checkbox" name="isHolidayWork" checked={holidayWork} onChange={(e) => setHolidayWork(e.target.checked)} className="accent-blue-600" />
              休日出勤
            </label>

            <button
              type="submit"
              disabled={isPending}
              className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg disabled:opacity-40"
            >
              {isPending ? "登録中..." : "登録"}
            </button>
          </div>

          <p className="text-[10px] text-gray-400 mt-2">
            ※ 登録すると状態は「承認済」になります。休日出勤にチェックすると遅刻・早退を計上しません
          </p>
          {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
          {done  && <p className="text-xs text-green-600 mt-1">{done}</p>}
        </form>
      )}
    </div>
  )
}
