/**
 * Excel（個人別日別勤務報告書）の表示用フォーマット関数。
 * 旧勤怠Reco の意味に揃える（docs/SESSION_2026-09-16_admin-requests.md「5・6. Excel」）。
 * 時刻は DB の UTC → JST 変換（formatHHMMfromDate が JST の HH:MM を返す）。
 */
import { formatHHMMfromDate } from "@/lib/attendance"

const WEEKDAY = ["日", "月", "火", "水", "木", "金", "土"]

/** 日付 → `11/5(水)`。dayDate は「UTC 0時＝その日」で保存された日付 */
export function fmtDateWithWeekday(dayDate: Date): string {
  return `${dayDate.getUTCMonth() + 1}/${dayDate.getUTCDate()}(${WEEKDAY[dayDate.getUTCDay()]})`
}

/**
 * 勤務時間欄 → 記録時刻（clockIn/clockOut）の時間帯 `09:00-15:00`。
 * 両方無ければ空欄。片方だけなら無い側を空にして `09:00-` / `-15:00`。
 */
export function fmtWorkRange(
  clockIn: Date | null | undefined,
  clockOut: Date | null | undefined,
): string {
  if (!clockIn && !clockOut) return ""
  return `${formatHHMMfromDate(clockIn) ?? ""}-${formatHHMMfromDate(clockOut) ?? ""}`
}

/** 出勤・退勤欄（AD・AE）→ 実打刻 rawClockIn/Out の HH:MM。実打刻が無い日は空欄（記録時刻で埋めない） */
export function fmtRawPunch(raw: Date | null | undefined): string {
  return formatHHMMfromDate(raw) ?? ""
}

/**
 * 変更出勤・変更退勤欄（旧Excel の意味）。
 * 「手を入れた日」＝その日の変更履歴（AttendanceChangeLog）に clockIn / clockOut の変更がある日。
 * - 手を入れた日は出勤・退勤の両方を出す。直した側は直した時刻（記録時刻 clockIn/clockOut）、
 *   直していない側は実打刻（rawClockIn/Out）。実打刻が無ければ記録時刻
 * - 手を入れていない日、および値が無い欄は `-`（変更欄だけ。他の欄の空欄表記は変えない）
 * - 遅刻・早退申請の承認だけの日は変更履歴が無いので対象外
 * changedFields は変更履歴の fieldName 一覧（clockIn / clockOut 以外は無視する）。
 */
export function fmtChangedPair(
  rec: {
    clockIn: Date | null | undefined
    clockOut: Date | null | undefined
    rawClockIn: Date | null | undefined
    rawClockOut: Date | null | undefined
  } | null | undefined,
  changedFields: readonly string[],
): { changedIn: string; changedOut: string } {
  const none = { changedIn: "-", changedOut: "-" }
  if (!rec) return none
  const touchedIn = changedFields.includes("clockIn")
  const touchedOut = changedFields.includes("clockOut")
  if (!touchedIn && !touchedOut) return none
  const inVal = touchedIn ? rec.clockIn : (rec.rawClockIn ?? rec.clockIn)
  const outVal = touchedOut ? rec.clockOut : (rec.rawClockOut ?? rec.clockOut)
  return {
    changedIn: formatHHMMfromDate(inVal) ?? "-",
    changedOut: formatHHMMfromDate(outVal) ?? "-",
  }
}

/** 分 → H:MM。fmtLateEarly 用 */
function minToHMM(min: number): string {
  return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, "0")}`
}

/**
 * 遅刻／早退欄 → 旧Excel と同じ表記。`遅 0:30` / `早 2:00`、両方ある日は `遅 0:30 早 1:00`。
 * 0分（または無し）の側は出さない。両方 0 なら空欄。
 * この欄は文字を含む備考欄のような扱い（Excel 上で集計に使えない）。
 */
export function fmtLateEarly(
  lateMinutes: number | null | undefined,
  earlyLeaveMinutes: number | null | undefined,
): string {
  const parts: string[] = []
  if (lateMinutes && lateMinutes > 0) parts.push(`遅 ${minToHMM(lateMinutes)}`)
  if (earlyLeaveMinutes && earlyLeaveMinutes > 0) parts.push(`早 ${minToHMM(earlyLeaveMinutes)}`)
  return parts.join(" ")
}
