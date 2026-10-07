/**
 * ⑤切替の再レビュー対応
 * - 所定勤務時間（有給の分・所定の表示）は記録の⑤スナップショットに従う
 * - 早退申請の休憩の申告は管理者の修正でもパートに受け付けない
 * - 早退の促しは承認済みの休日出勤申請がある日・定時なしの日に出さない
 */
import { describe, it, expect } from "vitest"
import { scheduledMinutesForRecord } from "../lib/clock-pipeline"
import { earlyLeaveNudgeTime, resolveEarlyLeaveBreakAnswer } from "../lib/attendance"
import { DATE, jst } from "./helpers/pipeline"

const SETTING = {
  break1Threshold: 360, break1Minutes: 45, break2Threshold: 480, break2Minutes: 60,
  roundEarlyClockIn: false, roundNearClockTime: false, roundQuarterHour: false, capOvertimeByRequest: false, newCalcMethod: true,
}
const USER = { workStartTime: "09:00", workEndTime: "17:30", employmentType: "full", breakMinutes: 45 }
const SAVED = (newCalc: boolean) => ({
  switchRoundEarly: false, switchRoundNear: false, switchRoundQuarter: false, switchCapOvertime: false, switchNewCalc: newCalc,
})

describe("所定勤務時間は記録の⑤スナップショットに従う", () => {
  it("9:00〜17:30・本人の休憩45：OFF は法定休憩60で450、ON は本人の休憩45で465", () => {
    expect(scheduledMinutesForRecord(USER, SETTING, SAVED(false))).toBe(450)
    expect(scheduledMinutesForRecord(USER, SETTING, SAVED(true))).toBe(465)
  })
  it("現在の設定を切り替えても、保存した記録は変わらない", () => {
    expect(scheduledMinutesForRecord(USER, { ...SETTING, newCalcMethod: false }, SAVED(true))).toBe(465)
    expect(scheduledMinutesForRecord(USER, SETTING, SAVED(false))).toBe(450)
  })
  it("記録が無い日（保存値なし）は現在の設定", () => {
    expect(scheduledMinutesForRecord(USER, SETTING, null)).toBe(465)
    expect(scheduledMinutesForRecord(USER, { ...SETTING, newCalcMethod: false }, null)).toBe(450)
  })
})

describe("早退申請の休憩の申告（管理者の修正）", () => {
  it("正社員の早退は 15分刻みの申告を受け付け、空欄は申告なし", () => {
    expect(resolveEarlyLeaveBreakAnswer("full", "early", "30")).toEqual({ ok: true, minutes: "30" })
    expect(resolveEarlyLeaveBreakAnswer("full", "early", "")).toEqual({ ok: true, minutes: null })
    expect(resolveEarlyLeaveBreakAnswer("full", "early", "7")).toEqual({ ok: false })
  })
  it("パートは送られてきても受け付けない（申告なし）", () => {
    expect(resolveEarlyLeaveBreakAnswer("part", "early", "30")).toEqual({ ok: true, minutes: null })
  })
  it("遅刻には申告を付けない", () => {
    expect(resolveEarlyLeaveBreakAnswer("full", "late", "30")).toEqual({ ok: true, minutes: null })
  })
})

describe("早退の促し：休日出勤・定時なしの日は出さない", () => {
  const base = {
    employmentType: "full", date: DATE, schedule: { start: "09:00", end: "17:30" }, clockOut: jst(14, 10), hasEarlyLeaveRequest: false,
  }
  it("通常の日は出す", () => {
    expect(earlyLeaveNudgeTime(base)).toBe("14:00")
  })
  it("承認済みの休日出勤申請がある日は出さない（休憩は休日出勤申請で答える）", () => {
    expect(earlyLeaveNudgeTime({ ...base, hasApprovedHolidayWork: true })).toBeNull()
  })
  it("定時なしの休日は出さない", () => {
    expect(earlyLeaveNudgeTime({ ...base, schedule: null })).toBeNull()
  })
})
