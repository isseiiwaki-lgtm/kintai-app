/**
 * 休む日は1つの休日出勤申請にしかひも付けられない（申請・管理者の修正の両方）／承認詳細の休む日ラベルの材料
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => ({
  count: vi.fn(),
  create: vi.fn(),
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
    request: {
      count: mocks.count, create: mocks.create,
      findUnique: mocks.requestFind, findMany: mocks.requestFindMany, update: mocks.requestUpdate,
    },
    approval: { create: async () => ({}), findMany: async () => [] },
    approvalRoute: { findMany: async () => [] },
    user: { findUnique: async () => ({ employmentType: "part", workSun: false, workMon: true, workTue: true, workWed: true, workThu: true, workFri: true, workSat: false }) },
    holiday: { findUnique: async () => null },
    setting: { findUnique: async () => null },
  },
}))

import { actionCreateRequest } from "../app/(app)/requests/actions"
import { actionUpdateRequest } from "../app/(app)/admin/requests/actions"
import { REST_DATE_TAKEN_MESSAGE } from "../lib/holiday-work-db"
import { buildRestDayLabels, labelOnlyRestDates } from "../lib/holiday-work"

const SAT = new Date(Date.UTC(2026, 9, 10))
const fd = (v: Record<string, string>) => {
  const f = new FormData()
  for (const [k, val] of Object.entries(v)) f.set(k, val)
  return f
}
const HW = { type: "HOLIDAY_WORK", targetDate: "2026-10-10", reason: "", startTime: "09:00", endTime: "15:00", breakMinutes: "0" }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.count.mockResolvedValue(0)
  mocks.requestFindMany.mockResolvedValue([])
})

describe("申請：休む日が別の休日出勤申請と重なる", () => {
  it("審査中・承認済みの別の申請が同じ休む日を持つと断る（却下は数えない）", async () => {
    mocks.count.mockResolvedValue(1)
    const res = await actionCreateRequest(fd({ ...HW, restDate: "2026-10-12" }))
    expect(res).toEqual({ ok: false, error: REST_DATE_TAKEN_MESSAGE })
    expect(mocks.create).not.toHaveBeenCalled()
    const where = mocks.count.mock.calls[0][0].where
    expect(where).toMatchObject({
      userId: "admin1", type: "HOLIDAY_WORK", status: { in: ["PENDING", "APPROVED"] },
      detail: { path: ["restDate"], equals: "2026-10-12" },
    })
  })
  it("重ならなければ作る。休む日が空欄なら確かめない", async () => {
    await actionCreateRequest(fd({ ...HW, restDate: "2026-10-12" }))
    expect(mocks.create).toHaveBeenCalledTimes(1)
    mocks.count.mockClear(); mocks.create.mockClear()
    await actionCreateRequest(fd(HW))
    expect(mocks.count).not.toHaveBeenCalled()
    expect(mocks.create).toHaveBeenCalledTimes(1)
  })
})

describe("管理者の修正：休む日を足す・変える", () => {
  const before = (over: Record<string, unknown>) => ({
    id: "q1", userId: "u1", type: "HOLIDAY_WORK", status: "APPROVED", targetDate: SAT, createdAt: new Date(), reason: null, approvals: [],
    user: { employmentType: "part" }, detail: { startTime: "09:00", endTime: "15:00", breakMinutes: "0" },
    ...over,
  })
  it("後から休む日を足すとき、別の申請とかぶれば断る（自分自身は除いて数える）", async () => {
    mocks.requestFind.mockResolvedValue(before({}))
    mocks.count.mockResolvedValue(1)
    const res = await actionUpdateRequest("q1", fd({ ...HW, restDate: "2026-10-12" }))
    expect(res).toEqual({ ok: false, error: REST_DATE_TAKEN_MESSAGE })
    expect(mocks.requestUpdate).not.toHaveBeenCalled()
    expect(mocks.count.mock.calls[0][0].where).toMatchObject({ userId: "u1", id: { not: "q1" } })
  })
  it("重ならなければ通る", async () => {
    mocks.requestFind.mockResolvedValue(before({}))
    expect(await actionUpdateRequest("q1", fd({ ...HW, restDate: "2026-10-12" }))).toEqual({ ok: true })
  })
  it("休む日を変えない修正・却下済みの申請の修正は確かめない（既存の重なりで他の修正を止めない）", async () => {
    mocks.count.mockResolvedValue(1)
    mocks.requestFind.mockResolvedValue(before({ detail: { startTime: "09:00", endTime: "15:00", breakMinutes: "0", restDate: "2026-10-12", restKind: "furikyu" } }))
    expect(await actionUpdateRequest("q1", fd({ ...HW, restDate: "2026-10-12" }))).toEqual({ ok: true })
    mocks.requestFind.mockResolvedValue(before({ status: "REJECTED" }))
    expect(await actionUpdateRequest("q1", fd({ ...HW, restDate: "2026-10-12" }))).toEqual({ ok: true })
    expect(mocks.count).not.toHaveBeenCalled()
  })
})

describe("承認詳細の休む日ラベル", () => {
  const labels = buildRestDayLabels([
    { targetDate: new Date(Date.UTC(2026, 9, 10)), createdAt: new Date(1), detail: { restDate: "2026-10-12", restKind: "furikyu" } },
    { targetDate: new Date(Date.UTC(2026, 9, 11)), createdAt: new Date(2), detail: { restDate: "2026-10-14", restKind: "daikyu" } },
  ])
  it("Excel・/records と同じ文言", () => {
    expect(labels.get("2026-10-12")).toBe("振休（10/10 出勤分）")
    expect(labels.get("2026-10-14")).toBe("代休（10/11 出勤分）")
  })
  it("記録が無い休む日だけ、期間内で昇順に返す", () => {
    expect(labelOnlyRestDates(labels, new Set(["2026-10-14"]), "2026-09-26", "2026-10-25")).toEqual(["2026-10-12"])
    expect(labelOnlyRestDates(labels, new Set(), "2026-10-13", "2026-10-25")).toEqual(["2026-10-14"])
    expect(labelOnlyRestDates(labels, new Set(), "2026-10-15", "2026-10-25")).toEqual([])
  })
})
