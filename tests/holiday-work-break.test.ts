/**
 * 休日出勤申請の「休憩（分）」・休日の休憩の規定値・振休/代休で休む日の行の表示・振休申請の廃止
 * （docs/REVIEW_R2_PIPELINE_2026-10-07.md「新しい休憩の規則への切り替え」）
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => ({
  recompute: vi.fn(async () => {}),
  holidayFind: vi.fn(async () => null),
  recordFind: vi.fn(),
  recordCreate: vi.fn(),
  recordUpsert: vi.fn(),
  recordUpdate: vi.fn(),
  recordDelete: vi.fn(),
  requestFind: vi.fn(),
  requestFindMany: vi.fn(),
  requestCount: vi.fn(),
  requestCreate: vi.fn(),
  requestUpdate: vi.fn(),
  requestDelete: vi.fn(),
  approvalCreate: vi.fn(),
}))

vi.mock("@/auth", () => ({ auth: async () => ({ user: { id: "admin1", role: "ADMIN" } }) }))
vi.mock("next/cache", () => ({ revalidatePath: () => {} }))
vi.mock("next/navigation", () => ({ redirect: () => {} }))
vi.mock("@/lib/clock-pipeline-db", async (orig) => ({
  ...(await orig<typeof import("../lib/clock-pipeline-db")>()),
  recomputeDay: mocks.recompute,
}))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    attendanceRecord: {
      findUnique: mocks.recordFind, create: mocks.recordCreate, upsert: mocks.recordUpsert,
      update: mocks.recordUpdate, delete: mocks.recordDelete,
    },
    request: {
      findUnique: mocks.requestFind, findMany: mocks.requestFindMany, count: mocks.requestCount,
      create: mocks.requestCreate, update: mocks.requestUpdate, delete: mocks.requestDelete,
    },
    approval: { create: mocks.approvalCreate, findMany: async () => [] },
    approvalRoute: { findMany: async () => [] },
    user: { findUnique: async () => ({ employmentType: "full", workSun: false, workMon: true, workTue: true, workWed: true, workThu: true, workFri: true, workSat: false }) },
    holiday: { findUnique: mocks.holidayFind },
    setting: { findUnique: async () => null },
  },
}))

import { actionApproveRequest, actionDeleteRequest, actionUpdateRequest } from "../app/(app)/admin/requests/actions"
import { actionCreateRequest } from "../app/(app)/requests/actions"
import { breakAnswerMinutes } from "../lib/attendance"
import { calcDefaultBreakMinutes, resolveBreakMinutes } from "../lib/clock-pipeline"
import {
  buildRestDayLabels, defaultHolidayBreakMinutes, holidayWorkSummary, restDateMonthPrefixes, restDayLabel,
} from "../lib/holiday-work"

const SAT = new Date(Date.UTC(2026, 9, 10)) // 2026-10-10（土）
const SETTING = { break1Threshold: 360, break1Minutes: 45, break2Threshold: 480, break2Minutes: 60 }

describe("休日出勤申請の休憩の目安（旧い法定休憩の規則を予定の長さに当てる）", () => {
  it("6時間以内 0／6時間超 45／8時間超 60", () => {
    expect(defaultHolidayBreakMinutes("09:00", "15:00")).toBe(0)
    expect(defaultHolidayBreakMinutes("09:00", "15:30")).toBe(45)
    expect(defaultHolidayBreakMinutes("09:00", "17:00")).toBe(45)
    expect(defaultHolidayBreakMinutes("09:00", "17:30")).toBe(60)
    expect(defaultHolidayBreakMinutes("", "17:30")).toBe(0)
  })
  it("breakAnswerMinutes：休日出勤は detail.breakMinutes。旧い申請（無し）・不正値は null", () => {
    expect(breakAnswerMinutes({ type: "HOLIDAY_WORK", detail: { breakMinutes: "45" } })).toBe(45)
    expect(breakAnswerMinutes({ type: "HOLIDAY_WORK", detail: { breakMinutes: "0" } })).toBe(0)
    expect(breakAnswerMinutes({ type: "HOLIDAY_WORK", detail: { startTime: "09:00" } })).toBeNull()
    expect(breakAnswerMinutes({ type: "HOLIDAY_WORK", detail: { breakMinutes: "20" } })).toBeNull()
  })
  it("内容欄の文言に休憩が入る", () => {
    expect(holidayWorkSummary({ startTime: "09:00", endTime: "15:00", breakMinutes: "45", restDate: "2026-10-12", restKind: "furikyu" }))
      .toBe("休日出勤 09:00〜15:00（休憩 45分）・振休 10/12")
  })
})

describe("休日（定時なし・休日出勤申請なし）の休憩の規定値：在席時間の法定休憩（本人の所定休憩は使わない）", () => {
  const base = {
    savedBreakMinutes: null, halfDay: null, employmentType: "full", userBreakMinutes: 60,
    workStartTime: "09:00", workEndTime: "18:00", daySchedule: null, setting: SETTING,
  } as const
  for (const newCalc of [true, false]) {
    it(`⑤${newCalc ? "ON" : "OFF"}：所定休憩60分の社員が日曜 10:00〜12:00（在席120分）→ 休憩0・実働120`, () => {
      const presence = 120
      const b = resolveBreakMinutes({ ...base, presenceMinutes: presence, newCalc })
      expect(b).toBe(0)
      expect(presence - b).toBe(120)
    })
    it(`⑤${newCalc ? "ON" : "OFF"}：在席6時間超 → 45、8時間超 → 60`, () => {
      expect(resolveBreakMinutes({ ...base, presenceMinutes: 361, newCalc })).toBe(45)
      expect(resolveBreakMinutes({ ...base, presenceMinutes: 481, newCalc })).toBe(60)
    })
    it(`⑤${newCalc ? "ON" : "OFF"}：パートは従来どおり 0（事実が無ければ）`, () => {
      expect(resolveBreakMinutes({ ...base, employmentType: "part", presenceMinutes: 500, newCalc })).toBe(0)
    })
  }
  it("休日出勤が承認された日（定時あり）は従来どおり定時から決める（⑤ON）", () => {
    expect(resolveBreakMinutes({ ...base, daySchedule: { start: "09:00", end: "18:00" }, presenceMinutes: 120, newCalc: true }))
      .toBe(calcDefaultBreakMinutes({ userBreakMinutes: 60, workStartTime: "09:00", workEndTime: "18:00" }, SETTING))
  })
  it("保存済みの休憩分数（承認済みの休日出勤申請が入れた値）が最優先", () => {
    expect(resolveBreakMinutes({ ...base, savedBreakMinutes: 30, daySchedule: { start: "09:00", end: "15:00" }, presenceMinutes: 600 })).toBe(30)
  })
})

describe("休む日の行の表示（振休・代休）", () => {
  it("ラベル：振休（10/12 出勤分）／代休（10/12 出勤分）", () => {
    expect(restDayLabel("furikyu", "2026-10-12")).toBe("振休（10/12 出勤分）")
    expect(restDayLabel("daikyu", "2026-10-12")).toBe("代休（10/12 出勤分）")
  })
  it("buildRestDayLabels：休む日 → ラベル。休む日なしは対象外", () => {
    const map = buildRestDayLabels([
      { targetDate: new Date(Date.UTC(2026, 9, 12)), createdAt: new Date("2026-10-01T00:00:00Z"), detail: { restDate: "2026-10-14", restKind: "furikyu" } },
      { targetDate: new Date(Date.UTC(2026, 9, 10)), createdAt: new Date("2026-10-02T00:00:00Z"), detail: { restDate: "2026-10-15", restKind: "daikyu" } },
      { targetDate: new Date(Date.UTC(2026, 9, 11)), createdAt: new Date("2026-10-03T00:00:00Z"), detail: {} },
    ])
    expect(map.get("2026-10-14")).toBe("振休（10/12 出勤分）")
    expect(map.get("2026-10-15")).toBe("代休（10/10 出勤分）")
    expect(map.size).toBe(2)
  })
  it("同じ休む日が複数なら、最後に出した申請", () => {
    const map = buildRestDayLabels([
      { targetDate: new Date(Date.UTC(2026, 9, 10)), createdAt: new Date("2026-10-02T00:00:00Z"), detail: { restDate: "2026-10-14", restKind: "daikyu" } },
      { targetDate: new Date(Date.UTC(2026, 9, 12)), createdAt: new Date("2026-10-01T00:00:00Z"), detail: { restDate: "2026-10-14", restKind: "furikyu" } },
    ])
    expect(map.get("2026-10-14")).toBe("代休（10/10 出勤分）")
  })
  it("期間にかかる月の接頭辞（締め期間 9/26〜10/25）", () => {
    expect(restDateMonthPrefixes(new Date(Date.UTC(2026, 8, 26)), new Date(Date.UTC(2026, 9, 25)))).toEqual(["2026-09", "2026-10"])
  })
})

describe("申請の作成：振休申請の廃止・休日出勤の休憩（必須）", () => {
  const form = (o: Record<string, string>) => {
    const fd = new FormData()
    for (const [k, v] of Object.entries(o)) fd.set(k, v)
    return fd
  }
  beforeEach(() => { vi.clearAllMocks() })

  it("LEAVE の substitute は新規に作れない（休日出勤申請を案内）。有給は作れる", async () => {
    const res = await actionCreateRequest(form({ type: "LEAVE", leaveType: "substitute", targetDate: "2026-10-14", reason: "", workDate: "2026-10-10" }))
    expect(res && !res.ok && res.error).toContain("休日出勤申請")
    expect(mocks.requestCreate).not.toHaveBeenCalled()
    await actionCreateRequest(form({ type: "LEAVE", leaveType: "paid", targetDate: "2026-10-14", reason: "" }))
    expect(mocks.requestCreate).toHaveBeenCalledTimes(1)
  })

  const hw = (over: Record<string, string> = {}) =>
    form({ type: "HOLIDAY_WORK", targetDate: "2026-10-10", reason: "", startTime: "09:00", endTime: "17:30", restDate: "", ...over })

  it("休日出勤：休憩が無い・不正（20分）→ エラーで作らない", async () => {
    for (const v of [{}, { breakMinutes: "" }, { breakMinutes: "20" }, { breakMinutes: "255" }] as Record<string, string>[]) {
      const res = await actionCreateRequest(hw(v))
      expect(res && !res.ok && res.error).toContain("休憩")
    }
    expect(mocks.requestCreate).not.toHaveBeenCalled()
  })

  it("休日出勤：休憩 0 も有効。detail に文字列で保存する", async () => {
    await actionCreateRequest(hw({ breakMinutes: "0" }))
    const data = (mocks.requestCreate.mock.calls[0][0] as { data: { detail: Record<string, string> } }).data
    expect(data.detail).toEqual({ startTime: "09:00", endTime: "17:30", breakMinutes: "0" })
  })
})

describe("休日出勤申請の休憩：承認・修正・削除は休憩申請と同じ連鎖", () => {
  const hwReq = (over: Record<string, unknown> = {}) => ({
    id: "q1", userId: "u1", type: "HOLIDAY_WORK", status: "PENDING", targetDate: SAT, createdAt: new Date(),
    detail: { startTime: "09:00", endTime: "17:30", breakMinutes: "60" }, reason: null, approvals: [],
    user: { workStartTime: "09:00", workEndTime: "17:30", employmentType: "full", breakMinutes: null, department: null },
    ...over,
  })
  const emptyRec = (over: Record<string, unknown> = {}) => ({
    id: "r1", status: "OPEN", isHolidayWork: true, clockIn: null, clockOut: null, rawClockIn: null, rawClockOut: null,
    goOutAt: null, returnAt: null, breakStart: null, breakEnd: null, breakMinutes: null, note: null, isAbsent: false, paidLeaveMinutes: null, ...over,
  })
  const form = (o: Record<string, string>) => {
    const fd = new FormData()
    const v = { type: "HOLIDAY_WORK", targetDate: "2026-10-10", reason: "", startTime: "09:00", endTime: "17:30", restDate: "", ...o }
    for (const [k, val] of Object.entries(v)) fd.set(k, val)
    return fd
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requestFindMany.mockResolvedValue([])
    mocks.requestCount.mockResolvedValue(1)
  })

  it("承認：その日の breakMinutes に入れ、承認前の値と適用順を申請に残し、計算し直す", async () => {
    mocks.requestFind.mockResolvedValue(hwReq())
    mocks.recordFind.mockResolvedValue(emptyRec({ breakMinutes: 15 }))
    expect(await actionApproveRequest("q1")).toEqual({ ok: true })
    expect(mocks.recordUpsert).toHaveBeenCalledWith(expect.objectContaining({ update: { breakMinutes: 60 } }))
    expect(mocks.requestUpdate).toHaveBeenCalledWith({
      where: { id: "q1" },
      data: { detail: { startTime: "09:00", endTime: "17:30", breakMinutes: "60", prevBreakMinutes: "15", breakAppliedAt: expect.any(String) } },
    })
    expect(mocks.recompute).toHaveBeenCalledWith("u1", SAT)
  })

  it("旧い申請（休憩なし）の承認は休憩を書かない（印だけ）", async () => {
    mocks.requestFind.mockResolvedValue(hwReq({ detail: { startTime: "09:00", endTime: "17:30" } }))
    mocks.recordFind.mockResolvedValue(null)
    await actionApproveRequest("q1")
    expect(mocks.recordUpsert).not.toHaveBeenCalled()
  })

  it("承認：締め済みの日は拒否し、何も書かない", async () => {
    mocks.requestFind.mockResolvedValue(hwReq())
    mocks.recordFind.mockResolvedValue({ id: "r1", status: "LOCKED" })
    const res = await actionApproveRequest("q1")
    expect(res.ok).toBe(false)
    expect(mocks.recordUpsert).not.toHaveBeenCalled()
    expect(mocks.approvalCreate).not.toHaveBeenCalled()
  })

  it("削除：記録が申請の入れた値のままなら承認前の値へ戻す。締め済みは拒否", async () => {
    const approved = hwReq({ status: "APPROVED", detail: { startTime: "09:00", endTime: "17:30", breakMinutes: "60", prevBreakMinutes: "15", breakAppliedAt: "2026-10-10T01:00:00.000Z" } })
    mocks.requestFind.mockResolvedValue(approved)
    mocks.requestCount.mockResolvedValue(0)
    mocks.recordFind.mockResolvedValue(emptyRec({ breakMinutes: 60, clockIn: new Date() }))
    expect(await actionDeleteRequest("q1")).toEqual({ ok: true })
    expect(mocks.recordUpdate).toHaveBeenCalledWith({ where: { id: "r1" }, data: { breakMinutes: 15 } })

    vi.clearAllMocks()
    mocks.requestFind.mockResolvedValue(approved)
    mocks.recordFind.mockResolvedValue({ id: "r1", status: "LOCKED" })
    const res = await actionDeleteRequest("q1")
    expect(res.ok).toBe(false)
    expect(!res.ok && res.error).toContain("休日出勤申請")
    expect(mocks.requestDelete).not.toHaveBeenCalled()
  })

  it("修正：承認済みの申請の休憩を直すと、記録が申請の値のままなら新しい分数にする（管理者が休憩を変えられる）", async () => {
    mocks.requestFind.mockResolvedValue(hwReq({ status: "APPROVED", detail: { startTime: "09:00", endTime: "17:30", breakMinutes: "60", prevBreakMinutes: "15", breakAppliedAt: "2026-10-10T01:00:00.000Z" } }))
    mocks.recordFind.mockResolvedValue(emptyRec({ breakMinutes: 60, clockIn: new Date() }))
    expect(await actionUpdateRequest("q1", form({ breakMinutes: "30" }))).toEqual({ ok: true })
    const call = mocks.requestUpdate.mock.calls[0][0] as { data: { detail: Record<string, string> } }
    expect(call.data.detail).toMatchObject({ breakMinutes: "30", prevBreakMinutes: "15" })
    expect(mocks.recordUpdate).toHaveBeenCalledWith({ where: { id: "r1" }, data: { breakMinutes: 30 } })
  })

  it("修正：日付を動かすと元の日は承認前の値へ戻し、新しい日に入れる", async () => {
    mocks.requestFind.mockResolvedValue(hwReq({ status: "APPROVED", detail: { startTime: "09:00", endTime: "17:30", breakMinutes: "60", prevBreakMinutes: "15", breakAppliedAt: "2026-10-10T01:00:00.000Z" } }))
    mocks.recordFind.mockImplementation(async ({ where }: { where: { userId_date: { date: Date } } }) =>
      where.userId_date.date.getTime() === SAT.getTime() ? emptyRec({ breakMinutes: 60, clockIn: new Date() }) : null)
    expect(await actionUpdateRequest("q1", form({ targetDate: "2026-10-11", breakMinutes: "60" }))).toEqual({ ok: true })
    expect(mocks.recordUpdate).toHaveBeenCalledWith({ where: { id: "r1" }, data: { breakMinutes: 15 } })
    expect(mocks.recordUpsert).toHaveBeenCalledWith(expect.objectContaining({ update: { breakMinutes: 60 } }))
  })

  it("修正：旧い申請（休憩なし）に休憩を足すと承認済みならその日に入れる。空欄のままなら何もしない", async () => {
    mocks.requestFind.mockResolvedValue(hwReq({ status: "APPROVED", detail: { startTime: "09:00", endTime: "17:30" } }))
    mocks.recordFind.mockResolvedValue(emptyRec({ clockIn: new Date() }))
    await actionUpdateRequest("q1", form({ breakMinutes: "45" }))
    expect(mocks.recordUpsert).toHaveBeenCalledWith(expect.objectContaining({ update: { breakMinutes: 45 } }))
    vi.clearAllMocks()
    mocks.requestFind.mockResolvedValue(hwReq({ status: "APPROVED", detail: { startTime: "09:00", endTime: "17:30" } }))
    mocks.recordFind.mockResolvedValue(emptyRec({ clockIn: new Date() }))
    expect(await actionUpdateRequest("q1", form({}))).toEqual({ ok: true })
    expect(mocks.recordUpsert).not.toHaveBeenCalled()
  })

  it("修正：休憩つきだった申請の休憩を空欄にはできない／不正な分数は拒否", async () => {
    mocks.requestFind.mockResolvedValue(hwReq())
    expect((await actionUpdateRequest("q1", form({ breakMinutes: "" }))).ok).toBe(false)
    expect((await actionUpdateRequest("q1", form({ breakMinutes: "20" }))).ok).toBe(false)
    expect(mocks.requestUpdate).not.toHaveBeenCalled()
  })

  it("管理者の修正：既存の振休申請（LEAVE substitute）は直せる", async () => {
    mocks.requestFind.mockResolvedValue({ id: "q9", userId: "u1", type: "LEAVE", status: "APPROVED", targetDate: SAT, createdAt: new Date(), detail: { leaveType: "substitute", halfDay: "full", workDate: "2026-10-03" } })
    const fd = new FormData()
    for (const [k, v] of Object.entries({ type: "LEAVE", targetDate: "2026-10-10", reason: "", leaveType: "substitute", halfDay: "full", workDate: "2026-10-04" })) fd.set(k, v)
    expect(await actionUpdateRequest("q9", fd)).toEqual({ ok: true })
  })
})
