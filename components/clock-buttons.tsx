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
  if (!r?.clockIn)                       return "initial"
  if (r.clockOut)                        return "done"
  if (r.goOutAt && !r.returnAt)          return "out"
  if (r.breakStart && !r.breakEnd)       return "on_break"
  return "working"
}

// ── 個別打刻ボタン ────────────────────────────────────────
type Scheme = "clockin" | "clockout" | "sub"

const ACTIVE_COLORS: Record<Scheme, string> = {
  clockin:  "bg-[#6C9CDE] hover:bg-[#5a8ccf] active:bg-[#4d7fbf] text-white shadow-[0_2px_8px_rgba(108,156,222,0.45)]",
  clockout: "bg-[#008E64] hover:bg-[#007655] active:bg-[#006046] text-white shadow-[0_2px_8px_rgba(0,142,100,0.40)]",
  sub:      "bg-[#6C757D] hover:bg-[#5a6268] active:bg-[#4b5359] text-white shadow-[0_2px_8px_rgba(108,117,125,0.35)]",
}

function ClockBtn({
  label, scheme, disabled, onClick,
}: {
  label:    string
  scheme:   Scheme
  disabled: boolean
  onClick:  () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`
        w-full py-4 rounded-xl font-semibold text-base transition-all
        ${disabled
          ? "bg-[#FCFCFC] text-gray-300 border border-gray-100 cursor-not-allowed shadow-none"
          : `${ACTIVE_COLORS[scheme]} cursor-pointer`
        }
      `}
    >
      {label}
    </button>
  )
}

// ── メインコンポーネント ──────────────────────────────────
export function ClockButtons({ record, employmentType }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [now, setNow] = useState<Date | null>(null)

  useEffect(() => {
    setNow(new Date())
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  const state  = getWorkState(record)
  const isPart = employmentType === "part"

  const run = (action: () => Promise<void>) => {
    startTransition(async () => {
      await action()
      router.refresh()
    })
  }

  // JST 現在時刻
  const jst     = now ? new Date(now.getTime() + 9 * 60 * 60 * 1000) : null
  const timeStr = jst
    ? [jst.getUTCHours(), jst.getUTCMinutes(), jst.getUTCSeconds()]
        .map((n) => String(n).padStart(2, "0"))
        .join(":")
    : "--:--:--"
  const dateStr = jst
    ? jst.toLocaleDateString("ja-JP", {
        timeZone: "UTC",
        year: "numeric", month: "long", day: "numeric", weekday: "short",
      })
    : ""

  // 打刻状況の表示項目
  const statusItems = [
    { label: "出勤",     value: formatTime(record?.clockIn)    },
    { label: "退勤",     value: formatTime(record?.clockOut)   },
    { label: "外出",     value: formatTime(record?.goOutAt)    },
    { label: "戻り",     value: formatTime(record?.returnAt)   },
    ...(isPart ? [
      { label: "休憩開始", value: formatTime(record?.breakStart) },
      { label: "休憩終了", value: formatTime(record?.breakEnd)   },
    ] : []),
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
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
        {state === "done" ? (
          <p className="text-center text-sm text-gray-400 py-2">本日の打刻は完了しています</p>
        ) : (
          <div className="space-y-3">
            {/* 行1: 出勤 / 退勤 */}
            <div className="grid grid-cols-2 gap-3">
              <ClockBtn
                label="出勤"
                scheme="clockin"
                disabled={isPending || state !== "initial"}
                onClick={() => run(actionClockIn)}
              />
              <ClockBtn
                label="退勤"
                scheme="clockout"
                disabled={isPending || state !== "working"}
                onClick={() => run(actionClockOut)}
              />
            </div>
            {/* 行2: 外出/戻り / 休憩 */}
            <div className="grid grid-cols-2 gap-3">
              <ClockBtn
                label={state === "out" ? "戻り" : "外出"}
                scheme="sub"
                disabled={isPending || (state === "out" ? false : state !== "working")}
                onClick={() => run(state === "out" ? actionReturn : actionGoOut)}
              />
              <ClockBtn
                label={state === "on_break" ? "休憩終了" : "休憩開始"}
                scheme="sub"
                disabled={isPending || !isPart || (state === "on_break" ? false : state !== "working")}
                onClick={() => run(state === "on_break" ? actionBreakEnd : actionBreakStart)}
              />
            </div>
          </div>
        )}
        {isPending && (
          <p className="text-center text-xs text-gray-400 mt-2">処理中...</p>
        )}
      </div>
    </div>
  )
}
