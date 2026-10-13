/**
 * パートの残業・定時なしパート（シフト勤務）の丸め（2026-10-13 決定。docs/CLOCK_PIPELINE.md 冒頭の見直し）
 * - 残業 ＝「8時間を超えた時間帯」と「承認された残業申請の時間帯のうち働いた部分」を合わせた長さ（足し算にしない）
 * - 定時の外にはみ出しただけでは残業にしない
 * - 定時なしパート：遅刻・早退なし、①②なし、③は毎時 00/15/30/45、④は申請の終了時刻で打ち切る
 */
import { describe, it, expect, vi } from "vitest"

vi.mock("@/lib/prisma", () => ({ prisma: {} }))

import { buildRecordUpdate, type PipelineContext } from "../lib/clock-pipeline-db"
import { calcPartOvertimeMinutes } from "../lib/attendance"
import { DATE, hm, jst } from "./helpers/pipeline"

type RecordRow = Parameters<typeof buildRecordUpdate>[0]
type Data = Record<string, unknown>

const SETTING = {
  id: 1, closingDay: 25, break1Threshold: 360, break1Minutes: 60, break2Threshold: 480, break2Minutes: 60,
  roundEarlyClockIn: true, roundNearClockTime: true, roundQuarterHour: false, capOvertimeByRequest: false, newCalcMethod: false,
  lunchStartTime: "12:00", legalHolidayWeekday: 0, weekStartDay: 0,
}
const WEEKDAYS = { workSun: false, workMon: true, workTue: true, workWed: true, workThu: true, workFri: true, workSat: false }
/** 定時なし・所定休憩60のパート（長時間のシフト勤務） */
const SHIFT_60 = { workStartTime: null, workEndTime: null, employmentType: "part", isFullTimePart: false, breakMinutes: 60, ...WEEKDAYS }
/** 定時なし・所定休憩なしのパート（例：岡田さん） */
const SHIFT_0 = { ...SHIFT_60, breakMinutes: null }
/** 定時ありのパート 9:00〜16:00（所定休憩60） */
const FIXED = { ...SHIFT_60, workStartTime: "09:00", workEndTime: "16:00" }

function otReq(startTime: string, endTime: string) {
  return { type: "OVERTIME", status: "APPROVED", createdAt: new Date("2026-10-01T00:00:00Z"), detail: { startTime, endTime }, targetDate: DATE }
}

function ctx(user: Record<string, unknown>, requests: unknown[] = [], settingOver: Record<string, unknown> = {}): PipelineContext {
  return {
    user: user as PipelineContext["user"],
    setting: { ...SETTING, ...settingOver } as unknown as PipelineContext["setting"],
    holidayKeys: new Set(), requests: requests as PipelineContext["requests"], logs: [],
  }
}

/** 保存したスイッチ：①②は設定どおり ON、③④は引数 */
function rec(clockIn: Date, clockOut: Date, q = false, cap = false, over: Record<string, unknown> = {}): RecordRow {
  return {
    id: "r1", userId: "u1", date: DATE, status: "OPEN", isHolidayWork: false, isAbsent: false,
    clockIn, clockOut, rawClockIn: clockIn, rawClockOut: clockOut,
    goOutAt: null, returnAt: null, breakStart: null, breakEnd: null, breakMinutes: null,
    lateMinutes: null, earlyLeaveMinutes: null, overtimeMinutes: null, workingMinutes: null,
    adminClockIn: null, adminClockOut: null,
    switchRoundEarly: true, switchRoundNear: true, switchRoundQuarter: q, switchCapOvertime: cap, switchNewCalc: false,
    ...over,
  } as unknown as RecordRow
}

const calc = (r: RecordRow, c: PipelineContext) => buildRecordUpdate(r, c)!.data as Data

describe("パートの残業（合意した6つの例。休憩60）", () => {
  it("申請どおり：9:00〜18:00・申請 16:00〜18:00 → 2:00", () => {
    expect(calc(rec(jst(9, 0), jst(18, 0)), ctx(SHIFT_60, [otReq("16:00", "18:00")])).overtimeMinutes).toBe(120)
  })
  it("申請より長く働いた（④OFF）：9:00〜20:00・申請 16:00〜18:00 → 8時間超 18〜20 と合わせて 4:00", () => {
    expect(calc(rec(jst(9, 0), jst(20, 0)), ctx(SHIFT_60, [otReq("16:00", "18:00")])).overtimeMinutes).toBe(240)
  })
  it("同上（④ON）：退勤は申請の終わり 18:00 で打ち切り → 2:00", () => {
    const d = calc(rec(jst(9, 0), jst(20, 0), false, true), ctx(SHIFT_60, [otReq("16:00", "18:00")]))
    expect(hm(d.clockOut as Date)).toBe("18:00")
    expect(d.overtimeMinutes).toBe(120)
  })
  it("申請が8時間超と重なる：9:00〜20:00・申請 17:00〜20:00 → 3:00（足すと5:00になる）", () => {
    expect(calc(rec(jst(9, 0), jst(20, 0)), ctx(SHIFT_60, [otReq("17:00", "20:00")])).overtimeMinutes).toBe(180)
  })
  it("申請なし・長時間（④OFF）：9:00〜19:00 → 8時間超 18〜19 の 1:00", () => {
    expect(calc(rec(jst(9, 0), jst(19, 0)), ctx(SHIFT_60)).overtimeMinutes).toBe(60)
  })
  it("申請なし・短時間：12:45〜17:00 → 0", () => {
    expect(calc(rec(jst(12, 45), jst(17, 0)), ctx(SHIFT_0)).overtimeMinutes).toBe(0)
  })
})

