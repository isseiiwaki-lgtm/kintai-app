/**
 * ⑤「新しい計算方式」（正社員の休憩の規定値と残業の式）
 * - ⑤OFF＝旧方式：残業は 実働 − 所定勤務時間／⑤ON：残業は早出＋終業後
 * - 休憩の規定値は 2026-10-13 から⑤に関係なく所定から決める（本人の所定休憩 → 定時の拘束時間＋会社ルール）
 * - 休憩の事実（休憩ボタン・承認済みの休憩申請・早退申請の休憩の申告）は ON/OFF どちらでも同じ
 * - 記録に保存した⑤に従い、設定を切り替えても保存した記録は変わらない
 */
import { describe, it, expect, vi } from "vitest"

vi.mock("@/lib/prisma", () => ({ prisma: {} }))

import { buildRecordUpdate, type PipelineContext } from "../lib/clock-pipeline-db"
import { legacyOvertimeInput, resolveBreakMinutes, resolveOvertimeMinutes, resolveSwitches, switchesFromSetting, switchesToColumns } from "../lib/clock-pipeline"
import { calcLegacyScheduledMinutes, resolveDayMetrics } from "../lib/attendance"
import { DATE, jst } from "./helpers/pipeline"

type RecordRow = Parameters<typeof buildRecordUpdate>[0]
type Data = Record<string, unknown>

const SETTING = {
  id: 1, closingDay: 25, break1Threshold: 360, break1Minutes: 45, break2Threshold: 480, break2Minutes: 60,
  roundEarlyClockIn: false, roundNearClockTime: false, roundQuarterHour: false, capOvertimeByRequest: false, newCalcMethod: false,
  lunchStartTime: "12:00", legalHolidayWeekday: 0, weekStartDay: 0,
}
const WEEKDAYS = { workSun: false, workMon: true, workTue: true, workWed: true, workThu: true, workFri: true, workSat: false }
const FULL_830 = { workStartTime: "08:30", workEndTime: "17:30", employmentType: "full", breakMinutes: null, ...WEEKDAYS }
const FULL_900 = { workStartTime: "09:00", workEndTime: "17:30", employmentType: "full", breakMinutes: null, ...WEEKDAYS }
const PART_900 = { workStartTime: "09:00", workEndTime: "15:00", employmentType: "part", breakMinutes: 60, ...WEEKDAYS }

function ctx(user: PipelineContext["user"], settingOver: Record<string, unknown> = {}): PipelineContext {
  return { user, setting: { ...SETTING, ...settingOver } as unknown as PipelineContext["setting"], holidayKeys: new Set(), requests: [], logs: [] }
}

/** ①〜④は全部 OFF で保存した記録（丸め・打ち切りの影響を消す）。⑤は newCalc で指定 */
function rec(clockIn: Date, clockOut: Date, newCalc: boolean | null, over: Record<string, unknown> = {}): RecordRow {
  return {
    id: "r1", userId: "u1", date: DATE, status: "OPEN", isHolidayWork: false, isAbsent: false,
    clockIn, clockOut, rawClockIn: clockIn, rawClockOut: clockOut,
    goOutAt: null, returnAt: null, breakStart: null, breakEnd: null, breakMinutes: null,
    lateMinutes: null, earlyLeaveMinutes: null, overtimeMinutes: null, workingMinutes: null,
    switchRoundEarly: false, switchRoundNear: false, switchRoundQuarter: false, switchCapOvertime: false, switchNewCalc: newCalc,
    ...over,
  } as unknown as RecordRow
}

const calc = (r: RecordRow, c: PipelineContext, opts = {}) => buildRecordUpdate(r, c, opts)!.data as Data

