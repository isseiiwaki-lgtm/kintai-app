// 休暇申請（LEAVE）の休暇種別。システムが実際に使う値：paid（有給）・substitute（旧い振休申請）・special（特別休暇。有給/無給は isPaid）
export const LEAVE_TYPE_LABEL: Record<string, string> = {
  paid: "有給",
  substitute: "振休",
  special: "特別休暇",
}

/**
 * 管理者の修正フォームに出す休暇種別の選択肢。
 * 新規の振休は廃止済みなので、振休・特別休暇は「すでにその種別の申請」を直すときだけ出す（種別を黙って変えないため）
 */
export function leaveTypeOptions(current: unknown): { value: string; label: string }[] {
  const opts = [{ value: "paid", label: LEAVE_TYPE_LABEL.paid }]
  if (current === "substitute") opts.push({ value: "substitute", label: LEAVE_TYPE_LABEL.substitute })
  if (current === "special") opts.push({ value: "special", label: LEAVE_TYPE_LABEL.special })
  return opts
}

/**
 * 修正フォームの初期の休暇種別。既存の種別を保つ。
 * 過去の管理者修正で入った "annual"（システムが使わない値。Excel の有給に数えられない）は paid として扱い、次の保存で直る
 */
export function initialLeaveType(current: unknown): string {
  if (current === "substitute" || current === "special") return current
  return "paid"
}
