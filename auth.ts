import NextAuth from "next-auth"
import Google from "next-auth/providers/google"
import { PrismaAdapter } from "@auth/prisma-adapter"
import { prisma } from "@/lib/prisma"
import { authConfig } from "./auth.config"
import type { Role } from "@prisma/client"

const PENDING_PREFIX = "__pending__"

// email / companyEmail 両方で User を検索するカスタムアダプタ
const baseAdapter = PrismaAdapter(prisma) as Required<ReturnType<typeof PrismaAdapter>>
const adapter = {
  ...baseAdapter,
  getUserByEmail: async (email: string) => {
    return prisma.user.findFirst({
      where: { OR: [{ email }, { companyEmail: email }] },
    })
  },
  // 未登録Googleアカウントには __pending__ プレフィックスを付けて仮作成
  createUser: async (userData: Parameters<typeof baseAdapter.createUser>[0]) => {
    const email = userData.email
    if (!email) return baseAdapter.createUser(userData)

    // 既存ユーザー（email / companyEmail / __pending__ のいずれかで一致）があれば流用
    const existing = await prisma.user.findFirst({
      where: { OR: [{ email }, { companyEmail: email }, { email: `${PENDING_PREFIX}${email}` }] },
    })
    if (existing) return existing

    // 未登録 → 仮ユーザー作成
    return prisma.user.create({
      data: {
        email:  `${PENDING_PREFIX}${email}`,
        name:   userData.name  ?? null,
        image:  userData.image ?? null,
      },
    })
  },
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  ...authConfig,
  adapter,
  session: { strategy: "jwt" },
  callbacks: {
    jwt({ token, user }) {
      if (user) token.role = (user as unknown as { role: Role }).role
      return token
    },
    session({ session, token }) {
      session.user.role  = token.role as Role
      if (token.sub) session.user.id = token.sub
      return session
    },
    async signIn({ user, account, profile }) {
      if (account?.provider !== "google") return true

      const googleEmail = (profile as { email?: string })?.email ?? user.email ?? ""
      if (!googleEmail) return false

      const name  = (profile as { name?: string })?.name  ?? user.name  ?? ""
      const image = (profile as { picture?: string })?.picture ?? user.image ?? ""

      // 1. __pending__ ユーザーが存在する（2回目以降のサインイン）→ /link へ
      const pendingUser = await prisma.user.findUnique({
        where: { email: `${PENDING_PREFIX}${googleEmail}` },
      })
      if (pendingUser) {
        const state = Buffer.from(JSON.stringify({
          pendingUserId:     pendingUser.id,
          googleEmail,
          providerAccountId: account.providerAccountId,
          name, image,
        })).toString("base64")
        return `/link?state=${encodeURIComponent(state)}`
      }

      // 2. 既にリンク済み Account が存在 → そのまま通す
      const existingAccount = await prisma.account.findUnique({
        where: { provider_providerAccountId: { provider: "google", providerAccountId: account.providerAccountId } },
      })
      if (existingAccount) return true

      // 3. companyEmail or email が直接マッチ（GoogleメールをcompanyEmailとして登録済み）→ そのまま通す
      const directMatch = await prisma.user.findFirst({
        where: { OR: [{ email: googleEmail }, { companyEmail: googleEmail }] },
      })
      if (directMatch) return true

      // 4. 完全未登録（初回サインイン、createUser はまだ呼ばれていない）→ /link へ
      const state = Buffer.from(JSON.stringify({
        pendingUserId:     "",
        googleEmail,
        providerAccountId: account.providerAccountId,
        name, image,
      })).toString("base64")
      return `/link?state=${encodeURIComponent(state)}`
    },
  },
})