describe("定時ありのパートも、定時の外にはみ出しただけでは残業にしない", () => {
  it("定時 9:00〜16:00 で 17:00 退勤・申請なし（④OFF）→ 実働7h なので 0", () => {
    expect(calc(rec(jst(9, 0), jst(17, 0)), ctx(FIXED)).overtimeMinutes).toBe(0)
  })
  it("定時 9:00〜16:00・申請 16:00〜17:00・17:00 退勤 → 1:00", () => {
    expect(calc(rec(jst(9, 0), jst(17, 0)), ctx(FIXED, [otReq("16:00", "17:00")])).overtimeMinutes).toBe(60)
  })
  it("実際の申請の形（終了時刻だけ）：開始は定時の終業 16:00 → 17:00 退勤で 1:00", () => {
    const req = { type: "OVERTIME", status: "APPROVED", createdAt: new Date("2026-10-01T00:00:00Z"), detail: { endTime: "17:00", scheduledEndTime: "16:00" }, targetDate: DATE }
    expect(calc(rec(jst(9, 0), jst(17, 0)), ctx(FIXED, [req])).overtimeMinutes).toBe(60)
  })
  it("定時ありのパートは遅刻を判定する（9:10 出勤 → 遅刻10。承認時に保存）", () => {
    const d = buildRecordUpdate(rec(jst(9, 10), jst(16, 0)), ctx(FIXED), { status: "APPROVED" })!.data as Data
    expect(d.lateMinutes).toBe(10)
  })
})

describe("定時なしパート（シフト勤務）", () => {
  it("遅刻・早退を判定しない（承認しても0）", () => {
    const d = buildRecordUpdate(rec(jst(12, 41), jst(17, 7)), ctx(SHIFT_0), { status: "APPROVED" })!.data as Data
    expect(d.lateMinutes).toBe(0)
    expect(d.earlyLeaveMinutes).toBe(0)
  })
  it("③OFF は丸めない（①②は定時が基準なので効かない）", () => {
    const d = calc(rec(jst(12, 41), jst(17, 7)), ctx(SHIFT_0))
    expect(hm(d.clockIn as Date)).toBe("12:41")
    expect(hm(d.clockOut as Date)).toBe("17:07")
  })
  it("③ON は毎時 00/15/30/45 で区切る（出勤は切り上げ・退勤は切り捨て）", () => {
    const d = calc(rec(jst(12, 41), jst(17, 7), true), ctx(SHIFT_0))
    expect(hm(d.clockIn as Date)).toBe("12:45")
    expect(hm(d.clockOut as Date)).toBe("17:00")
    expect(hm((calc(rec(jst(12, 45), jst(17, 15), true), ctx(SHIFT_0))).clockIn as Date)).toBe("12:45")
    expect(hm((calc(rec(jst(12, 46), jst(17, 15), true), ctx(SHIFT_0))).clockIn as Date)).toBe("13:00")
    expect(hm((calc(rec(jst(12, 46), jst(17, 15), true), ctx(SHIFT_0))).clockOut as Date)).toBe("17:15")
  })
  it("④ON でも申請が無ければ打ち切らない（定時が無いので基準が無い）", () => {
    const d = calc(rec(jst(12, 45), jst(17, 7), false, true), ctx(SHIFT_0))
    expect(hm(d.clockOut as Date)).toBe("17:07")
  })
  it("休憩：所定休憩なしの定時なしパートは申告が無ければ0（実働＝在席）", () => {
    expect(calc(rec(jst(12, 45), jst(17, 0)), ctx(SHIFT_0)).workingMinutes).toBe(255)
  })
})

describe("休日（休日出勤申請なし）のパートは残業0", () => {
  it("祝日に9:00〜20:00 → 残業0（勤務が成立していない）", () => {
    const c = ctx(SHIFT_60)
    c.holidayKeys = new Set([DATE.toISOString().slice(0, 10)])
    expect(calc(rec(jst(9, 0), jst(20, 0)), c).overtimeMinutes).toBe(0)
  })
})

describe("calcPartOvertimeMinutes（区間を合わせた長さ）", () => {
  it("外出も8時間に達する時刻を遅らせる（9:00〜19:00・休憩60・外出60 → 実働8h → 0）", () => {
    expect(calcPartOvertimeMinutes({ clockIn: jst(9, 0), clockOut: jst(19, 0), nonWorkMinutes: 120, windows: [] })).toBe(0)
  })
  it("申請が勤務の外なら数えない（申請 18:00〜20:00・17:00 退勤 → 0）", () => {
    expect(calcPartOvertimeMinutes({ clockIn: jst(12, 0), clockOut: jst(17, 0), nonWorkMinutes: 0, windows: [{ start: jst(18, 0), end: jst(20, 0) }] })).toBe(0)
  })
})
