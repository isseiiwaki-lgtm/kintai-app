/**
 * 残業申請が退勤後に承認・削除されたときの、退勤の記録時刻の計算し直し（④）
 * prisma をモックして、update へ渡るデータを確認する
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => ({
  recordFind: vi.fn(),
  userFind: vi.fn(),
  settingFind: vi.fn(),
  requestFindMany: vi.fn(),
  logCount: vi.fn(),
  update: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    attendanceRecord: { findUnique: mocks.recordFind, update: mocks.update },
    user: { findUnique: mocks.userFind },
    setting: { findUnique: mocks.settingFind },
    request: { findMany: mocks.requestFindMany },
    attendanceChangeLog: { count: mocks.logCount },
  },
}))

import { recomputeClockOutForDay } from "../lib/clock-out-cap"

function jst(h: number, mi: number): Date {
  return new Date(Date.UTC(2026, 9, 5, h, mi) - 9 * 60 * 60 * 1000)
}
function hm(d: Date): string {
  const j = new Date(d.getTime() + 9 * 60 * 60 * 1000)
  return `${String(j.getUTCHours()).padStart(2, "0")}:${String(j.getUTCMinutes()).padStart(2, "0")}`
}

const DATE = new Date(Date.UTC(2026, 9, 5))
const USER = { workStartTime: "09:00", workEndTime: "17:30", employmentType: "full" }
const SETTING_ON = { roundEarlyClockIn: false, roundNearClockTime: false, roundQuarterHour: true, capOvertimeByRequest: true }

/** 19:51 に退勤打刻した日（申請が無かったので記録は定時 17:30 に頭打ち済み） */
function record(over: Record<string, unknown> = {}) {
  return {
    id: "r1", status: "OPEN", isHolidayWork: false,
    clockIn: jst(9, 0), clockOut: jst(17, 30), rawClockOut: jst(19, 51), originalClockOut: null,
    goOutAt: null, returnAt: null, breakStart: null, breakEnd: null,
    ...over,
  }
}
const approved1930 = [{ type: "OVERTIME", status: "APPROVED", createdAt: new Date("2026-10-05T10:00:00Z"), detail: { endTime: "19:30" } }]

describe("recomputeClockOutForDay", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.userFind.mockResolvedValue(USER)
    mocks.settingFind.mockResolvedValue(SETTING_ON)
    mocks.logCount.mockResolvedValue(0)
    mocks.recordFind.mockResolvedValue(record())
  })

  it("退勤後に残業申請（19:30）が承認された → 記録時刻 19:30・勤務時間と残業を計算し直す", async () => {
    mocks.requestFindMany.mockResolvedValue(approved1930)
    await recomputeClockOutForDay("u1", DATE)
    const data = mocks.update.mock.calls[0][0].data
    expect(hm(data.clockOut)).toBe("19:30")
    // 拘束 9:00-19:30=630分 - 法定休憩60 = 570、480基準の残業 90（残業の基準は変えない）
    expect(data.workingMinutes).toBe(570)
    expect(data.overtimeMinutes).toBe(90)
    // 未承認の日は遅刻・早退の保存値が無い（表示時に記録時刻から計算）ので書かない
    expect(data).not.toHaveProperty("lateMinutes")
    // 実打刻は書き換えない
    expect(data).not.toHaveProperty("rawClockOut")
  })

  it("承認が取り消されて申請が無くなった → 定時 17:30 に戻る", async () => {
    mocks.recordFind.mockResolvedValue(record({ clockOut: jst(19, 30) }))
    mocks.requestFindMany.mockResolvedValue([])
    await recomputeClockOutForDay("u1", DATE)
    expect(hm(mocks.update.mock.calls[0][0].data.clockOut)).toBe("17:30")
  })

  it("承認済みの勤怠は遅刻・早退・残業も保存し直す（休日出勤の印は0のまま）", async () => {
    mocks.requestFindMany.mockResolvedValue(approved1930)
    mocks.recordFind.mockResolvedValue(record({ status: "APPROVED", isHolidayWork: true, clockIn: jst(9, 20) }))
    await recomputeClockOutForDay("u1", DATE)
    const data = mocks.update.mock.calls[0][0].data
    expect(data).toMatchObject({ lateMinutes: 0, earlyLeaveMinutes: 0 })
    // 承認処理と同じ所定基準: 実働550（9:20-19:30 の拘束610 - 休憩60）- 所定450（拘束510 - 休憩60）= 100
    expect(data.overtimeMinutes).toBe(100)
  })

  it("④OFF なら何もしない", async () => {
    mocks.settingFind.mockResolvedValue({ ...SETTING_ON, capOvertimeByRequest: false })
    mocks.requestFindMany.mockResolvedValue(approved1930)
    await recomputeClockOutForDay("u1", DATE)
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it("締め済み（LOCKED）は遡及しない", async () => {
    mocks.recordFind.mockResolvedValue(record({ status: "LOCKED" }))
    mocks.requestFindMany.mockResolvedValue(approved1930)
    await recomputeClockOutForDay("u1", DATE)
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it("退勤時刻が人の手で直されている日は上書きしない（originalClockOut・変更履歴）", async () => {
    mocks.requestFindMany.mockResolvedValue(approved1930)
    mocks.recordFind.mockResolvedValue(record({ originalClockOut: jst(17, 30) }))
    await recomputeClockOutForDay("u1", DATE)
    expect(mocks.update).not.toHaveBeenCalled()

    mocks.recordFind.mockResolvedValue(record())
    mocks.logCount.mockResolvedValue(1)
    await recomputeClockOutForDay("u1", DATE)
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it("実打刻が無い日（代理打刻・手入力）は触らない", async () => {
    mocks.requestFindMany.mockResolvedValue(approved1930)
    mocks.recordFind.mockResolvedValue(record({ rawClockOut: null }))
    await recomputeClockOutForDay("u1", DATE)
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it("記録時刻が変わらなければ書かない", async () => {
    mocks.requestFindMany.mockResolvedValue(approved1930)
    mocks.recordFind.mockResolvedValue(record({ clockOut: jst(19, 30) }))
    await recomputeClockOutForDay("u1", DATE)
    expect(mocks.update).not.toHaveBeenCalled()
  })
})
