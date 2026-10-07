/**
 * 休憩申請（BREAK）の承認・削除・締め済みの扱い（サーバーアクションを prisma モックで確認）
 * 承認で AttendanceRecord.breakMinutes に入り（上書き）、打刻パイプラインで計算し直す。審査中は何も書かない
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => ({
  recompute: vi.fn(async () => {}),
  recordFind: vi.fn(),
  recordUpsert: vi.fn(),
  recordUpdate: vi.fn(),
  requestFind: vi.fn(),
  requestFindMany: vi.fn(),
  requestUpdate: vi.fn(),
  requestDelete: vi.fn(),
  approvalCreate: vi.fn(),
}))

vi.mock("@/auth", () => ({ auth: async () => ({ user: { id: "admin1", role: "ADMIN" } }) }))
vi.mock("next/cache", () => ({ revalidatePath: () => {} }))
vi.mock("@/lib/clock-pipeline-db", async (orig) => ({
  ...(await orig<typeof import("../lib/clock-pipeline-db")>()),
  recomputeDay: mocks.recompute,
}))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    attendanceRecord: { findUnique: mocks.recordFind, upsert: mocks.recordUpsert, update: mocks.recordUpdate },
    request: {
      findUnique: mocks.requestFind, findMany: mocks.requestFindMany, update: mocks.requestUpdate, delete: mocks.requestDelete,
    },
    approval: { create: mocks.approvalCreate, findMany: async () => [] },
    approvalRoute: { findMany: async () => [] },
    setting: { findUnique: async () => null },
  },
}))

import { actionApproveRequest, actionDeleteRequest } from "../app/(app)/admin/requests/actions"

const DAY = new Date(Date.UTC(2026, 9, 5))
const breakReq = (over: Record<string, unknown> = {}) => ({
  id: "q1", userId: "u1", type: "BREAK", status: "PENDING", targetDate: DAY, createdAt: new Date(),
  detail: { minutes: "90" }, reason: null, approvals: [],
  user: { workStartTime: "09:00", workEndTime: "15:00", employmentType: "part", breakMinutes: 60, department: null },
  ...over,
})

describe("休憩申請の承認・削除", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requestFindMany.mockResolvedValue([])
  })

  it("承認：その日の breakMinutes を申請の分数で上書きし、計算し直す", async () => {
    mocks.requestFind.mockResolvedValue(breakReq())
    mocks.recordFind.mockResolvedValue({ id: "r1", status: "OPEN" })
    expect(await actionApproveRequest("q1")).toEqual({ ok: true })
    expect(mocks.recordUpsert).toHaveBeenCalledWith(expect.objectContaining({ update: { breakMinutes: 90 } }))
    expect(mocks.recompute).toHaveBeenCalledWith("u1", DAY)
  })

  it("承認：0分の申請も有効（休憩なし）", async () => {
    mocks.requestFind.mockResolvedValue(breakReq({ detail: { minutes: "0" } }))
    mocks.recordFind.mockResolvedValue(null)
    await actionApproveRequest("q1")
    expect(mocks.recordUpsert).toHaveBeenCalledWith(expect.objectContaining({ update: { breakMinutes: 0 } }))
  })

  it("承認：締め済みの日は拒否し、何も書かない", async () => {
    mocks.requestFind.mockResolvedValue(breakReq())
    mocks.recordFind.mockResolvedValue({ id: "r1", status: "LOCKED" })
    const res = await actionApproveRequest("q1")
    expect(res.ok).toBe(false)
    expect(mocks.recordUpsert).not.toHaveBeenCalled()
    expect(mocks.approvalCreate).not.toHaveBeenCalled()
  })

  it("削除：承認済みを削除すると、残りの承認済みの休憩申請から出し直す（無ければ空に戻す）", async () => {
    mocks.requestFind.mockResolvedValue(breakReq({ status: "APPROVED" }))
    mocks.recordFind.mockResolvedValue({ id: "r1", status: "OPEN" })
    await actionDeleteRequest("q1")
    expect(mocks.recordUpdate).toHaveBeenCalledWith({ where: { id: "r1" }, data: { breakMinutes: null } })
    expect(mocks.recompute).toHaveBeenCalledWith("u1", DAY)
  })

  it("削除：残りに承認済みの休憩申請があれば、その分数に戻す", async () => {
    mocks.requestFind.mockResolvedValue(breakReq({ status: "APPROVED" }))
    mocks.recordFind.mockResolvedValue({ id: "r1", status: "OPEN" })
    mocks.requestFindMany.mockResolvedValue([{ detail: { minutes: "30" } }])
    await actionDeleteRequest("q1")
    expect(mocks.recordUpdate).toHaveBeenCalledWith({ where: { id: "r1" }, data: { breakMinutes: 30 } })
  })

  it("削除：締め済みの日は拒否（申請も消さない）", async () => {
    mocks.requestFind.mockResolvedValue(breakReq({ status: "APPROVED" }))
    mocks.recordFind.mockResolvedValue({ id: "r1", status: "LOCKED" })
    const res = await actionDeleteRequest("q1")
    expect(res.ok).toBe(false)
    expect(mocks.requestDelete).not.toHaveBeenCalled()
  })
})
