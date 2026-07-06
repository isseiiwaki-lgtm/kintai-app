/**
 * 締め期間計算の共通関数
 * 「今月」= 前月(closingDay+1)日 〜 当月closingDay日（すべて UTC の日付 0:00 基準）
 * 新規に日付範囲を扱う実装は必ずここを使う（暦月ベタ書き禁止）
 */

/** 対象年月(year, month=1-12)の締め期間を返す */
export function getClosingPeriod(year: number, month: number, closingDay: number) {
  const firstDay = new Date(Date.UTC(year, month - 2, closingDay + 1))
  const lastDay = new Date(Date.UTC(year, month - 1, closingDay))
  return { firstDay, lastDay }
}

/**
 * デフォルト表示月を返す（JST 当日 > closingDay なら翌月扱い）
 * now は省略時現在時刻
 */
export function getDefaultClosingMonth(closingDay: number, now: Date = new Date()) {
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000)
  let year = jst.getUTCFullYear()
  let month = jst.getUTCMonth() + 1
  if (jst.getUTCDate() > closingDay) {
    month += 1
    if (month > 12) {
      month = 1
      year += 1
    }
  }
  return { year, month }
}

/** 締め期間内の日付（UTC 0:00 の Date）を列挙 */
export function listClosingPeriodDates(firstDay: Date, lastDay: Date): Date[] {
  const dates: Date[] = []
  for (let t = firstDay.getTime(); t <= lastDay.getTime(); t += 24 * 60 * 60 * 1000) {
    dates.push(new Date(t))
  }
  return dates
}
