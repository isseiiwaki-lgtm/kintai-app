/**
 * フルタイムパートの半休・半休の有給の分数・有給の日数（半休 0.5）
 */
import { describe, it, expect } from "vitest"
import {
  canTakeHalfDay,
  halfDayPaidMinutes,
  paidLeaveDays,
  paidLeaveMinutesFor,
  resolveDaySchedule,
  resolveScheduleForDate,
} from "../lib/clock-pipeline"

const sched = {
  workStartTime: "08:30",
  workEndTime: "17:30",
  breakMinutes: 60,
  lunchStartTime: "12:00",
  isRestDay: false,
} as const

describe("canTakeHalfDay：半休を取れる人", () => {
  it("正社員とフルタイムパートだけ", () => {
    expect(canTakeHalfDay({ employmentType: "full" })).toBe(true)
    expect(canTakeHalfDay({ employmentType: "part", isFullTimePart: true })).toBe(true)
    expect(canTakeHalfDay({ employmentType: "part", isFullTimePart: false })).toBe(false)
    expect(canTakeHalfDay({ employmentType: "part" })).toBe(false)
    expect(canTakeHalfDay(null)).toBe(false)
  })
  it("正社員に戻した人のフラグは見ない（full は常に可）", () => {
    expect(canTakeHalfDay({ employmentType: "full", isFullTimePart: false })).toBe(true)
  })
})

describe("段0：フルタイムパートの半休は正社員と同じ定時", () => {
  it("午前休 ＝ 昼休憩の終わり〜終業、午後休 ＝ 始業〜昼休憩の開始", () => {
    const p = { ...sched, employmentType: "part", isFullTimePart: true }
    expect(resolveDaySchedule({ ...p, halfDay: "am" })).toEqual({ start: "13:00", end: "17:30" })
    expect(resolveDaySchedule({ ...p, halfDay: "pm" })).toEqual({ start: "08:30", end: "12:00" })
  })
  it("フルタイムパートでないパートは半休を無視して通常の定時", () => {
    expect(resolveDaySchedule({ ...sched, employmentType: "part", isFullTimePart: false, halfDay: "am" })).toEqual({ start: "08:30", end: "17:30" })
  })
  it("resolveScheduleForDate も isFullTimePart を通す", () => {
    const user = {
      workStartTime: "08:30", workEndTime: "17:30", employmentType: "part", isFullTimePart: true, breakMinutes: 60,
      workSun: false, workMon: true, workTue: true, workWed: true, workThu: true, workFri: true, workSat: false,
    }
    const requests = [{ type: "LEAVE", status: "APPROVED", createdAt: new Date(), detail: { leaveType: "paid", halfDay: "pm" } }]
    const date = new Date(Date.UTC(2026, 9, 7)) // 水曜
    expect(resolveScheduleForDate({ date, user, setting: { lunchStartTime: "12:00", break1Threshold: 360, break1Minutes: 45, break2Threshold: 480, break2Minutes: 60 }, isHoliday: false, requests }))
      .toEqual({ start: "08:30", end: "12:00" })
    expect(resolveScheduleForDate({ date, user: { ...user, isFullTimePart: false }, setting: null, isHoliday: false, requests }))
      .toEqual({ start: "08:30", end: "17:30" })
  })
})

describe("半休の有給の分数：所定の半分ではなく、その人の実際の半分", () => {
  it("8:30〜17:30・休憩60：午前休 210、午後休 270", () => {
    const p = { workStartTime: "08:30", workEndTime: "17:30", breakMinutes: 60, lunchStartTime: "12:00" }
    expect(halfDayPaidMinutes({ ...p, halfDay: "am" })).toBe(210)
    expect(halfDayPaidMinutes({ ...p, halfDay: "pm" })).toBe(270)
  })
  it("定時が不明なら null", () => {
    expect(halfDayPaidMinutes({ halfDay: "am", workStartTime: null, workEndTime: "17:30", breakMinutes: 60, lunchStartTime: "12:00" })).toBeNull()
  })

  const setting = {
    break1Threshold: 360, break1Minutes: 45, break2Threshold: 480, break2Minutes: 60, lunchStartTime: "12:00",
    newCalcMethod: true,
  } as never
  const user = { workStartTime: "08:30", workEndTime: "17:30", employmentType: "full", breakMinutes: 60 }

  it("⑤ON：承認の保存値（午前休 210・午後休 270・全休 480）", () => {
    const saved = { switchNewCalc: true } as never
    expect(paidLeaveMinutesFor({ user, setting, saved, halfDay: "am" })).toBe(210)
    expect(paidLeaveMinutesFor({ user, setting, saved, halfDay: "pm" })).toBe(270)
    expect(paidLeaveMinutesFor({ user, setting, saved, halfDay: null })).toBe(480)
  })
  it("⑤OFF（旧方式）：昼休憩は法定休憩（9h拘束→60分）。午前休 210・午後休 270・全休 480", () => {
    const saved = { switchNewCalc: false } as never
    expect(paidLeaveMinutesFor({ user, setting, saved, halfDay: "am" })).toBe(210)
    expect(paidLeaveMinutesFor({ user, setting, saved, halfDay: "pm" })).toBe(270)
    expect(paidLeaveMinutesFor({ user, setting, saved, halfDay: null })).toBe(480)
  })
  it("フルタイムパート（9:00〜17:00・休憩45）：午前休 180、午後休 255", () => {
    const part = { workStartTime: "09:00", workEndTime: "17:00", employmentType: "part", breakMinutes: 45 }
    const saved = { switchNewCalc: true } as never
    expect(paidLeaveMinutesFor({ user: part, setting, saved, halfDay: "am" })).toBe(180)
    expect(paidLeaveMinutesFor({ user: part, setting, saved, halfDay: "pm" })).toBe(255)
  })
})

describe("有給の日数：全休 1・半休 0.5（分数から求めない）", () => {
  it("午後休 2 件 ＝ 1.0 日", () => {
    const details = [{ leaveType: "paid", halfDay: "pm" }, { leaveType: "paid", halfDay: "pm" }]
    expect(details.reduce((s, d) => s + paidLeaveDays(d), 0)).toBe(1)
  })
  it("全休 1、半休 0.5、区分なしは全休", () => {
    expect(paidLeaveDays({ halfDay: "full" })).toBe(1)
    expect(paidLeaveDays({ halfDay: "am" })).toBe(0.5)
    expect(paidLeaveDays({})).toBe(1)
    expect(paidLeaveDays(null)).toBe(1)
  })
})
