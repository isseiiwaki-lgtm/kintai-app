/**
 * /link の署名付き state と、紐づけサーバーアクションの検証テスト
 * 署名・期限・改ざん・紐づけ済み拒否を確認する。
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { signLinkState, verifyLinkState, LINK_STATE_TTL_MS, type LinkState } from "../lib/link-state"

const SECRET = "test-secret-fixed"
const NOW = 1_800_000_000_000

const base: LinkState = {
  pendingUserId: "pending-1",
  googleEmail: "attacker@gmail.com",
  providerAccountId: "g-123",
  name: "Attacker",
  image: "",
}

/** 署名付き文字列の本体を書き換える（署名はそのまま） */
function tamperBody(token: string, patch: Partial<LinkState>): string {
  const [body, sig] = token.split(".")
  const obj = JSON.parse(Buffer.from(body, "base64url").toString())
  return `${Buffer.from(JSON.stringify({ ...obj, ...patch })).toString("base64url")}.${sig}`
}

describe("signLinkState / verifyLinkState", () => {
  it("署名したものは検証を通り、中身が戻る", () => {
    const t = signLinkState(base, SECRET, NOW)
    expect(verifyLinkState(t, SECRET, NOW + 1000)).toEqual(base)
  })

  it("有効期限内（15分ちょうど）は通り、超えると null", () => {
    const t = signLinkState(base, SECRET, NOW)
    expect(verifyLinkState(t, SECRET, NOW + LINK_STATE_TTL_MS)).toEqual(base)
    expect(verifyLinkState(t, SECRET, NOW + LINK_STATE_TTL_MS + 1)).toBeNull()
  })

  it("中身の書き換え（providerAccountId / pendingUserId）は null", () => {
    const t = signLinkState(base, SECRET, NOW)
    expect(verifyLinkState(tamperBody(t, { providerAccountId: "g-999" }), SECRET, NOW)).toBeNull()
    expect(verifyLinkState(tamperBody(t, { pendingUserId: "victim" }), SECRET, NOW)).toBeNull()
  })

  it("発行時刻の書き換えで期限を延ばしても null", () => {
    const t = signLinkState(base, SECRET, NOW)
    expect(verifyLinkState(tamperBody(t, { iat: NOW + 10 * LINK_STATE_TTL_MS } as never), SECRET, NOW + 5 * LINK_STATE_TTL_MS)).toBeNull()
  })

  it("署名の書き換え・欠落・長さ違いは null", () => {
    const t = signLinkState(base, SECRET, NOW)
    const [body, sig] = t.split(".")
    const flipped = (sig[0] === "A" ? "B" : "A") + sig.slice(1)
    expect(verifyLinkState(`${body}.${flipped}`, SECRET, NOW)).toBeNull()
    expect(verifyLinkState(`${body}.`, SECRET, NOW)).toBeNull()
    expect(verifyLinkState(`${body}.${sig}x`, SECRET, NOW)).toBeNull()
    expect(verifyLinkState(body, SECRET, NOW)).toBeNull()
  })

  it("別の鍵・空の鍵・従来の署名なし base64 は null", () => {
    const t = signLinkState(base, SECRET, NOW)
    expect(verifyLinkState(t, "other-secret", NOW)).toBeNull()
    expect(verifyLinkState(t, "", NOW)).toBeNull()
    const legacy = Buffer.from(JSON.stringify(base)).toString("base64")
    expect(verifyLinkState(legacy, SECRET, NOW)).toBeNull()
    expect(verifyLinkState("", SECRET, NOW)).toBeNull()
  })

  it("鍵が空だと署名できない", () => {
    expect(() => signLinkState(base, "", NOW)).toThrow()
  })
})

// --- サーバーアクション（prisma はモック） ---
const prismaMock = vi.hoisted(() => ({
  user: { findFirst: vi.fn(), update: vi.fn(), delete: vi.fn() },
  account: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  $transaction: vi.fn(),
}))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))

import { actionLinkAccount, actionFindByCompanyEmail } from "../app/link/actions"

const victim = (accounts: number) => ({
  id: "victim-1", name: "社員", role: "EMPLOYEE", employmentType: "FULL_TIME",
  department: null, employeeCode: "001", jobTitle: null, workStartTime: null,
  workEndTime: null, hireDate: null, salaryCode: null, isActive: true,
  _count: { accounts },
})

