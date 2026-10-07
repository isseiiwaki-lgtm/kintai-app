/**
 * 休憩の記録を申請に一本化（IMPLEMENTATION_PLAN 作業I・CLOCK_PIPELINE 段7）
 * - 休憩分数の決め方（その日の breakMinutes → 半休・パート → 規定値）と、それを控除した勤務時間
 * - 所定勤務時間 ＝ 拘束時間 − 所定休憩（半休はその半分）
 * - パートの休憩申請漏れの知らせ・休憩申請の分数の検証・所定休憩の入力検証
 * prisma をモックして、パイプラインが保存する値（buildRecordUpdate）を確認する
 */
import { describe, it, expect, vi } from "vitest"

vi.mock("@/lib/prisma", () => ({ prisma: {} }))

import { buildRecordUpdate, type PipelineContext } from "../lib/clock-pipeline-db"
import { resolveBreakMinutes } from "../lib/clock-pipeline"
import { calcScheduledMinutes, needsBreakRecordNotice, parseBreakRequestMinutes } from "../lib/attendance"
import { parseUserBreakMinutes } from "../lib/user-validation"
import { DATE, jst } from "./helpers/pipeline"

type RecordRow = Parameters<typeof buildRecordUpdate>[0]
type Data = Record<string, unknown>

const SETTING = {
  id: 1, closingDay: 25, break1Threshold: 360, break1Minutes: 45, break2Threshold: 480, break2Minutes: 60,
  roundEarlyClockIn: false, roundNearClockTime: false, roundQuarterHour: false, capOvertimeByRequest: false,
  lunchStartTime: "12:00", legalHolidayWeekday: 0, weekStartDay: 0,
}
const WEEKDAYS = { workSun: false, workMon: true, workTue: true, workWed: true, workThu: true, workFri: true, workSat: false }

/** 野木さん：パート・9:00〜15:00・所定休憩60 */
const NOGI = { workStartTime: "09:00", workEndTime: "15:00", employmentType: "part", breakMinutes: 60, ...WEEKDAYS }
/** 社員・9:00〜18:00（所定休憩未設定） */
const FULL_18 = { workStartTime: "09:00", workEndTime: "18:00", employmentType: "full", breakMinutes: null, ...WEEKDAYS }
/** 社員・9:00〜17:00 */
const FULL_17 = { workStartTime: "09:00", workEndTime: "17:00", employmentType: "full", breakMinutes: null, ...WEEKDAYS }

function ctx(user: PipelineContext["user"], requests: PipelineContext["requests"] = []): PipelineContext {
  return { user, setting: SETTING as unknown as PipelineContext["setting"], holidayKeys: new Set(), requests, logs: [] }
}

function rec(clockIn: Date, clockOut: Date, over: Record<string, unknown> = {}): RecordRow {
  return {
    id: "r1", userId: "u1", date: DATE, status: "OPEN", isHolidayWork: false, isAbsent: false,
    clockIn, clockOut, rawClockIn: clockIn, rawClockOut: clockOut,
    goOutAt: null, returnAt: null, breakStart: null, breakEnd: null, breakMinutes: null,
    lateMinutes: null, earlyLeaveMinutes: null, overtimeMinutes: null, workingMinutes: null,
    switchRoundEarly: false, switchRoundNear: false, switchRoundQuarter: false, switchCapOvertime: false, switchNewCalc: true,
    ...over,
  } as unknown as RecordRow
}

function working(r: RecordRow, c: PipelineContext): number | null {
  const built = buildRecordUpdate(r, c)
  return built ? ((built.data as Data).workingMinutes as number) : null
}

const breakReq = (minutes: string, status = "APPROVED") => ({
  type: "BREAK", status, createdAt: new Date("2026-10-05T10:00:00Z"), detail: { minutes }, targetDate: DATE,
})
const leaveReq = (halfDay: "am" | "pm") => ({
  type: "LEAVE", status: "APPROVED", createdAt: new Date("2026-10-04T10:00:00Z"), detail: { leaveType: "paid", halfDay }, targetDate: DATE,
})

