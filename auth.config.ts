import type { NextAuthConfig } from "next-auth"
import Google from "next-auth/providers/google"

// Edge runtime 互換（Prisma なし）— middleware 用
export const authConfig: NextAuthConfig = {
  providers: [Google],
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
