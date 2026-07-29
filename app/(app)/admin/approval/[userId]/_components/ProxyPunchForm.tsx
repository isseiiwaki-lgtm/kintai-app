"use client"

import { useState, useTransition } from "react"
import { actionAdminCreateRecord } from "../actions"

export type MissingDate = { iso: string; label: string }

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

const selectClass =
  "border border-gray-200 rounded px-2 py-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-blue-500"

const TIME_FIELDS: { name: string; label: string; required?: boolean }[] = [
  { name: "clockIn",    label: "出勤", required: true },
  { name: "clockOut",   label: "退勤" },
  { name: "goOutAt",    label: "外出" },
  { name: "returnAt",   label: "戻り" },
  { name: "breakStart", label: "休憩開始" },
  { name: "breakEnd",   label: "休憩終了" },
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
  const [isPending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const fd   = new FormData(form)
    const dateISO = fd.get("dateISO") as string
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
              <select name="dateISO" defaultValue="" required className={selectClass}>
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
                <select name={name} defaultValue="" required={required} className={`${selectClass} w-[72px]`}>
                  <option value="">—</option>
                  {TIME_OPTIONS.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
            ))}

            <label className="flex items-center gap-1.5 text-xs text-gray-600 pb-1.5">
              <input type="checkbox" name="isHolidayWork" className="accent-blue-600" />
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
