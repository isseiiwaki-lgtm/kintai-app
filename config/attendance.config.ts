/**
 * 勤怠管理 設定ファイル
 * 管理者が直接編集して運用する。
 * 将来的には DB 管理画面 or ユーザー個別設定へ移行予定。
 */

/** 法定休憩ルール（日本労働基準法）
 *  勤務時間が overMinutes を超えた場合、breakMinutes を自動差し引き。
 *  配列は overMinutes 降順で記述すること（最初にマッチしたルールを適用）。
 */
export const BREAK_RULES: { overMinutes: number; breakMinutes: number }[] = [
  { overMinutes: 480, breakMinutes: 60 }, // 8時間超 → 60分
  { overMinutes: 360, breakMinutes: 45 }, // 6時間超 → 45分
  { overMinutes: 0,   breakMinutes: 0  }, // 6時間以内 → 0分
]

/** 法定休憩時間を計算する
 *  @param rawMinutes 外出時間を差し引いた純粋な在席時間（分）
 *  @returns 差し引くべき休憩時間（分）
 */
export function calcLegalBreak(rawMinutes: number): number {
  for (const rule of BREAK_RULES) {
    if (rawMinutes > rule.overMinutes) return rule.breakMinutes
  }
  return 0
}
