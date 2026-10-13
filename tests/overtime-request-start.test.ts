/**
 * 定時の無い人（シフト勤務のパート）の残業申請は開始時刻を持つ（2026-10-13〜）。定時のある人は従来どおり終了時刻だけ
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => ({
  user: { workStartTime: "09:00" as string | null, workEndTime: "16:00" as string | null },
  created: [] as { data: { type: string; detail: Record<string, string> } }[],
}))

vi.mock("@/auth", () => ({ auth: async () => ({ user: { id: "u1", role: "USER" } }) }))
vi.mock("next/cache", () => ({ revalidatePath: () => {} }))
vi.mock("next/navigation", () => ({ redirect: () => { throw new Error("NEXT_REDIRECT") } }))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: async () => mocks.user },
    request: { create: async (a: { data: { type: string; detail: Record<string, string> } }) => { mocks.created.push(a) } },
  },
}))

import { actionCreateRequest } from "../app/(app)/requests/actions"

const submit = async (v: Record<string, string>) => {
  const fd = new FormData()
  for (const [k, val] of Object.entries({ type: "OVERTIME", targetDate: "2026-10-05", reason: "", ...v })) fd.set(k, val)
  try { return await actionCreateRequest(fd) } catch (e) { if ((e as Error).message === "NEXT_REDIRECT") return "redirected"; throw e }
}

describe("残業申請の開始時刻", () => {
  beforeEach(() => { mocks.created = []; mocks.user = { workStartTime: "09:00", workEndTime: "16:00" } })

  it("定時のある人は終了時刻だけ（開始は定時の終業）", async () => {
    expect(await submit({ endTime: "17:00" })).toBe("redirected")
    expect(mocks.created[0].data.detail).toEqual({ endTime: "17:00", scheduledEndTime: "16:00" })
  })

  it("定時の無い人は開始時刻が必須", async () => {
    mocks.user = { workStartTime: null, workEndTime: null }
    expect(await submit({ endTime: "18:00" })).toMatchObject({ ok: false })
    expect(await submit({ startTime: "18:00", endTime: "18:00" })).toMatchObject({ ok: false })
    expect(mocks.created).toHaveLength(0)
    expect(await submit({ startTime: "16:00", endTime: "18:00" })).toBe("redirected")
    expect(mocks.created[0].data.detail).toMatchObject({ startTime: "16:00", endTime: "18:00" })
  })
})
