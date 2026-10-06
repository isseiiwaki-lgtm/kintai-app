/**
 * 日付ヘルパー（lib/date.ts）のテスト。保存規約: 「その日」= UTC 0時
 */
import { describe, it, expect } from "vitest"
import { jstDateToUtcMidnight, parseJstDateString, nthMondayUtc, buildNationalHolidays } from "../lib/date"

describe("jstDateToUtcMidnight", () => {
  it("2026-08-11 → UTC 0時（JST 0時＝前日15時ではない）", () => {
    expect(jstDateToUtcMidnight(2026, 8, 11).toISOString()).toBe("2026-08-11T00:00:00.000Z")
  })
})

describe("parseJstDateString", () => {
  it("手動追加の夏季休暇 8/14 は 8/14 のまま", () => {
    expect(parseJstDateString("2026-08-14")?.toISOString()).toBe("2026-08-14T00:00:00.000Z")
  })
  it("形式不正・存在しない日付は null", () => {
    expect(parseJstDateString("")).toBeNull()
    expect(parseJstDateString("2026/08/14")).toBeNull()
    expect(parseJstDateString("2026-02-30")).toBeNull()
  })
})

describe("nthMondayUtc", () => {
  it("2026年: 成人の日 1/12・海の日 7/20・敬老の日 9/21・スポーツの日 10/12", () => {
    expect(nthMondayUtc(2026, 1, 2).toISOString().slice(0, 10)).toBe("2026-01-12")
    expect(nthMondayUtc(2026, 7, 3).toISOString().slice(0, 10)).toBe("2026-07-20")
    expect(nthMondayUtc(2026, 9, 3).toISOString().slice(0, 10)).toBe("2026-09-21")
    expect(nthMondayUtc(2026, 10, 2).toISOString().slice(0, 10)).toBe("2026-10-12")
  })
})

describe("buildNationalHolidays", () => {
  const h2026 = buildNationalHolidays(2026)
  const find = (name: string) => h2026.find((h) => h.name === name)!.date.toISOString()

  it("全件が UTC 0時で生成される（JST 0時保存の再発防止）", () => {
    for (const h of h2026) expect(h.date.getTime() % (24 * 60 * 60 * 1000)).toBe(0)
  })
  it("山の日は 2026-08-11T00:00:00Z（Excel で 8/11 に出る）", () => {
    expect(find("山の日")).toBe("2026-08-11T00:00:00.000Z")
  })
  it("春分 3/20・秋分 9/23（2026）", () => {
    expect(find("春分の日").slice(0, 10)).toBe("2026-03-20")
    expect(find("秋分の日").slice(0, 10)).toBe("2026-09-23")
  })
  it("16件", () => {
    expect(h2026).toHaveLength(16)
  })
})
