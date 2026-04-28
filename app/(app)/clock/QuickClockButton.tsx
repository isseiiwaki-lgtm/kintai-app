"use client"

import { useState, useEffect, useTransition } from "react"
import { actionClockIn, actionClockOut } from "./actions"

type Props = {
  status: "未出勤" | "出勤中" | "退勤済"
}

export function QuickClockButton({ status }: Props) {
  const [now, setNow] = useState<Date | null>(null)
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    setNow(new Date())
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  const timeStr = now
    ? now.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Tokyo" })
    : "--:--"

  if (status === "退勤済") {
    return (
      <a
        href="/clock"
        className="block w-full text-center bg-gray-100 hover:bg-gray-200 text-gray-600 font-medium py-3 rounded-lg text-sm transition-colors"
      >
        打刻ページへ
      </a>
    )
  }

  const isClockIn = status === "未出勤"

  function handleClick() {
    startTransition(async () => {
      if (isClockIn) await actionClockIn()
      else await actionClockOut()
    })
  }

  return (
    <button
      onClick={handleClick}
      disabled={pending}
      style={!isClockIn ? { backgroundColor: "#008E64" } : undefined}
      className={`w-full flex items-center justify-center gap-3 font-medium py-3 rounded-lg text-sm transition-all disabled:opacity-50 ${
        isClockIn
          ? "bg-[#6C9CDE] hover:bg-[#5a8ccf] active:bg-[#4d7fbf] text-white shadow-[0_2px_8px_rgba(108,156,222,0.45)]"
          : "hover:brightness-90 active:brightness-75 text-white shadow-[0_2px_8px_rgba(0,142,100,0.40)]"
      }`}
    >
      <span className="font-mono text-base">{timeStr}</span>
      <span>{isClockIn ? "出勤する" : "退勤する"}</span>
    </button>
  )
}