describe("休憩の規定値（事実が無い日。2026-10-13〜 ⑤に関係なく所定から決める）", () => {
  it("8:30〜17:30 の社員が 15:00 に退勤：ON/OFF とも定時の拘束540分に60分 → 実働330（在席時間から推定しない）", () => {
    expect(calc(rec(jst(8, 30), jst(15, 0), false), ctx(FULL_830)).workingMinutes).toBe(330)
    expect(calc(rec(jst(8, 30), jst(15, 0), true), ctx(FULL_830)).workingMinutes).toBe(330)
  })

  it("12:00 に退勤（在席210分）：ON/OFF とも休憩60", () => {
    expect(calc(rec(jst(8, 30), jst(12, 0), false), ctx(FULL_830)).workingMinutes).toBe(150)
    expect(calc(rec(jst(8, 30), jst(12, 0), true), ctx(FULL_830)).workingMinutes).toBe(150)
  })

  it("定時どおりの日は ON/OFF で同じ（在席540分 → 60）", () => {
    expect(calc(rec(jst(8, 30), jst(17, 30), false), ctx(FULL_830)).workingMinutes).toBe(480)
    expect(calc(rec(jst(8, 30), jst(17, 30), true), ctx(FULL_830)).workingMinutes).toBe(480)
  })

  it("在席時間は見ない（在席360分でも定時の拘束で決める）", () => {
    expect(resolveBreakMinutes({
      savedBreakMinutes: null, halfDay: null, employmentType: "full", userBreakMinutes: null,
      workStartTime: "08:30", workEndTime: "17:30", daySchedule: { start: "08:30", end: "17:30" },
    })).toBe(60)
  })

  it("外出は休憩とは別に引く（15:00 退勤・外出60分 → 在席330分 − 休憩60 = 270）", () => {
    const r = calc(rec(jst(8, 30), jst(15, 0), false, { goOutAt: jst(12, 0), returnAt: jst(13, 0) }), ctx(FULL_830))
    expect(r.workingMinutes).toBe(270)
  })

  it("本人の所定休憩（User.breakMinutes）を ON/OFF とも使う", () => {
    const user = { ...FULL_830, breakMinutes: 30 }
    expect(calc(rec(jst(8, 30), jst(15, 0), false), ctx(user)).workingMinutes).toBe(360)
    expect(calc(rec(jst(8, 30), jst(15, 0), true), ctx(user)).workingMinutes).toBe(360)
  })

  it("パート：所定休憩60分の人は記録が無くても60分引く（ON/OFF とも）", () => {
    expect(calc(rec(jst(9, 0), jst(15, 0), false), ctx(PART_900)).workingMinutes).toBe(300)
    expect(calc(rec(jst(9, 0), jst(15, 0), true), ctx(PART_900)).workingMinutes).toBe(300)
  })

  it("パート：所定休憩なし・定時6時間以下は休憩0（定時の長さで決める）", () => {
    const user = { ...PART_900, breakMinutes: null }
    expect(calc(rec(jst(9, 0), jst(16, 0), true), ctx(user)).workingMinutes).toBe(420)
  })

  it("パート：所定休憩なし・定時が6時間超（9:00〜16:00）は会社ルールの値（このテストの設定は45分）", () => {
    const user = { ...PART_900, workEndTime: "16:00", breakMinutes: null }
    expect(calc(rec(jst(9, 0), jst(16, 0), true), ctx(user)).workingMinutes).toBe(375)
  })
})

