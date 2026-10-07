/**
 * 段1：入力の時刻 / 段2：早出（出勤側）（docs/CLOCK_PIPELINE.md）
 */
import { describe, it, expect } from "vitest"
import { REQUEST_TIME_STEP_MINUTES } from "../config/attendance.config"
import { ceilToRequestStep, pickEarlyStartTime, resolveInputTime } from "../lib/clock-pipeline"
import { DATE, OFF, ON34, earlyReq, hm, jst, overtimeReq, run, sw } from "./helpers/pipeline"

describe("段1：入力の時刻", () => {
  it("変更履歴が無ければ実打刻", () => {
    const r = resolveInputTime({ date: DATE, raw: jst(8, 50), recorded: jst(9, 0), logs: [] })
    expect(r.source).toBe("raw")
    expect(hm(r.time)).toBe("08:50")
  })
  it("打刻修正で直した時刻があればそれが入力（実打刻より新しい変更履歴の新しい値）", () => {
    const r = resolveInputTime({
      date: DATE, raw: jst(9, 20), recorded: jst(9, 0),
      logs: [{ newValue: "09:00", changedAt: new Date(jst(12, 0).getTime()) }],
    })
    expect(r.source).toBe("corrected")
    expect(hm(r.time)).toBe("09:00")
  })
  it("複数回直したら最新の値", () => {
    const r = resolveInputTime({
      date: DATE, raw: jst(9, 20), recorded: null,
      logs: [
        { newValue: "09:05", changedAt: jst(12, 0) },
        { newValue: "08:55", changedAt: jst(13, 0) },
      ],
    })
    expect(hm(r.time)).toBe("08:55")
  })
  it("実打刻のほうが新しければ（修正のあとに打刻し直した）実打刻", () => {
    const r = resolveInputTime({
      date: DATE, raw: jst(15, 0), recorded: null,
      logs: [{ newValue: "09:00", changedAt: jst(12, 0) }],
    })
    expect(r.source).toBe("raw")
  })
  it("実打刻も修正も無い既存の記録は、記録時刻をそのまま使う（丸めない）", () => {
    const r = resolveInputTime({ date: DATE, raw: null, recorded: jst(9, 7), logs: [] })
    expect(r.source).toBe("recorded")
    expect(hm(r.time)).toBe("09:07")
  })
  it("修正した時刻にも以降の段の丸めをかける（修正 9:23・③ON → 9:30）", () => {
    const r = resolveInputTime({ date: DATE, raw: jst(9, 40), recorded: null, logs: [{ newValue: "09:23", changedAt: jst(12, 0) }] })
    expect(hm(run({ in: r.time, switches: ON34 }).clockIn)).toBe("09:30")
  })
})

describe("段2：申請の時刻の刻み（フォームとパイプラインが同じ定数を参照）", () => {
  it("定数は1か所（15分）", () => {
    expect(REQUEST_TIME_STEP_MINUTES).toBe(15)
  })
  it("実打刻を申請の刻みで切り上げる（7:40 → 7:45、8:13 → 8:15、8:15 → 8:15）", () => {
    expect(hm(ceilToRequestStep(jst(7, 40)))).toBe("07:45")
    expect(hm(ceilToRequestStep(jst(8, 13)))).toBe("08:15")
    expect(hm(ceilToRequestStep(jst(8, 15)))).toBe("08:15")
  })
  it("秒は落として数える（8:15:40 は 8:15 扱い）", () => {
    expect(hm(ceilToRequestStep(new Date(jst(8, 15).getTime() + 40_000)))).toBe("08:15")
  })
  it("刻みは引数で変えられる（10分刻みなら 8:13 → 8:20）", () => {
    expect(hm(ceilToRequestStep(jst(8, 13), 10))).toBe("08:20")
  })
})

