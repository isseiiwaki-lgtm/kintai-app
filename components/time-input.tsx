"use client"

/**
 * 申請フォームの時刻入力（IMPLEMENTATION_PLAN K）。
 * 時・分それぞれ ▲▼（長押しで連続増減）、数字の直接入力も可（欄を離れた時点で刻みに補正）。分は REQUEST_TIME_STEP_MINUTES（15分）刻み。
 * 値の受け渡しは旧セレクトと同じ（name 付きの hidden input に "HH:MM"、未選択は ""）。
 * スピナーと一覧（旧セレクト）は、一人ひとりが申請画面の切り替えで選ぶ（ブラウザに記憶。末尾の TimeInput）。
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import { REQUEST_TIME_STEP_MINUTES } from "@/config/attendance.config"

type TimeInputProps = {
  name: string
  /** 制御する場合の値（"HH:MM" か ""） */
  value?: string
  /** 制御しない場合の初期値（"HH:MM" か ""） */
  defaultValue?: string
  onChange?: (value: string) => void
  required?: boolean
  /** 旧セレクトに戻したときの選択肢（スピナーでは使わない） */
  options?: { value: string; label: string }[]
}

const STEP = REQUEST_TIME_STEP_MINUTES
const pad = (n: number) => String(n).padStart(2, "0")

function parse(v: string | undefined): { h: number; m: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(v ?? "")
  if (!m) return null
  const h = Number(m[1])
  const mi = Number(m[2])
  if (h > 23 || mi > 59) return null
  return { h, m: mi }
}

/** 分を刻みに丸める（近いほう。60 になったら 45 に寄せる＝時は繰り上げない） */
function roundMinute(mi: number): number {
  const r = Math.round(mi / STEP) * STEP
  return Math.min(r, 60 - STEP)
}

/** ▲▼ ボタン。押した瞬間に1回、長押しで連続して呼ぶ */
function RepeatButton({ label, onStep }: { label: string; onStep: () => void }) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const stepRef = useRef(onStep)
  stepRef.current = onStep
  const stop = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }
  const start = (e: React.PointerEvent) => {
    e.preventDefault()
    stop()
    stepRef.current()
    const repeat = (delay: number) => {
      timer.current = setTimeout(() => { stepRef.current(); repeat(80) }, delay)
    }
    repeat(400)
  }
  useEffect(() => stop, [])
  return (
    <button
      type="button"
      aria-label={label}
      onPointerDown={start}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); stepRef.current() } }}
      className="w-full h-7 flex items-center justify-center text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded select-none touch-manipulation"
    >
      {label === "上げる" ? "▲" : "▼"}
    </button>
  )
}

export function TimeSpinner({ name, value, defaultValue = "", onChange, required }: TimeInputProps) {
  const controlled = value !== undefined
  const [inner, setInner] = useState(defaultValue)
  const current = controlled ? value : inner
  const parsed = parse(current)
  // 直接入力中の文字（欄を離れるまで補正しない）
  const [hText, setHText] = useState<string | null>(null)
  const [mText, setMText] = useState<string | null>(null)

  const commit = (h: number, m: number) => {
    const v = `${pad(h)}:${pad(m)}`
    if (!controlled) setInner(v)
    onChange?.(v)
  }
  // 未選択から ▲▼ を押したときの起点
  const base = parsed ?? { h: 9, m: 0 }
  const stepHour = (d: number) => commit((base.h + d + 24) % 24, parsed ? base.m : 0)
  const stepMinute = (d: number) => {
    const total = (base.h * 60 + (parsed ? base.m : 0) + d * STEP + 24 * 60) % (24 * 60)
    commit(Math.floor(total / 60), total % 60)
  }
  const blurHour = () => {
    if (hText === null) return
    const n = Number(hText)
    if (hText !== "" && Number.isInteger(n) && n >= 0 && n <= 23) commit(n, parsed ? parsed.m : 0)
    setHText(null)
  }
  const blurMinute = () => {
    if (mText === null) return
    const n = Number(mText)
    if (mText !== "" && Number.isInteger(n) && n >= 0 && n <= 59) commit(parsed ? parsed.h : base.h, roundMinute(n))
    setMText(null)
  }

  const box = "w-12 text-center text-lg font-mono border border-gray-200 rounded-lg py-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
  return (
    <div className="inline-flex items-center gap-1">
      <input type="hidden" name={name} value={parsed ? `${pad(parsed.h)}:${pad(parsed.m)}` : ""} />
      <div className="flex flex-col items-center w-12">
        <RepeatButton label="上げる" onStep={() => stepHour(1)} />
        <input
          type="text" inputMode="numeric" maxLength={2} aria-label="時"
          // 未選択のまま送ろうとしたらブラウザが止める（hidden input は required が効かないため、見える欄で止める）
          required={required && !parsed}
          value={hText ?? (parsed ? pad(parsed.h) : "")}
          placeholder="--"
          onChange={(e) => setHText(e.target.value.replace(/\D/g, ""))}
          onBlur={blurHour}
          className={box}
        />
        <RepeatButton label="下げる" onStep={() => stepHour(-1)} />
      </div>
      <span className="text-lg font-mono text-gray-500">:</span>
      <div className="flex flex-col items-center w-12">
        <RepeatButton label="上げる" onStep={() => stepMinute(1)} />
        <input
          type="text" inputMode="numeric" maxLength={2} aria-label="分"
          value={mText ?? (parsed ? pad(parsed.m) : "")}
          placeholder="--"
          onChange={(e) => setMText(e.target.value.replace(/\D/g, ""))}
          onBlur={blurMinute}
          className={box}
        />
        <RepeatButton label="下げる" onStep={() => stepMinute(-1)} />
      </div>
    </div>
  )
}