describe("休憩の事実は ⑤ON/OFF どちらでも同じ", () => {
  it("パートの休憩ボタン（breakMinutes=30）", () => {
    expect(calc(rec(jst(9, 0), jst(15, 0), false, { breakMinutes: 30 }), ctx(PART_900)).workingMinutes).toBe(330)
    expect(calc(rec(jst(9, 0), jst(15, 0), true, { breakMinutes: 30 }), ctx(PART_900)).workingMinutes).toBe(330)
  })

  it("社員の承認済み休憩（早退申請の申告・休憩申請）：0分も事実（15:00 退勤で 0 → 実働390）", () => {
    expect(calc(rec(jst(8, 30), jst(15, 0), false, { breakMinutes: 0 }), ctx(FULL_830)).workingMinutes).toBe(390)
    expect(calc(rec(jst(8, 30), jst(15, 0), true, { breakMinutes: 0 }), ctx(FULL_830)).workingMinutes).toBe(390)
  })

  it("社員の申告 30分", () => {
    expect(calc(rec(jst(8, 30), jst(15, 0), false, { breakMinutes: 30 }), ctx(FULL_830)).workingMinutes).toBe(360)
    expect(calc(rec(jst(8, 30), jst(15, 0), true, { breakMinutes: 30 }), ctx(FULL_830)).workingMinutes).toBe(360)
  })

  it("過去の休憩打刻（開始・終了）も事実として使う（OFF でも）", () => {
    const r = rec(jst(8, 30), jst(15, 0), false, { breakStart: jst(12, 0), breakEnd: jst(12, 20) })
    expect(calc(r, ctx(FULL_830)).workingMinutes).toBe(370)
  })

  it("半休の日は事実が無ければ 0（ON/OFF とも。在席時間から推定しない）", () => {
    const base = {
      savedBreakMinutes: null, halfDay: "pm" as const, employmentType: "full", userBreakMinutes: null,
      workStartTime: "09:00", workEndTime: "17:30", daySchedule: { start: "09:00", end: "12:00" },
    }
    expect(resolveBreakMinutes(base)).toBe(0)
  })
})

describe("⑤ 残業の式", () => {
  it("9:20〜18:00（定時 9:00〜17:30）：OFF は実働460 − 所定450 = 10、ON は終業後30", () => {
    expect(calc(rec(jst(9, 20), jst(18, 0), false), ctx(FULL_900)).overtimeMinutes).toBe(10)
    expect(calc(rec(jst(9, 20), jst(18, 0), true), ctx(FULL_900)).overtimeMinutes).toBe(30)
  })

  it("8:00〜16:30：OFF は実働450 − 所定450 = 0、ON は早出60", () => {
    expect(calc(rec(jst(8, 0), jst(16, 30), false), ctx(FULL_900)).overtimeMinutes).toBe(0)
    expect(calc(rec(jst(8, 0), jst(16, 30), true), ctx(FULL_900)).overtimeMinutes).toBe(60)
  })

  it("定時どおり（9:00〜17:30）は ON/OFF とも 0", () => {
    expect(calc(rec(jst(9, 0), jst(17, 30), false), ctx(FULL_900)).overtimeMinutes).toBe(0)
    expect(calc(rec(jst(9, 0), jst(17, 30), true), ctx(FULL_900)).overtimeMinutes).toBe(0)
  })

  it("所定が0（時刻未設定のパート）の OFF は 0", () => {
    expect(calcLegacyScheduledMinutes(null, null, "part", { userBreakMinutes: null, setting: SETTING })).toBe(0)
    expect(resolveOvertimeMinutes({ newCalc: false, pipelineOvertime: 30, workingMinutes: 600, legacyScheduledMinutes: 0, hasSchedule: true })).toBe(0)
  })

  it("旧方式の所定も会社設定・本人の所定休憩から（2026-10-13〜。法定休憩の固定値は使わない）", () => {
    expect(calcLegacyScheduledMinutes("09:00", "17:30", "full", { userBreakMinutes: null, setting: SETTING })).toBe(450)
    // 9:00〜17:00（拘束480分）：会社設定のルール1（このテストでは45分）。本番の設定（60分）なら所定7:00
    expect(calcLegacyScheduledMinutes("09:00", "17:00", "full", { userBreakMinutes: null, setting: { ...SETTING, break1Minutes: 60 } })).toBe(420)
    expect(calcLegacyScheduledMinutes("09:00", "17:00", "full", { userBreakMinutes: 60, setting: SETTING })).toBe(420)
    expect(calcLegacyScheduledMinutes(null, null, "full", { userBreakMinutes: null, setting: SETTING })).toBe(480)
  })
})

