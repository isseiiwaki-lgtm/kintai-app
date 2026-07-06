/**
 * 申請の多段階承認ロジック（純粋関数）
 * 経路: ApprovalRoute（部署ごと・step 昇順）。経路未設定の部署は一段階承認（従来動作）
 * 消化: Approval ログの APPROVED / SKIPPED がステップを消化する（REJECTED は消化しない＝申請自体が却下で終了）
 */

export type RouteStep = { step: number; approverId: string }
export type ApprovalLog = { step: number; action: string }

/** 経路を step 昇順に正規化 */
function sortedRoute(route: RouteStep[]): RouteStep[] {
  return [...route].sort((a, b) => a.step - b.step)
}

/** 現在承認待ちのステップ番号を返す。全ステップ消化済み or 経路なしは null */
export function getCurrentStep(route: RouteStep[], approvals: ApprovalLog[]): number | null {
  const done = new Set(
    approvals.filter(a => a.action === "APPROVED" || a.action === "SKIPPED").map(a => a.step),
  )
  for (const r of sortedRoute(route)) {
    if (!done.has(r.step)) return r.step
  }
  return null
}

/** 指定ステップが経路の最終ステップか */
export function isFinalStep(route: RouteStep[], step: number): boolean {
  if (route.length === 0) return true
  return step === Math.max(...route.map(r => r.step))
}

/** userId が指定ステップの承認者か（ADMIN の特権は呼び出し側で判定する） */
export function isStepApprover(route: RouteStep[], step: number, userId: string): boolean {
  return route.some(r => r.step === step && r.approverId === userId)
}

/** 表示用の承認進捗（消化済みステップ数 / 総ステップ数） */
export function approvalProgress(route: RouteStep[], approvals: ApprovalLog[]): { done: number; total: number } {
  const done = new Set(
    approvals.filter(a => a.action === "APPROVED" || a.action === "SKIPPED").map(a => a.step),
  )
  const consumed = route.filter(r => done.has(r.step)).length
  return { done: consumed, total: route.length }
}
