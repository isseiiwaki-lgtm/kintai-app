"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { actionSubmitMonth, actionUnsubmitMonth } from "./actions"

type Props = {
  userId:      string
  year:        number
  month:       number
  isSubmitted: boolean
}

export function SubmitMonthButton({ userId, year, month, isSubmitted }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const run = (action: () => Promise<void>) => {
    startTransition(async () => {
      await action()
      router.refresh()
    })
  }

  if (isSubmitted) {
    return (
      <button
        disabled={isPending}
        onClick={() => run(() => actionUnsubmitMonth(userId, year, month))}
        className="px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-200 hover:bg-gray-300 text-gray-700 disabled:opacity-40 transition-colors"
      >
        {isPending ? "処理中..." : "提出取消"}
      </button>
    )
  }

  return (
    <button
      disabled={isPending}
      onClick={() => run(() => actionSubmitMonth(userId, year, month))}
      className="px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-40 transition-colors"
    >
      {isPending ? "処理中..." : "月次提出"}
    </button>
  )
}
