/**
 * Excel 出力のフォーマット関数テスト
 * 具体例: docs/IMPLEMENTATION_PLAN_2026-10.md 作業F
 */
import { describe, it, expect } from "vitest"
import { fmtDateWithWeekday, fmtWorkRange, fmtRawPunch, fmtChangedTime, fmtLateEarly } from "../lib/export-format"

/** JST の時刻を UTC Date に変換 */
function jst(y: number, mo: number, d: number, h: number, mi: number): Date {
  return new Date(Date.UTC(y, mo - 1, d, h, mi) - 9 * 60 * 60 * 1000)
}

describe("日付（曜日付き）", () => {
  it("2025-11-05 → 11/5(水)", () => {
    expect(fmtDateWithWeekday(new Date(Date.UTC(2025, 10, 5)))).toBe("11/5(水)")
  })
  it("日曜・土曜", () => {
    expect(fmtDateWithWeekday(new Date(Date.UTC(2026, 9, 4)))).toBe("10/4(日)")
    expect(fmtDateWithWeekday(new Date(Date.UTC(2026, 9, 10)))).toBe("10/10(土)")
  })
})

describe("Excel の出勤・退勤・勤務時間・変更列", () => {
  it("実打刻 8:54/15:13・記録 9:00/15:00・修正なし → 勤務時間は記録の時間帯、変更は空欄", () => {
    const rawIn = jst(2026, 10, 5, 8, 54), rawOut = jst(2026, 10, 5, 15, 13)
    const cin = jst(2026, 10, 5, 9, 0), cout = jst(2026, 10, 5, 15, 0)
    expect(fmtRawPunch(rawIn)).toBe("08:54")
    expect(fmtRawPunch(rawOut)).toBe("15:13")
    expect(fmtWorkRange(cin, cout)).toBe("09:00-15:00")
    expect(fmtChangedTime(cin, null)).toBe("")
    expect(fmtChangedTime(cout, null)).toBe("")
  })
  it("退勤 15:17 を管理者が 15:00 に修正 → 退勤 15:17・変更退勤 15:00・勤務時間 …-15:00", () => {
    const rawOut = jst(2026, 10, 5, 15, 17)
    const cout = jst(2026, 10, 5, 15, 0)
    const originalOut = jst(2026, 10, 5, 15, 17) // 修正前の記録時刻
    expect(fmtRawPunch(rawOut)).toBe("15:17")
    expect(fmtChangedTime(cout, originalOut)).toBe("15:00")
    expect(fmtWorkRange(null, cout)).toBe("-15:00")
  })
  it("代理打刻の日（実打刻なし）→ 出勤・退勤は空欄、勤務時間は記録時刻", () => {
    expect(fmtRawPunch(null)).toBe("")
    expect(fmtRawPunch(undefined)).toBe("")
    expect(fmtWorkRange(jst(2026, 10, 5, 9, 0), jst(2026, 10, 5, 17, 30))).toBe("09:00-17:30")
  })
  it("打刻が無い日は勤務時間が空欄", () => {
    expect(fmtWorkRange(null, null)).toBe("")
    expect(fmtWorkRange(undefined, undefined)).toBe("")
  })
  it("JST 0:00〜8:59（UTC では前日）も日本時間で出る", () => {
    expect(fmtRawPunch(jst(2026, 10, 5, 0, 30))).toBe("00:30")
  })
})

describe("遅刻／早退欄", () => {
  it("遅刻だけ → 遅 0:30", () => {
    expect(fmtLateEarly(30, 0)).toBe("遅 0:30")
  })
  it("早退だけ → 早 2:00", () => {
    expect(fmtLateEarly(0, 120)).toBe("早 2:00")
  })
  it("両方 → 遅 0:30 早 1:00", () => {
    expect(fmtLateEarly(30, 60)).toBe("遅 0:30 早 1:00")
  })
  it("0分・無しは出さない", () => {
    expect(fmtLateEarly(0, 0)).toBe("")
    expect(fmtLateEarly(null, undefined)).toBe("")
  })
  it("1時間以上・分は2桁", () => {
    expect(fmtLateEarly(65, 5)).toBe("遅 1:05 早 0:05")
  })
})
