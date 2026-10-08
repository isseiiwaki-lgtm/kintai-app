/**
 * 一時 DB での画面確認の指摘の修正：
 * - 休憩打刻と外出の重なりを二重に引かない（段7・storedBreakMinutes）
 * - 会社設定の数値の検証
 * - パートの所定でない曜日の出勤はシフト交換（休日にしない）
 * - 休日出勤申請の休憩の初期値は会社設定のルール
 */
import { describe, it, expect } from "vitest"
import { computeClockPipeline, isHolidayWorkEligibleDate, isRestDay, resolveBreakMinutes, resolveScheduleForDate } from "../lib/clock-pipeline"
import { calcWorkingMinutes, needsHolidayWorkNotice, storedBreakMinutes } from "../lib/attendance"
import { validateSettingNumbers } from "../lib/setting-validation"
import { defaultHolidayBreakMinutes } from "../lib/holiday-work"
import { jst, sw } from "./helpers/pipeline"

const day = 11  // 2026-10-11
const t = (h: number, m = 0) => jst(h, m, day)

describe("休憩打刻と外出の重なり", () => {
  const base = {
    savedBreakMinutes: null, halfDay: null, employmentType: "full" as const, userBreakMinutes: 60,
    workStartTime: "09:00", workEndTime: "17:00", daySchedule: { start: "09:00", end: "17:00" },
  }
  it("9:00-17:00・外出 11:00-13:45・休憩打刻 12:00-13:00 → 休憩0分・実働 5:15", () => {
    const b = resolveBreakMinutes({ ...base, breakStart: t(12), breakEnd: t(13), goOutAt: t(11), returnAt: t(13, 45) })
    expect(b).toBe(0)
    expect(calcWorkingMinutes({ clockIn: t(9), clockOut: t(17), goOutAt: t(11), returnAt: t(13, 45), breakMinutes: b })).toBe(315)
  })
  it("一部だけ重なる：外出 11:00-12:30・休憩打刻 12:00-13:00 → 重ならない30分だけ", () => {
    expect(resolveBreakMinutes({ ...base, breakStart: t(12), breakEnd: t(13), goOutAt: t(11), returnAt: t(12, 30) })).toBe(30)
  })
  it("重ならない・外出なしは休憩打刻の長さそのまま", () => {
    expect(resolveBreakMinutes({ ...base, breakStart: t(12), breakEnd: t(13), goOutAt: t(14), returnAt: t(15) })).toBe(60)
    expect(resolveBreakMinutes({ ...base, breakStart: t(12), breakEnd: t(13) })).toBe(60)
  })
  it("storedBreakMinutes も同じ（Excel・/records の休憩列。休憩＋実働＋外出＝在席）", () => {
    const rec = {
      breakMinutes: null, breakStart: t(12), breakEnd: t(13), clockIn: t(9), clockOut: t(17),
      goOutAt: t(11), returnAt: t(13, 45), workingMinutes: 315,
    }
    expect(storedBreakMinutes(rec)).toBe(0)
    expect(storedBreakMinutes({ ...rec, goOutAt: null, returnAt: null, workingMinutes: 420 })).toBe(60)
  })
})

describe("会社設定の数値の検証", () => {
  const ok = { closingDay: "25", break1Threshold: "360", break1Minutes: "45", break2Threshold: "480", break2Minutes: "60" }
  it("正しい値は通る（控除0分も可）", () => {
    expect(validateSettingNumbers(ok)).toBeNull()
    expect(validateSettingNumbers({ ...ok, break1Minutes: "0" })).toBeNull()
  })
  it("空・非数・負・閾値0以下・小数を弾く", () => {
    expect(validateSettingNumbers({ ...ok, break1Threshold: "" })).not.toBeNull()
    expect(validateSettingNumbers({ ...ok, break2Threshold: "abc" })).not.toBeNull()
    expect(validateSettingNumbers({ ...ok, break1Minutes: "-5" })).not.toBeNull()
    expect(validateSettingNumbers({ ...ok, break2Minutes: null })).not.toBeNull()
    expect(validateSettingNumbers({ ...ok, break1Threshold: "0" })).not.toBeNull()
    expect(validateSettingNumbers({ ...ok, break2Threshold: "-30" })).not.toBeNull()
    expect(validateSettingNumbers({ ...ok, break1Minutes: "4.5" })).not.toBeNull()
    expect(validateSettingNumbers({ ...ok, closingDay: "29" })).not.toBeNull()
  })
})