describe("段2：早出申請がある日（定時 9:00・申請 8:00・④ON）仕様書の例", () => {
  const sw4 = sw({ capOvertime: true })
  const req = [earlyReq("08:00")]

  it("7:40 → 8:00", () => {
    expect(hm(run({ in: jst(7, 40), switches: sw4, requests: req }).clockIn)).toBe("08:00")
  })
  it("8:13 → 8:15", () => {
    expect(hm(run({ in: jst(8, 13), switches: sw4, requests: req }).clockIn)).toBe("08:15")
  })
  it("8:50 → 申請無効（有効な開始が 9:00 以降）→ 申請が無い日と同じ。全部 OFF なら 8:50", () => {
    const r = run({ in: jst(8, 50), switches: sw4, requests: req })
    expect(hm(r.clockIn)).toBe("08:50")
    expect(r.earlyStartRequestApplied).toBe(false)
  })
  it("8:50 → 申請無効 → ①が ON なら 9:00", () => {
    expect(hm(run({ in: jst(8, 50), switches: sw({ capOvertime: true, roundEarly: true }), requests: req }).clockIn)).toBe("09:00")
  })
  it("8:50 → 申請無効 → ②が ON なら 9:00", () => {
    expect(hm(run({ in: jst(8, 50), switches: sw({ capOvertime: true, roundNear: true }), requests: req }).clockIn)).toBe("09:00")
  })
  it("有効な早出申請の日は①を使わない（①ON でも 7:40 → 8:00）", () => {
    const r = run({ in: jst(7, 40), switches: sw({ capOvertime: true, roundEarly: true }), requests: req })
    expect(hm(r.clockIn)).toBe("08:00")
    expect(r.earlyStartRequestApplied).toBe(true)
  })
  it("③ON でも効く（8:10 → 切り上げ 8:15 → ③ 8:15）", () => {
    expect(hm(run({ in: jst(8, 10), switches: ON34, requests: req }).clockIn)).toBe("08:15")
  })
  it("遅刻側（定時後の出勤）は申請があっても通常どおり：9:10 → 9:10", () => {
    expect(hm(run({ in: jst(9, 10), switches: sw4, requests: req }).clockIn)).toBe("09:10")
  })
  it("④OFF なら申請の開始で打ち切らない（7:40 は 7:40 のまま）", () => {
    const r = run({ in: jst(7, 40), switches: OFF, requests: req })
    expect(hm(r.clockIn)).toBe("07:40")
    expect(r.earlyStartRequestApplied).toBe(true)
  })
  it("申請の開始が定時以降なら申請は無効", () => {
    const r = run({ in: jst(8, 30), switches: sw4, requests: [earlyReq("09:00")] })
    expect(r.earlyStartRequestApplied).toBe(false)
    expect(hm(r.clockIn)).toBe("08:30")
  })
  it("審査中・却下の早出申請は入力に使わない（承認済みだけ）", () => {
    expect(pickEarlyStartTime([earlyReq("08:00", undefined, "PENDING")])).toBeNull()
    expect(pickEarlyStartTime([earlyReq("08:00", undefined, "REJECTED")])).toBeNull()
    expect(hm(run({ in: jst(7, 40), switches: sw4, requests: [earlyReq("08:00", undefined, "PENDING")] }).clockIn)).toBe("07:40")
  })
  it("残業申請（早出でない）は段2に影響しない", () => {
    expect(pickEarlyStartTime([overtimeReq("19:00")])).toBeNull()
  })
  it("早出申請を却下／削除すると申請が無い日と同じ（①ON なら 7:40 → 9:00）", () => {
    expect(hm(run({ in: jst(7, 40), switches: sw({ capOvertime: true, roundEarly: true }), requests: [] }).clockIn)).toBe("09:00")
  })
})

describe("段2：申請が無い日", () => {
  it("①ON なら定時前の出勤は定時（8:10 → 9:00）", () => {
    expect(hm(run({ in: jst(8, 10), switches: sw({ roundEarly: true }) }).clockIn)).toBe("09:00")
  })
  it("全部 OFF なら実打刻のまま（8:10 → 8:10）", () => {
    expect(hm(run({ in: jst(8, 10) }).clockIn)).toBe("08:10")
  })
  it("④ON でも申請が無い日の出勤は定時で打ち切らない（④は退勤側）：8:50 → 8:50", () => {
    expect(hm(run({ in: jst(8, 50), switches: sw({ capOvertime: true }) }).clockIn)).toBe("08:50")
  })
})
