/**
 * 段0：その日の定時を決める（docs/CLOCK_PIPELINE.md）
 */
import { describe, it, expect } from "vitest"
import {
  calcDefaultBreakMinutes,
  isRestDay,
  pickHalfDay,
  resolveDaySchedule,
  resolveScheduleForDate,
} from "../lib/clock-pipeline"
import { DATE, jst, run } from "./helpers/pipeline"

const base = {
  workStartTime: "09:00",
  workEndTime: "17:30",
  employmentType: "full",
  breakMinutes: 60,
  lunchStartTime: "12:00",
  isRestDay: false,
  halfDay: null,
} as const

describe("段0：通常の日", () => {
  it("本人の定時（workStartTime〜workEndTime）", () => {
    expect(resolveDaySchedule({ ...base })).toEqual({ start: "09:00", end: "17:30" })
  })
  it("定時が未設定なら定時なし", () => {
    expect(resolveDaySchedule({ ...base, workStartTime: null })).toBeNull()
  })
})

describe("段0：正社員の半休（昼休憩を除いた前半か後半）", () => {
  it("例：9:00〜17:30・休憩60分 → 午前半休 13:00〜17:30", () => {
    expect(resolveDaySchedule({ ...base, halfDay: "am" })).toEqual({ start: "13:00", end: "17:30" })
  })
  it("例：9:00〜17:30・休憩60分 → 午後半休 9:00〜12:00", () => {
    expect(resolveDaySchedule({ ...base, halfDay: "pm" })).toEqual({ start: "09:00", end: "12:00" })
  })
  it("昼休憩の終わり ＝ 開始 ＋ 本人の休憩の長さ（休憩45分なら午前半休は 12:45〜）", () => {
    expect(resolveDaySchedule({ ...base, breakMinutes: 45, halfDay: "am" })).toEqual({ start: "12:45", end: "17:30" })
  })
  it("昼休憩の開始時刻は設定（Setting.lunchStartTime）に従う", () => {
    expect(resolveDaySchedule({ ...base, lunchStartTime: "12:30", halfDay: "pm" })).toEqual({ start: "09:00", end: "12:30" })
    expect(resolveDaySchedule({ ...base, lunchStartTime: "12:30", halfDay: "am" })).toEqual({ start: "13:30", end: "17:30" })
  })
  it("パートには半休が無い（半休の指定は無視して通常の定時）", () => {
    expect(resolveDaySchedule({ ...base, employmentType: "part", halfDay: "am" })).toEqual({ start: "09:00", end: "17:30" })
  })
  it("午前半休の日：13:10 出勤 → 遅刻10分（定時 13:00）、9:00 の定時では遅刻にならない", () => {
    const schedule = resolveDaySchedule({ ...base, halfDay: "am" })
    expect(run({ in: jst(13, 10), out: jst(17, 30), schedule }).lateMinutes).toBe(10)
  })
  it("午後半休の日：12:00 退勤 → 早退なし、11:30 退勤 → 早退30分", () => {
    const schedule = resolveDaySchedule({ ...base, halfDay: "pm" })
    expect(run({ in: jst(9, 0), out: jst(12, 0), schedule }).earlyLeaveMinutes).toBe(0)
    expect(run({ in: jst(9, 0), out: jst(11, 30), schedule }).earlyLeaveMinutes).toBe(30)
  })
})

describe("段0：休日", () => {
  it("休日（休日カレンダー・本人の休みの曜日）で休日出勤申請が無い日は定時なし", () => {
    expect(resolveDaySchedule({ ...base, isRestDay: true })).toBeNull()
  })
  it("定時なしの日は打刻があっても遅刻・早退・残業を付けない", () => {
    const r = run({ in: jst(10, 0), out: jst(15, 0), schedule: null })
    expect(r).toMatchObject({ lateMinutes: 0, earlyLeaveMinutes: 0, overtimeMinutes: 0 })
    expect(r.clockIn).toEqual(jst(10, 0))  // 丸めの基準が無いので記録時刻＝実打刻
  })
  it("休日出勤申請の差し込み口：承認済みの休日出勤申請の開始〜終了を定時の代わりにする（後続担当）", () => {
    expect(resolveDaySchedule({ ...base, isRestDay: true, holidayWork: { start: "10:00", end: "15:00" } }))
      .toEqual({ start: "10:00", end: "15:00" })
  })

  const flags = { workSun: false, workMon: true, workTue: true, workWed: true, workThu: true, workFri: true, workSat: false }
  it("本人の休みの曜日（土日）は休日", () => {
    expect(isRestDay(new Date(Date.UTC(2026, 9, 10)), flags, false)).toBe(true)   // 土
    expect(isRestDay(new Date(Date.UTC(2026, 9, 11)), flags, false)).toBe(true)   // 日
    expect(isRestDay(DATE, flags, false)).toBe(false)                              // 月
  })
  it("休日カレンダーの日は休日（平日でも）", () => {
    expect(isRestDay(DATE, flags, true)).toBe(true)
  })
  it("土曜が労働日の人は土曜が休日にならない", () => {
    expect(isRestDay(new Date(Date.UTC(2026, 9, 10)), { ...flags, workSat: true }, false)).toBe(false)
  })
  it("振替で労働日になった休日は、通常の労働日（本人の定時）", () => {
    expect(isRestDay(new Date(Date.UTC(2026, 9, 10)), flags, true, true)).toBe(false)
  })
})

