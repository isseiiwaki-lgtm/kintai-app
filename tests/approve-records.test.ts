/**
 * 勤怠承認（一覧の承認・承認詳細の一括承認）は共通処理 approveRecordsWithMetrics で、
 * 打刻パイプラインを通して遅刻・早退・残業を保存する（F2-2）
 * 計算の中身は tests/clock-pipeline-record.test.ts。ここでは呼び出しの形だけを確かめる
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  recomputeRecords: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: { attendanceRecord: { findMany: mocks.findMany } },
}))
vi.mock("@/lib/clock-pipeline-db", () => ({
  recomputeRecords: mocks.recomputeRecords,
}))

import { approveRecordsWithMetrics } from "../lib/approve-records"

describe("approveRecordsWithMetrics", () => {
  beforeEach(() => vi.clearAllMocks())

  it("対象は OPEN / SUBMITTED のみ（承認詳細の一括承認と同じ）", async () => {
    mocks.findMany.mockResolvedValue([])
    await approveRecordsWithMetrics("u1", new Date(Date.UTC(2026, 9, 1)), new Date(Date.UTC(2026, 9, 31)))
    expect(mocks.findMany.mock.calls[0][0].where.status).toEqual({ in: ["OPEN", "SUBMITTED"] })
    expect(mocks.recomputeRecords).not.toHaveBeenCalled()
  })

  it("対象の記録を打刻パイプラインに通して APPROVED にする", async () => {
    const records = [{ id: "a" }, { id: "b" }]
    mocks.findMany.mockResolvedValue(records)
    await approveRecordsWithMetrics("u1", new Date(Date.UTC(2026, 9, 1)), new Date(Date.UTC(2026, 9, 31)))
    expect(mocks.recomputeRecords).toHaveBeenCalledWith("u1", records, { status: "APPROVED" })
  })
})
