/**
 * 休日出勤申請（HOLIDAY_WORK）：振休・代休の区別、段0（申請の開始〜終了が定時の代わり）、知らせる条件、
 * 承認・削除・修正・締め済みの扱い（サーバーアクションを prisma モックで確認）
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => {
  const store = { records: [] as Record<string, unknown>[], requests: [] as Record<string, unknown>[] }
  return {
    store,
    recompute: vi.fn(async () => {}),
    recordFind: vi.fn(),
    recordCreate: vi.fn(),
    recordUpdate: vi.fn(),
    recordDelete: vi.fn(),
    requestFind: vi.fn(),
    requestCount: vi.fn(),
    requestUpdate: vi.fn(),
    requestDelete: vi.fn(),
    approvalCreate: vi.fn(),
    approvalFindMany: vi.fn(async () => []),
    routeFindMany: vi.fn(async () => []),
  }
})

vi.mock("@/auth", () => ({ auth: async () => ({ user: { id: "admin1", role: "ADMIN" } }) }))
vi.mock("next/cache", () => ({ revalidatePath: () => {} }))
vi.mock("@/lib/clock-pipeline-db", async (orig) => ({
  ...(await orig<typeof import("../lib/clock-pipeline-db")>()),
  recomputeDay: mocks.recompute,
}))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    attendanceRecord: {
      findUnique: mocks.recordFind, create: mocks.recordCreate, update: mocks.recordUpdate, delete: mocks.recordDelete,
    },
    request: {
      findUnique: mocks.requestFind, count: mocks.requestCount, update: mocks.requestUpdate, delete: mocks.requestDelete,
      findMany: async () => [],
    },
    approval: { create: mocks.approvalCreate, findMany: mocks.approvalFindMany },
    approvalRoute: { findMany: mocks.routeFindMany },
    user: { findUnique: async () => null },
    setting: { findUnique: async () => null },
  },
}))

import { actionApproveRequest, actionDeleteRequest, actionUpdateRequest } from "../app/(app)/admin/requests/actions"
import { buildRecordUpdate, type PipelineContext } from "../lib/clock-pipeline-db"
import { needsHolidayWorkNotice } from "../lib/attendance"
import {
  fmtRestDate, holidayWorkSummary, isSameWeek, resolveRestKind, validateHolidayWorkTimes, validateRestDate,
} from "../lib/holiday-work"
import { pickHolidayWorkSchedule, resolveScheduleForDate } from "../lib/clock-pipeline"
import { hm, jst } from "./helpers/pipeline"

const SAT = new Date(Date.UTC(2026, 9, 10)) // 2026-10-10（土）
const WEEKDAYS = { workSun: false, workMon: true, workTue: true, workWed: true, workThu: true, workFri: true, workSat: false }
const USER = { workStartTime: "09:00", workEndTime: "17:30", employmentType: "full", breakMinutes: null, ...WEEKDAYS }
const SETTING = {
  id: 1, closingDay: 25, break1Threshold: 360, break1Minutes: 45, break2Threshold: 480, break2Minutes: 60,
  roundEarlyClockIn: false, roundNearClockTime: false, roundQuarterHour: false, capOvertimeByRequest: true,
  lunchStartTime: "12:00", legalHolidayWeekday: 0, weekStartDay: 0,
}

const hwRequest = (over: Record<string, unknown> = {}) => ({
  type: "HOLIDAY_WORK", status: "APPROVED", createdAt: new Date("2026-10-05T00:00:00Z"), targetDate: SAT,
  detail: { startTime: "09:00", endTime: "15:00" }, ...over,
})

describe("振休・代休の決め方（システムが決める）", () => {
  it("休む日を申請と一緒に決めた → 振休", () => {
    expect(resolveRestKind({ nextRestDate: "2026-10-12", decidedWithRequest: true })).toBe("furikyu")
  })
  it("休む日を後から足した（管理者）→ 代休", () => {
    expect(resolveRestKind({ prevRestDate: null, nextRestDate: "2026-10-12", decidedWithRequest: false })).toBe("daikyu")
  })
  it("一度決まった区別は、休む日を直しても変わらない", () => {
    expect(resolveRestKind({ prevRestDate: "2026-10-12", prevRestKind: "furikyu", nextRestDate: "2026-10-13", decidedWithRequest: false })).toBe("furikyu")
    expect(resolveRestKind({ prevRestDate: "2026-10-12", prevRestKind: "daikyu", nextRestDate: "2026-10-13", decidedWithRequest: false })).toBe("daikyu")
  })
  it("休む日が空なら区別なし", () => {
    expect(resolveRestKind({ prevRestDate: "2026-10-12", prevRestKind: "furikyu", nextRestDate: "", decidedWithRequest: false })).toBeUndefined()
  })
  it("内容欄の文言：振休・代休・未定", () => {
    expect(holidayWorkSummary({ startTime: "09:00", endTime: "15:00", restDate: "2026-10-12", restKind: "furikyu" })).toBe("休日出勤 09:00〜15:00・振休 10/12")
    expect(holidayWorkSummary({ startTime: "09:00", endTime: "15:00", restDate: "2026-10-12", restKind: "daikyu" })).toBe("休日出勤 09:00〜15:00・代休 10/12")
    expect(holidayWorkSummary({ startTime: "09:00", endTime: "15:00" })).toBe("休日出勤 09:00〜15:00・休む日未定")
    expect(fmtRestDate("2026-10-02")).toBe("10/2")
  })
})

describe("申請の入力検証・週の判定", () => {
  it("開始・終了：両方必須で終了は開始より後", () => {
    expect(validateHolidayWorkTimes("09:00", "15:00")).toBeNull()
    expect(validateHolidayWorkTimes("15:00", "09:00")).not.toBeNull()
    expect(validateHolidayWorkTimes("", "15:00")).not.toBeNull()
  })
  it("休む日：空欄は可。休日出勤の日と同じ日は不可", () => {
    expect(validateRestDate("", "2026-10-10")).toBeNull()
    expect(validateRestDate("2026-10-10", "2026-10-10")).not.toBeNull()
    expect(validateRestDate("2026-13-40", "2026-10-10")).not.toBeNull()
    expect(validateRestDate("2026-10-12", "2026-10-10")).toBeNull()
  })
  it("同じ週か：起算日が日曜なら 土(10/10) と 月(10/12) は別の週、金(10/9) とは同じ週", () => {
    expect(isSameWeek("2026-10-12", "2026-10-10", 0)).toBe(false)
    expect(isSameWeek("2026-10-09", "2026-10-10", 0)).toBe(true)
  })
  it("起算日が月曜なら 土(10/10) と 月(10/12) は別の週、日(10/11) とは同じ週", () => {
    expect(isSameWeek("2026-10-12", "2026-10-10", 1)).toBe(false)
    expect(isSameWeek("2026-10-11", "2026-10-10", 1)).toBe(true)
    // 起算日が土曜なら 土(10/10) と 月(10/12) は同じ週
    expect(isSameWeek("2026-10-12", "2026-10-10", 6)).toBe(true)
  })
})

describe("段0：承認済みの休日出勤申請の開始〜終了が定時の代わり", () => {
  it("承認済みの申請だけを拾う（審査中・却下は無視。複数あれば最後に出した申請）", () => {
    expect(pickHolidayWorkSchedule([hwRequest({ status: "PENDING" })])).toBeNull()
    expect(pickHolidayWorkSchedule([hwRequest()])).toEqual({ start: "09:00", end: "15:00" })
    expect(pickHolidayWorkSchedule([
      hwRequest(),
      hwRequest({ createdAt: new Date("2026-10-06T00:00:00Z"), detail: { startTime: "10:00", endTime: "16:00" } }),
    ])).toEqual({ start: "10:00", end: "16:00" })
  })

  it("休日（土曜）に申請が無い日は定時なし、承認済みの申請がある日は申請の開始〜終了", () => {
    const base = { date: SAT, user: USER, setting: SETTING, isHoliday: false }
    expect(resolveScheduleForDate({ ...base, requests: [] })).toBeNull()
    expect(resolveScheduleForDate({ ...base, isHolidayWork: true, requests: [hwRequest()] })).toEqual({ start: "09:00", end: "15:00" })
  })

  it("土曜 9:00〜15:00 で申請、8:50 出勤・15:20 退勤（④ON）→ 記録 9:00〜15:00・遅刻早退なし・残業0", () => {
    const rec = {
      id: "r1", userId: "u1", date: SAT, status: "OPEN", isHolidayWork: true, isAbsent: false,
      clockIn: jst(8, 50, 10), clockOut: jst(15, 20, 10), rawClockIn: jst(8, 50, 10), rawClockOut: jst(15, 20, 10),
      goOutAt: null, returnAt: null, breakStart: null, breakEnd: null, breakMinutes: null,
      lateMinutes: null, earlyLeaveMinutes: null, overtimeMinutes: null, workingMinutes: null,
      switchRoundEarly: false, switchRoundNear: false, switchRoundQuarter: false, switchCapOvertime: true,
    } as unknown as Parameters<typeof buildRecordUpdate>[0]
    const ctx: PipelineContext = {
      user: USER, setting: SETTING as unknown as PipelineContext["setting"], holidayKeys: new Set(),
      requests: [hwRequest() as unknown as PipelineContext["requests"][number]], logs: [],
    }
    const built = buildRecordUpdate(rec, ctx)!
    const data = built.data as Record<string, unknown>
    expect(hm(data.clockIn as Date)).toBe("09:00")   // 定時前の早出は ④ で申請の開始に切られる
    expect(hm(data.clockOut as Date)).toBe("15:00")  // ④：残業申請が無いので定時（申請の終了）で頭打ち
    expect(data.overtimeMinutes).toBe(0)
    // 在席6時間 → 在席時間に会社ルール（6時間以内は0分）。休日出勤の日に平日の定時ぶんの休憩を引かない
    expect(data.workingMinutes).toBe(360)
  })

  it("承認前（申請が審査中）の休日の打刻は定時なしのまま・印が無ければ知らせの対象", () => {
    const sched = resolveScheduleForDate({ date: SAT, user: USER, setting: SETTING, isHoliday: false, requests: [hwRequest({ status: "PENDING" })] })
    expect(sched).toBeNull()
  })
})

describe("知らせる：休日に休日出勤申請が無いまま打刻があった日", () => {
  const base = { isRestDay: true, hasPunch: true, isHolidayWork: false, hasHolidayWorkRequest: false }
  it("休日・打刻あり・印も申請も無い → 出す", () => {
    expect(needsHolidayWorkNotice(base)).toBe(true)
  })
  it("審査中・承認済みの申請がある → 出さない", () => {
    expect(needsHolidayWorkNotice({ ...base, hasHolidayWorkRequest: true })).toBe(false)
  })
  it("休日出勤の印がある（承認済み・代理打刻のチェック）→ 出さない", () => {
    expect(needsHolidayWorkNotice({ ...base, isHolidayWork: true })).toBe(false)
  })
  it("平日・打刻なしの休日 → 出さない", () => {
    expect(needsHolidayWorkNotice({ ...base, isRestDay: false })).toBe(false)
    expect(needsHolidayWorkNotice({ ...base, hasPunch: false })).toBe(false)
  })
})

describe("承認・削除・修正（サーバーアクション）", () => {
  const pendingReq = (over: Record<string, unknown> = {}) => ({
    id: "q1", userId: "u1", type: "HOLIDAY_WORK", status: "PENDING", targetDate: SAT, createdAt: new Date(),
    detail: { startTime: "09:00", endTime: "15:00" }, reason: null,
    user: { workStartTime: "09:00", workEndTime: "17:30", employmentType: "full", breakMinutes: null, department: null },
    ...over,
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requestCount.mockResolvedValue(1)
  })

  it("承認：記録が無い日は休日出勤の印つきで記録を作り、打刻パイプラインで計算し直す", async () => {
    mocks.requestFind.mockResolvedValue(pendingReq())
    mocks.recordFind.mockResolvedValue(null)
    const res = await actionApproveRequest("q1")
    expect(res).toEqual({ ok: true })
    expect(mocks.recordCreate).toHaveBeenCalledWith({ data: { userId: "u1", date: SAT, isHolidayWork: true } })
    expect(mocks.recompute).toHaveBeenCalledWith("u1", SAT)
  })

  it("承認：打刻のある日は印だけ付けて計算し直す（出勤・退勤どちらが先でも同じ）", async () => {
    mocks.requestFind.mockResolvedValue(pendingReq())
    mocks.recordFind.mockResolvedValue({ id: "r1", status: "OPEN", isHolidayWork: false, clockIn: new Date() })
    await actionApproveRequest("q1")
    expect(mocks.recordUpdate).toHaveBeenCalledWith({ where: { id: "r1" }, data: { isHolidayWork: true } })
    expect(mocks.recompute).toHaveBeenCalledWith("u1", SAT)
  })

  it("承認：締め済み（LOCKED）の日は承認を拒否し、承認の記録も申請の状態も変えない", async () => {
    mocks.requestFind.mockResolvedValue(pendingReq())
    mocks.recordFind.mockResolvedValue({ id: "r1", status: "LOCKED" })
    const res = await actionApproveRequest("q1")
    expect(res.ok).toBe(false)
    expect(!res.ok && res.error).toContain("締め済み")
    expect(mocks.approvalCreate).not.toHaveBeenCalled()
    expect(mocks.requestUpdate).not.toHaveBeenCalled()
  })

  it("削除：承認済みを削除すると印を外し、打刻が無い空の記録は消す", async () => {
    mocks.requestFind.mockResolvedValue(pendingReq({ status: "APPROVED", approvals: [] }))
    mocks.requestCount.mockResolvedValue(0)
    const rec = { id: "r1", status: "OPEN", isHolidayWork: true, clockIn: null, clockOut: null, rawClockIn: null, rawClockOut: null,
      goOutAt: null, returnAt: null, breakStart: null, breakEnd: null, breakMinutes: null, note: null, isAbsent: false, paidLeaveMinutes: null }
    mocks.recordFind.mockResolvedValue(rec)
    const res = await actionDeleteRequest("q1")
    expect(res).toEqual({ ok: true })
    expect(mocks.recordUpdate).toHaveBeenCalledWith({ where: { id: "r1" }, data: { isHolidayWork: false } })
    expect(mocks.recordDelete).toHaveBeenCalledWith({ where: { id: "r1" } })
  })

  it("削除：打刻のある日は印を外して計算し直す（記録は残す）", async () => {
    mocks.requestFind.mockResolvedValue(pendingReq({ status: "APPROVED", approvals: [] }))
    mocks.requestCount.mockResolvedValue(0)
    mocks.recordFind.mockResolvedValue({ id: "r1", status: "OPEN", isHolidayWork: true, clockIn: new Date(), clockOut: null })
    await actionDeleteRequest("q1")
    expect(mocks.recordUpdate).toHaveBeenCalledWith({ where: { id: "r1" }, data: { isHolidayWork: false } })
    expect(mocks.recordDelete).not.toHaveBeenCalled()
    expect(mocks.recompute).toHaveBeenCalledWith("u1", SAT)
  })

  it("削除：締め済みの日は拒否（申請も消さない）", async () => {
    mocks.requestFind.mockResolvedValue(pendingReq({ status: "APPROVED", approvals: [] }))
    mocks.recordFind.mockResolvedValue({ id: "r1", status: "LOCKED" })
    const res = await actionDeleteRequest("q1")
    expect(res.ok).toBe(false)
    expect(mocks.requestDelete).not.toHaveBeenCalled()
  })

  function editForm(over: Record<string, string> = {}): FormData {
    const fd = new FormData()
    const v = { type: "HOLIDAY_WORK", targetDate: "2026-10-10", reason: "", startTime: "09:00", endTime: "15:00", restDate: "", ...over }
    for (const [k, val] of Object.entries(v)) fd.set(k, val)
    return fd
  }

  it("修正：承認済みの休日出勤に後から休む日を足す → 代休。時刻・日付が同じなら記録には触れない（締め済みでも可）", async () => {
    mocks.requestFind.mockResolvedValue(pendingReq({ status: "APPROVED" }))
    mocks.recordFind.mockResolvedValue({ id: "r1", status: "LOCKED" })
    const res = await actionUpdateRequest("q1", editForm({ restDate: "2026-10-14" }))
    expect(res).toEqual({ ok: true })
    const call = mocks.requestUpdate.mock.calls[0][0] as { data: { detail: Record<string, string> } }
    expect(call.data.detail).toEqual({ startTime: "09:00", endTime: "15:00", restDate: "2026-10-14", restKind: "daikyu" })
    expect(mocks.recompute).not.toHaveBeenCalled()
  })

  it("修正：申請と一緒に決めた休む日（振休）は、日付を直しても振休のまま", async () => {
    mocks.requestFind.mockResolvedValue(pendingReq({
      status: "APPROVED", detail: { startTime: "09:00", endTime: "15:00", restDate: "2026-10-13", restKind: "furikyu" },
    }))
    mocks.recordFind.mockResolvedValue({ id: "r1", status: "OPEN", isHolidayWork: true })
    await actionUpdateRequest("q1", editForm({ restDate: "2026-10-14" }))
    const call = mocks.requestUpdate.mock.calls[0][0] as { data: { detail: Record<string, string> } }
    expect(call.data.detail.restKind).toBe("furikyu")
  })

  it("修正：承認済みの予定時刻を変えると、記録時刻を計算し直す。締め済みの日は拒否", async () => {
    mocks.requestFind.mockResolvedValue(pendingReq({ status: "APPROVED" }))
    mocks.recordFind.mockResolvedValue({ id: "r1", status: "OPEN", isHolidayWork: true, clockIn: new Date() })
    const ok = await actionUpdateRequest("q1", editForm({ endTime: "16:00" }))
    expect(ok).toEqual({ ok: true })
    expect(mocks.recompute).toHaveBeenCalledWith("u1", SAT)

    vi.clearAllMocks()
    mocks.requestFind.mockResolvedValue(pendingReq({ status: "APPROVED" }))
    mocks.recordFind.mockResolvedValue({ id: "r1", status: "LOCKED" })
    const ng = await actionUpdateRequest("q1", editForm({ endTime: "16:00" }))
    expect(ng.ok).toBe(false)
    expect(mocks.requestUpdate).not.toHaveBeenCalled()
  })

  it("修正：休む日が休日出勤の日と同じ・終了が開始より前はエラーで保存しない", async () => {
    mocks.requestFind.mockResolvedValue(pendingReq({ status: "APPROVED" }))
    expect((await actionUpdateRequest("q1", editForm({ restDate: "2026-10-10" }))).ok).toBe(false)
    expect((await actionUpdateRequest("q1", editForm({ startTime: "15:00", endTime: "09:00" }))).ok).toBe(false)
    expect(mocks.requestUpdate).not.toHaveBeenCalled()
  })
})
