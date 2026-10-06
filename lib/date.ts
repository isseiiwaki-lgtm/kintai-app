/**
 * 日付ヘルパー（「その日」を表す日付の保存規約）
 *
 * 規約: 勤怠記録の date・休日の date・締め期間など「その日」を表す日付は
 *       **UTC 0時を日付の通し番号として保存**する。
 *       人間は常に日本時間の日付で考えているので、入力時に「日本時間の年月日 → UTC 0時」へ変換し、
 *       表示時に日本時間へ戻す。`new Date(y, m-1, d)`（サーバーのローカル＝JST 0時）で保存しない。
 *       （2026-09 の山の日ずれ＝祝日シードだけ JST 0時保存だったことの再発防止）
 *
 * 日付を入力・生成する経路（画面・CSV・シード）は必ずここの関数を使うこと。
 */

/** 日本時間の年・月(1-12)・日 → 保存用の UTC 0時 */
export function jstDateToUtcMidnight(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day))
}

/**
 * "YYYY-MM-DD"（日付入力・CSV の日付文字列）→ 保存用の UTC 0時。
 * 形式不正・存在しない日付は null
 */
export function parseJstDateString(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim())
  if (!m) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const date = jstDateToUtcMidnight(y, mo, d)
  // 2/30 などの存在しない日付を弾く（Date.UTC は繰り上げてしまう）
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null
  return date
}

/** 第 n 月曜日（ハッピーマンデー用）。保存用の UTC 0時で返す */
export function nthMondayUtc(year: number, month: number, n: number): Date {
  const dow = jstDateToUtcMidnight(year, month, 1).getUTCDay()
  const first = dow === 1 ? 1 : ((8 - dow) % 7) + 1
  return jstDateToUtcMidnight(year, month, first + (n - 1) * 7)
}

/** 国民の祝日（固定・ハッピーマンデー・春分/秋分）を年単位で生成。振替休日は含まない。date は UTC 0時 */
export function buildNationalHolidays(year: number): { date: Date; name: string }[] {
  const fixed: { month: number; day: number; name: string }[] = [
    { month: 1,  day: 1,  name: "元日" },
    { month: 2,  day: 11, name: "建国記念の日" },
    { month: 2,  day: 23, name: "天皇誕生日" },
    { month: 4,  day: 29, name: "昭和の日" },
    { month: 5,  day: 3,  name: "憲法記念日" },
    { month: 5,  day: 4,  name: "みどりの日" },
    { month: 5,  day: 5,  name: "こどもの日" },
    { month: 8,  day: 11, name: "山の日" },
    { month: 11, day: 3,  name: "文化の日" },
    { month: 11, day: 23, name: "勤労感謝の日" },
  ]

  // 春分・秋分の日（簡易計算）
  const shunbun = Math.floor(20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4))
  const shubun  = Math.floor(23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4))

  return [
    ...fixed.map((h) => ({ date: jstDateToUtcMidnight(year, h.month, h.day), name: h.name })),
    { date: nthMondayUtc(year, 1, 2),  name: "成人の日" },
    { date: nthMondayUtc(year, 7, 3),  name: "海の日" },
    { date: nthMondayUtc(year, 9, 3),  name: "敬老の日" },
    { date: nthMondayUtc(year, 10, 2), name: "スポーツの日" },
    { date: jstDateToUtcMidnight(year, 3, shunbun), name: "春分の日" },
    { date: jstDateToUtcMidnight(year, 9, shubun),  name: "秋分の日" },
  ]
}
