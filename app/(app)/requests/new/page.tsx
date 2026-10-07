import { Suspense } from "react"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { NewRequestForm } from "./NewRequestForm"

/**
 * 新規申請。休日出勤申請の予定時刻の初期値（本人の所定の定時）と、週の起算日（会社設定）を読んで渡す。
 * フォーム本体は URL のプリセット（useSearchParams）を使うクライアントコンポーネント
 */
export default async function NewRequestPage() {
  const session = await auth()
  const userId = session!.user!.id!
  const [user, setting] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { workStartTime: true, workEndTime: true } }),
    prisma.setting.findUnique({ where: { id: 1 }, select: { weekStartDay: true } }),
  ])
  return (
    <Suspense>
      <NewRequestForm
        defaultStartTime={user?.workStartTime ?? ""}
        defaultEndTime={user?.workEndTime ?? ""}
        weekStartDay={setting?.weekStartDay ?? 0}
      />
    </Suspense>
  )
}