describe("紐づけサーバーアクション", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.AUTH_SECRET = SECRET
    prismaMock.account.findUnique.mockResolvedValue(null)
  })

  it("署名なし（従来形式）の state は拒否し、DB に触れない", async () => {
    const legacy = Buffer.from(JSON.stringify({ ...base, pendingUserId: "" })).toString("base64")
    await expect(actionLinkAccount(legacy, "admin@iwaki-i.com")).rejects.toThrow("有効期限")
    await expect(actionFindByCompanyEmail(legacy, "admin@iwaki-i.com")).rejects.toThrow("有効期限")
    expect(prismaMock.user.findFirst).not.toHaveBeenCalled()
    expect(prismaMock.account.create).not.toHaveBeenCalled()
  })

  it("期限切れの state は拒否する", async () => {
    const old = signLinkState({ ...base, pendingUserId: "" }, SECRET, Date.now() - LINK_STATE_TTL_MS - 1000)
    await expect(actionLinkAccount(old, "admin@iwaki-i.com")).rejects.toThrow("有効期限")
    expect(prismaMock.user.findFirst).not.toHaveBeenCalled()
  })

  it("改ざんした state（別の providerAccountId）は拒否する", async () => {
    const t = tamperBody(signLinkState({ ...base, pendingUserId: "" }, SECRET), { providerAccountId: "evil" })
    await expect(actionLinkAccount(t, "admin@iwaki-i.com")).rejects.toThrow("有効期限")
    expect(prismaMock.account.create).not.toHaveBeenCalled()
  })

  it("紐づけ済みの社員は actionLinkAccount でも拒否（パターンB）", async () => {
    prismaMock.user.findFirst.mockResolvedValue(victim(1))
    const t = signLinkState({ ...base, pendingUserId: "" }, SECRET)
    await expect(actionLinkAccount(t, "admin@iwaki-i.com")).rejects.toThrow("紐づけ済み")
    expect(prismaMock.account.create).not.toHaveBeenCalled()
  })

  it("紐づけ済みの社員は削除させない（パターンA）", async () => {
    prismaMock.user.findFirst.mockResolvedValue(victim(1))
    const t = signLinkState(base, SECRET)
    await expect(actionLinkAccount(t, "admin@iwaki-i.com")).rejects.toThrow("紐づけ済み")
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
    expect(prismaMock.user.delete).not.toHaveBeenCalled()
  })

  it("正常: 未紐づけ社員にパターンB で Account を作成する", async () => {
    prismaMock.user.findFirst.mockResolvedValue(victim(0))
    const t = signLinkState({ ...base, pendingUserId: "" }, SECRET)
    await actionLinkAccount(t, "emp@iwaki-i.com")
    expect(prismaMock.account.create).toHaveBeenCalledWith({
      data: { userId: "victim-1", type: "oauth", provider: "google", providerAccountId: "g-123" },
    })
    expect(prismaMock.user.update).toHaveBeenCalled()
  })

  it("正常: パターンA は検証済みの pendingUserId を昇格させる", async () => {
    prismaMock.user.findFirst.mockResolvedValue(victim(0))
    prismaMock.user.delete.mockReturnValue("del")
    prismaMock.user.update.mockReturnValue("upd")
    const t = signLinkState(base, SECRET)
    await actionLinkAccount(t, "emp@iwaki-i.com")
    expect(prismaMock.user.delete).toHaveBeenCalledWith({ where: { id: "victim-1" } })
    expect(prismaMock.user.update.mock.calls[0][0].where).toEqual({ id: "pending-1" })
    expect(prismaMock.$transaction).toHaveBeenCalledWith(["del", "upd"])
  })

  it("正常: 検索は検証済みなら結果を返し、紐づけ済みは null", async () => {
    const t = signLinkState(base, SECRET)
    prismaMock.user.findFirst.mockResolvedValueOnce({ id: "u", name: "n", department: "d", _count: { accounts: 0 } })
    expect(await actionFindByCompanyEmail(t, "a@iwaki-i.com")).toEqual({ id: "u", name: "n", department: "d" })
    prismaMock.user.findFirst.mockResolvedValueOnce({ id: "u", name: "n", department: "d", _count: { accounts: 1 } })
    expect(await actionFindByCompanyEmail(t, "a@iwaki-i.com")).toBeNull()
  })
})
