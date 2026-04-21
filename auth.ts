import NextAuth from "next-auth"
import Google from "next-auth/providers/google"
import { PrismaAdapter } from "@auth/prisma-adapter"
import { prisma } from "@/lib/prisma"
import { authConfig } from "./auth.config"
import type { Role } from "@prisma/client"

export const { handlers, signIn, signOut, auth } = NextAuth({
  ...authConfig,
  adapter: PrismaAdapter(prisma),
  session: { strategy: "jwt" }, // JWT = Edge 互換
  callbacks: {
    // JWT にロールを保存
    jwt({ token, user }) {
      if (user) token.role = (user as unknown as { role: Role }).role
      return token
    },
    // セッションに JWT のロールを反映
    session({ session, token }) {
      session.user.role = token.role as Role
      if (token.sub) session.user.id = token.sub
      return session
    },
    signIn({ user }) {
      const allowed = (process.env.ALLOWED_EMAILS ?? "").split(",").map(e => e.trim())
      return allowed.includes(user.email ?? "")
    },
  },
})
