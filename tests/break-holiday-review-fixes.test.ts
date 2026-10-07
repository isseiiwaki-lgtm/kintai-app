/**
 * 休憩の申請一本化・休日出勤申請のレビュー指摘の修正
 * - 代理打刻が、休憩申請の承認・休日出勤の事前承認で作られた空の記録の値を消さない
 * - 管理者の記録の編集で休憩を「未設定に戻す」
 * - 承認済みの休憩申請がある日は休憩ボタンを断る
 * - 休日出勤申請の対象日（休日）をサーバーで確かめる
 * - Excel と /records が同じ休憩（storedBreakMinutes）・Excel と段0が同じ休日出勤申請（pickHolidayWorkRequest）を使う
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => ({
  recompute: vi.fn(async () => {}),
  recordFind: vi.fn(),
  recordUpdate: vi.fn(),
  recordCreate: vi.fn(),
  logCreate: vi.fn(),
  logCreateMany: vi.fn(),
  userFind: vi.fn(),
  holidayFind: vi.fn(async () => null),
  requestCount: vi.fn(async () => 0),
  requestCreate: vi.fn(),
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
    attendanceRecord: { findUnique: mocks.recordFind, update: mocks.recordUpdate, create: mocks.recordCreate },
    attendanceChangeLog: { create: mocks.logCreate, createMany: mocks.logCreateMany },
    user: { findUnique: mocks.userFind },
    holiday: { findUnique: mocks.holidayFind },
    request: { count: mocks.requestCount, create: mocks.requestCreate },
    $transaction: async (arg: unknown) => {
      if (typeof arg === "function") {
        return (arg as (tx: unknown) => Promise<unknown>)({
          attendanceRecord: { update: mocks.recordUpdate, create: mocks.recordCreate },
          attendanceChangeLog: { createMany: mocks.logCreateMany },
        })
      }
      return Promise.all(arg as Promise<unknown>[])
    },
  },
}))

import { actionAdminCreateRecord, actionAdminUpdateRecord } from "../app/(app)/admin/approval/[userId]/actions"
import { actionSetBreak } from "../app/(app)/clock/actions"
import { actionCreateRequest } from "../app/(app)/requests/actions"
import { pickHolidayWorkRequest, pickHolidayWorkSchedule } from "../lib/clock-pipeline"
import { storedBreakMinutes } from "../lib/attendance"

const SAT = new Date(Date.UTC(2026, 9, 10))
const WEEKDAY_USER = {
  workSun: false, workMon: true, workTue: true, workWed: true, workThu: true, workFri: true, workSat: false,
  workStartTime: "09:00", workEndTime: "15:00", employmentType: "part",
}

function form(v: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [k, val] of Object.entries(v)) fd.set(k, val)
  return fd
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.userFind.mockResolvedValue(WEEKDAY_USER)
  mocks.holidayFind.mockResolvedValue(null)
  mocks.requestCount.mockResolvedValue(0)
  mocks.recordUpdate.mockResolvedValue({ id: "r1" })
  mocks.recordCreate.mockResolvedValue({ id: "r1" })
})

describe("代理打刻：すでにある空の記録の値を消さない", () => {
  const emptyRec = (over: Record<string, unknown> = {}) => ({
    id: "r1", userId: "u1", date: SAT, status: "OPEN", clockIn: null, clockOut: null,
    breakMinutes: 90, isHolidayWork: true, holidayWorkByProxy: false, ...over,
  })
  const updateData = () => (mocks.recordUpdate.mock.calls[0][0] as { data: Record<string, unknown> }).data

  it("休憩が未設定・休日出勤のチェックなし → 休憩申請の承認で入った休憩と、休日出勤申請の印を残す（印の出どころも変えない）", async () => {
    mocks.recordFind.mockResolvedValue(emptyRec())
    const res = await actionAdminCreateRecord("u1", "2026-10-10", form({ clockIn: "09:00", clockOut: "15:00" }))
    expect(res).toEqual({ ok: true })
    expect(updateData().breakMinutes).toBe(90)
    expect(updateData().isHolidayWork).toBe(true)
    expect(updateData().holidayWorkByProxy).toBe(false)
  })

  it("休憩を入力したらそれで上書き。チェックを入れたら代理打刻の印になる", async () => {
    mocks.recordFind.mockResolvedValue(emptyRec({ isHolidayWork: false }))
    await actionAdminCreateRecord("u1", "2026-10-10", form({ clockIn: "09:00", clockOut: "15:00", breakMinutes: "30", isHolidayWork: "on" }))
    expect(updateData().breakMinutes).toBe(30)
    expect(updateData().isHolidayWork).toBe(true)
    expect(updateData().holidayWorkByProxy).toBe(true)
  })

  it("記録が無い日の新規作成：空なら breakMinutes は null、チェックなしなら印なし", async () => {
    mocks.recordFind.mockResolvedValue(null)
    await actionAdminCreateRecord("u1", "2026-10-10", form({ clockIn: "09:00" }))
    const data = (mocks.recordCreate.mock.calls[0][0] as { data: Record<string, unknown> }).data
    expect(data.breakMinutes).toBeNull()
    expect(data.isHolidayWork).toBe(false)
    expect(data.holidayWorkByProxy).toBe(false)
  })
})

describe("管理者の記録の編集：休憩を未設定に戻す", () => {
  const current = (breakMinutes: number | null) => ({
    id: "r1", userId: "u1", date: SAT, status: "OPEN", breakMinutes,
    clockIn: null, clockOut: null, goOutAt: null, returnAt: null, breakStart: null, breakEnd: null,
    originalClockIn: null, originalClockOut: null, user: {},
  })
  const sentData = () => (mocks.recordUpdate.mock.calls[0][0] as { data: Record<string, unknown> }).data

  it("unset → breakMinutes を null にして履歴に残す", async () => {
    mocks.recordFind.mockResolvedValue(current(60))
    expect(await actionAdminUpdateRecord("r1", "2026-10-10", form({ breakMinutes: "unset" }))).toEqual({ ok: true })
    expect(sentData().breakMinutes).toBeNull()
    expect(mocks.logCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ fieldName: "breakMinutes", oldValue: "60", newValue: null }) })
  })

  it("空（変更なし）は触らない。もともと未設定の unset も何もしない", async () => {
    mocks.recordFind.mockResolvedValue(current(60))
    await actionAdminUpdateRecord("r1", "2026-10-10", form({ breakMinutes: "" }))
    expect("breakMinutes" in sentData()).toBe(false)
    vi.clearAllMocks()
    mocks.recordFind.mockResolvedValue(current(null))
    await actionAdminUpdateRecord("r1", "2026-10-10", form({ breakMinutes: "unset" }))
    expect("breakMinutes" in sentData()).toBe(false)
  })
})

describe("休憩ボタン：承認済みの休憩申請がある日は断る", () => {
  it("承認済みの申請あり → エラー・記録を書き換えない", async () => {
    mocks.recordFind.mockResolvedValue({ id: "r1", status: "OPEN", clockIn: new Date() })
    mocks.requestCount.mockResolvedValue(1)
    const res = await actionSetBreak(60)
    expect(res.ok).toBe(false)
    expect(!res.ok && res.error).toContain("休憩申請")
    expect(mocks.recordUpdate).not.toHaveBeenCalled()
  })

  it("承認済みの申請なし → 従来どおり保存", async () => {
    mocks.recordFind.mockResolvedValue({ id: "r1", status: "OPEN", clockIn: new Date() })
    expect(await actionSetBreak(60)).toEqual({ ok: true })
    expect(mocks.recordUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: { breakMinutes: 60 } }))
  })
})

describe("休日出勤申請の作成：対象日が休日か", () => {
  const hwForm = (targetDate: string) =>
    form({ type: "HOLIDAY_WORK", targetDate, reason: "", startTime: "09:00", endTime: "15:00", breakMinutes: "45", restDate: "" })

  it("平日（休日カレンダーにも無い）→ エラーを返し、申請を作らない", async () => {
    const res = await actionCreateRequest(hwForm("2026-10-07"))
    expect(res && !res.ok && res.error).toContain("休日")
    expect(mocks.requestCreate).not.toHaveBeenCalled()
  })

  it("本人の休みの曜日（土）・休日カレンダーの日 → 作れる", async () => {
    await actionCreateRequest(hwForm("2026-10-10"))
    expect(mocks.requestCreate).toHaveBeenCalledTimes(1)
    mocks.holidayFind.mockResolvedValue({ id: 1 } as never)
    await actionCreateRequest(hwForm("2026-10-07"))
    expect(mocks.requestCreate).toHaveBeenCalledTimes(2)
  })
})

describe("休憩の共通ヘルパー（/records と Excel）", () => {
  const base = { breakMinutes: null, breakStart: null, breakEnd: null, goOutAt: null, returnAt: null, clockIn: null, clockOut: null, workingMinutes: null }
  const t = (h: number, m = 0) => new Date(Date.UTC(2026, 9, 5, h - 9, m))

  it("保存した実働があり breakMinutes が空：在席時間 − 外出 − 実働で逆算（Excel の休憩と実働が食い違わない）", () => {
    expect(storedBreakMinutes({ ...base, clockIn: t(9), clockOut: t(18), workingMinutes: 480 })).toBe(60)
    expect(storedBreakMinutes({ ...base, clockIn: t(9), clockOut: t(18), goOutAt: t(12), returnAt: t(12, 30), workingMinutes: 480 })).toBe(30)
  })
  it("breakMinutes があればそれ。過去の休憩打刻が次。実働が無ければ null（resolveBreakMinutes に任せる）", () => {
    expect(storedBreakMinutes({ ...base, breakMinutes: 45, clockIn: t(9), clockOut: t(18), workingMinutes: 480 })).toBe(45)
    expect(storedBreakMinutes({ ...base, breakStart: t(12), breakEnd: t(12, 40) })).toBe(40)
    expect(storedBreakMinutes({ ...base, clockIn: t(9), clockOut: t(18) })).toBeNull()
  })
})

describe("休日出勤申請の選び方（段0と Excel で共通）", () => {
  const mk = (createdAt: number, restDate: string, status = "APPROVED") => ({
    type: "HOLIDAY_WORK", status, createdAt: new Date(createdAt), detail: { startTime: "09:00", endTime: "15:00", restDate },
  })
  it("最後に出した承認済みの申請を選ぶ。段0の定時も同じ申請から", () => {
    const list = [mk(1, "a"), mk(3, "c"), mk(2, "b"), mk(4, "d", "PENDING")]
    expect(pickHolidayWorkRequest(list)?.detail.restDate).toBe("c")
    expect(pickHolidayWorkSchedule(list)).toEqual({ start: "09:00", end: "15:00" })
  })
  it("開始・終了が正しくない申請は選ばない", () => {
    const bad = { type: "HOLIDAY_WORK", status: "APPROVED", createdAt: new Date(9), detail: { restDate: "x" } }
    expect(pickHolidayWorkRequest([bad, mk(1, "a")])?.detail).toMatchObject({ restDate: "a" })
    expect(pickHolidayWorkRequest([bad])).toBeNull()
  })
})
