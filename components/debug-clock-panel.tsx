"use client"

import { useState } from "react"
import { ClockButtons } from "@/components/clock-buttons"

type Record = {
  clockIn:    Date | null
  clockOut:   Date | null
  goOutAt:    Date | null
  returnAt:   Date | null
  breakStart: Date | null
  breakEnd:   Date | null
}

type WorkState = "initial" | "working" | "out" | "on_break" | "done"
type EmpType   = "full" | "part"

const MOCK_BASE: Record = {
  clockIn:    new Date("2026-04-21T08:30:00+09:00"),
  clockOut:   null,
  goOutAt:    null,
  returnAt:   null,
  breakStart: null,
  breakEnd:   null,
}

const MOCK_RECORDS: Record<WorkState, Record | null> = {
  initial:  null,
  working:  { ...MOCK_BASE },
  out:      { ...MOCK_BASE, goOutAt: new Date("2026-04-21T12:00:00+09:00") },
  on_break: { ...MOCK_BASE, breakStart: new Date("2026-04-21T12:00:00+09:00") },
  done:     { ...MOCK_BASE, clockOut: new Date("2026-04-21T17:30:00+09:00") },
}

const STATE_LABELS: { value: WorkState; label: string }[] = [
  { value: "initial",  label: "未出勤" },
  { value: "working",  label: "出勤中" },
  { value: "out",      label: "外出中" },
  { value: "on_break", label: "休憩中" },
  { value: "done",     label: "退勤済" },
]

type Props = {
  realRecord:      Record | null
  realEmpType:     string
}

export function DebugClockPanel({ realRecord, realEmpType }: Props) {
  const [open,      setOpen]      = useState(false)
  const [override,  setOverride]  = useState(false)
  const [workState, setWorkState] = useState<WorkState>("working")
  const [empType,   setEmpType]   = useState<EmpType>("full")

  const record      = override ? MOCK_RECORDS[workState] : realRecord
  const employType  = override ? empType : realEmpType

  return (
    <div className="relative">
      <ClockButtons record={record} employmentType={employType} />

      {/* デバッグパネル（開発環境のみ） */}
      <div className="fixed bottom-20 right-3 lg:bottom-4 z-50">
        {open ? (
          <div className="bg-gray-900 text-white rounded-lg shadow-xl p-3 w-52 text-xs space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-yellow-400">🛠 Debug</span>
              <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-white">✕</button>
            </div>

            {/* オーバーライド切替 */}
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={override}
                onChange={(e) => setOverride(e.target.checked)}
                className="accent-yellow-400"
              />
              <span>モック使用</span>
            </label>

            {override && (
              <>
                {/* 雇用形態 */}
                <div>
                  <p className="text-gray-400 mb-1">雇用形態</p>
                  <div className="flex gap-1.5">
                    {(["full", "part"] as EmpType[]).map((v) => (
                      <button
                        key={v}
                        onClick={() => setEmpType(v)}
                        className={`flex-1 py-1 rounded text-xs font-medium transition-colors ${
                          empType === v
                            ? "bg-yellow-400 text-gray-900"
                            : "bg-gray-700 text-gray-300 hover:bg-gray-600"
                        }`}
                      >
                        {v === "full" ? "社員" : "パート"}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 打刻状態 */}
                <div>
                  <p className="text-gray-400 mb-1">打刻状態</p>
                  <div className="grid grid-cols-2 gap-1">
                    {STATE_LABELS.map(({ value, label }) => (
                      <button
                        key={value}
                        onClick={() => setWorkState(value)}
                        className={`py-1 rounded text-xs font-medium transition-colors ${
                          workState === value
                            ? "bg-yellow-400 text-gray-900"
                            : "bg-gray-700 text-gray-300 hover:bg-gray-600"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        ) : (
          <button
            onClick={() => setOpen(true)}
            className="bg-gray-900 text-yellow-400 rounded-full w-8 h-8 flex items-center justify-center shadow-lg text-sm hover:bg-gray-800 opacity-70 hover:opacity-100 transition-opacity"
            title="デバッグパネル"
          >
            🛠
          </button>
        )}
      </div>
    </div>
  )
}
