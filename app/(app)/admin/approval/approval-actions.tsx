"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { actionApproveMonth, actionRejectMonth, actionLockMonth } from "./actions"

type Props = {
  userId:       string
  year:         number
  month:        number
  hasSubmitted: boolean
  hasApproved:  boolean
  isAdmin:      boolean
  allLocked:    boolean
}

export function ApprovalActions({ userId, year, month, hasSubmitted, hasApproved, isAdmin, allLocked }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const run = (action: () => Promise<void>) => {
    startTransition(async () => {
      await action()
      router.refresh()
    })
  }

  if (allLocked) {
    return <p className="text-xs text-purple-500 mt-2">締め済み</p>
  }

  return (
    <div className="flex gap-2 mt-3 flex-wrap">
      {/* 承認 */}
      <button
        disabled={!hasSubmitted || isPending}
        onClick={() => run(() => actionApproveMonth(userId, year, month))}
        className="px-3 py-1.5 rounded-lg text-xs font-medium bg-green-600 hover:bg-green-700 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        承認
      </button>

      {/* 差戻し */}
      <button
        disabled={!hasSubmitted || isPending}
        onClick={() => run(() => actionRejectMonth(userId, year, month))}
        className="px-3 py-1.5 rounded-lg text-xs font-medium bg-red-500 hover:bg-red-600 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        差戻し
      </button>

      {/* 締め（ADMIN のみ） */}
      {isAdmin && (
        <button
          disabled={!hasApproved || isPending}
          onClick={() => run(() => actionLockMonth(userId, year, month))}
          className="px-3 py-1.5 rounded-lg text-xs font-medium bg-purple-600 hover:bg-purple-700 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          締め
        </button>
      )}

      {isPending && <span className="text-xs text-gray-400 self-center">処理中...</span>}
    </div>
  )
}
