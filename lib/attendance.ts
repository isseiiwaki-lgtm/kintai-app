/**
 * 勤怠計算ユーティリティ
 * 承認・締め時に AttendanceRecord へ保存する集計値を計算する
 */

function toJST(dt: Date): Date {
  return new Date(dt.getTime() + 9 * 60 * 60 * 1000)
}

/** HH:MM 文字列 → その日の分数 */
function hhmm(dt: Date): number {
  const j = toJST(dt)
  return j.getUTCHours() * 60 + j.getUTCMinutes()
}

function parseHHMM(s: string | null | undefined): number | null {
  if (!s) return null
  const [h, m] = s.split(":").map(Number)
  return h * 60 + m
}

type CalcInput = {
  clockIn:        Date | null
  clockOut:       Date | null
  workingMinutes: number | null  // 既存の勤務時間（break 控除済み）
  workStartTime:  string | null  // "08:30"
  workEndTime:    string | null  // "17:30"
  scheduledMinutes: number       // 所定勤務時間（例: 480）
}

export type AttendanceMetrics = {
  lateMinutes:       number
  earlyLeaveMinutes: number
  overtimeMinutes:   number
}

export function calcMetrics({
  clockIn,
  clockOut,
  workingMinutes,
  workStartTime,
  workEndTime,
  scheduledMinutes,
}: CalcInput): AttendanceMetrics {
  let lateMinutes       = 0
  let earlyLeaveMinutes = 0
  let overtimeMinutes   = 0

  const startMins = parseHHMM(workStartTime)
  const endMins   = parseHHMM(workEndTime)

  if (clockIn && startMins !== null) {
    lateMinutes = Math.max(0, hhmm(clockIn) - startMins)
  }

  if (clockOut && endMins !== null) {
    const outMins = hhmm(clockOut)
    earlyLeaveMinutes = Math.max(0, endMins - outMins)
    // 退勤が所定終了を超えていれば早退ではなく残業
    if (outMins >= endMins) earlyLeaveMinutes = 0
  }

  // 残業: 実労働時間 - 所定時間
  if (workingMinutes !== null && scheduledMinutes > 0) {
    overtimeMinutes = Math.max(0, workingMinutes - scheduledMinutes)
  }

  return { lateMinutes, earlyLeaveMinutes, overtimeMinutes }
}

/** HH:MM 形式の文字列を返す（ChangeLog 保存用）*/
export function formatHHMMfromDate(dt: Date | null | undefined): string | null {
  if (!dt) return null
  const j = toJST(dt)
  return `${String(j.getUTCHours()).padStart(2, "0")}:${String(j.getUTCMinutes()).padStart(2, "0")}`
}
