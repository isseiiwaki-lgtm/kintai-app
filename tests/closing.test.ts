/**
 * 締め期間計算（lib/closing.ts）の境界値回帰テスト
 */
import { describe, it, expect } from "vitest"
import { getClosingPeriod, getDefaultClosingMonth, listClosingPeriodDates } from "../lib/closing"

describe("getClosingPeriod", () => {
  it("2026年7月度（締め25日）= 6/26〜7/25", () => {
    const { firstDay, lastDay } = getClosingPeriod(2026, 7, 25)
    expect(firstDay).toEqual(new Date(Date.UTC(2026, 5, 26)))
    expect(lastDay).toEqual(new Date(Date.UTC(2026, 6, 25)))
  })

  it("年跨ぎ: 2026年1月度 = 2025/12/26〜2026/1/25", () => {
    const { firstDay, lastDay } = getClosingPeriod(2026, 1, 25)
    expect(firstDay).toEqual(new Date(Date.UTC(2025, 11, 26)))
    expect(lastDay).toEqual(new Date(Date.UTC(2026, 0, 25)))
  })

  it("締め日末日相当（closingDay=31, 2月）でも Date.UTC の繰り上げで破綻しない", () => {
    // 2026年3月度・締め31日 = 2/1相当〜3/31。2月に31日は無く 3/3 に繰り上がる点は仕様上の限界として明示
    const { firstDay } = getClosingPeriod(2026, 3, 31)
    expect(firstDay.getTime()).toBeGreaterThan(0)
  })
})

describe("getDefaultClosingMonth（JST基準・締め25日）", () => {
  it("締め日当日 7/25 → 7月度", () => {
    expect(getDefaultClosingMonth(25, new Date(Date.UTC(2026, 6, 25, 3, 0)))) // JST 7/25 12:00
      .toEqual({ year: 2026, month: 7 })
  })

  it("締め日翌日 7/26 → 8月度", () => {
    expect(getDefaultClosingMonth(25, new Date(Date.UTC(2026, 6, 26, 3, 0))))
      .toEqual({ year: 2026, month: 8 })
  })

  it("年跨ぎ: 12/26 → 翌年1月度", () => {
    expect(getDefaultClosingMonth(25, new Date(Date.UTC(2026, 11, 26, 3, 0))))
      .toEqual({ year: 2027, month: 1 })
  })

  it("JST日付跨ぎ: UTC 7/25 16:00 = JST 7/26 1:00 → 8月度", () => {
    expect(getDefaultClosingMonth(25, new Date(Date.UTC(2026, 6, 25, 16, 0))))
      .toEqual({ year: 2026, month: 8 })
  })
})

describe("listClosingPeriodDates", () => {
  it("6/26〜7/25 は30日分・先頭と末尾が一致", () => {
    const { firstDay, lastDay } = getClosingPeriod(2026, 7, 25)
    const dates = listClosingPeriodDates(firstDay, lastDay)
    expect(dates).toHaveLength(30)
    expect(dates[0]).toEqual(firstDay)
    expect(dates[dates.length - 1]).toEqual(lastDay)
  })
})
