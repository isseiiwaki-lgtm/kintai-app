"use client"

import { useEffect, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import {
  actionClockIn,
  actionClockOut,
  actionGoOut,
  actionReturn,
  actionSetBreak,
  actionSaveNote,
} from "@/app/(app)/clock/actions"
import { BREAK_BUTTON_MINUTES } from "@/config/attendance.config"

type ClockRecord = {
  clockIn:    Date | null
  clockOut:   Date | null
  goOutAt:    Date | null
  returnAt:   Date | null
  /** その日の休憩の合計（分）。パートの休憩ボタンで入る。null ＝ まだ押していない */
  breakMinutes: number | null
  note?:      string | null
}

type Props = {
  record: ClockRecord | null
  employmentType: string // "full" | "part"
}

function formatTime(dt: Date | null | undefined): string {
  if (!dt) return "--:--"
  const jst = new Date(dt.getTime() + 9 * 60 * 60 * 1000)
  return `${String(jst.getUTCHours()).padStart(2, "0")}:${String(jst.getUTCMinutes()).padStart(2, "0")}`
}

type WorkState = "initial" | "working" | "out" | "done"

function getWorkState(r: ClockRecord | null): WorkState {
  if (!r?.clockIn)                       return "initial"
  if (r.clockOut)                        return "done"
  if (r.goOutAt && !r.returnAt)          return "out"
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
  const [note, setNote] = useState(record?.note ?? "")

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
      { label: "休憩", value: record?.breakMinutes != null ? `${record.breakMinutes}分` : "--" },
    ] : []),
  ]
  // 休憩ボタンは出勤後から押せる（退勤後も、押し忘れの訂正ができるよう押せる）
  const canSetBreak = isPart && state !== "initial"
  const [breakError, setBreakError] = useState<string | null>(null)
  const setBreak = (m: number) => {
    setBreakError(null)
    startTransition(async () => {
      const res = await actionSetBreak(m)
      if (!res.ok) setBreakError(res.error)
      router.refresh()
    })
  }

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
            {/* 行2: 外出 → 戻り */}
            <ClockBtn
              label={state === "out" ? "戻り" : "外出"}
              scheme="sub"
              disabled={isPending || (state === "out" ? false : state !== "working")}
              onClick={() => run(state === "out" ? actionReturn : actionGoOut)}
            />
          </div>
        )}
        {isPending && (
          <p className="text-center text-xs text-gray-400 mt-2">処理中...</p>
        )}
      </div>

      {/* 休憩（パートのみ）：押した値がその日の休憩の合計（上書き）。承認は不要 */}
      {isPart && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-1">休憩時間</h2>
          <p className="text-xs text-gray-400 mb-3">その日の休憩がすべて終わってから押してください。押した値がその日の休憩の合計になります。</p>
          <div className="grid grid-cols-5 gap-2">
            {BREAK_BUTTON_MINUTES.map((m) => {
              const selected = record?.breakMinutes === m
              return (
                <button
                  key={m}
                  type="button"
                  disabled={isPending || !canSetBreak}
                  onClick={() => setBreak(m)}
                  aria-pressed={selected}
                  className={`py-3 rounded-lg text-sm font-semibold transition-colors ${
                    !canSetBreak
                      ? "bg-[#FCFCFC] text-gray-300 border border-gray-100 cursor-not-allowed"
                      : selected
                        ? "bg-[#6C757D] text-white shadow-[0_2px_8px_rgba(108,117,125,0.35)]"
                        : "bg-white text-gray-700 border border-gray-300 hover:bg-gray-50"
                  }`}
                >
                  {m}
                </button>
              )
            })}
          </div>
          <p className="text-xs text-gray-400 mt-2">単位：分。60分を超える休憩・押し忘れは「申請」の休憩申請から出してください。</p>
          {breakError && <p role="alert" className="text-xs text-red-600 mt-1">{breakError}</p>}
        </div>
      )}

      {/* 当日コメント（申請にならない当日事情の連絡用。管理者が承認画面で確認する） */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-1">当日コメント</h2>
        <p className="text-xs text-gray-400 mb-2">申請するほどではない当日の事情を管理者へ伝えられます（例: 健康診断のため午後から出勤）</p>
        <textarea
          value={note}
          onChange={e => setNote(e.target.value)}
          maxLength={200}
          rows={2}
          placeholder="未入力"
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400 resize-none"
        />
        <div className="flex items-center justify-end gap-2 mt-1.5">
          {note === (record?.note ?? "") && (record?.note ?? "") !== "" && (
            <span className="text-xs text-green-600">保存済み</span>
          )}
          <button
            type="button"
            disabled={isPending || note === (record?.note ?? "")}
            onClick={() => run(() => actionSaveNote(note))}
            className="px-4 py-1.5 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white disabled:bg-gray-100 disabled:text-gray-300 transition-colors"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  )
}
