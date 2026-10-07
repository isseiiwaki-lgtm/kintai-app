/**
 * 段6.5：管理者の確定修正（docs/CLOCK_PIPELINE.md）
 * 管理者の直接修正・代理打刻の時刻は段0〜6の結果を最後に上書きし、遅刻・早退・残業は上書き後の時刻から出す
 */
import { describe, it, expect } from "vitest"
import { buildAdminTimeOptions, computeClockPipeline, type AdminTimeConstraint } from "../lib/clock-pipeline"
import { OFF, ON34, SCHEDULE, hm, jst, sw } from "./helpers/pipeline"

describe("段6.5：管理者の値が最後に勝つ", () => {
  const base = { schedule: SCHEDULE, requests: [] }

  it("丸め・④を通さない：③④ON でも管理者の 9:07 / 19:00 がそのまま記録される", () => {
    const r = computeClockPipeline({
      ...base, switches: ON34, inputClockIn: jst(9, 23), inputClockOut: jst(19, 51),
      adminClockIn: jst(9, 7), adminClockOut: jst(19, 0),
    })
    expect(hm(r.clockIn)).toBe("09:07")
    expect(hm(r.clockOut)).toBe("19:00")
  })

  it("遅刻・早退・残業は上書き後の時刻から出す（9:07 出勤 → 遅刻7、19:00 退勤 → 残業90）", () => {
    const r = computeClockPipeline({
      ...base, switches: ON34, inputClockIn: jst(9, 23), inputClockOut: jst(19, 51),
      adminClockIn: jst(9, 7), adminClockOut: jst(19, 0),
    })
    expect(r).toMatchObject({ lateMinutes: 7, earlyLeaveMinutes: 0, overtimeMinutes: 90 })
  })

  it("片側だけ管理者が直したら、もう片側は段0〜6の結果のまま", () => {
    const r = computeClockPipeline({
      ...base, switches: ON34, inputClockIn: jst(9, 23), inputClockOut: jst(17, 20), adminClockIn: jst(9, 0),
    })
    expect(hm(r.clockIn)).toBe("09:00")
    expect(hm(r.clockOut)).toBe("17:15")
  })

  it("④の上限が出勤より前でも、管理者の退勤があれば勤務0分にしない", () => {
    const r = computeClockPipeline({
      ...base, switches: ON34, inputClockIn: jst(18, 0), inputClockOut: jst(20, 0), adminClockOut: jst(20, 0),
    })
    expect(r.capBeforeClockIn).toBe(false)
    expect(hm(r.clockOut)).toBe("20:00")
  })

  it("管理者の値が無ければ従来どおり", () => {
    expect(hm(computeClockPipeline({ ...base, switches: ON34, inputClockIn: jst(9, 23), inputClockOut: null }).clockIn)).toBe("09:30")
  })
})

describe("段6.5：入力画面の選択肢（その時刻をパイプラインに通しても変わらない時刻だけ）", () => {
  const c = (over: Partial<AdminTimeConstraint> = {}): AdminTimeConstraint => ({
    schedule: SCHEDULE, switches: OFF, earlyStartTime: null, overtimeCapEnd: null, ...over,
  })

  it("全スイッチ OFF：出勤・退勤とも1分単位で全時間帯", () => {
    expect(buildAdminTimeOptions("clockIn", c(), false)).toHaveLength(1440)
    expect(buildAdminTimeOptions("clockOut", c(), false)).toHaveLength(1440)
  })

  it("③ON：出勤・退勤とも定時を起点にした15分刻みだけ（96個）", () => {
    const inOpts = buildAdminTimeOptions("clockIn", c({ switches: sw({ roundQuarter: true }) }), false)
    expect(inOpts).toHaveLength(96)
    expect(inOpts).toContain("09:00")
    expect(inOpts).toContain("09:15")
    expect(inOpts).not.toContain("09:10")
  })

  it("③ON・定時が区切り外（始業 9:10）：9:10 起点の 9:25 は選べて 9:30 は選べない", () => {
    const o = buildAdminTimeOptions("clockIn", c({ schedule: { start: "09:10", end: "17:40" }, switches: sw({ roundQuarter: true }) }), false)
    expect(o).toContain("09:25")
    expect(o).not.toContain("09:30")
  })

  it("④ON：退勤は上限まで（申請なし＝定時 17:30 まで）", () => {
    const o = buildAdminTimeOptions("clockOut", c({ switches: sw({ capOvertime: true }) }), false)
    expect(o).toContain("17:30")
    expect(o).not.toContain("17:31")
    expect(o).toContain("09:00")
  })

  it("④ON：残業申請の終了 19:30 があれば 19:30 まで", () => {
    const o = buildAdminTimeOptions("clockOut", c({ switches: sw({ capOvertime: true }), overtimeCapEnd: "19:30" }), false)
    expect(o).toContain("19:30")
    expect(o).not.toContain("19:31")
  })

  it("②ON：定時の14分前〜（8:46〜8:59）の出勤は選べない（定時に丸まるため）", () => {
    const o = buildAdminTimeOptions("clockIn", c({ switches: sw({ roundNear: true }) }), false)
    expect(o).not.toContain("08:50")
    expect(o).toContain("08:45")
    expect(o).toContain("09:00")
  })

  it("④ON・早出申請 8:00：出勤は 8:00 以降の15分刻み、定時以降は1分単位", () => {
    const o = buildAdminTimeOptions("clockIn", c({ switches: sw({ capOvertime: true }), earlyStartTime: "08:00" }), false)
    expect(o).toContain("08:00")
    expect(o).toContain("08:15")
    expect(o).not.toContain("07:45")
    expect(o).not.toContain("08:10")
    expect(o).toContain("09:07")
  })

  it("外出・戻り・休憩はパイプラインに影響しないので申請の刻み（15分）", () => {
    expect(buildAdminTimeOptions("other", c({ switches: ON34 }), false)).toHaveLength(96)
  })

  it("「制限なしで入力する」：スイッチに関わらず1分単位・全時間帯", () => {
    for (const kind of ["clockIn", "clockOut", "other"] as const) {
      expect(buildAdminTimeOptions(kind, c({ switches: ON34 }), true)).toHaveLength(1440)
    }
  })

  it("選択肢の時刻はどれも通しても変わらない（③④ON・出勤）", () => {
    const o = buildAdminTimeOptions("clockOut", c({ switches: ON34 }), false)
    for (const t of o.slice(0, 200)) {
      const [h, m] = t.split(":").map(Number)
      const r = computeClockPipeline({ inputClockIn: null, inputClockOut: jst(h, m), schedule: SCHEDULE, switches: ON34, requests: [] })
      expect(hm(r.clockOut)).toBe(t)
    }
  })
})
