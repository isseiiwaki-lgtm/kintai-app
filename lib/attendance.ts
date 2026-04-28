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

/**
 * 深夜労働時間（分）を計算する（22:00〜翌5:00）
 */
export function calcNightMinutes(clockIn: Date | null, clockOut: Date | null): number {
  if (!clockIn || !clockOut) return 0

  const inMins  = hhmm(clockIn)
  let outMins   = hhmm(clockOut)
  if (outMins < inMins) outMins += 24 * 60  // 日をまたぐ場合

  const NIGHT_START = 22 * 60  // 1320
  const NIGHT_END   = 29 * 60  // 1740（翌5:00 = 24+5 = 29時）
  const EARLY_END   =  5 * 60  //  300

  let night = 0

  // 22:00 以降の深夜部分
  if (outMins > NIGHT_START) {
    const s = Math.max(inMins, NIGHT_START)
    const e = Math.min(outMins, NIGHT_END)
    if (e > s) night += e - s
  }

  // 深夜残業で翌 5:00 まで続く部分（上の式で NIGHT_END=29:00 でキャップ済み）
  // さらに翌朝 5:00 前出勤の早朝分
  if (inMins < EARLY_END) {
    const e = Math.min(outMins, EARLY_END)
    if (e > inMins) night += e - inMins
  }

  return Math.max(0, night)
}

/**
 * 「要確認」判定
 * OPEN レコードに対して表示ラベルを 打刻済 / 要確認 で分類する。
 * - 退勤なし（昨日以前）→ 要確認
 * - 遅刻（clockIn > workStartTime + 1分）→ 要確認
 * - 早退（clockOut < workEndTime - 1分）→ 要確認
 */
export function calcNeedsReview({
  clockIn,
  clockOut,
  date,
  today,
  workStartTime,
  workEndTime,
}: {
  clockIn:       Date | null
  clockOut:      Date | null
  date:          Date          // レコードの日付（UTC 00:00）
  today:         Date          // 今日の日付（UTC 00:00）
  workStartTime: string | null // "09:00"
  workEndTime:   string | null // "17:30"
}): boolean {
  if (!clockIn) return false
  if (date >= today) return false   // 今日は対象外

  // 退勤打刻なし
  if (!clockOut) return true

  // 遅刻: clockIn > workStartTime + 1分
  if (workStartTime) {
    const startMins = parseHHMM(workStartTime)
    if (startMins !== null && hhmm(clockIn) > startMins + 1) return true
  }

  // 早退: clockOut < workEndTime - 1分
  if (workEndTime && clockOut) {
    const endMins = parseHHMM(workEndTime)
    if (endMins !== null && hhmm(clockOut) < endMins - 1) return true
  }

  return false
}

/** DBステータス + 要確認判定 → 表示用ラベル・クラス */
export function getDisplayStatus(
  status: string,
  needsReview: boolean,
): { label: string; className: string } {
  if (status === "LOCKED")    return { label: "締め済", className: "bg-purple-100 text-purple-700" }
  if (status === "APPROVED")  return { label: "承認済", className: "bg-green-100 text-green-700" }
  if (status === "SUBMITTED") return { label: "確認済", className: "bg-blue-100 text-blue-700" }
  // OPEN
  if (needsReview) return { label: "要確認", className: "bg-red-100 text-red-600" }
  return { label: "打刻済", className: "bg-gray-100 text-gray-500" }
}

/** HH:MM 形式の文字列を返す（ChangeLog 保存用）*/
export function formatHHMMfromDate(dt: Date | null | undefined): string | null {
  if (!dt) return null
  const j = toJST(dt)
  return `${String(j.getUTCHours()).padStart(2, "0")}:${String(j.getUTCMinutes()).padStart(2, "0")}`
}
