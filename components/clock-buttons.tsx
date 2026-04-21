"use client"

import { useEffect, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import {
  actionClockIn,
  actionClockOut,
  actionGoOut,
  actionReturn,
  actionBreakStart,
  actionBreakEnd,
} from "@/app/(app)/clock/actions"

type Record = {
  clockIn:    Date | null
  clockOut:   Date | null
  goOutAt:    Date | null
  returnAt:   Date | null
  breakStart: Date | null
  breakEnd:   Date | null
}

type Props = {
  record: Record | null
  employmentType: string // "full" | "part"
}

function formatTime(dt: Date | null | undefined): string {
  if (!dt) return "--:--"
  const jst = new Date(dt.getTime() + 9 * 60 * 60 * 1000)
  return `${String(jst.getUTCHours()).padStart(2, "0")}:${String(jst.getUTCMinutes()).padStart(2, "0")}`
}

type WorkState = "initial" | "working" | "out" | "on_break" | "done"

function getWorkState(r: Record | null): WorkState {
  if (!r?.clockIn)  return "initial"
  if (r.clockOut)   return "done"
  if (r.goOutAt && !r.returnAt)          return "out"
  if (r.breakStart  && !r.breakEnd)      return "on_break"
  return "working"
}

type ButtonDef = {
  label:    string
  color:    string
  disabled: boolean
  action:   () => Promise<void>
}

export function ClockButtons({ record, employmentType }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [now, setNow] = useState<Date | null>(null)

  useEffect(() => {
    setNow(new Date())
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  const state = getWorkState(record)
  const isPart = employmentType === "part"

  const run = (action: () => Promise<void>) => {
    startTransition(async () => {
      await action()
      router.refresh()
    })
  }

  // JST 現在時刻（hydration 前は空表示）
  const jst      = now ? new Date(now.getTime() + 9 * 60 * 60 * 1000) : null
  const timeStr  = jst
    ? [jst.getUTCHours(), jst.getUTCMinutes(), jst.getUTCSeconds()]
        .map((n) => String(n).padStart(2, "0"))
        .join(":")
    : "--:--:--"
  const dateStr  = jst
    ? jst.toLocaleDateString("ja-JP", {
        timeZone: "UTC",
        year: "numeric", month: "long", day: "numeric", weekday: "short",
      })
    : ""

  // ボタン定義
  const buttons: ButtonDef[] = [
    {
      label: "出勤",
      color: "bg-blue-600 hover:bg-blue-700 text-white",
      disabled: state !== "initial",
      action: actionClockIn,
    },
    ...(isPart
      ? [
          {
            label: state === "on_break" ? "休憩終了" : "休憩開始",
            color: "bg-amber-500 hover:bg-amber-600 text-white",
            disabled: state === "on_break"
              ? false
              : state !== "working",
            action: state === "on_break" ? actionBreakEnd : actionBreakStart,
          } satisfies ButtonDef,
        ]
      : []),
    {
      label: state === "out" ? "戻り" : "外出",
      color: "bg-orange-500 hover:bg-orange-600 text-white",
      disabled: state === "out"
        ? false
        : (state !== "working"),
      action: state === "out" ? actionReturn : actionGoOut,
    },
    {
      label: "退勤",
      color: "bg-gray-700 hover:bg-gray-800 text-white",
      disabled: state !== "working",
      action: actionClockOut,
    },
  ]

  // 打刻状況の表示項目
  const statusItems = [
    { label: "出勤",     value: formatTime(record?.clockIn) },
    { label: "退勤",     value: formatTime(record?.clockOut) },
    { label: "外出",     value: formatTime(record?.goOutAt) },
    { label: "戻り",     value: formatTime(record?.returnAt) },
    ...(isPart
      ? [
          { label: "休憩開始", value: formatTime(record?.breakStart) },
          { label: "休憩終了", value: formatTime(record?.breakEnd) },
        ]
      : []),
  ]

  return (
    <div className="space-y-4">
      {/* 現在時刻 */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 text-center">
        <p className="text-xs text-gray-400 mb-1">{dateStr}</p>
        <p className="text-5xl font-mono font-semibold text-gray-900 tracking-tight">{timeStr}</p>
      </div>

      {/* 打刻状況 */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">今日の打刻</h2>
        <div className="grid grid-cols-2 gap-2.5">
          {statusItems.map(({ label, value }) => (
            <div key={label} className="bg-gray-50 rounded-lg px-3 py-2.5">
              <p className="text-xs text-gray-400">{label}</p>
              <p className="text-lg font-mono font-semibold text-gray-800">{value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* 打刻ボタン */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 space-y-2.5">
        {state === "done" ? (
          <p className="text-center text-sm text-gray-400 py-2">本日の打刻は完了しています</p>
        ) : (
          buttons.map((btn) => (
            <button
              key={btn.label}
              disabled={btn.disabled || isPending}
              onClick={() => run(btn.action)}
              className={`w-full py-3.5 rounded-lg font-medium text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${btn.color}`}
            >
              {btn.label}
            </button>
          ))
        )}
        {isPending && (
          <p className="text-center text-xs text-gray-400">処理中...</p>
        )}
      </div>
    </div>
  )
}
