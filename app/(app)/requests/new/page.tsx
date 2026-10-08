import { Suspense } from "react"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { canTakeHalfDay } from "@/lib/clock-pipeline"
import { NewRequestForm } from "./NewRequestForm"

/**
 * 新規申請。休日出勤申請の予定時刻の初期値（本人の所定の定時）と、週の起算日（会社設定）を読んで渡す。
 * フォーム本体は URL のプリセット（useSearchParams）を使うクライアントコンポーネント
 */
export default async function NewRequestPage() {
  const session = await auth()
  const userId = session!.user!.id!
  const [user, setting] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { workStartTime: true, workEndTime: true, employmentType: true, isFullTimePart: true } }),
    prisma.setting.findUnique({ where: { id: 1 }, select: { weekStartDay: true, break1Threshold: true, break1Minutes: true, break2Threshold: true, break2Minutes: true } }),
  ])
  return (
    <Suspense>
      <NewRequestForm
        defaultStartTime={user?.workStartTime ?? ""}
        defaultEndTime={user?.workEndTime ?? ""}
        weekStartDay={setting?.weekStartDay ?? 0}
        isPartTimer={user?.employmentType === "part"}
        canHalfDay={canTakeHalfDay(user)}
        breakSetting={setting ? { break1Threshold: setting.break1Threshold, break1Minutes: setting.break1Minutes, break2Threshold: setting.break2Threshold, break2Minutes: setting.break2Minutes } : null}
      />
    </Suspense>
  )
}