describe("段0：承認済み LEAVE の半休の拾い方", () => {
  const leave = (status: string, halfDay: string, createdAt: string) => ({
    type: "LEAVE", status, createdAt: new Date(createdAt), detail: { leaveType: "paid", halfDay },
  })
  it("承認済みだけ拾う（審査中・却下は無視）", () => {
    expect(pickHalfDay([leave("PENDING", "am", "2026-10-01T00:00:00Z")])).toBeNull()
    expect(pickHalfDay([leave("REJECTED", "am", "2026-10-01T00:00:00Z")])).toBeNull()
    expect(pickHalfDay([leave("APPROVED", "am", "2026-10-01T00:00:00Z")])).toBe("am")
  })
  it("全休（halfDay=full）は半休ではない", () => {
    expect(pickHalfDay([leave("APPROVED", "full", "2026-10-01T00:00:00Z")])).toBeNull()
  })
  it("残業申請など LEAVE 以外は無視", () => {
    expect(pickHalfDay([{ type: "OVERTIME", status: "APPROVED", createdAt: new Date(), detail: { halfDay: "am" } }])).toBeNull()
  })
})

describe("段0：本人の休憩の長さ（段7の担当が正式に作るまでの既存の算出）", () => {
  it("本人の User.breakMinutes が最優先", () => {
    expect(calcDefaultBreakMinutes({ userBreakMinutes: 45, workStartTime: "09:00", workEndTime: "17:30" })).toBe(45)
    expect(calcDefaultBreakMinutes({ userBreakMinutes: 0, workStartTime: "09:00", workEndTime: "17:30" })).toBe(0)
  })
  it("無ければ会社設定の休憩ルールを定時の拘束時間に当てる（510分 > 480 → 60分）", () => {
    const setting = { break1Threshold: 360, break1Minutes: 45, break2Threshold: 480, break2Minutes: 60 }
    expect(calcDefaultBreakMinutes({ userBreakMinutes: null, workStartTime: "09:00", workEndTime: "17:30" }, setting)).toBe(60)
    expect(calcDefaultBreakMinutes({ userBreakMinutes: null, workStartTime: "09:00", workEndTime: "16:00" }, setting)).toBe(45)
    expect(calcDefaultBreakMinutes({ userBreakMinutes: null, workStartTime: "09:00", workEndTime: "15:00" }, setting)).toBe(0)
  })
})

describe("段0：resolveScheduleForDate（画面・Excel・計算し直しが同じ定時を使う入口）", () => {
  const user = {
    workStartTime: "09:00", workEndTime: "17:30", employmentType: "full", breakMinutes: null,
    workSun: false, workMon: true, workTue: true, workWed: true, workThu: true, workFri: true, workSat: false,
  }
  const setting = { lunchStartTime: "12:00", break1Threshold: 360, break1Minutes: 45, break2Threshold: 480, break2Minutes: 60 }
  const args = { date: DATE, user, setting, isHoliday: false, requests: [] as { type: string; status: string; createdAt: Date; detail?: unknown }[] }

  it("通常の日", () => {
    expect(resolveScheduleForDate(args)).toEqual({ start: "09:00", end: "17:30" })
  })
  it("休日カレンダーの日は定時なし", () => {
    expect(resolveScheduleForDate({ ...args, isHoliday: true })).toBeNull()
  })
  it("休日出勤の印がある日は定時なし", () => {
    expect(resolveScheduleForDate({ ...args, isHolidayWork: true })).toBeNull()
  })
  it("承認済みの午前半休 → 13:00〜17:30（休憩は会社設定の規定値60分）", () => {
    const requests = [{ type: "LEAVE", status: "APPROVED", createdAt: new Date(), detail: { leaveType: "paid", halfDay: "am" } }]
    expect(resolveScheduleForDate({ ...args, requests })).toEqual({ start: "13:00", end: "17:30" })
  })
})
