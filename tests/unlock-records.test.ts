/**
 * 締め解除（F2-4）: 締め済 → 承認済、解除した勤怠ごとに変更履歴を残す
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  updateMany: vi.fn((args: unknown) => args),
  createMany: vi.fn((args: unknown) => args),
  transaction: vi.fn(async (ops: unknown[]) => ops),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    attendanceRecord: { findMany: mocks.findMany, updateMany: mocks.updateMany },
    attendanceChangeLog: { createMany: mocks.createMany },
    $transaction: mocks.transaction,
  },
}))

import { unlockRecords } from "../lib/unlock-records"

const first = new Date(Date.UTC(2026, 8, 26))
const last = new Date(Date.UTC(2026, 9, 25))

describe("unlockRecords", () => {
  beforeEach(() => vi.clearAllMocks())

  it("締め済の勤怠だけを対象に探す", async () => {
    mocks.findMany.mockResolvedValue([])
    await unlockRecords("u1", first, last, "admin1")
    expect(mocks.findMany.mock.calls[0][0].where).toMatchObject({ userId: "u1", status: "LOCKED" })
  })

  it("締め済が無ければ何もしない（0件）", async () => {
    mocks.findMany.mockResolvedValue([])
    expect(await unlockRecords("u1", first, last, "admin1")).toBe(0)
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it("締め済 → 承認済にし、1件ごとに誰が解除したかを変更履歴に残す", async () => {
    mocks.findMany.mockResolvedValue([{ id: "r1" }, { id: "r2" }])
    expect(await unlockRecords("u1", first, last, "admin1")).toBe(2)
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["r1", "r2"] }, status: "LOCKED" },
      data: { status: "APPROVED" },
    })
    expect(mocks.createMany).toHaveBeenCalledWith({
      data: [
        { recordId: "r1", changedById: "admin1", fieldName: "status", oldValue: "締め済", newValue: "承認済" },
        { recordId: "r2", changedById: "admin1", fieldName: "status", oldValue: "締め済", newValue: "承認済" },
      ],
    })
  })
})
