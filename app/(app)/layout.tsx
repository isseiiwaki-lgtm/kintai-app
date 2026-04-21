import { redirect } from "next/navigation"
import { auth, signOut } from "@/auth"
import { Sidebar } from "@/components/sidebar"

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  if (!session?.user) redirect("/login")

  const logoutAction = async () => {
    "use server"
    await signOut({ redirectTo: "/login" })
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Sidebar
        userName={session.user.name ?? session.user.email ?? "ユーザー"}
        userImage={session.user.image}
        role={session.user.role ?? "EMPLOYEE"}
        logoutAction={logoutAction}
      />
      {/* デスクトップ: サイドバー分オフセット / モバイル: ヘッダー+ボトムナビ分パディング */}
      <main className="lg:pl-56 pt-14 lg:pt-0 pb-16 lg:pb-0 min-h-screen">
        {children}
      </main>
    </div>
  )
}
