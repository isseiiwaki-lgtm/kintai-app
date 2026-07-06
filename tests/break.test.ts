/**
 * 法定休憩控除（config/attendance.config.ts calcLegalBreak）の境界値回帰テスト
 */
import { describe, it, expect } from "vitest"
import { calcLegalBreak } from "../config/attendance.config"

describe("calcLegalBreak", () => {
  it("481分（8時間超）→ 60分控除", () => {
    expect(calcLegalBreak(481)).toBe(60)
  })
  it("480分ちょうど（8時間）→ 45分控除（『超』のため60分ルール非適用）", () => {
    expect(calcLegalBreak(480)).toBe(45)
  })
  it("361分（6時間超）→ 45分控除", () => {
    expect(calcLegalBreak(361)).toBe(45)
  })
  it("360分ちょうど（6時間）→ 控除なし", () => {
    expect(calcLegalBreak(360)).toBe(0)
  })
  it("0分 → 控除なし", () => {
    expect(calcLegalBreak(0)).toBe(0)
  })
})
