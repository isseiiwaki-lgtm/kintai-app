/**
 * 一覧画面の承認でも遅刻・早退・残業の分数を保存する（F2-2）
 * prisma をモックして、承認時に update へ渡るデータを確認する
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn((args: { where: { id: string }; data: Record<string, unknown> }) => args),
  transaction: vi.fn(async (ops: unknown[]) => ops),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    attendanceRecord: { findMany: mocks.findMany, update: mocks.update },
    user: { findUnique: mocks.findUnique },
    $transaction: mocks.transaction,
  },
}))

import { approveRecordsWithMetrics } from "../lib/approve-records"

function jst(h: number, mi: number): Date {
  return new Date(Date.UTC(2026, 9, 5, h, mi) - 9 * 60 * 60 * 1000)
}

describe("approveRecordsWithMetrics", () => {
  beforeEach(() => vi.clearAllMocks())

  it("承認と同時に遅刻・早退・残業の分数を保存する（定時 9:00-18:00）", async () => {
    mocks.findUnique.mockResolvedValue({ workStartTime: "09:00", workEndTime: "18:00", employmentType: "full" })
    mocks.findMany.mockResolvedValue([
      // 9:20 出勤・18:00 退勤 → 遅刻20分
      { id: "a", clockIn: jst(9, 20), clockOut: jst(18, 0), workingMinutes: 460 },
      // 9:00 出勤・14:00 退勤 → 早退240分
      { id: "b", clockIn: jst(9, 0), clockOut: jst(14, 0), workingMinutes: 300 },
      // 9:00 出勤・19:00 退勤（実働540・所定480）→ 残業60分
      { id: "c", clockIn: jst(9, 0), clockOut: jst(19, 0), workingMinutes: 540 },
    ])
    await approveRecordsWithMetrics("u1", new Date(Date.UTC(2026, 9, 1)), new Date(Date.UTC(2026, 9, 31)))

    const byId = Object.fromEntries(
      mocks.update.mock.calls.map(([arg]) => [arg.where.id, arg.data]),
    )
    expect(byId.a).toMatchObject({ status: "APPROVED", lateMinutes: 20, earlyLeaveMinutes: 0 })
    expect(byId.b).toMatchObject({ status: "APPROVED", lateMinutes: 0, earlyLeaveMinutes: 240 })
    expect(byId.c).toMatchObject({ status: "APPROVED", overtimeMinutes: 60 })
  })

  it("対象は OPEN / SUBMITTED のみ（承認詳細の一括承認と同じ）", async () => {
    mocks.findUnique.mockResolvedValue({ workStartTime: "09:00", workEndTime: "18:00", employmentType: "full" })
    mocks.findMany.mockResolvedValue([])
    await approveRecordsWithMetrics("u1", new Date(Date.UTC(2026, 9, 1)), new Date(Date.UTC(2026, 9, 31)))
    expect(mocks.findMany.mock.calls[0][0].where.status).toEqual({ in: ["OPEN", "SUBMITTED"] })
  })
})