/** 旧セレクト（アンケートで戻すとき用に残す） */
export function TimeSelect({ name, value, defaultValue = "", onChange, required, options = [] }: TimeInputProps) {
  const cls = "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
  const list = options.length > 0 ? options : Array.from({ length: 24 * 60 / STEP }, (_, i) => {
    const v = `${pad(Math.floor((i * STEP) / 60))}:${pad((i * STEP) % 60)}`
    return { value: v, label: v }
  })
  const common = { name, required, className: cls }
  return value !== undefined ? (
    <select {...common} value={value} onChange={(e) => onChange?.(e.target.value)}>
      <option value="" disabled>-- 時刻を選択 --</option>
      {list.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  ) : (
    <select {...common} defaultValue={defaultValue} onChange={(e) => onChange?.(e.target.value)}>
      <option value="" disabled>-- 時刻を選択 --</option>
      {list.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}

// ---------------------------------------------------------------------------
// 入力の形（スピナー／一覧から選ぶ）は一人ひとりが選ぶ。ブラウザに記憶する（DB には持たない。2026-10-23）
// ---------------------------------------------------------------------------

export type TimeInputMode = "spinner" | "select"
const MODE_KEY = "kintai.timeInputMode"
const MODE_EVENT = "kintai:time-input-mode"

function readMode(): TimeInputMode {
  try {
    return window.localStorage.getItem(MODE_KEY) === "select" ? "select" : "spinner"
  } catch {
    return "spinner"
  }
}

function subscribeMode(callback: () => void) {
  window.addEventListener(MODE_EVENT, callback)
  window.addEventListener("storage", callback)
  return () => {
    window.removeEventListener(MODE_EVENT, callback)
    window.removeEventListener("storage", callback)
  }
}

/** 今の入力の形。サーバーで描くときと記憶が読めないときはスピナー */
export function useTimeInputMode(): TimeInputMode {
  return useSyncExternalStore(subscribeMode, readMode, () => "spinner")
}

export function setTimeInputMode(mode: TimeInputMode) {
  try {
    window.localStorage.setItem(MODE_KEY, mode)
  } catch {
    // 記憶できない環境（プライベートモード等）でも、この画面の中では切り替える
  }
  window.dispatchEvent(new Event(MODE_EVENT))
}

/** 申請フォームの上に置く切り替え。選んだ形はこのブラウザで次回も使う */
export function TimeInputModeToggle() {
  const mode = useTimeInputMode()
  const btn = (m: TimeInputMode, label: string) => (
    <button
      type="button"
      onClick={() => setTimeInputMode(m)}
      className={`px-2.5 py-1 rounded-md border text-xs ${mode === m ? "border-blue-500 bg-blue-50 text-blue-700" : "border-gray-200 text-gray-500 hover:bg-gray-50"}`}
    >
      {label}
    </button>
  )
  return (
    <div className="flex items-center gap-2 text-xs text-gray-500">
      <span>時刻の入れ方</span>
      {btn("spinner", "▲▼で選ぶ")}
      {btn("select", "一覧から選ぶ")}
    </div>
  )
}

/** 申請フォームが使う時刻入力。本人が選んだ形（スピナー／一覧）で出す */
export function TimeInput(props: TimeInputProps) {
  return useTimeInputMode() === "select" ? <TimeSelect {...props} /> : <TimeSpinner {...props} />
}
