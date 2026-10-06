/**
 * 遅刻・早退（分）: 保存値が無ければ記録時刻から計算（画面と Excel で共通・F2-3）
 */
import { describe, it, expect } from "vitest"
import { resolveLateEarlyMinutes } from "../lib/attendance"

function jst(h: number, mi: number): Date {
  return new Date(Date.UTC(2026, 9, 5, h, mi) - 9 * 60 * 60 * 1000)
}
const user = { workStartTime: "09:00", workEndTime: "18:00", employmentType: "full" }

describe("resolveLateEarlyMinutes", () => {
  it("保存値が無い（承認前）→ 記録時刻から計算（9:20 出勤・14:00 退勤 → 遅刻20・早退240）", () => {
    const r = resolveLateEarlyMinutes(
      { clockIn: jst(9, 20), clockOut: jst(14, 0), workingMinutes: 280, lateMinutes: null, earlyLeaveMinutes: null },
      user,
    )
    expect(r).toEqual({ lateMinutes: 20, earlyLeaveMinutes: 240 })
  })
  it("保存値があればそれを使う（0 も保存値として尊重。休日出勤は 0 保存）", () => {
    const r = resolveLateEarlyMinutes(
      { clockIn: jst(9, 20), clockOut: jst(14, 0), workingMinutes: 280, lateMinutes: 0, earlyLeaveMinutes: 0 },
      user,
    )
    expect(r).toEqual({ lateMinutes: 0, earlyLeaveMinutes: 0 })
  })
  it("退勤前（clockOut なし）は遅刻だけ計算", () => {
    const r = resolveLateEarlyMinutes(
      { clockIn: jst(9, 20), clockOut: null, workingMinutes: null, lateMinutes: null, earlyLeaveMinutes: null },
      user,
    )
    expect(r).toEqual({ lateMinutes: 20, earlyLeaveMinutes: 0 })
  })
})
