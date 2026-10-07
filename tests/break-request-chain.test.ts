/**
 * 同じ日に承認済みの休憩申請が複数あるときの連鎖（承認前の値 prev → 申請の分数）の扱い。
 * 削除・日付移動で途中の段が外れても、後の段の prev を付け替えるので、最後に消したときに「いちばん最初の値」へ戻る。
 * 順序は承認・移動で記録へ入れた順（detail.breakAppliedAt）。サーバーアクションを状態を持つ prisma モックで確認する。
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

type Req = { id: string; userId: string; type: string; status: string; targetDate: Date; createdAt: Date; detail: Record<string, string>; reason: null }
type Rec = { id: string; userId: string; date: Date; status: string; breakMinutes: number | null }

const store = vi.hoisted(() => ({ reqs: [] as unknown[], recs: [] as unknown[] }))
const reqs = () => store.reqs as Req[]
const recs = () => store.recs as Rec[]

vi.mock("@/auth", () => ({ auth: async () => ({ user: { id: "admin1", role: "ADMIN" } }) }))
vi.mock("next/cache", () => ({ revalidatePath: () => {} }))
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
          else (store.recs as Rec[]).push({ id: `r${store.recs.length + 1}`, userId: "u1", date: a.where.userId_date.date, status: "OPEN", breakMinutes: null, ...a.create })
        },
        update: async (a: { where: { id: string }; data: Partial<Rec> }) => { Object.assign((store.recs as Rec[]).find((r) => r.id === a.where.id)!, a.data) },
      },
      request: {
        findUnique: async (a: { where: { id: string } }) => {
          const r = (store.reqs as Req[]).find((x) => x.id === a.where.id)
          return r ? { ...r, approvals: [], user: { workStartTime: "09:00", workEndTime: "15:00", employmentType: "part", breakMinutes: 60, department: null } } : null
        },
        findMany: async (a: { where: { targetDate: Date; status: string; type: string | { in: string[] }; id?: { not: string } } }) =>
          (store.reqs as Req[]).filter((r) =>
            (typeof a.where.type === "string" ? r.type === a.where.type : a.where.type.in.includes(r.type)) && r.status === a.where.status && r.targetDate.getTime() === a.where.targetDate.getTime() && r.id !== a.where.id?.not),
        update: async (a: { where: { id: string }; data: Partial<Req> }) => { Object.assign((store.reqs as Req[]).find((r) => r.id === a.where.id)!, a.data) },
        delete: async (a: { where: { id: string } }) => { store.reqs = (store.reqs as Req[]).filter((r) => r.id !== a.where.id) },
        count: async () => 0,
      },
      approval: { create: async () => ({}), findMany: async () => [] },
      approvalRoute: { findMany: async () => [] },
      setting: { findUnique: async () => null },
    },
  }
})

import { actionApproveRequest, actionDeleteRequest, actionUpdateRequest } from "../app/(app)/admin/requests/actions"

const DAY1 = new Date(Date.UTC(2026, 9, 5))
const DAY2 = new Date(Date.UTC(2026, 9, 6))
let seq = 0
function addReq(id: string, minutes: number, date = DAY1) {
  seq += 1
  // 作成順は呼び出し順（id の昇順と同じ）
  reqs().push({ id, userId: "u1", type: "BREAK", status: "PENDING", targetDate: date, createdAt: new Date(Date.UTC(2026, 9, 1, 0, seq)), detail: { minutes: String(minutes) }, reason: null })
}
const rec = (date = DAY1) => recs().find((r) => r.date.getTime() === date.getTime())
const setRec = (breakMinutes: number | null, date = DAY1) => {
  const r = rec(date)
  if (r) r.breakMinutes = breakMinutes
  else recs().push({ id: `r-${date.getTime()}`, userId: "u1", date, status: "OPEN", breakMinutes })
}
const approve = async (id: string) => { expect(await actionApproveRequest(id)).toEqual({ ok: true }) }
const del = async (id: string) => { expect(await actionDeleteRequest(id)).toEqual({ ok: true }) }
function editForm(over: Record<string, string> = {}): FormData {
  const fd = new FormData()
  const v = { type: "BREAK", targetDate: "2026-10-05", reason: "", minutes: "60", ...over }
  for (const [k, val] of Object.entries(v)) fd.set(k, val)
  return fd
}

describe("同じ日に承認済みの休憩申請が複数ある（連鎖）", () => {
  beforeEach(() => { store.reqs = []; store.recs = []; seq = 0 })

  it("A(60)→B(45)承認：古い A を先に消しても、B を消せば空（A が入る前）に戻る", async () => {
    addReq("a", 60); addReq("b", 45)
    await approve("a"); await approve("b")
    expect(rec()!.breakMinutes).toBe(45)
    await del("a")
    expect(rec()!.breakMinutes).toBe(45) // 後の B が優先
    await del("b")
    expect(rec()!.breakMinutes).toBeNull() // 削除済みの A の 60 には戻らない
  })

  it("A(60)→B(45)承認：B を先に消すと A の 60、続けて A を消すと空", async () => {
    addReq("a", 60); addReq("b", 45)
    await approve("a"); await approve("b")
    await del("b")
    expect(rec()!.breakMinutes).toBe(60)
    await del("a")
    expect(rec()!.breakMinutes).toBeNull()
  })

  it("A を別の日へ移す：元の日の B を消すと空に戻る（移した A の 60 にならない）。移った先には A の 60 が入る", async () => {
    addReq("a", 60); addReq("b", 45)
    await approve("a"); await approve("b")
    expect(await actionUpdateRequest("a", editForm({ targetDate: "2026-10-06" }))).toEqual({ ok: true })
    expect(rec(DAY2)!.breakMinutes).toBe(60)
    expect(rec()!.breakMinutes).toBe(45)
    await del("b")
    expect(rec()!.breakMinutes).toBeNull()
  })

  it("後の段が上書きしていない prev は付け替えない：A(60)→管理者が30に直す→B(45)承認→A を消しても B を消せば 30", async () => {
    addReq("a", 60); addReq("b", 45)
    await approve("a")
    setRec(30) // 管理者の入力
    await approve("b")
    await del("a") // B の prev（30）は A の値ではないので触らない
    await del("b")
    expect(rec()!.breakMinutes).toBe(30)
  })

  it("Minor1：A(60)→管理者が30→B(45)承認→B を消すと、直前の 30（A の 60 ではない）", async () => {
    addReq("a", 60); addReq("b", 45)
    await approve("a")
    setRec(30)
    await approve("b")
    await del("b")
    expect(rec()!.breakMinutes).toBe(30)
  })

  it("途中の段の分数を直したら、後の段の prev も付け替える（そのあと A を消さず B→A の順に消すと空）", async () => {
    addReq("a", 60); addReq("b", 45)
    await approve("a"); await approve("b")
    expect(await actionUpdateRequest("a", editForm({ minutes: "75" }))).toEqual({ ok: true })
    expect(rec()!.breakMinutes).toBe(45) // 記録は B のまま
    await del("a")
    await del("b")
    expect(rec()!.breakMinutes).toBeNull()
  })

  it("Minor2：すでに承認済みの休憩申請がある日へ移した申請が最後の段になる（作成順に関係なく、移した順）。消す順も同じ規則", async () => {
    addReq("a", 60, DAY1) // 作成が古い申請を、あとで DAY2 へ移す
    addReq("b", 45, DAY2)
    await approve("a"); await approve("b")
    expect(rec(DAY2)!.breakMinutes).toBe(45)
    expect(await actionUpdateRequest("a", editForm({ targetDate: "2026-10-06" }))).toEqual({ ok: true })
    expect(rec(DAY2)!.breakMinutes).toBe(60) // 移した A が最後に入る（作成順なら B のはず）
    await del("a") // 最後の段は直前の値（B の 45）へ戻る
    expect(rec(DAY2)!.breakMinutes).toBe(45)
    await del("b")
    expect(rec(DAY2)!.breakMinutes).toBeNull()
  })

  it("休憩の値があとの入力で変わっていたら、削除では動かさない（後の入力が優先）", async () => {
    addReq("a", 60)
    await approve("a")
    setRec(30)
    await del("a")
    expect(rec()!.breakMinutes).toBe(30)
  })
})
