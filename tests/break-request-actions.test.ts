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

import { actionApproveRequest, actionDeleteRequest, actionUpdateRequest } from "../app/(app)/admin/requests/actions"

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
    mocks.recordFind.mockResolvedValue({ id: "r1", status: "OPEN", breakMinutes: 90 })
    await actionDeleteRequest("q1")
    expect(mocks.recordUpdate).toHaveBeenCalledWith({ where: { id: "r1" }, data: { breakMinutes: null } })
    expect(mocks.recompute).toHaveBeenCalledWith("u1", DAY)
  })

  it("削除：最後の段は、残りに承認済みの休憩申請があっても自分の承認前の値へ戻す（連鎖の順。詳細は break-request-chain.test.ts）", async () => {
    mocks.requestFind.mockResolvedValue(breakReq({ status: "APPROVED", detail: { minutes: "90", prevBreakMinutes: "30", breakAppliedAt: "2026-10-05T01:00:00.000Z" } }))
    mocks.recordFind.mockResolvedValue({ id: "r1", status: "OPEN", breakMinutes: 90 })
    mocks.requestFindMany.mockResolvedValue([{ id: "q0", createdAt: new Date(0), detail: { minutes: "30", prevBreakMinutes: "", breakAppliedAt: "2026-10-05T00:00:00.000Z" } }])
    await actionDeleteRequest("q1")
    expect(mocks.recordUpdate).toHaveBeenCalledWith({ where: { id: "r1" }, data: { breakMinutes: 30 } })
  })

  it("承認：承認前の breakMinutes を申請の detail に残す（未設定は空文字）", async () => {
    mocks.requestFind.mockResolvedValue(breakReq())
    mocks.recordFind.mockResolvedValue({ id: "r1", status: "OPEN", breakMinutes: 45 })
    await actionApproveRequest("q1")
    expect(mocks.requestUpdate).toHaveBeenCalledWith({
      where: { id: "q1" }, data: { detail: { minutes: "90", prevBreakMinutes: "45", breakAppliedAt: expect.any(String) } },
    })
    vi.clearAllMocks()
    mocks.requestFind.mockResolvedValue(breakReq())
    mocks.recordFind.mockResolvedValue({ id: "r1", status: "OPEN", breakMinutes: null })
    await actionApproveRequest("q1")
    expect(mocks.requestUpdate).toHaveBeenCalledWith({
      where: { id: "q1" }, data: { detail: { minutes: "90", prevBreakMinutes: "", breakAppliedAt: expect.any(String) } },
    })
  })

  it("削除：承認前の値が残っていれば、記録が申請の入れた値のままのときその値へ戻す", async () => {
    mocks.requestFind.mockResolvedValue(breakReq({ status: "APPROVED", detail: { minutes: "90", prevBreakMinutes: "45" } }))
    mocks.recordFind.mockResolvedValue({ id: "r1", status: "OPEN", breakMinutes: 90 })
    await actionDeleteRequest("q1")
    expect(mocks.recordUpdate).toHaveBeenCalledWith({ where: { id: "r1" }, data: { breakMinutes: 45 } })
  })

  it("削除：あとで休憩ボタン・管理者の入力が入って値が変わっていたら、そのまま残す", async () => {
    mocks.requestFind.mockResolvedValue(breakReq({ status: "APPROVED", detail: { minutes: "90", prevBreakMinutes: "45" } }))
    mocks.recordFind.mockResolvedValue({ id: "r1", status: "OPEN", breakMinutes: 60 })
    const res = await actionDeleteRequest("q1")
    expect(res).toEqual({ ok: true })
    expect(mocks.recordUpdate).not.toHaveBeenCalled()
    expect(mocks.requestDelete).toHaveBeenCalled()
  })

  function editForm(over: Record<string, string> = {}): FormData {
    const fd = new FormData()
    const v = { type: "BREAK", targetDate: "2026-10-05", reason: "", minutes: "60", ...over }
    for (const [k, val] of Object.entries(v)) fd.set(k, val)
    return fd
  }

  it("修正：同じ日の分数だけの修正は、記録が申請の入れた値のままなら新しい分数にする。承認前の値は引き継ぐ", async () => {
    mocks.requestFind.mockResolvedValue(breakReq({ status: "APPROVED", detail: { minutes: "90", prevBreakMinutes: "45" } }))
    mocks.recordFind.mockResolvedValue({ id: "r1", status: "OPEN", breakMinutes: 90 })
    expect(await actionUpdateRequest("q1", editForm())).toEqual({ ok: true })
    const call = mocks.requestUpdate.mock.calls[0][0] as { data: { detail: Record<string, string> } }
    expect(call.data.detail).toEqual({ minutes: "60", prevBreakMinutes: "45" })
    expect(mocks.recordUpdate).toHaveBeenCalledWith({ where: { id: "r1" }, data: { breakMinutes: 60 } })
  })

  it("修正：記録の値があとの入力で変わっていたら、記録は動かさない", async () => {
    mocks.requestFind.mockResolvedValue(breakReq({ status: "APPROVED", detail: { minutes: "90", prevBreakMinutes: "45" } }))
    mocks.recordFind.mockResolvedValue({ id: "r1", status: "OPEN", breakMinutes: 30 })
    await actionUpdateRequest("q1", editForm())
    expect(mocks.recordUpdate).not.toHaveBeenCalled()
  })

  it("修正：別の日へ直すと、元の日は承認前の値へ戻し、新しい日は承認と同じに入れる", async () => {
    mocks.requestFind.mockResolvedValue(breakReq({ status: "APPROVED", detail: { minutes: "90", prevBreakMinutes: "" } }))
    mocks.recordFind.mockImplementation(async (a: { where: { userId_date: { date: Date } } }) =>
      a.where.userId_date.date.getTime() === DAY.getTime()
        ? { id: "r1", status: "OPEN", breakMinutes: 90 }
        : { id: "r2", status: "OPEN", breakMinutes: 15 })
    expect(await actionUpdateRequest("q1", editForm({ targetDate: "2026-10-06" }))).toEqual({ ok: true })
    expect(mocks.recordUpdate).toHaveBeenCalledWith({ where: { id: "r1" }, data: { breakMinutes: null } })
    expect(mocks.recordUpsert).toHaveBeenCalledWith(expect.objectContaining({ update: { breakMinutes: 60 } }))
    expect(mocks.requestUpdate).toHaveBeenLastCalledWith({
      where: { id: "q1" }, data: { detail: { minutes: "60", prevBreakMinutes: "15", breakAppliedAt: expect.any(String) } },
    })
  })

  it("削除：締め済みの日は拒否（申請も消さない）", async () => {
    mocks.requestFind.mockResolvedValue(breakReq({ status: "APPROVED" }))
    mocks.recordFind.mockResolvedValue({ id: "r1", status: "LOCKED" })
    const res = await actionDeleteRequest("q1")
    expect(res.ok).toBe(false)
    expect(mocks.requestDelete).not.toHaveBeenCalled()
  })
})