describe("段7：休憩分数の決め方（IMPLEMENTATION_PLAN I の具体例）", () => {
  it("野木さん：[60] を押す → 実働300・所定300", () => {
    const c = ctx(NOGI)
    expect(working(rec(jst(9, 0), jst(15, 0), { breakMinutes: 60 }), c)).toBe(300)
    expect(calcScheduledMinutes("09:00", "15:00", "part", { userBreakMinutes: 60, setting: c.setting })).toBe(300)
  })

  it("野木さん：押し忘れ → 実働360（休憩を引かない）・休憩申請漏れの知らせ", () => {
    expect(working(rec(jst(9, 0), jst(15, 0)), ctx(NOGI))).toBe(360)
    expect(needsBreakRecordNotice({
      employmentType: "part", userBreakMinutes: 60, breakMinutes: null,
      clockIn: jst(9, 0), clockOut: jst(15, 0),
    })).toBe(true)
  })

  it("野木さん：半休（所定の半分）は 150分", () => {
    const sched = calcScheduledMinutes("09:00", "15:00", "part", { userBreakMinutes: 60, setting: SETTING })
    expect(Math.round(sched / 2)).toBe(150)
  })

  it("パート・所定休憩なし・5時間勤務・記録なし → 0分・知らせなし", () => {
    const user = { ...NOGI, breakMinutes: null }
    expect(working(rec(jst(9, 0), jst(14, 0)), ctx(user))).toBe(300)
    expect(needsBreakRecordNotice({
      employmentType: "part", userBreakMinutes: null, breakMinutes: null, clockIn: jst(9, 0), clockOut: jst(14, 0),
    })).toBe(false)
  })

  it("パート・7時間勤務・記録なし → 0分・知らせあり（6時間超）", () => {
    const user = { ...NOGI, breakMinutes: null }
    expect(working(rec(jst(9, 0), jst(16, 0)), ctx(user))).toBe(420)
    expect(needsBreakRecordNotice({
      employmentType: "part", userBreakMinutes: null, breakMinutes: null, clockIn: jst(9, 0), clockOut: jst(16, 0),
    })).toBe(true)
  })

  it("パート・ちょうど6時間は知らせなし（6時間を超えたら）", () => {
    expect(needsBreakRecordNotice({
      employmentType: "part", userBreakMinutes: null, breakMinutes: null, clockIn: jst(9, 0), clockOut: jst(15, 0),
    })).toBe(false)
  })

  it("社員・9:00〜18:00・記録なし・所定休憩未設定 → 会社設定から60分", () => {
    expect(working(rec(jst(9, 0), jst(18, 0)), ctx(FULL_18))).toBe(480)
  })

  it("社員・9:00〜17:00・所定休憩60を設定 → 60分（未設定なら会社設定で45分）", () => {
    expect(working(rec(jst(9, 0), jst(17, 0)), ctx({ ...FULL_17, breakMinutes: 60 }))).toBe(420)
    expect(working(rec(jst(9, 0), jst(17, 0)), ctx(FULL_17))).toBe(435)
  })

  it("社員・休憩申請0分が承認済み → 0分（申請の0分は有効）", () => {
    expect(working(rec(jst(9, 0), jst(18, 0), { breakMinutes: 0 }), ctx(FULL_18))).toBe(540)
  })

  it("社員・午前半休 → 休憩0分（半休の日は規定の休憩を引かない）", () => {
    // 午前半休＝昼休憩の終わり（13:00）から。13:00〜18:00 の 300分がそのまま実働
    expect(working(rec(jst(13, 0), jst(18, 0)), ctx(FULL_18, [leaveReq("am")]))).toBe(300)
  })

  it("休憩ボタンは足し算ではなく上書き：30 → 60 に押し直すと 60 だけ引く", () => {
    const c = ctx(NOGI)
    expect(working(rec(jst(9, 0), jst(15, 0), { breakMinutes: 30 }), c)).toBe(330)
    expect(working(rec(jst(9, 0), jst(15, 0), { breakMinutes: 60 }), c)).toBe(300)
  })

  it("休憩0分を押した日は0分を引く（規定値を引かない）。[0] は「記録あり」で知らせも出ない", () => {
    expect(working(rec(jst(9, 0), jst(18, 0), { breakMinutes: 0 }), ctx(FULL_18))).toBe(540)
    expect(needsBreakRecordNotice({
      employmentType: "part", userBreakMinutes: 60, breakMinutes: 0, clockIn: jst(9, 0), clockOut: jst(15, 0),
    })).toBe(false)
  })

  it("審査中の休憩申請は差し引かない（承認されて breakMinutes に入った時点で反映）", () => {
    const pending = ctx(NOGI, [breakReq("90", "PENDING")])
    expect(working(rec(jst(9, 0), jst(15, 0)), pending)).toBe(360)
  })

  it("承認された休憩申請（90分）は breakMinutes に入った値として差し引く", () => {
    expect(working(rec(jst(9, 0), jst(15, 0), { breakMinutes: 90 }), ctx(NOGI))).toBe(270)
  })

  it("外出は休憩とは別に引く（在席時間から外出を除いて、休憩を引く）", () => {
    const r = rec(jst(9, 0), jst(15, 0), { breakMinutes: 60, goOutAt: jst(10, 0), returnAt: jst(10, 30) })
    expect(working(r, ctx(NOGI))).toBe(270)
  })

  it("過去の休憩打刻（開始・終了）だけが残る記録は、打刻の差を休憩として使う（再計算で実働が増えない）", () => {
    const r = rec(jst(9, 0), jst(16, 0), { breakStart: jst(12, 0), breakEnd: jst(12, 45) })
    expect(working(r, ctx({ ...NOGI, breakMinutes: null }))).toBe(375)
  })

  it("休日（定時なし）に半日出勤した社員は、平日の定時ぶんの休憩を引かず在席時間に会社ルールを当てる", () => {
    // 在席5時間 → 6時間以内なので0分
    expect(resolveBreakMinutes({
      savedBreakMinutes: null, halfDay: null, employmentType: "full", userBreakMinutes: null,
      workStartTime: "09:00", workEndTime: "18:00", daySchedule: null, presenceMinutes: 300, setting: SETTING,
    })).toBe(0)
  })
})

