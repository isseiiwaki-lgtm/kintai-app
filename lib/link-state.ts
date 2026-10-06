import { createHmac, timingSafeEqual } from "crypto"

/** /link に渡す state の中身（サインイン途中の Google 情報） */
export type LinkState = {
  pendingUserId:     string
  googleEmail:       string
  providerAccountId: string
  name:              string
  image:             string
}

/** 署名付き state の有効期限（15分） */
export const LINK_STATE_TTL_MS = 15 * 60 * 1000

function hmac(body: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(body).digest()
}

/**
 * state に発行時刻を付けて HMAC-SHA256 署名する。
 * 形式: `<base64url(JSON)>.<base64url(署名)>`
 */
export function signLinkState(state: LinkState, secret: string, now: number = Date.now()): string {
  if (!secret) throw new Error("署名鍵が未設定です")
  const body = Buffer.from(JSON.stringify({ ...state, iat: now })).toString("base64url")
  return `${body}.${hmac(body, secret).toString("base64url")}`
}

/**
 * 署名・有効期限を検証して state を返す。不正・期限切れ・改ざんは null。
 */
export function verifyLinkState(token: string, secret: string, now: number = Date.now()): LinkState | null {
  if (!secret || typeof token !== "string") return null
  const parts = token.split(".")
  if (parts.length !== 2) return null
  const [body, sig] = parts

  const expected = hmac(body, secret)
  const actual   = Buffer.from(sig, "base64url")
  // 長さが違うと timingSafeEqual が例外を投げるため先に弾く
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null

  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString())
    if (typeof p.iat !== "number" || now - p.iat > LINK_STATE_TTL_MS || p.iat > now + 60_000) return null
    if (
      typeof p.pendingUserId     !== "string" || typeof p.googleEmail !== "string" ||
      typeof p.providerAccountId !== "string" || typeof p.name        !== "string" ||
      typeof p.image             !== "string" || !p.providerAccountId || !p.googleEmail
    ) return null
    return {
      pendingUserId: p.pendingUserId, googleEmail: p.googleEmail,
      providerAccountId: p.providerAccountId, name: p.name, image: p.image,
    }
  } catch {
    return null
  }
}
