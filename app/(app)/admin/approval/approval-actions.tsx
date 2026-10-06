"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { actionApproveMonth, actionRejectMonth, actionLockMonth, actionUnlockMonth } from "./actions"

type Props = {
  userId:      string
  year:        number
  month:       number
  hasOpen:     boolean
  hasApproved: boolean
  hasLocked:   boolean
  isAdmin:     boolean
  allLocked:   boolean
}

export function ApprovalActions({ userId, year, month, hasOpen, hasApproved, hasLocked, isAdmin, allLocked }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const run = (action: () => Promise<void>) => {
    startTransition(async () => {
      await action()
      router.refresh()
    })
  }

  // 締め解除（ADMIN のみ）: LOCKED → APPROVED。誤操作防止に確認ダイアログを出す
  const unlock = () => {
    if (!window.confirm("この社員の締めを解除します（締め済 → 承認済）。解除の履歴は変更履歴に残ります。よろしいですか？")) return
    run(() => actionUnlockMonth(userId, year, month))
  }
  const unlockButton = isAdmin && hasLocked && (
    <button
      disabled={isPending}
      onClick={unlock}
      className="px-3 py-1.5 rounded-lg text-xs font-medium bg-red-600 hover:bg-red-700 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
    >
      締め解除
    </button>
  )

  if (allLocked) {
    return (
      <div className="flex items-center justify-between mt-2">
        <div className="flex items-center gap-3">
          <p className="text-xs text-purple-500">締め済み</p>
          {unlockButton}
          {isPending && <span className="text-xs text-gray-400">処理中...</span>}
        </div>
        <Link
          href={`/admin/approval/${userId}?year=${year}&month=${month}`}
          className="text-xs text-blue-500 hover:underline"
        >
          詳細 →
        </Link>
      </div>
    )
  }

  return (
    <div className="flex gap-2 mt-3 flex-wrap items-center justify-between">
      <div className="flex gap-2 flex-wrap">
        {/* 承認: OPEN → APPROVED */}
        <button
          disabled={!hasOpen || isPending}
          onClick={() => run(() => actionApproveMonth(userId, year, month))}
          className="px-3 py-1.5 rounded-lg text-xs font-medium bg-green-600 hover:bg-green-700 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          承認
        </button>

        {/* 承認取消: APPROVED → OPEN */}
        <button
          disabled={!hasApproved || isPending}
          onClick={() => run(() => actionRejectMonth(userId, year, month))}
          className="px-3 py-1.5 rounded-lg text-xs font-medium bg-amber-500 hover:bg-amber-600 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          承認取消
        </button>

        {/* 締め（ADMIN のみ）: APPROVED → LOCKED */}
        {isAdmin && (
          <button
            disabled={!hasApproved || isPending}
            onClick={() => run(() => actionLockMonth(userId, year, month))}
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-purple-600 hover:bg-purple-700 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            締め
          </button>
        )}

        {/* 締め解除（ADMIN のみ）: LOCKED → APPROVED */}
        {unlockButton}

        {isPending && <span className="text-xs text-gray-400 self-center">処理中...</span>}
      </div>

      <Link
        href={`/admin/approval/${userId}?year=${year}&month=${month}`}
        className="text-xs text-blue-500 hover:underline whitespace-nowrap"
      >
        詳細 →
      </Link>
    </div>
  )
}
