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
 * - 遅刻（clockIn > workStartTime + 1分）→ 要確認（今日も対象）
 * - 退勤なし（昨日以前）→ 要確認
 * - 早退（clockOut < workEndTime - 1分）→ 要確認（昨日以前）
 *
 * 判定順序:
 *   ① 遅刻チェック（今日含む）
 *   ② 今日以降は以降のチェック不要（退勤未打刻は問題なし）
 *   ③ 昨日以前で退勤なし
 *   ④ 早退チェック
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

  // ① 遅刻: 今日も含めて判定（先に評価）
  if (workStartTime) {
    const startMins = parseHHMM(workStartTime)
    if (startMins !== null && hhmm(clockIn) > startMins + 1) return true
  }

  // ② 今日以降: 退勤未打刻・早退は問題なし
  if (date >= today) return false

  // ③ 昨日以前で退勤打刻なし
  if (!clockOut) return true

  // ④ 早退: clockOut < workEndTime - 1分
  if (workEndTime && clockOut) {
    const endMins = parseHHMM(workEndTime)
    if (endMins !== null && hhmm(clockOut) < endMins - 1) return true
  }

  return false
}

/** HH:MM 文字列を当日の UTC Date に変換（打刻丸め用） */
export function hhmmToUTCDate(hhmm: string, todayUTC: Date): Date {
  const [h, m] = hhmm.split(":").map(Number)
  return new Date(todayUTC.getTime() + (h * 60 + m) * 60 * 1000)
}

/**
 * 打刻丸め: 設定に従い clockIn/clockOut を補正して返す
 * - roundEarly: 定時前打刻 → 定時扱い
 * - roundNear:  定時〜14分以内 → 定時きっかり
 */
export function applyRounding(
  actual: Date,
  scheduled: string | null,
  opts: { roundEarly: boolean; roundNear: boolean },
): Date {
  if (!scheduled) return actual
  // actual の日付部分（UTC）から JST 日付ベースを算出
  const todayUTC = new Date(
    Date.UTC(actual.getUTCFullYear(), actual.getUTCMonth(), actual.getUTCDate())
    - 9 * 60 * 60 * 1000,
  )
  const scheduledDate = hhmmToUTCDate(scheduled, todayUTC)
  const diffMin = Math.round((actual.getTime() - scheduledDate.getTime()) / 60000)

  if (opts.roundEarly && diffMin < 0) return scheduledDate
  if (opts.roundNear  && diffMin >= 0 && diffMin <= 14) return scheduledDate
  return actual
}

/** DBステータス + 要確認判定 → 表示用ラベル・クラス */
export function getDisplayStatus(
  status: string,
  needsReview: boolean,
  correctionStatus?: "PENDING" | "APPROVED" | "REJECTED" | null,
): { label: string; className: string } {
  if (status === "LOCKED")    return { label: "締め済", className: "bg-purple-100 text-purple-700" }
  if (status === "APPROVED") {
    // 打刻修正承認済みは「修正済」で区別
    if (correctionStatus === "APPROVED") return { label: "修正済", className: "bg-teal-100 text-teal-700" }
    return { label: "承認済", className: "bg-green-100 text-green-700" }
  }
  if (status === "SUBMITTED") return { label: "確認済", className: "bg-blue-100 text-blue-700" }
  // OPEN
  // 申請中（CORRECTION申請が審査中）
  if (correctionStatus === "PENDING") return { label: "申請中", className: "bg-blue-100 text-blue-600" }
  if (needsReview) return { label: "要確認", className: "bg-red-100 text-red-600" }
  return { label: "打刻済", className: "bg-gray-100 text-gray-500" }
}

/** HH:MM 形式の文字列を返す（ChangeLog 保存用）*/
export function formatHHMMfromDate(dt: Date | null | undefined): string | null {
  if (!dt) return null
  const j = toJST(dt)
  return `${String(j.getUTCHours()).padStart(2, "0")}:${String(j.getUTCMinutes()).padStart(2, "0")}`
}
