/**
 * 遅刻早退申請（ABSENCE）による従業員向け「要確認」の理由別打ち消しの回帰テスト
 * docs/IMPLEMENTATION_PLAN_2026-10.md 作業A・F2-7
 */
import { describe, it, expect } from "vitest"
import {
  calcNeedsReview, calcReviewReasons, resolveEmployeeReview, getDisplayStatus, buildLateEarlyStatusMap,
  type LateEarlyTypeStatus,
} from "../lib/attendance"

function jst(y: number, mo: number, d: number, h: number, mi: number): Date {
  return new Date(Date.UTC(y, mo - 1, d, h, mi) - 9 * 60 * 60 * 1000)
}

const date = new Date(Date.UTC(2026, 9, 5))
const today = new Date(Date.UTC(2026, 9, 6))

/** 昨日（10/5）の勤務。定時 9:00-18:00 */
function reasons(clockIn: Date | null, clockOut: Date | null) {
  return calcReviewReasons({ clockIn, clockOut, date, today, workStartTime: "09:00", workEndTime: "18:00" })
}

/** 画面側の組み立て（records ページと同じ） */
function employeeStatus(
  r: ReturnType<typeof reasons>,
  typeStatus: LateEarlyTypeStatus | null,
  correction: "PENDING" | "APPROVED" | "REJECTED" | null = null,
) {
  const review = resolveEmployeeReview(r, typeStatus)
  return getDisplayStatus("OPEN", review.needsReview, correction, review.pending).label
}

describe("calcReviewReasons（calcNeedsReview の分解）", () => {
  const cases: [string, Date | null, Date | null][] = [
    ["正常", jst(2026, 10, 5, 9, 0), jst(2026, 10, 5, 18, 0)],
    ["遅刻", jst(2026, 10, 5, 9, 20), jst(2026, 10, 5, 18, 0)],
    ["早退", jst(2026, 10, 5, 9, 0), jst(2026, 10, 5, 14, 0)],
    ["退勤漏れ", jst(2026, 10, 5, 9, 0), null],
    ["遅刻+退勤漏れ", jst(2026, 10, 5, 9, 20), null],
    ["遅刻+早退", jst(2026, 10, 5, 9, 20), jst(2026, 10, 5, 14, 0)],
    ["打刻なし", null, null],
  ]
  for (const [name, i, o] of cases) {
    it(`${name}: 理由の和 = calcNeedsReview`, () => {
      const r = reasons(i, o)
      const legacy = calcNeedsReview({ clockIn: i, clockOut: o, date, today, workStartTime: "09:00", workEndTime: "18:00" })
      expect(r.late || r.early || r.missingOut).toBe(legacy)
    })
  }
  it("遅刻+退勤漏れは遅刻と退勤漏れ（早退は判定しない）", () => {
    expect(reasons(jst(2026, 10, 5, 9, 20), null)).toEqual({ late: true, early: false, missingOut: true })
  })
})

describe("従業員向けの要確認（理由ごとの打ち消し）", () => {
  it("申請前 → 要確認／審査中 → 申請中／承認済み → 打刻済／却下 → 要確認", () => {
    const r = reasons(jst(2026, 10, 5, 9, 20), jst(2026, 10, 5, 18, 0))
    expect(employeeStatus(r, null)).toBe("要確認")
    expect(employeeStatus(r, { late: "PENDING" })).toBe("申請中")
    expect(employeeStatus(r, { late: "APPROVED" })).toBe("打刻済")
    expect(employeeStatus(r, { late: "REJECTED" })).toBe("要確認")
  })
  it("具体例1: 9:20 出勤・退勤漏れ・遅刻申請承認 → 要確認のまま（退勤漏れ）", () => {
    const r = reasons(jst(2026, 10, 5, 9, 20), null)
    expect(employeeStatus(r, { late: "APPROVED" })).toBe("要確認")
  })
  it("具体例2: 9:20 出勤・14:00 退勤・早退申請却下・遅刻申請承認 → 要確認のまま（早退）", () => {
    const r = reasons(jst(2026, 10, 5, 9, 20), jst(2026, 10, 5, 14, 0))
    expect(employeeStatus(r, { late: "APPROVED", early: "REJECTED" })).toBe("要確認")
  })
  it("具体例3: 9:20 出勤・遅刻申請承認のみ → 打刻済", () => {
    const r = reasons(jst(2026, 10, 5, 9, 20), jst(2026, 10, 5, 18, 0))
    expect(employeeStatus(r, { late: "APPROVED" })).toBe("打刻済")
  })
  it("遅刻申請の承認では早退は消えない／早退申請の承認では遅刻は消えない", () => {
    const r = reasons(jst(2026, 10, 5, 9, 20), jst(2026, 10, 5, 14, 0))
    expect(resolveEmployeeReview(r, { late: "APPROVED" }).needsReview).toBe(true)
    expect(resolveEmployeeReview(r, { early: "APPROVED" }).needsReview).toBe(true)
    expect(resolveEmployeeReview(r, { late: "APPROVED", early: "APPROVED" }).needsReview).toBe(false)
  })
  it("遅刻承認＋早退審査中 → 申請中", () => {
    const r = reasons(jst(2026, 10, 5, 9, 20), jst(2026, 10, 5, 14, 0))
    expect(employeeStatus(r, { late: "APPROVED", early: "PENDING" })).toBe("申請中")
  })
  it("退勤漏れは遅刻・早退どちらの申請（審査中でも）でも消えない", () => {
    const r = reasons(jst(2026, 10, 5, 9, 0), null)
    expect(resolveEmployeeReview(r, { late: "APPROVED", early: "APPROVED" }).needsReview).toBe(true)
    expect(employeeStatus(r, { early: "PENDING" })).toBe("要確認")
  })
  it("該当する理由が無ければ審査中の申請があっても打刻済", () => {
    const r = reasons(jst(2026, 10, 5, 9, 0), jst(2026, 10, 5, 18, 0))
    expect(employeeStatus(r, { late: "PENDING" })).toBe("打刻済")
  })
  it("打刻修正と遅刻早退が両方審査中 → 打刻修正が優先で申請中", () => {
    const r = reasons(jst(2026, 10, 5, 9, 20), jst(2026, 10, 5, 18, 0))
    expect(employeeStatus(r, { late: "PENDING" }, "PENDING")).toBe("申請中")
  })
  it("管理者向け（申請状態を渡さない）は要確認のまま", () => {
    expect(getDisplayStatus("OPEN", true, null).label).toBe("要確認")
  })
  it("勤怠承認済み（APPROVED）は承認済", () => {
    expect(getDisplayStatus("APPROVED", false, null, true).label).toBe("承認済")
  })
})

describe("buildLateEarlyStatusMap", () => {
  const keyOf = (d: Date) => d.toISOString()
  it("遅刻・早退それぞれ最新（先頭）の状態を採用する", () => {
    const m = buildLateEarlyStatusMap([
      { targetDate: date, status: "REJECTED", detail: { absenceType: "late" } },
      { targetDate: date, status: "APPROVED", detail: { absenceType: "late" } },
      { targetDate: date, status: "PENDING", detail: { absenceType: "early" } },
    ], keyOf)
    expect(m.get(date.toISOString())).toEqual({ late: "REJECTED", early: "PENDING" })
  })
  it("欠勤（absent）は対象外", () => {
    const m = buildLateEarlyStatusMap([
      { targetDate: date, status: "APPROVED", detail: { absenceType: "absent" } },
    ], keyOf)
    expect(m.size).toBe(0)
  })
})