describe("画面・Excel：保存した⑤に従う", () => {
  const r = { clockIn: jst(9, 20), clockOut: jst(18, 0), lateMinutes: null, earlyLeaveMinutes: null, overtimeMinutes: null }
  const sched = { start: "09:00", end: "17:30" }

  it("保存値が無い日の残業：⑤OFF の記録は 実働 − 所定、ON の記録は終業後", () => {
    const off = legacyOvertimeInput({ switchRoundEarly: false, switchRoundNear: false, switchRoundQuarter: false, switchCapOvertime: false, switchNewCalc: false, workingMinutes: 460 }, SETTING, FULL_900)
    expect(resolveDayMetrics(r, sched, off).overtimeMinutes).toBe(10)
    const on = legacyOvertimeInput({ switchRoundEarly: false, switchRoundNear: false, switchRoundQuarter: false, switchCapOvertime: false, switchNewCalc: true, workingMinutes: 460 }, SETTING, FULL_900)
    expect(on).toBeUndefined()
    expect(resolveDayMetrics(r, sched, on).overtimeMinutes).toBe(30)
  })

  it("保存値がある日はそれを使う（式に関係なく）", () => {
    expect(resolveDayMetrics({ ...r, overtimeMinutes: 77 }, sched, { workingMinutes: 460, legacyScheduledMinutes: 450 }).overtimeMinutes).toBe(77)
  })

  it("現在の設定が ON でも、保存した⑤がOFFの記録は旧方式のまま", () => {
    const sw = resolveSwitches({ switchRoundEarly: true, switchRoundNear: true, switchRoundQuarter: false, switchCapOvertime: false, switchNewCalc: false }, { newCalcMethod: true })
    expect(sw.newCalc).toBe(false)
  })

  it("①〜④の保存値があり⑤が無い記録（⑤導入前）は旧方式、保存値が全く無い記録は現在の設定", () => {
    expect(resolveSwitches({ switchRoundEarly: true, switchRoundNear: true, switchRoundQuarter: false, switchCapOvertime: false }, { newCalcMethod: true }).newCalc).toBe(false)
    expect(resolveSwitches(null, { newCalcMethod: true }).newCalc).toBe(true)
    expect(resolveSwitches({}, { newCalcMethod: false }).newCalc).toBe(false)
  })
})

describe("⑤のスナップショット", () => {
  it("設定をONにして計算し直しても、保存した⑤がOFFの記録は旧方式のまま（保存値も書き換えない）", () => {
    // ⑤で変わるのは残業の式（休憩は⑤に関係ない）。9:20〜18:00：OFF＝実働460−所定450＝10、ON＝終業後30
    const c = ctx(FULL_900, { newCalcMethod: true })
    const r = rec(jst(9, 20), jst(18, 0), false)
    const data = calc(r, c)
    expect(data.overtimeMinutes).toBe(10)
    expect(calc(r, c, { snapshot: "ifMissing" })).not.toHaveProperty("switchNewCalc")
    expect(calc(r, c, { snapshot: "ifMissing" }).overtimeMinutes).toBe(10)
  })

  it("保存値が無い記録は、最初に書くとき現在の設定を保存する（ifMissing）", () => {
    const none = rec(jst(9, 20), jst(18, 0), null, { switchRoundEarly: null, switchRoundNear: null, switchRoundQuarter: null, switchCapOvertime: null })
    const on = calc(none, ctx(FULL_900, { newCalcMethod: true }), { snapshot: "ifMissing" })
    expect(on).toMatchObject({ switchNewCalc: true, overtimeMinutes: 30 })
    const off = calc(none, ctx(FULL_900, { newCalcMethod: false }), { snapshot: "ifMissing" })
    expect(off).toMatchObject({ switchNewCalc: false, overtimeMinutes: 10 })
  })

  it("出勤打刻（overwrite）は現在の設定で⑤を保存し直す", () => {
    const r = rec(jst(8, 30), jst(15, 0), false)
    expect(calc(r, ctx(FULL_830, { newCalcMethod: true }), { snapshot: "overwrite" })).toMatchObject({ switchNewCalc: true, workingMinutes: 330 })
  })

  it("switchesFromSetting／switchesToColumns に⑤が入る", () => {
    expect(switchesToColumns(switchesFromSetting({ newCalcMethod: true })).switchNewCalc).toBe(true)
    expect(switchesToColumns(switchesFromSetting(null)).switchNewCalc).toBe(false)
  })
})
