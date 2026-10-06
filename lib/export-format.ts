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
 * 変更出勤・変更退勤欄 → 修正後の記録時刻。修正した日（originalClockIn/Out がある側）だけ出す。
 * original は「修正前の記録時刻」なので出力には使わず、修正の有無の判定にだけ使う。
 */
export function fmtChangedTime(
  current: Date | null | undefined,
  original: Date | null | undefined,
): string {
  if (!original) return ""
  return formatHHMMfromDate(current) ?? ""
}
