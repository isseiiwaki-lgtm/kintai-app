/**
 * ⑤「新しい計算方式」（正社員の休憩の規定値と残業の式）
 * - ⑤OFF＝旧方式（本番 a1d25ca）：休憩の規定値は在席時間に法定休憩、残業は 実働 − 所定勤務時間
 * - ⑤ON＝現行：休憩の規定値は定時の拘束時間から、残業は早出＋終業後
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

describe("⑤ 正社員の休憩の規定値（事実が無い日）", () => {
  it("8:30〜17:30 の社員が 15:00 に退勤：OFF は在席390分に45分 → 実働345、ON は定時の拘束540分に60分 → 実働330", () => {
    expect(calc(rec(jst(8, 30), jst(15, 0), false), ctx(FULL_830)).workingMinutes).toBe(345)
    expect(calc(rec(jst(8, 30), jst(15, 0), true), ctx(FULL_830)).workingMinutes).toBe(330)
  })

  it("12:00 に退勤（在席210分）：OFF は休憩0、ON は休憩60", () => {
    expect(calc(rec(jst(8, 30), jst(12, 0), false), ctx(FULL_830)).workingMinutes).toBe(210)
    expect(calc(rec(jst(8, 30), jst(12, 0), true), ctx(FULL_830)).workingMinutes).toBe(150)
  })

  it("定時どおりの日は ON/OFF で同じ（在席540分 → 60）", () => {
    expect(calc(rec(jst(8, 30), jst(17, 30), false), ctx(FULL_830)).workingMinutes).toBe(480)
    expect(calc(rec(jst(8, 30), jst(17, 30), true), ctx(FULL_830)).workingMinutes).toBe(480)
  })

  it("在席が360分ちょうどは法定休憩なし（6時間超から45分）", () => {
    expect(resolveBreakMinutes({
      savedBreakMinutes: null, halfDay: null, employmentType: "full", userBreakMinutes: null,
      workStartTime: "08:30", workEndTime: "17:30", daySchedule: { start: "08:30", end: "17:30" }, presenceMinutes: 360, newCalc: false,
    })).toBe(0)
  })

  it("OFF は外出を除いた在席時間で判定する（15:00 退勤・外出60分 → 在席330分 → 休憩0）", () => {
    const r = calc(rec(jst(8, 30), jst(15, 0), false, { goOutAt: jst(12, 0), returnAt: jst(13, 0) }), ctx(FULL_830))
    expect(r.workingMinutes).toBe(330)
  })

  it("本人の所定休憩（User.breakMinutes）も OFF では見ない（旧方式は法定休憩のみ）", () => {
    const user = { ...FULL_830, breakMinutes: 30 }
    expect(calc(rec(jst(8, 30), jst(15, 0), false), ctx(user)).workingMinutes).toBe(345)
    expect(calc(rec(jst(8, 30), jst(15, 0), true), ctx(user)).workingMinutes).toBe(360)
  })

  it("パート：休憩の記録が無ければ ON/OFF とも 0（法定休憩を当てない）", () => {
    expect(calc(rec(jst(9, 0), jst(15, 0), false), ctx(PART_900)).workingMinutes).toBe(360)
    expect(calc(rec(jst(9, 0), jst(15, 0), true), ctx(PART_900)).workingMinutes).toBe(360)
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

  it("半休の日は事実が無ければ、ON は 0（仕様）・OFF は旧方式（在席時間に法定休憩。a1d25ca と同じ）", () => {
    const base = {
      savedBreakMinutes: null, halfDay: "pm" as const, employmentType: "full", userBreakMinutes: null,
      workStartTime: "09:00", workEndTime: "17:30", daySchedule: { start: "09:00", end: "12:00" }, presenceMinutes: 400,
    }
    expect(resolveBreakMinutes({ ...base, newCalc: true })).toBe(0)
    expect(resolveBreakMinutes({ ...base, newCalc: false })).toBe(45)
    expect(resolveBreakMinutes({ ...base, newCalc: false, presenceMinutes: 500 })).toBe(60)
    expect(resolveBreakMinutes({ ...base, newCalc: false, presenceMinutes: 300 })).toBe(0)
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
    expect(calcLegacyScheduledMinutes(null, null, "part")).toBe(0)
    expect(resolveOvertimeMinutes({ newCalc: false, pipelineOvertime: 30, workingMinutes: 600, legacyScheduledMinutes: 0, hasSchedule: true })).toBe(0)
  })

  it("旧所定勤務時間は法定休憩のみ（9:00〜17:30 → 450、時刻未設定の社員は480）", () => {
    expect(calcLegacyScheduledMinutes("09:00", "17:30", "full")).toBe(450)
    expect(calcLegacyScheduledMinutes(null, null, "full")).toBe(480)
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
    const c = ctx(FULL_830, { newCalcMethod: true })
    const r = rec(jst(8, 30), jst(15, 0), false)
    const data = calc(r, c)
    expect(data.workingMinutes).toBe(345)
    expect(calc(r, c, { snapshot: "ifMissing" })).not.toHaveProperty("switchNewCalc")
    expect(calc(r, c, { snapshot: "ifMissing" }).workingMinutes).toBe(345)
  })

  it("保存値が無い記録は、最初に書くとき現在の設定を保存する（ifMissing）", () => {
    const none = rec(jst(8, 30), jst(15, 0), null, { switchRoundEarly: null, switchRoundNear: null, switchRoundQuarter: null, switchCapOvertime: null })
    const on = calc(none, ctx(FULL_830, { newCalcMethod: true }), { snapshot: "ifMissing" })
    expect(on).toMatchObject({ switchNewCalc: true, workingMinutes: 330 })
    const off = calc(none, ctx(FULL_830, { newCalcMethod: false }), { snapshot: "ifMissing" })
    expect(off).toMatchObject({ switchNewCalc: false, workingMinutes: 345 })
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
