/**
 * 早退申請の作成（休憩の申告の必須化）と、退勤直後の早退申請の促し
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => ({
  employmentType: "full" as string,
  created: [] as { data: { type: string; detail: Record<string, string> } }[],
}))

vi.mock("@/auth", () => ({ auth: async () => ({ user: { id: "u1", role: "USER" } }) }))
vi.mock("next/cache", () => ({ revalidatePath: () => {} }))
vi.mock("next/navigation", () => ({ redirect: () => { throw new Error("NEXT_REDIRECT") } }))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: async () => ({ employmentType: mocks.employmentType }) },
    request: { create: async (a: { data: { type: string; detail: Record<string, string> } }) => { mocks.created.push(a) } },
  },
}))

import { actionCreateRequest } from "../app/(app)/requests/actions"
import { breakAnswerMinutes, earlyLeaveNudgeTime, earlyLeaveRequestHref } from "../lib/attendance"
import { DATE, jst } from "./helpers/pipeline"

function form(v: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [k, val] of Object.entries({ type: "ABSENCE", targetDate: "2026-10-05", reason: "", absenceType: "early", time: "14:00", ...v })) fd.set(k, val)
  return fd
}
const submit = async (v: Record<string, string>) => {
  try { return await actionCreateRequest(form(v)) } catch (e) { if ((e as Error).message === "NEXT_REDIRECT") return "redirected"; throw e }
}

describe("早退申請の作成：正社員は休憩の申告が必須、パート・遅刻は聞かない", () => {
  beforeEach(() => { mocks.created = []; mocks.employmentType = "full" })

  it("正社員の早退で申告が無い → エラー（作られない）", async () => {
    expect(await submit({})).toMatchObject({ ok: false })
    expect(mocks.created).toHaveLength(0)
  })

  it("正社員の申告 0（取らなかった）・45 は detail.breakMinutes に入る", async () => {
    expect(await submit({ breakMinutes: "0" })).toBe("redirected")
    expect(mocks.created[0].data.detail).toMatchObject({ absenceType: "early", breakMinutes: "0" })
    expect(await submit({ breakMinutes: "45" })).toBe("redirected")
    expect(mocks.created[1].data.detail.breakMinutes).toBe("45")
  })

  it("15分刻みでない・上限超えは拒否", async () => {
    expect(await submit({ breakMinutes: "20" })).toMatchObject({ ok: false })
    expect(await submit({ breakMinutes: "255" })).toMatchObject({ ok: false })
  })

  it("パートの早退申請は申告なしで作れ、申告を送っても保存しない", async () => {
    mocks.employmentType = "part"
    expect(await submit({})).toBe("redirected")
    expect(mocks.created[0].data.detail).not.toHaveProperty("breakMinutes")
    expect(await submit({ breakMinutes: "30" })).toBe("redirected")
    expect(mocks.created[1].data.detail).not.toHaveProperty("breakMinutes")
  })

  it("遅刻申請は申告なしで作れる（正社員でも）", async () => {
    expect(await submit({ absenceType: "late", time: "10:00" })).toBe("redirected")
    expect(mocks.created[0].data.detail).not.toHaveProperty("breakMinutes")
  })
})

describe("breakAnswerMinutes：休憩の申告つきの申請の見分け", () => {
  it("BREAK は minutes、早退申請は breakMinutes。それ以外は null", () => {
    expect(breakAnswerMinutes({ type: "BREAK", detail: { minutes: "60" } })).toBe(60)
    expect(breakAnswerMinutes({ type: "ABSENCE", detail: { absenceType: "early", breakMinutes: "0" } })).toBe(0)
    expect(breakAnswerMinutes({ type: "ABSENCE", detail: { absenceType: "early", time: "14:00" } })).toBeNull()
    expect(breakAnswerMinutes({ type: "ABSENCE", detail: { absenceType: "late", breakMinutes: "30" } })).toBeNull()
    expect(breakAnswerMinutes({ type: "ABSENCE", detail: { absenceType: "early", breakMinutes: "20" } })).toBeNull()
    expect(breakAnswerMinutes({ type: "OVERTIME", detail: { minutes: "30" } })).toBeNull()
  })
})

describe("退勤直後の早退申請の促し（定時前に退勤した正社員）", () => {
  const SCHED = { start: "09:00", end: "17:30" }
  const base = { employmentType: "full", date: DATE, schedule: SCHED, hasEarlyLeaveRequest: false }

  it("定時前の退勤 → 退勤時刻を15分で切り下げた時刻を返す（14:07 → 14:00）", () => {
    expect(earlyLeaveNudgeTime({ ...base, clockOut: jst(14, 7) })).toBe("14:00")
    expect(earlyLeaveNudgeTime({ ...base, clockOut: jst(17, 29) })).toBe("17:15")
  })

  it("定時どおり・定時後は出さない", () => {
    expect(earlyLeaveNudgeTime({ ...base, clockOut: jst(17, 30) })).toBeNull()
    expect(earlyLeaveNudgeTime({ ...base, clockOut: jst(19, 0) })).toBeNull()
  })

  it("パート・定時なしの日・退勤前・申請済みは出さない", () => {
    expect(earlyLeaveNudgeTime({ ...base, employmentType: "part", clockOut: jst(14, 0) })).toBeNull()
    expect(earlyLeaveNudgeTime({ ...base, schedule: null, clockOut: jst(14, 0) })).toBeNull()
    expect(earlyLeaveNudgeTime({ ...base, clockOut: null })).toBeNull()
    expect(earlyLeaveNudgeTime({ ...base, hasEarlyLeaveRequest: true, clockOut: jst(14, 0) })).toBeNull()
  })

  it("半休で定時が変わる日は、その定時で判定する（午後半休 9:00〜12:00 で 11:30 退勤は出す・13:00 は出さない）", () => {
    const pm = { ...base, schedule: { start: "09:00", end: "12:00" } }
    expect(earlyLeaveNudgeTime({ ...pm, clockOut: jst(11, 30) })).toBe("11:30")
    expect(earlyLeaveNudgeTime({ ...pm, clockOut: jst(13, 0) })).toBeNull()
  })

  it("日をまたぐ退勤（翌 1:00）は早退ではない", () => {
    expect(earlyLeaveNudgeTime({ ...base, clockOut: jst(1, 0, 6) })).toBeNull()
  })

  it("リンクは対象日・早退・時刻を入れた申請フォーム", () => {
    expect(earlyLeaveRequestHref("2026-10-05", "14:00")).toBe("/requests/new?type=ABSENCE&absenceType=early&date=2026-10-05&time=14:00")
  })
})
