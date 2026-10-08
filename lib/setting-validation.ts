/**
 * 会社設定の数値入力の検証（サーバー側）。フォームの min/required はブラウザ任せなので、保存前にここで確かめる。
 * 空欄は Number("") ＝ 0 になって通ってしまうため、文字列のまま空・非数を弾く。エラーメッセージ（日本語）か null を返す
 */
export function validateSettingNumbers(raw: {
  closingDay: unknown
  break1Threshold: unknown
  break1Minutes: unknown
  break2Threshold: unknown
  break2Minutes: unknown
}): string | null {
  const num = (v: unknown): number => (typeof v === "string" && v.trim() !== "" ? Number(v) : NaN)

  const closingDay = num(raw.closingDay)
  if (!Number.isInteger(closingDay) || closingDay < 1 || closingDay > 28) {
    return "締め日は1〜28の整数で入力してください"
  }

  const fields: { key: keyof typeof raw; label: string; positive: boolean }[] = [
    { key: "break1Threshold", label: "ルール1の閾値（分）", positive: true },
    { key: "break1Minutes", label: "ルール1の控除（分）", positive: false },
    { key: "break2Threshold", label: "ルール2の閾値（分）", positive: true },
    { key: "break2Minutes", label: "ルール2の控除（分）", positive: false },
  ]
  for (const f of fields) {
    const n = num(raw[f.key])
    if (!Number.isFinite(n) || !Number.isInteger(n)) return `${f.label}は数値（整数）で入力してください`
    if (n < 0) return `${f.label}は0以上で入力してください`
    if (f.positive && n <= 0) return `${f.label}は1以上で入力してください`
  }
  return null
}