describe("パートの所定でない曜日（シフト交換）", () => {
  // 月・火・水・金 9:00-15:00 のパート。2026-10-08 は木曜
  const part = {
    workStartTime: "09:00", workEndTime: "15:00", employmentType: "part", breakMinutes: null as number | null,
    workSun: false, workMon: true, workTue: true, workWed: true, workThu: false, workFri: true, workSat: false,
  }
  const THU = new Date(Date.UTC(2026, 9, 8))
  const setting = { break1Threshold: 360, break1Minutes: 45, break2Threshold: 480, break2Minutes: 60 }
  it("所定でない木曜は休日ではない。祝日・会社の休みは休日のまま。正社員は従来どおり", () => {
    expect(isRestDay(THU, part, false)).toBe(false)
    expect(isRestDay(THU, part, true)).toBe(true)
    expect(isRestDay(THU, { ...part, employmentType: "full" }, false)).toBe(true)
  })
  it("木曜 9:20-15:00 → 本人の定時で遅刻20分・休日出勤の注意なし", () => {
    const schedule = resolveScheduleForDate({ date: THU, user: part, setting, isHoliday: false, requests: [] })
    expect(schedule).toEqual({ start: "09:00", end: "15:00" })
    const out = computeClockPipeline({
      inputClockIn: jst(9, 20, 8), inputClockOut: jst(15, 0, 8), date: THU, schedule, switches: sw(), requests: [],
    })
    expect(out.lateMinutes).toBe(20)
    expect(needsHolidayWorkNotice({
      isRestDay: isRestDay(THU, part, false), hasPunch: true, isHolidayWork: false, hasHolidayWorkRequest: false,
    })).toBe(false)
  })
  it("祝日のパートは定時なし（休日扱いのまま）", () => {
    expect(resolveScheduleForDate({ date: THU, user: part, setting, isHoliday: true, requests: [] })).toBeNull()
  })
})

describe("休日出勤申請の休憩の初期値は会社設定のルール", () => {
  const setting = { break1Threshold: 300, break1Minutes: 30, break2Threshold: 540, break2Minutes: 75 }
  it("設定の閾値を超えたら設定の分数（15分単位）", () => {
    expect(defaultHolidayBreakMinutes("09:00", "13:00", setting)).toBe(0)       // 4h
    expect(defaultHolidayBreakMinutes("09:00", "14:30", setting)).toBe(30)      // 5.5h > 5h
    expect(defaultHolidayBreakMinutes("09:00", "19:00", setting)).toBe(75)      // 10h > 9h
  })
  it("会社設定が無ければ法定休憩", () => {
    expect(defaultHolidayBreakMinutes("09:00", "15:30")).toBe(45)
    expect(defaultHolidayBreakMinutes("09:00", "18:00")).toBe(60)
  })
  it("15分刻みでない設定は切り上げる", () => {
    expect(defaultHolidayBreakMinutes("09:00", "16:00", { ...setting, break1Minutes: 50 })).toBe(60)
  })
})

describe("パートの休みの曜日の休日出勤申請", () => {
  // 月・火・水・金のパート。2026-10-08 木曜（休み）、2026-10-07 水曜（所定）
  const part = {
    workStartTime: "09:00", workEndTime: "15:00", employmentType: "part", breakMinutes: null as number | null,
    workSun: false, workMon: true, workTue: true, workWed: true, workThu: false, workFri: true, workSat: false,
  }
  const THU = new Date(Date.UTC(2026, 9, 8))
  const WED = new Date(Date.UTC(2026, 9, 7))
  const setting = { break1Threshold: 360, break1Minutes: 45, break2Threshold: 480, break2Minutes: 60 }
  it("木曜は申請できる・水曜（所定出勤曜日）は不可・祝日は可", () => {
    expect(isHolidayWorkEligibleDate(THU, part, false)).toBe(true)
    expect(isHolidayWorkEligibleDate(WED, part, false)).toBe(false)
    expect(isHolidayWorkEligibleDate(WED, part, true)).toBe(true)
  })
  it("承認済みの木曜 10:00-14:00 → 定時は申請の開始〜終了（休日出勤の印があっても申請が先）", () => {
    const requests = [{ type: "HOLIDAY_WORK", status: "APPROVED", createdAt: new Date(), detail: { startTime: "10:00", endTime: "14:00" } }]
    expect(resolveScheduleForDate({ date: THU, user: part, setting, isHoliday: false, requests })).toEqual({ start: "10:00", end: "14:00" })
    expect(resolveScheduleForDate({ date: THU, user: part, setting, isHoliday: false, isHolidayWork: true, requests })).toEqual({ start: "10:00", end: "14:00" })
  })
  it("申請なしの木曜 → 本人の定時・注意なし", () => {
    expect(resolveScheduleForDate({ date: THU, user: part, setting, isHoliday: false, requests: [] })).toEqual({ start: "09:00", end: "15:00" })
    expect(needsHolidayWorkNotice({
      isRestDay: isRestDay(THU, part, false), hasPunch: true, isHolidayWork: false, hasHolidayWorkRequest: false,
    })).toBe(false)
  })
})
