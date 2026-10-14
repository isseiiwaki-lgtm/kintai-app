import type { NextAuthConfig } from "next-auth"
import Google from "next-auth/providers/google"

// Edge runtime 互換（Prisma なし）— middleware 用
export const authConfig: NextAuthConfig = {
  // 事前登録した社員（ログイン用メール・会社メールが Google のメールと同じ）は、初回ログインで自動で紐づける。
  // Google はメールの本人確認をしている。誤った人への紐づけは auth.ts の linkAccount で止める
  providers: [Google({ allowDangerousEmailAccountLinking: true })],
  pages: {
    signIn: "/login",
    error: "/login",
  },
  callbacks: {
    authorized({ auth }) {
      return !!auth?.user
    },
  },
}
