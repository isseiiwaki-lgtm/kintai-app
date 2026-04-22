import NextAuth from "next-auth"
import { authConfig } from "./auth.config"

// Edge 互換の設定のみ使用（Prisma なし）
const { auth } = NextAuth(authConfig)
export default auth

export const config = {
  matcher: ["/((?!api/auth|login|link|_next/static|_next/image|favicon.ico).*)"],
}
