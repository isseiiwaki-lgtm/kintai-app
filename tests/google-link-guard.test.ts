/**
 * Google アカウントの自動紐づけの見張り（2026-10-14 急ぎの修正）
 * - 事前登録した社員（ログイン用メール・会社メール＝Google のメール）は紐づけてよい
 * - ログインしたままのブラウザで別の人が Google ログインしても、今ログインしている人には紐づけない
 */
import { describe, it, expect } from "vitest"
import { canLinkGoogleAccount, verifiedEmailFromIdToken } from "../lib/google-link-guard"

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url")
const idToken = (payload: unknown) => `${b64({ alg: "RS256" })}.${b64(payload)}.sig`

describe("verifiedEmailFromIdToken", () => {
  it("本人確認済みのメールを取り出す（小文字にそろえる）", () => {
    expect(verifiedEmailFromIdToken(idToken({ email: "N-Watanabe@iwaki-i.com", email_verified: true }))).toBe("n-watanabe@iwaki-i.com")
  })
  it("本人確認されていない・壊れている・無いときは null", () => {
    expect(verifiedEmailFromIdToken(idToken({ email: "a@iwaki-i.com", email_verified: false }))).toBeNull()
    expect(verifiedEmailFromIdToken("not-a-jwt")).toBeNull()
    expect(verifiedEmailFromIdToken(undefined)).toBeNull()
  })
})

describe("canLinkGoogleAccount", () => {
  it("事前登録・複製した社員（ログイン用メール＝会社メール＝Google）は紐づけてよい", () => {
    expect(canLinkGoogleAccount({ email: "n-watanabe@iwaki-i.com", companyEmail: "n-watanabe@iwaki-i.com" }, "n-watanabe@iwaki-i.com")).toBe(true)
  })
  it("会社メールだけ一致する社員も紐づけてよい", () => {
    expect(canLinkGoogleAccount({ email: "duplicate_1@temp.invalid", companyEmail: "n-watanabe@iwaki-i.com" }, "n-watanabe@iwaki-i.com")).toBe(true)
  })
  it("ログインしたままの管理者に、別の人の Google は紐づけない", () => {
    expect(canLinkGoogleAccount({ email: "kumagai@iwaki-i.com", companyEmail: "kumagai@iwaki-i.com" }, "n-watanabe@iwaki-i.com")).toBe(false)
  })
  it("メールが取れないときは紐づけない", () => {
    expect(canLinkGoogleAccount({ email: "n-watanabe@iwaki-i.com", companyEmail: null }, null)).toBe(false)
  })
})
