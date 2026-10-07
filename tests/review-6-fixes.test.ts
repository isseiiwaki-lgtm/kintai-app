/**
 * 切替6のレビュー指摘の修正
 * - 初期時刻の選択肢（正規表現）／休日だけの在席時間の法定休憩／休日出勤への種別変更の休憩必須／休暇種別の保持
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => ({
  requestFind: vi.fn(),
  requestFindMany: vi.fn(),
  requestUpdate: vi.fn(),
}))

vi.mock("@/auth", () => ({ auth: async () => ({ user: { id: "admin1", role: "ADMIN" } }) }))
vi.mock("next/cache", () => ({ revalidatePath: () => {} }))
vi.mock("next/navigation", () => ({ redirect: () => {}, useRouter: () => ({}), useSearchParams: () => new URLSearchParams() }))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    attendanceRecord: { findUnique: async () => null, upsert: async () => ({}), update: async () => ({}) },
    request: { findUnique: mocks.requestFind, findMany: mocks.requestFindMany, update: mocks.requestUpdate },
    approval: { create: async () => ({}), findMany: async () => [] },
    approvalRoute: { findMany: async () => [] },
    user: { findUnique: async () => ({ employmentType: "full" }) },
    holiday: { findUnique: async () => null },
    setting: { findUnique: async () => null },
  },
}))

import { actionUpdateRequest } from "../app/(app)/admin/requests/actions"
import { withPresetOption } from "../app/(app)/requests/new/NewRequestForm"
import { resolveBreakMinutes, calcDefaultBreakMinutes } from "../lib/clock-pipeline"
import { initialLeaveType, leaveTypeOptions } from "../lib/leave-type"

const DAY = new Date(Date.UTC(2026, 9, 5))
const SETTING = { break1Threshold: 360, break1Minutes: 45, break2Threshold: 480, break2Minutes: 60 }

describe("withPresetOption：範囲外の初期時刻を選択肢に足す", () => {
  it("21:00 を足して並べる。既にある値・不正な値は足さない", () => {
    const opts = [{ value: "20:45", label: "20:45" }, { value: "22:00", label: "22:00" }]
    expect(withPresetOption(opts, "21:00").map((o) => o.value)).toEqual(["20:45", "21:00", "22:00"])
    expect(withPresetOption(opts, "20:45")).toBe(opts)
    expect(withPresetOption(opts, "")).toBe(opts)
    expect(withPresetOption(opts, "abc")).toBe(opts)
  })
})

describe("resolveBreakMinutes：在席時間の法定休憩は「休日で休日出勤申請なし」だけ", () => {
  const base = {
    savedBreakMinutes: null, halfDay: null, employmentType: "full", userBreakMinutes: 60,
    workStartTime: null, workEndTime: null, daySchedule: null, presenceMinutes: 120, setting: SETTING,
  } as const
  it("休日（isRestDay）・定時なし → 在席120分は休憩0（⑤ON/OFF 共通）", () => {
    expect(resolveBreakMinutes({ ...base, isRestDay: true, newCalc: true })).toBe(0)
    expect(resolveBreakMinutes({ ...base, isRestDay: true, newCalc: false })).toBe(0)
  })
  it("平日で本人の始業・終業が未設定（定時なし）→ ⑤ON は従来の規定値（本人の所定休憩）", () => {
    expect(resolveBreakMinutes({ ...base, isRestDay: false, newCalc: true }))
      .toBe(calcDefaultBreakMinutes({ userBreakMinutes: 60, workStartTime: null, workEndTime: null }, SETTING))
    expect(resolveBreakMinutes({ ...base, newCalc: true }))
      .toBe(calcDefaultBreakMinutes({ userBreakMinutes: 60, workStartTime: null, workEndTime: null }, SETTING))
  })
  it("平日で定時なし → ⑤OFF は旧方式（在席時間の法定休憩）", () => {
    expect(resolveBreakMinutes({ ...base, isRestDay: false, presenceMinutes: 500, newCalc: false })).toBe(60)
    expect(resolveBreakMinutes({ ...base, isRestDay: false, presenceMinutes: 120, newCalc: false })).toBe(0)
  })
})

describe("管理者の修正", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requestFindMany.mockResolvedValue([])
  })
  const req = (over: Record<string, unknown>) => ({
    id: "q1", userId: "u1", status: "PENDING", targetDate: DAY, createdAt: new Date(), reason: null, approvals: [],
    user: { employmentType: "full" },
    ...over,
  })
  const form = (v: Record<string, string>) => {
    const fd = new FormData()
    for (const [k, val] of Object.entries({ targetDate: "2026-10-05", reason: "", ...v })) fd.set(k, val)
    return fd
  }

  it("他の種別から休日出勤申請に変えるとき、休憩（分）は必須", async () => {
    mocks.requestFind.mockResolvedValue(req({ type: "OVERTIME", detail: { endTime: "20:00" } }))
    const res = await actionUpdateRequest("q1", form({ type: "HOLIDAY_WORK", startTime: "09:00", endTime: "15:00" }))
    expect(res).toEqual({ ok: false, error: "休憩（分）を選んでください（取らない場合は0分）" })
    expect(mocks.requestUpdate).not.toHaveBeenCalled()
    // 休憩を選べば通る
    const ok = await actionUpdateRequest("q1", form({ type: "HOLIDAY_WORK", startTime: "09:00", endTime: "15:00", breakMinutes: "0" }))
    expect(ok).toEqual({ ok: true })
  })

  it("旧い休日出勤申請（休憩の申告なし）の修正は、休憩が空欄でも通る", async () => {
    mocks.requestFind.mockResolvedValue(req({ type: "HOLIDAY_WORK", detail: { startTime: "09:00", endTime: "17:00" } }))
    const res = await actionUpdateRequest("q1", form({ type: "HOLIDAY_WORK", startTime: "09:00", endTime: "15:00" }))
    expect(res).toEqual({ ok: true })
  })

  it("有給の修正で休暇種別が paid のまま残り、特別休暇の isPaid も消えない", async () => {
    mocks.requestFind.mockResolvedValue(req({ type: "LEAVE", detail: { leaveType: "paid", halfDay: "full", workDate: "" } }))
    await actionUpdateRequest("q1", form({ type: "LEAVE", leaveType: initialLeaveType("paid"), halfDay: "am" }))
    expect(mocks.requestUpdate.mock.calls[0][0].data.detail).toMatchObject({ leaveType: "paid", halfDay: "am" })

    mocks.requestUpdate.mockClear()
    mocks.requestFind.mockResolvedValue(req({ type: "LEAVE", detail: { leaveType: "special", isPaid: false, halfDay: "full" } }))
    await actionUpdateRequest("q1", form({ type: "LEAVE", leaveType: initialLeaveType("special"), halfDay: "full" }))
    expect(mocks.requestUpdate.mock.calls[0][0].data.detail).toMatchObject({ leaveType: "special", isPaid: false })
  })
})

describe("休暇種別の選択肢（管理者の修正フォーム）", () => {
  it("システムが使う値（paid / substitute / special）だけ。annual は出さない", () => {
    expect(leaveTypeOptions("paid").map((o) => o.value)).toEqual(["paid"])
    expect(leaveTypeOptions("substitute").map((o) => o.value)).toEqual(["paid", "substitute"])
    expect(leaveTypeOptions("special").map((o) => o.value)).toEqual(["paid", "special"])
    expect(leaveTypeOptions(undefined).map((o) => o.value)).not.toContain("annual")
  })
  it("初期値は既存の種別を保つ。過去の修正で入った annual は paid", () => {
    expect(initialLeaveType("paid")).toBe("paid")
    expect(initialLeaveType("substitute")).toBe("substitute")
    expect(initialLeaveType("special")).toBe("special")
    expect(initialLeaveType("annual")).toBe("paid")
    expect(initialLeaveType(undefined)).toBe("paid")
  })
})
