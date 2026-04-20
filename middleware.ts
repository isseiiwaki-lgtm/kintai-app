import NextAuth from "next-auth"
import { authConfig } from "./auth.config"

// Edge 互換の設定のみ使用（Prisma なし）
export const { auth: middleware } = NextAuth(authConfig)

export const config = {
  matcher: ["/((?!api/auth|login|_next/static|_next/image|favicon.ico).*)"],
}
