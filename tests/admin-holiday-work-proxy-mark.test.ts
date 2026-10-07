/**
 * 管理者の記録編集モーダルの「休日出勤（代理）」チェック（actionAdminUpdateRecord）
 * 代理の印（holidayWorkByProxy）を付け外しでき、isHolidayWork ＝ 代理の印 OR 承認済みの休日出勤申請。
 * 変更履歴に1件残し、パイプラインで計算し直す。締め済みは拒否。
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => ({
  recompute: vi.fn(async () => {}),
  recordFind: vi.fn(),
  recordUpdate: vi.fn((a: unknown) => a),
  logCreate: vi.fn((a: unknown) => a),
  requestCount: vi.fn(),
  transaction: vi.fn(async () => []),
}))

vi.mock("@/auth", () => ({ auth: async () => ({ user: { id: "admin1", role: "ADMIN" } }) }))
vi.mock("next/cache", () => ({ revalidatePath: () => {} }))
vi.mock("@/lib/clock-pipeline-db", async (orig) => ({
  ...(await orig<typeof import("../lib/clock-pipeline-db")>()),
  recomputeDay: mocks.recompute,
}))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    attendanceRecord: { findUnique: mocks.recordFind, update: mocks.recordUpdate },
    attendanceChangeLog: { create: mocks.logCreate },
    request: { count: mocks.requestCount },
    $transaction: mocks.transaction,
  },
}))

import { actionAdminUpdateRecord } from "../app/(app)/admin/approval/[userId]/actions"

const DAY = new Date(Date.UTC(2026, 9, 4))
const record = (over: Record<string, unknown> = {}) => ({
  id: "r1", userId: "u1", date: DAY, status: "APPROVED", breakMinutes: null, isHolidayWork: false, holidayWorkByProxy: false,
  originalClockIn: null, originalClockOut: null,
  clockIn: null, clockOut: null, breakStart: null, breakEnd: null, goOutAt: null, returnAt: null,
  user: { workStartTime: "09:00", workEndTime: "15:00", employmentType: "part" },
  ...over,
})
function form(over: Record<string, string> = {}): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(over)) fd.set(k, v)
  return fd
}
const savedData = () => (mocks.recordUpdate.mock.calls[0][0] as { data: Record<string, unknown> }).data

describe("管理者の編集：休日出勤（代理）", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.requestCount.mockResolvedValue(0) })

  it("チェックを入れる：代理の印と休日出勤の印を付け、変更履歴を1件残し、計算し直す", async () => {
    mocks.recordFind.mockResolvedValue(record())
    expect(await actionAdminUpdateRecord("r1", "2026-10-04", form({ holidayWorkProxyField: "1", isHolidayWorkProxy: "on" }))).toEqual({ ok: true })
    expect(savedData()).toMatchObject({ holidayWorkByProxy: true, isHolidayWork: true })
    expect(mocks.logCreate).toHaveBeenCalledWith({ data: { recordId: "r1", changedById: "admin1", fieldName: "holidayWorkByProxy", oldValue: "なし", newValue: "あり" } })
    expect(mocks.recompute).toHaveBeenCalledWith("u1", DAY)
  })

  it("チェックを外す：承認済みの休日出勤申請が無ければ、休日出勤の印も外す（外せなかった印を戻せる）", async () => {
    mocks.recordFind.mockResolvedValue(record({ isHolidayWork: true, holidayWorkByProxy: true }))
    expect(await actionAdminUpdateRecord("r1", "2026-10-04", form({ holidayWorkProxyField: "1" }))).toEqual({ ok: true })
    expect(savedData()).toMatchObject({ holidayWorkByProxy: false, isHolidayWork: false })
    expect(mocks.logCreate).toHaveBeenCalledWith({ data: { recordId: "r1", changedById: "admin1", fieldName: "holidayWorkByProxy", oldValue: "あり", newValue: "なし" } })
    expect(mocks.recompute).toHaveBeenCalled()
  })

  it("チェックを外しても、承認済みの休日出勤申請があれば休日出勤のまま", async () => {
    mocks.recordFind.mockResolvedValue(record({ isHolidayWork: true, holidayWorkByProxy: true }))
    mocks.requestCount.mockResolvedValue(1)
    await actionAdminUpdateRecord("r1", "2026-10-04", form({ holidayWorkProxyField: "1" }))
    expect(savedData()).toMatchObject({ holidayWorkByProxy: false, isHolidayWork: true })
  })

  it("変更なし（印と同じチェック）なら印も履歴も書かない。欄が無い送信（hidden なし）も触らない", async () => {
    mocks.recordFind.mockResolvedValue(record({ isHolidayWork: true, holidayWorkByProxy: true }))
    await actionAdminUpdateRecord("r1", "2026-10-04", form({ holidayWorkProxyField: "1", isHolidayWorkProxy: "on" }))
    expect(savedData()).not.toHaveProperty("holidayWorkByProxy")
    expect(mocks.logCreate).not.toHaveBeenCalled()
    vi.clearAllMocks()
    mocks.recordFind.mockResolvedValue(record({ isHolidayWork: true, holidayWorkByProxy: true }))
    await actionAdminUpdateRecord("r1", "2026-10-04", form())
    expect(savedData()).not.toHaveProperty("holidayWorkByProxy")
  })

  it("締め済み（LOCKED）は拒否（エラーを返し、何も書かない）", async () => {
    mocks.recordFind.mockResolvedValue(record({ status: "LOCKED", holidayWorkByProxy: true, isHolidayWork: true }))
    const res = await actionAdminUpdateRecord("r1", "2026-10-04", form({ holidayWorkProxyField: "1" }))
    expect(res.ok).toBe(false)
    expect(mocks.transaction).not.toHaveBeenCalled()
    expect(mocks.recompute).not.toHaveBeenCalled()
  })
})
