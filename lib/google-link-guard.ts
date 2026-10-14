/**
 * Google アカウントを社員（User）に紐づけてよいかの判定（NextAuth の自動紐づけの見張り）。
 * NextAuth は「ログインしたままのブラウザで別の Google アカウントでログインする」と、その Google を今ログインしている人に紐づける。
 * それを防ぐため、Google のメール（Google が本人確認済みのもの）がその社員のログイン用メール・会社メールと一致するときだけ紐づける。
 * 会社メールを入力して紐づける画面（/link）は、この見張りを通らない別の仕組み（app/link/actions.ts）。
 */

const PENDING_PREFIX = "__pending__"

/** Google の id_token から本人確認済みのメールを取り出す（署名はサーバー間の受け取りなので検証しない）。取れなければ null */
export function verifiedEmailFromIdToken(idToken: string | null | undefined): string | null {
  if (!idToken) return null
  const parts = idToken.split(".")
  if (parts.length < 2) return null
  try {
    const payload = JSON.parse(Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")) as {
      email?: unknown
      email_verified?: unknown
    }
    if (typeof payload.email !== "string" || !payload.email) return null
    if (payload.email_verified !== true && payload.email_verified !== "true") return null
    return payload.email.toLowerCase()
  } catch {
    return null
  }
}

/** 社員のログイン用メール・会社メール（未登録で仮作成した __pending__ を含む）が Google のメールと一致するか */
export function canLinkGoogleAccount(
  user: { email: string | null; companyEmail: string | null } | null | undefined,
  googleEmail: string | null,
): boolean {
  if (!user || !googleEmail) return false
  const g = googleEmail.toLowerCase()
  const email = (user.email ?? "").toLowerCase()
  const company = (user.companyEmail ?? "").toLowerCase()
  return email === g || company === g || email === `${PENDING_PREFIX}${g}`
}
