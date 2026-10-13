/**
 * 多段階承認ロジック（lib/approval.ts）の回帰テスト
 */
import { describe, it, expect } from "vitest"
import { getCurrentStep, isFinalStep, isStepApprover, approvalProgress } from "../lib/approval"

const route2 = [
  { step: 1, approverId: "leader" },
  { step: 2, approverId: "director" },
]

describe("getCurrentStep", () => {
  it("承認なし → step1 が待ち", () => {
    expect(getCurrentStep(route2, [])).toBe(1)
  })
  it("step1 承認済み → step2 が待ち", () => {
    expect(getCurrentStep(route2, [{ step: 1, action: "APPROVED" }])).toBe(2)
  })
  it("SKIPPED も消化扱い（飛び越し承認）", () => {
    expect(getCurrentStep(route2, [{ step: 1, action: "SKIPPED" }])).toBe(2)
  })
  it("全消化 → null", () => {
    expect(getCurrentStep(route2, [
      { step: 1, action: "APPROVED" },
      { step: 2, action: "APPROVED" },
    ])).toBe(null)
  })
  it("REJECTED は消化しない（却下ログが残っても step は待ちのまま）", () => {
    expect(getCurrentStep(route2, [{ step: 1, action: "REJECTED" }])).toBe(1)
  })
  it("経路なし → null（一段階承認へフォールバック）", () => {
    expect(getCurrentStep([], [])).toBe(null)
  })
  it("経路の順序が乱れていても step 昇順で判定", () => {
    expect(getCurrentStep([route2[1], route2[0]], [])).toBe(1)
  })
})

describe("isFinalStep", () => {
  it("2段経路: step2 のみ最終", () => {
    expect(isFinalStep(route2, 1)).toBe(false)
    expect(isFinalStep(route2, 2)).toBe(true)
  })
  it("経路なしは常に最終（一段階承認）", () => {
    expect(isFinalStep([], 1)).toBe(true)
  })
})

describe("isStepApprover", () => {
  it("担当ステップのみ true", () => {
    expect(isStepApprover(route2, 1, "leader")).toBe(true)
    expect(isStepApprover(route2, 2, "leader")).toBe(false)
    expect(isStepApprover(route2, 2, "director")).toBe(true)
  })
})

describe("approvalProgress", () => {
  it("1/2 承認済み", () => {
    expect(approvalProgress(route2, [{ step: 1, action: "APPROVED" }])).toEqual({ done: 1, total: 2 })
  })
  it("経路外ステップのログはカウントしない", () => {
    expect(approvalProgress(route2, [{ step: 9, action: "APPROVED" }])).toEqual({ done: 0, total: 2 })
  })
})

describe("同じステップに複数の承認者（いずれか1名。IMPLEMENTATION_PLAN L の具体例）", () => {
  // 総務部 step1 に A・B、step2 に C
  const route = [
    { step: 1, approverId: "A" },
    { step: 1, approverId: "B" },
    { step: 2, approverId: "C" },
  ]
  it("step1 は A・B どちらも承認できる。C はまだできない", () => {
    expect(getCurrentStep(route, [])).toBe(1)
    expect(isStepApprover(route, 1, "A")).toBe(true)
    expect(isStepApprover(route, 1, "B")).toBe(true)
    expect(isStepApprover(route, 1, "C")).toBe(false)
  })
  it("A が承認すれば step2 へ（B は操作不要）。進捗は 0/2 → 1/2 → 2/2", () => {
    expect(approvalProgress(route, [])).toEqual({ done: 0, total: 2 })
    const afterA = [{ step: 1, action: "APPROVED" }]
    expect(getCurrentStep(route, afterA)).toBe(2)
    expect(isFinalStep(route, 1)).toBe(false)
    expect(approvalProgress(route, afterA)).toEqual({ done: 1, total: 2 })
    const afterC = [...afterA, { step: 2, action: "APPROVED" }]
    expect(getCurrentStep(route, afterC)).toBeNull()
    expect(approvalProgress(route, afterC)).toEqual({ done: 2, total: 2 })
  })
})
