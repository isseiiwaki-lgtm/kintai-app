/**
 * 有給（LEAVE paid）の分数（paidLeaveMinutes）の承認・修正・削除
 * - 半休の昼休憩の長さは段0と同じ（⑤ON/OFF 共通）
 * - 半休を取れない人の半休は承認を拒否
 * - 修正で日付・種別・区分が変わったら元の日の分数を消す。変わらなければ触らない。締め済みの日は拒否
 * - 削除で分数を消す。締め済みの日は拒否
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { paidLeaveMinutesFor } from "../lib/clock-pipeline"

type Req = { id: string; userId: string; type: string; status: string; targetDate: Date; createdAt: Date; detail: Record<string, string>; reason: null }
type Rec = { id: string; userId: string; date: Date; status: string; paidLeaveMinutes: number | null }

const store = vi.hoisted(() => ({
  reqs: [] as unknown[], recs: [] as unknown[],
  user: { workStartTime: "09:00", workEndTime: "17:00", employmentType: "full", isFullTimePart: false, breakMinutes: 60, department: null } as Record<string, unknown>,
}))
const reqs = () => store.reqs as Req[]
const recs = () => store.recs as Rec[]

vi.mock("@/auth", () => ({ auth: async () => ({ user: { id: "admin1", role: "ADMIN" } }) }))
vi.mock("next/cache", () => ({ revalidatePath: () => {} }))
vi.mock("next/navigation", () => ({ redirect: () => { throw new Error("REDIRECT") } }))
vi.mock("@/lib/clock-pipeline-db", async (orig) => ({
  ...(await orig<typeof import("../lib/clock-pipeline-db")>()),
  recomputeDay: async () => {},
}))
vi.mock("@/lib/prisma", () => {
  const dayOf = (a: { where: { userId_date: { date: Date } } }) => a.where.userId_date.date.getTime()
  return {
    prisma: {
      attendanceRecord: {
        findUnique: async (a: { where: { userId_date: { date: Date } } }) => (store.recs as Rec[]).find((r) => r.date.getTime() === dayOf(a)) ?? null,
        upsert: async (a: { where: { userId_date: { userId: string; date: Date } }; update: Partial<Rec>; create: Partial<Rec> }) => {
          const r = (store.recs as Rec[]).find((x) => x.date.getTime() === dayOf(a))
          if (r) Object.assign(r, a.update)
          else (store.recs as Rec[]).push({ id: `r${store.recs.length + 1}`, userId: "u1", date: a.where.userId_date.date, status: "OPEN", paidLeaveMinutes: null, ...a.create })
        },
        updateMany: async (a: { where: { date: Date }; data: Partial<Rec> }) => {
          for (const r of store.recs as Rec[]) if (r.date.getTime() === a.where.date.getTime()) Object.assign(r, a.data)
          return { count: 1 }
        },
        update: async () => ({}),
      },
      request: {
        findUnique: async (a: { where: { id: string } }) => {
          const r = (store.reqs as Req[]).find((x) => x.id === a.where.id)
          return r ? { ...r, approvals: [], user: store.user } : null
        },
        findMany: async (a: { where: { userId: string; targetDate: Date; type: string; status: { in: string[] }; id?: { not: string } } }) =>
          (store.reqs as Req[]).filter((r) => r.userId === a.where.userId && r.targetDate.getTime() === a.where.targetDate.getTime() && r.type === a.where.type && a.where.status.in.includes(r.status) && r.id !== a.where.id?.not),
        create: async (a: { data: Partial<Req> }) => { (store.reqs as Req[]).push({ id: `N${store.reqs.length + 1}`, createdAt: new Date(), reason: null, ...a.data } as Req) },
        update: async (a: { where: { id: string }; data: Partial<Req> }) => { Object.assign((store.reqs as Req[]).find((r) => r.id === a.where.id)!, a.data) },
        delete: async (a: { where: { id: string } }) => { store.reqs = (store.reqs as Req[]).filter((r) => r.id !== a.where.id) },
        count: async () => 0,
      },
      user: { findUnique: async () => store.user },
      approval: { create: async () => ({}), findMany: async () => [] },
      approvalRoute: { findMany: async () => [] },
      setting: { findUnique: async () => null },
    },
  }
})

import { actionCreateRequest } from "../app/(app)/requests/actions"
import { actionApproveRequest,actionDeleteRequest, actionUpdateRequest } from "../app/(app)/admin/requests/actions"

const DAY1 = new Date(Date.UTC(2026, 9, 5))
const DAY2 = new Date(Date.UTC(2026, 9, 6))
const addLeave = (status: string, halfDay: string, date = DAY1, leaveType = "paid") =>
  reqs().push({ id: "L1", userId: "u1", type: "LEAVE", status, targetDate: date, createdAt: new Date(), detail: { leaveType, halfDay, workDate: "" }, reason: null })
const setRec = (date: Date, paid: number | null, status = "OPEN") => recs().push({ id: `r-${date.getTime()}`, userId: "u1", date, status, paidLeaveMinutes: paid })
const rec = (date: Date) => recs().find((r) => r.date.getTime() === date.getTime())
const form = (over: Record<string, string> = {}) => {
  const fd = new FormData()
  const v = { type: "LEAVE", targetDate: "2026-10-05", reason: "", leaveType: "paid", halfDay: "pm", workDate: "", ...over }
  for (const [k, x] of Object.entries(v)) fd.set(k, x)
  return fd
}

beforeEach(() => {
  store.reqs = []; store.recs = []
  store.user = { workStartTime: "09:00", workEndTime: "17:00", employmentType: "full", isFullTimePart: false, breakMinutes: 60, department: null }
})

describe("半休の有給の分数：昼休憩は段0と同じ（⑤ON/OFF 共通）", () => {
  const user = { workStartTime: "09:00", workEndTime: "17:00", employmentType: "full", breakMinutes: 60 }
  it("9:00〜17:00・本人の休憩60・⑤OFF → 午前休 180・午後休 240", () => {
    const saved = { switchNewCalc: false } as never
    expect(paidLeaveMinutesFor({ user, setting: null, saved, halfDay: "pm" })).toBe(240)
    expect(paidLeaveMinutesFor({ user, setting: null, saved, halfDay: "am" })).toBe(180)
  })
  it("⑤ON でも同じ", () => {
    expect(paidLeaveMinutesFor({ user, setting: null, saved: { switchNewCalc: true } as never, halfDay: "pm" })).toBe(240)
  })
})

describe("承認：半休を取れない人は拒否", () => {
  it("パート（フルタイムパートでない）の半休は承認できず、分数も保存しない", async () => {
    store.user = { ...store.user, employmentType: "part" }
    addLeave("PENDING", "pm")
    const r = await actionApproveRequest("L1")
    expect(r.ok).toBe(false)
    expect(reqs()[0].status).toBe("PENDING")
    expect(rec(DAY1)).toBeUndefined()
  })
  it("フルタイムパートは承認でき、午後休の分数が入る", async () => {
    store.user = { ...store.user, employmentType: "part", isFullTimePart: true }
    addLeave("PENDING", "pm")
    expect(await actionApproveRequest("L1")).toEqual({ ok: true })
    expect(rec(DAY1)?.paidLeaveMinutes).toBe(240)
  })
})

describe("修正：承認済みの有給", () => {
  it("日付を変えると元の日の分数を消し、新しい日に入れる", async () => {
    addLeave("APPROVED", "pm"); setRec(DAY1, 240)
    expect(await actionUpdateRequest("L1", form({ targetDate: "2026-10-06" }))).toEqual({ ok: true })
    expect(rec(DAY1)?.paidLeaveMinutes).toBeNull()
    expect(rec(DAY2)?.paidLeaveMinutes).toBe(240)
  })
  it("全休に変えると入れ直す（半休 240 → 全休 435。設定なし・⑤未保存は旧方式＝法定休憩45）", async () => {
    addLeave("APPROVED", "pm"); setRec(DAY1, 240)
    expect(await actionUpdateRequest("L1", form({ halfDay: "full" }))).toEqual({ ok: true })
    expect(rec(DAY1)?.paidLeaveMinutes).toBe(435)
  })
  it("有給でなくなる（特別休暇へ変更）と分数を消す", async () => {
    addLeave("APPROVED", "full"); setRec(DAY1, 420)
    expect(await actionUpdateRequest("L1", form({ leaveType: "special", halfDay: "full" }))).toEqual({ ok: true })
    expect(rec(DAY1)?.paidLeaveMinutes).toBeNull()
  })
  it("種別・日付・区分が変わらない修正（理由だけ）では分数を書き換えない", async () => {
    addLeave("APPROVED", "pm"); setRec(DAY1, 999)
    expect(await actionUpdateRequest("L1", form({ reason: "メモ" }))).toEqual({ ok: true })
    expect(rec(DAY1)?.paidLeaveMinutes).toBe(999)
  })
  it("締め済みの元の日・新しい日は拒否（変更なし）", async () => {
    addLeave("APPROVED", "pm"); setRec(DAY1, 240, "LOCKED")
    const r1 = await actionUpdateRequest("L1", form({ targetDate: "2026-10-06" }))
    expect(r1.ok).toBe(false)
    expect(rec(DAY1)?.paidLeaveMinutes).toBe(240)
    store.recs = []; setRec(DAY1, 240); setRec(DAY2, null, "LOCKED")
    expect((await actionUpdateRequest("L1", form({ targetDate: "2026-10-06" }))).ok).toBe(false)
    expect(reqs()[0].targetDate).toEqual(DAY1)
  })
  it("半休を取れないパートの申請を半休へ直すのは拒否", async () => {
    store.user = { ...store.user, employmentType: "part" }
    addLeave("APPROVED", "full"); setRec(DAY1, 420)
    expect((await actionUpdateRequest("L1", form({ halfDay: "am" }))).ok).toBe(false)
    expect(rec(DAY1)?.paidLeaveMinutes).toBe(420)
  })
})

describe("有給は 1 日 1 件まで（審査中・承認済み）", () => {
  const MSG = "その日はすでに有給の申請があります。1日休む場合は全日で申請してください"
  const other = (id: string, status: string, date: Date, halfDay = "am") =>
    reqs().push({ id, userId: "admin1", type: "LEAVE", status, targetDate: date, createdAt: new Date(), detail: { leaveType: "paid", halfDay, workDate: "" }, reason: null })
  // 申請者は auth モックのユーザー（admin1）
  const create = async (over: Record<string, string> = {}) => {
    try { return (await actionCreateRequest(form(over))) ?? { ok: true } } catch (e) { if ((e as Error).message === "REDIRECT") return { ok: true }; throw e }
  }

  it("作成：同じ日に審査中・承認済みの有給があれば拒否", async () => {
    other("A", "PENDING", DAY1)
    expect(await create()).toEqual({ ok: false, error: MSG })
    reqs().length = 0; other("A", "APPROVED", DAY1)
    expect(await create()).toEqual({ ok: false, error: MSG })
  })
  it("作成：却下済みは数えない・別の日は可（午後休を別の日に 2 件）", async () => {
    other("A", "REJECTED", DAY1)
    expect(await create()).toEqual({ ok: true })
    other("B", "PENDING", DAY2, "pm")
    expect(await create({ targetDate: "2026-10-07" })).toEqual({ ok: true })
  })
  it("作成：有給以外の休暇は数えない", async () => {
    reqs().push({ id: "S", userId: "admin1", type: "LEAVE", status: "APPROVED", targetDate: DAY1, createdAt: new Date(), detail: { leaveType: "special", halfDay: "full" }, reason: null })
    expect(await create()).toEqual({ ok: true })
  })
  it("修正：他の有給がある日へ移す・その日の有給へ変えるのは拒否（自分自身は除く）", async () => {
    other("A", "APPROVED", DAY1, "am")
    reqs().push({ id: "L2", userId: "admin1", type: "LEAVE", status: "APPROVED", targetDate: DAY2, createdAt: new Date(), detail: { leaveType: "paid", halfDay: "pm", workDate: "" }, reason: null })
    expect(await actionUpdateRequest("L2", form({ targetDate: "2026-10-05" }))).toEqual({ ok: false, error: MSG })
    // 同じ日のまま区分だけ直すのは自分自身を除くので通る
    expect(await actionUpdateRequest("L2", form({ targetDate: "2026-10-06", halfDay: "am" }))).toEqual({ ok: true })
  })
  it("承認：同じ日にほかの有給があれば拒否（通常承認の安全網）", async () => {
    other("A", "APPROVED", DAY1, "am")
    reqs().push({ id: "L3", userId: "admin1", type: "LEAVE", status: "PENDING", targetDate: DAY1, createdAt: new Date(), detail: { leaveType: "paid", halfDay: "pm", workDate: "" }, reason: null })
    expect(await actionApproveRequest("L3")).toEqual({ ok: false, error: MSG })
    expect(reqs().find((r) => r.id === "L3")?.status).toBe("PENDING")
  })
})

describe("削除：承認済みの有給", () => {
  it("その日の分数を消す", async () => {
    addLeave("APPROVED", "pm"); setRec(DAY1, 240)
    expect(await actionDeleteRequest("L1")).toEqual({ ok: true })
    expect(rec(DAY1)?.paidLeaveMinutes).toBeNull()
    expect(reqs()).toHaveLength(0)
  })
  it("締め済みの日は拒否（申請も分数も残る）", async () => {
    addLeave("APPROVED", "pm"); setRec(DAY1, 240, "LOCKED")
    expect((await actionDeleteRequest("L1")).ok).toBe(false)
    expect(rec(DAY1)?.paidLeaveMinutes).toBe(240)
    expect(reqs()).toHaveLength(1)
  })
})
