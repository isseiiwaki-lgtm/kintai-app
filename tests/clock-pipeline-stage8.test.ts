/**
 * 段8：残業 ＝ 早出（定時の始業 − 記録した出勤）＋ 残業（記録した退勤 − 定時の終業）（docs/CLOCK_PIPELINE.md）
 */
import { describe, it, expect } from "vitest"
import { calcMetrics, resolveDayMetrics } from "../lib/attendance"
import { jst, run, sw } from "./helpers/pipeline"

describe("段8：残業の式", () => {
  it("早出60分＋退勤後30分 → 残業90分（8:00 出勤・18:00 退勤・定時 9:00〜17:30）", () => {
    const r = run({ in: jst(8, 0), out: jst(18, 0) })
    expect(r.earlyStartMinutes).toBe(60)
    expect(r.afterHoursMinutes).toBe(30)
    expect(r.overtimeMinutes).toBe(90)
  })
  it("どちらも0未満は0（遅刻して定時で退勤 → 残業0）", () => {
    expect(run({ in: jst(9, 20), out: jst(17, 30) }).overtimeMinutes).toBe(0)
  })
  it("遅刻した日の残業は終業後だけ（9:20 出勤・18:00 退勤 → 30分。遅刻と相殺しない）", () => {
    const r = run({ in: jst(9, 20), out: jst(18, 0) })
    expect(r.overtimeMinutes).toBe(30)
    expect(r.lateMinutes).toBe(20)
  })
  it("実働−所定の差し引きではない（休憩を引く前の拘束で数えない）：定時どおり 9:00〜17:30 → 0", () => {
    expect(run({ in: jst(9, 0), out: jst(17, 30) }).overtimeMinutes).toBe(0)
  })
  it("退勤が欠けた日は残業を出さない", () => {
    expect(run({ in: jst(8, 0) }).overtimeMinutes).toBe(0)
  })
  it("定時なし（休日）は0", () => {
    expect(run({ in: jst(8, 0), out: jst(18, 0), schedule: null }).overtimeMinutes).toBe(0)
  })
  it("日をまたぐ深夜残業も時刻の差で数える（9:00〜翌1:00 → 退勤後 7:30）", () => {
    const r = calcMetrics({
      clockIn: jst(9, 0), clockOut: new Date(jst(1, 0, 6).getTime()),
      workStartTime: "09:00", workEndTime: "17:30",
    })
    expect(r.afterHoursMinutes).toBe(450)
  })
  it("③ON の記録時刻（15分丸め）から出す：8:10 出勤→8:15・18:07 退勤→18:00 → 45＋30 = 75分", () => {
    const r = run({ in: jst(8, 10), out: jst(18, 7), switches: sw({ roundQuarter: true }) })
    expect(r.overtimeMinutes).toBe(75)
  })
})

describe("段8：画面・Excel の保存値が無いときの計算（resolveDayMetrics）は同じ式", () => {
  const rec = (over: Partial<Parameters<typeof resolveDayMetrics>[0]> = {}) => ({
    clockIn: jst(8, 0), clockOut: jst(18, 0), lateMinutes: null, earlyLeaveMinutes: null, overtimeMinutes: null, ...over,
  })
  const schedule = { start: "09:00", end: "17:30" }
  it("保存値が無い → 記録時刻と定時の差（残業90）", () => {
    expect(resolveDayMetrics(rec(), schedule)).toEqual({ lateMinutes: 0, earlyLeaveMinutes: 0, overtimeMinutes: 90 })
  })
  it("保存値があればそれを使う（0 も尊重）", () => {
    expect(resolveDayMetrics(rec({ overtimeMinutes: 0, lateMinutes: 0, earlyLeaveMinutes: 0 }), schedule))
      .toEqual({ lateMinutes: 0, earlyLeaveMinutes: 0, overtimeMinutes: 0 })
  })
  it("定時なし（休日）なら全部0", () => {
    expect(resolveDayMetrics(rec(), null)).toEqual({ lateMinutes: 0, earlyLeaveMinutes: 0, overtimeMinutes: 0 })
  })
  it("保存値が無い（承認前）9:20 出勤・14:00 退勤 → 遅刻20・早退210（定時 9:00〜17:30）", () => {
    expect(resolveDayMetrics(rec({ clockIn: jst(9, 20), clockOut: jst(14, 0) }), schedule))
      .toMatchObject({ lateMinutes: 20, earlyLeaveMinutes: 210, overtimeMinutes: 0 })
  })
})
