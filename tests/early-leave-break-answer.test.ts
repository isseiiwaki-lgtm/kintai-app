/**
 * 早退申請の「休憩を取りましたか」（正社員）の承認・削除・修正
 * 休憩申請（BREAK）と同じ連鎖（承認前の値 prev・適用順 breakAppliedAt）でその日の breakMinutes に入る。
 * サーバーアクションを、状態を持つ prisma モックで確認する（break-request-chain.test.ts と同じ道具立て）
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

type Req = { id: string; userId: string; type: string; status: string; targetDate: Date; createdAt: Date; detail: Record<string, string>; reason: null }
type Rec = { id: string; userId: string; date: Date; status: string; breakMinutes: number | null }

const store = vi.hoisted(() => ({ reqs: [] as unknown[], recs: [] as unknown[], recomputed: 0, empType: "full" }))
const reqs = () => store.reqs as Req[]
const recs = () => store.recs as Rec[]

vi.mock("@/auth", () => ({ auth: async () => ({ user: { id: "admin1", role: "ADMIN" } }) }))
vi.mock("next/cache", () => ({ revalidatePath: () => {} }))
vi.mock("@/lib/clock-pipeline-db", async (orig) => ({
  ...(await orig<typeof import("../lib/clock-pipeline-db")>()),
  recomputeDay: async () => { store.recomputed += 1 },
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
          else (store.recs as Rec[]).push({ id: `r${store.recs.length + 1}`, userId: "u1", date: a.where.userId_date.date, status: "OPEN", breakMinutes: null, ...a.create })
        },
        update: async (a: { where: { id: string }; data: Partial<Rec> }) => { Object.assign((store.recs as Rec[]).find((r) => r.id === a.where.id)!, a.data) },
      },
      request: {
        findUnique: async (a: { where: { id: string } }) => {
          const r = (store.reqs as Req[]).find((x) => x.id === a.where.id)
          return r ? { ...r, approvals: [], user: { workStartTime: "09:00", workEndTime: "17:30", employmentType: "full", breakMinutes: null, department: null } } : null
        },
        findMany: async (a: { where: { targetDate: Date; status: string; type: string | { in: string[] }; id?: { not: string } } }) =>
          (store.reqs as Req[]).filter((r) =>
            (typeof a.where.type === "string" ? r.type === a.where.type : a.where.type.in.includes(r.type)) &&
            r.status === a.where.status && r.targetDate.getTime() === a.where.targetDate.getTime() && r.id !== a.where.id?.not),
        update: async (a: { where: { id: string }; data: Partial<Req> }) => { Object.assign((store.reqs as Req[]).find((r) => r.id === a.where.id)!, a.data) },
        delete: async (a: { where: { id: string } }) => { store.reqs = (store.reqs as Req[]).filter((r) => r.id !== a.where.id) },
        count: async () => 0,
      },
      user: { findUnique: async () => ({ employmentType: store.empType }) },
      approval: { create: async () => ({}), findMany: async () => [] },
      approvalRoute: { findMany: async () => [] },
      setting: { findUnique: async () => null },
    },
  }
})

import { actionApproveRequest, actionDeleteRequest, actionForceApproveRequest, actionUpdateRequest } from "../app/(app)/admin/requests/actions"

const DAY1 = new Date(Date.UTC(2026, 9, 5))
const DAY2 = new Date(Date.UTC(2026, 9, 6))
let seq = 0
function addReq(id: string, type: "BREAK" | "ABSENCE", minutes: number, date = DAY1, absenceType = "early") {
  seq += 1
  const detail: Record<string, string> = type === "BREAK" ? { minutes: String(minutes) } : { absenceType, time: "14:00", breakMinutes: String(minutes) }
  reqs().push({ id, userId: "u1", type, status: "PENDING", targetDate: date, createdAt: new Date(Date.UTC(2026, 9, 1, 0, seq)), detail, reason: null })
}
const rec = (date = DAY1) => recs().find((r) => r.date.getTime() === date.getTime())
const setRec = (breakMinutes: number | null, date = DAY1, status = "OPEN") => {
  const r = rec(date)
  if (r) { r.breakMinutes = breakMinutes; r.status = status }
  else recs().push({ id: `r-${date.getTime()}`, userId: "u1", date, status, breakMinutes })
}
const approve = async (id: string) => { expect(await actionApproveRequest(id)).toEqual({ ok: true }) }
const del = async (id: string) => { expect(await actionDeleteRequest(id)).toEqual({ ok: true }) }
function absenceForm(over: Record<string, string> = {}): FormData {
  const fd = new FormData()
  const v = { type: "ABSENCE", targetDate: "2026-10-05", reason: "", absenceType: "early", time: "14:00", breakMinutes: "30", ...over }
  for (const [k, val] of Object.entries(v)) fd.set(k, val)
  return fd
}
const reset = () => { store.reqs = []; store.recs = []; store.recomputed = 0; seq = 0 }

describe("早退申請の休憩の申告：承認で breakMinutes に入る", () => {
  beforeEach(reset)

  it("申告 0（取らなかった）を承認すると breakMinutes が 0（事実の 0）になり、計算し直す", async () => {
    addReq("e", "ABSENCE", 0)
    await approve("e")
    expect(rec()!.breakMinutes).toBe(0)
    expect(store.recomputed).toBeGreaterThan(0)
  })

  it("申告 45 を承認すると 45。承認前の値と適用順が申請に残る（申請時の申告は書き換えない）", async () => {
    addReq("e", "ABSENCE", 45)
    await approve("e")
    expect(rec()!.breakMinutes).toBe(45)
    expect(reqs()[0].detail.prevBreakMinutes).toBe("")
    expect(reqs()[0].detail.breakAppliedAt).toBeTruthy()
    expect(reqs()[0].detail.breakMinutes).toBe("45")
  })

  it("審査中は差し引かない（記録に入らない）", async () => {
    addReq("e", "ABSENCE", 45)
    expect(rec()).toBeUndefined()
  })

  it("飛び越し承認でも同じように入る", async () => {
    addReq("e", "ABSENCE", 30)
    expect(await actionForceApproveRequest("e")).toEqual({ ok: true })
    expect(rec()!.breakMinutes).toBe(30)
  })

  it("申告の無い早退申請・遅刻申請は休憩に触らない", async () => {
    reqs().push({ id: "p", userId: "u1", type: "ABSENCE", status: "PENDING", targetDate: DAY1, createdAt: new Date(), detail: { absenceType: "early", time: "14:00" }, reason: null })
    reqs().push({ id: "l", userId: "u1", type: "ABSENCE", status: "PENDING", targetDate: DAY1, createdAt: new Date(), detail: { absenceType: "late", time: "10:00", breakMinutes: "30" }, reason: null })
    await approve("p"); await approve("l")
    expect(rec()).toBeUndefined()
  })

  it("締め済み（LOCKED）の日は承認できない（見えるエラー）。申請は審査中のまま", async () => {
    addReq("e", "ABSENCE", 30)
    setRec(null, DAY1, "LOCKED")
    const res = await actionApproveRequest("e")
    expect(res.ok).toBe(false)
    expect((res as { error: string }).error).toContain("締め済み")
    expect(reqs()[0].status).toBe("PENDING")
    expect(rec()!.breakMinutes).toBeNull()
  })

  it("締め済みの日の承認済み申請は削除・修正もできない", async () => {
    addReq("e", "ABSENCE", 30)
    await approve("e")
    setRec(30, DAY1, "LOCKED")
    expect((await actionDeleteRequest("e")).ok).toBe(false)
    expect((await actionUpdateRequest("e", absenceForm({ breakMinutes: "15" }))).ok).toBe(false)
    expect(rec()!.breakMinutes).toBe(30)
  })
})

describe("削除・修正・日付の移動で元に戻る", () => {
  beforeEach(reset)

  it("削除すると承認前の値（未設定）に戻る", async () => {
    addReq("e", "ABSENCE", 0)
    await approve("e")
    await del("e")
    expect(rec()!.breakMinutes).toBeNull()
  })

  it("あとの入力（管理者・休憩申請）が入っていたら削除では動かさない", async () => {
    addReq("e", "ABSENCE", 30)
    await approve("e")
    setRec(60)
    await del("e")
    expect(rec()!.breakMinutes).toBe(60)
  })

  it("申告の分数を直すと、記録が申請の値のままなら新しい分数になる", async () => {
    addReq("e", "ABSENCE", 30)
    await approve("e")
    expect(await actionUpdateRequest("e", absenceForm({ breakMinutes: "15" }))).toEqual({ ok: true })
    expect(rec()!.breakMinutes).toBe(15)
    await del("e")
    expect(rec()!.breakMinutes).toBeNull()
  })

  it("パートの早退申請を管理者が直すとき、休憩の申告は受け付けない（申告なしで保存）", async () => {
    store.empType = "part"
    addReq("e", "ABSENCE", 30)
    expect(await actionUpdateRequest("e", absenceForm({ breakMinutes: "15" }))).toEqual({ ok: true })
    expect(reqs().find((r) => r.id === "e")!.detail.breakMinutes).toBeUndefined()
    store.empType = "full"
  })

  it("申告を空欄にする・遅刻へ変える：元の値に戻る", async () => {
    addReq("e", "ABSENCE", 30)
    await approve("e")
    expect(await actionUpdateRequest("e", absenceForm({ breakMinutes: "" }))).toEqual({ ok: true })
    expect(rec()!.breakMinutes).toBeNull()
    addReq("f", "ABSENCE", 45, DAY2)
    await approve("f")
    expect(rec(DAY2)!.breakMinutes).toBe(45)
    expect(await actionUpdateRequest("f", absenceForm({ targetDate: "2026-10-06", absenceType: "late" }))).toEqual({ ok: true })
    expect(rec(DAY2)!.breakMinutes).toBeNull()
  })

  it("別の日へ移すと、元の日は戻り、移った先に入る", async () => {
    addReq("e", "ABSENCE", 30)
    await approve("e")
    expect(await actionUpdateRequest("e", absenceForm({ targetDate: "2026-10-06" }))).toEqual({ ok: true })
    expect(rec()!.breakMinutes).toBeNull()
    expect(rec(DAY2)!.breakMinutes).toBe(30)
  })

  it("不正な分数は修正できない（15分刻み）", async () => {
    addReq("e", "ABSENCE", 30)
    await approve("e")
    expect((await actionUpdateRequest("e", absenceForm({ breakMinutes: "20" }))).ok).toBe(false)
  })
})

describe("休憩申請と早退申請の申告は適用順で重なる", () => {
  beforeEach(reset)

  it("BREAK(60)→早退(30)：最後の早退を消すと 60、続けて BREAK を消すと未設定", async () => {
    addReq("b", "BREAK", 60); addReq("e", "ABSENCE", 30)
    await approve("b"); await approve("e")
    expect(rec()!.breakMinutes).toBe(30)
    await del("e")
    expect(rec()!.breakMinutes).toBe(60)
    await del("b")
    expect(rec()!.breakMinutes).toBeNull()
  })

  it("BREAK(60)→早退(30)：途中の BREAK を先に消しても記録は早退のまま、早退を消すと未設定（消した 60 には戻らない）", async () => {
    addReq("b", "BREAK", 60); addReq("e", "ABSENCE", 30)
    await approve("b"); await approve("e")
    await del("b")
    expect(rec()!.breakMinutes).toBe(30)
    await del("e")
    expect(rec()!.breakMinutes).toBeNull()
  })

  it("早退(0)→BREAK(45)：承認した順に適用される（BREAK を消すと早退の 0）", async () => {
    addReq("e", "ABSENCE", 0); addReq("b", "BREAK", 45)
    await approve("e"); await approve("b")
    expect(rec()!.breakMinutes).toBe(45)
    await del("b")
    expect(rec()!.breakMinutes).toBe(0)
  })
})
