/**
 * 遅刻早退申請（ABSENCE）による従業員向け「要確認」抑制の回帰テスト
 * 具体例（定時 9:00・9:20 出勤）: docs/IMPLEMENTATION_PLAN_2026-10.md 作業A
 */
import { describe, it, expect } from "vitest"
import { calcNeedsReview, getDisplayStatus, buildLateEarlyStatusMap } from "../lib/attendance"

function jst(y: number, mo: number, d: number, h: number, mi: number): Date {
  return new Date(Date.UTC(y, mo - 1, d, h, mi) - 9 * 60 * 60 * 1000)
}

const date = new Date(Date.UTC(2026, 9, 5))
const today = new Date(Date.UTC(2026, 9, 6))
const lateDay = () =>
  calcNeedsReview({
    clockIn: jst(2026, 10, 5, 9, 20), clockOut: jst(2026, 10, 5, 18, 0),
    date, today, workStartTime: "09:00", workEndTime: "18:00",
  })

/** 画面側の組み立て（records ページと同じ）：承認済みなら要確認を消して渡す */
function employeeStatus(
  needsReview: boolean,
  correction: "PENDING" | "APPROVED" | "REJECTED" | null,
  lateEarly: "PENDING" | "APPROVED" | "REJECTED" | null,
) {
  const nr = needsReview && lateEarly !== "APPROVED"
  return getDisplayStatus("OPEN", nr, correction, lateEarly).label
}

describe("遅刻早退申請と要確認表示（従業員向け）", () => {
  it("前提: 9:20 出勤は要確認", () => {
    expect(lateDay()).toBe(true)
  })
  it("申請前 → 要確認", () => {
    expect(employeeStatus(lateDay(), null, null)).toBe("要確認")
  })
  it("審査中 → 申請中", () => {
    expect(employeeStatus(lateDay(), null, "PENDING")).toBe("申請中")
  })
  it("承認済み → 打刻済（要確認が消える）", () => {
    expect(employeeStatus(lateDay(), null, "APPROVED")).toBe("打刻済")
  })
  it("却下 → 要確認に戻る", () => {
    expect(employeeStatus(lateDay(), null, "REJECTED")).toBe("要確認")
  })
  it("申請なしの遅刻日は要確認のまま", () => {
    expect(employeeStatus(true, null, null)).toBe("要確認")
  })
  it("打刻修正と遅刻早退が両方審査中 → 打刻修正が優先で申請中", () => {
    expect(getDisplayStatus("OPEN", true, "PENDING", "PENDING").label).toBe("申請中")
  })
  it("管理者向け（4番目の引数なし）は申請状態に関係なく要確認のまま", () => {
    expect(getDisplayStatus("OPEN", true, null).label).toBe("要確認")
  })
  it("勤怠承認済み（APPROVED）は遅刻早退申請があっても承認済", () => {
    expect(getDisplayStatus("APPROVED", false, null, "PENDING").label).toBe("承認済")
  })
})

describe("buildLateEarlyStatusMap", () => {
  const keyOf = (d: Date) => d.toISOString()
  it("最新（先頭）の状態を採用する", () => {
    const m = buildLateEarlyStatusMap([
      { targetDate: date, status: "REJECTED", detail: { absenceType: "late" } },
      { targetDate: date, status: "APPROVED", detail: { absenceType: "late" } },
    ], keyOf)
    expect(m.get(date.toISOString())).toBe("REJECTED")
  })
  it("欠勤（absent）は対象外", () => {
    const m = buildLateEarlyStatusMap([
      { targetDate: date, status: "APPROVED", detail: { absenceType: "absent" } },
    ], keyOf)
    expect(m.size).toBe(0)
  })
})