describe("所定勤務時間 ＝ 拘束時間 − 所定休憩", () => {
  it("社員 9:00〜18:00（所定休憩なし）→ 会社設定で60分 → 480分", () => {
    expect(calcScheduledMinutes("09:00", "18:00", "full", { setting: SETTING })).toBe(480)
  })
  it("社員 8:30〜17:30 → 480分（従来どおり）", () => {
    expect(calcScheduledMinutes("08:30", "17:30", "full")).toBe(480)
  })
  it("定時が未設定なら雇用形態で fallback（社員 480・パート 0）", () => {
    expect(calcScheduledMinutes(null, null, "full")).toBe(480)
    expect(calcScheduledMinutes(null, null, "part")).toBe(0)
  })
})

describe("休憩申請の分数・所定休憩の入力検証", () => {
  it("休憩申請は15分刻み・0〜240分。0 は有効", () => {
    expect(parseBreakRequestMinutes("0")).toBe(0)
    expect(parseBreakRequestMinutes("90")).toBe(90)
    expect(parseBreakRequestMinutes("240")).toBe(240)
    expect(parseBreakRequestMinutes("20")).toBeNull()
    expect(parseBreakRequestMinutes("255")).toBeNull()
    expect(parseBreakRequestMinutes("-15")).toBeNull()
    expect(parseBreakRequestMinutes("")).toBeNull()
    expect(parseBreakRequestMinutes(null)).toBeNull()
  })
  it("所定休憩は空（未設定）が許可され、15分刻みの 0〜240 だけ通る", () => {
    expect(parseUserBreakMinutes("")).toEqual({ value: null })
    expect(parseUserBreakMinutes("60")).toEqual({ value: 60 })
    expect(parseUserBreakMinutes("0")).toEqual({ value: 0 })
    expect("error" in parseUserBreakMinutes("50")).toBe(true)
    expect("error" in parseUserBreakMinutes("300")).toBe(true)
    expect("error" in parseUserBreakMinutes("abc")).toBe(true)
  })
})

describe("パートの休憩申請漏れの知らせ", () => {
  const base = { employmentType: "part", userBreakMinutes: 60, breakMinutes: null, clockIn: jst(9, 0), clockOut: jst(15, 0) }
  it("正社員は対象外", () => {
    expect(needsBreakRecordNotice({ ...base, employmentType: "full" })).toBe(false)
  })
  it("退勤前は判定しない", () => {
    expect(needsBreakRecordNotice({ ...base, clockOut: null })).toBe(false)
  })
  it("審査中の休憩申請がある日は出さない（申請済み）", () => {
    expect(needsBreakRecordNotice({ ...base, hasPendingBreakRequest: true })).toBe(false)
  })
  it("過去の休憩打刻がある日は「記録あり」", () => {
    expect(needsBreakRecordNotice({ ...base, breakStart: jst(12, 0), breakEnd: jst(13, 0) })).toBe(false)
  })
  it("外出を除いた実働で6時間を判定する（7時間在席でも外出90分なら5.5時間で知らせなし）", () => {
    expect(needsBreakRecordNotice({
      ...base, userBreakMinutes: null, clockOut: jst(16, 0), goOutAt: jst(11, 0), returnAt: jst(12, 30),
    })).toBe(false)
  })
})
