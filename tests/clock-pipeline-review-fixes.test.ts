/**
 * レビュー指摘の修正：日をまたぐ退勤・注意表示の定時・出勤側の④の判定
 */
import { describe, it, expect } from "vitest"
import { needsOvertimeRequestNotice } from "../lib/attendance"
import { computeClockPipeline, isClockInCapped, resolveDaySchedule } from "../lib/clock-pipeline"
import { DATE, ON34, SCHEDULE, earlyReq, hm, jst, sw } from "./helpers/pipeline"

describe("日をまたぐ退勤：定時・④の上限は記録の日付のもの", () => {
  const run = (over: Partial<Parameters<typeof computeClockPipeline>[0]> = {}) =>
    computeClockPipeline({
      date: DATE, inputClockIn: jst(9, 0), inputClockOut: jst(1, 0, 6), schedule: SCHEDULE, switches: sw({ capOvertime: true }),
      requests: [], ...over,
    })

  it("9:00〜翌1:00・④ON・申請なし → 17:30・残業0", () => {
    const r = run()
    expect(hm(r.clockOut)).toBe("17:30")
    expect(r.overtimeMinutes).toBe(0)
  })
  it("残業申請 翌日にかかる終了が無い 19:30 の場合 → 19:30・残業120", () => {
    const r = run({ requests: [{ type: "OVERTIME", status: "APPROVED", createdAt: new Date(), detail: { endTime: "19:30" } }] })
    expect(hm(r.clockOut)).toBe("19:30")
    expect(r.overtimeMinutes).toBe(120)
  })
  it("④OFF なら翌1:00 のまま・残業は終業後 450分", () => {
    const r = run({ switches: sw() })
    expect(hm(r.clockOut)).toBe("01:00")
    expect(r.overtimeMinutes).toBe(450)
  })
  it("③ON でも翌日の定時を基準にしない（翌1:07 → 17:30 起点で 翌1:00）", () => {
    const r = run({ switches: sw({ roundQuarter: true }), inputClockOut: jst(1, 7, 6) })
    expect(hm(r.clockOut)).toBe("01:00")
  })
})

describe("注意表示：段0の定時と記録の日付で判定する", () => {
  const base = { capEnabled: true, hasOvertimeRequest: false, date: DATE }
  const lunch = { workStartTime: "09:00", workEndTime: "17:30", employmentType: "full", breakMinutes: 60, lunchStartTime: "12:00", isRestDay: false } as const

  it("午後半休（定時 9:00〜12:00）・④ON・13:00 退勤 → 注意あり", () => {
    const sch = resolveDaySchedule({ ...lunch, halfDay: "pm" })
    expect(needsOvertimeRequestNotice({ ...base, rawClockOut: jst(13, 0), workEndTime: sch?.end ?? null })).toBe(true)
  })
  it("土曜（休日＝定時なし）18:00 退勤 → 注意なし", () => {
    const sch = resolveDaySchedule({ ...lunch, halfDay: null, isRestDay: true })
    expect(needsOvertimeRequestNotice({ ...base, date: new Date(Date.UTC(2026, 9, 10)), rawClockOut: jst(18, 0, 10), workEndTime: sch?.end ?? null })).toBe(false)
  })
  it("日またぎ（記録の日付の定時 17:30 基準）翌1:00 退勤・申請なし → 注意あり", () => {
    expect(needsOvertimeRequestNotice({ ...base, rawClockOut: jst(1, 0, 6), workEndTime: "17:30" })).toBe(true)
  })
  it("通常日 17:44 は対象外・17:45 は対象", () => {
    expect(needsOvertimeRequestNotice({ ...base, rawClockOut: jst(17, 44), workEndTime: "17:30" })).toBe(false)
    expect(needsOvertimeRequestNotice({ ...base, rawClockOut: jst(17, 45), workEndTime: "17:30" })).toBe(true)
  })
})

describe("出勤側の④（段2）で切った出勤かの判定（/records で実打刻を併記しない）", () => {
  const sw4 = sw({ capOvertime: true })
  const req = [earlyReq("08:00")]
  it("申請 8:00・7:40 出勤 → 8:00 に切られた → true", () => {
    expect(isClockInCapped({ inputClockIn: jst(7, 40), schedule: SCHEDULE, switches: sw4, requests: req })).toBe(true)
  })
  it("④OFF・申請なし・③の丸めだけの差（9:23→9:30 は④ONでも ④と無関係）→ false", () => {
    expect(isClockInCapped({ inputClockIn: jst(9, 23), schedule: SCHEDULE, switches: ON34, requests: [] })).toBe(false)
    expect(isClockInCapped({ inputClockIn: jst(7, 40), schedule: SCHEDULE, switches: sw(), requests: req })).toBe(false)
  })
})
