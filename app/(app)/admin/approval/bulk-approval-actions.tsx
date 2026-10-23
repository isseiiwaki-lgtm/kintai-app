"use client"

/**
 * 月単位で全員分を一括で承認・承認取消・締め（勤怠承認の一覧の上）。
 * 運用：先に1人ずつ申請・記録を確認し、問題なければここで全員分をまとめて処理する。
 * 全員分が変わるので、押す前に必ず人数と内容を確認するダイアログを出す。締めは ADMIN のみ。
 */
import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { actionApproveAllMonth, actionLockAllMonth, actionRejectAllMonth } from "./actions"

type Props = {
  year: number
  month: number
  /** 一覧に出ている人数と、それぞれの状態の件数（ダイアログの説明に使う） */
  people: number
  openCount: number
  approvedCount: number
  isAdmin: boolean
}

export function BulkApprovalActions({ year, month, people, openCount, approvedCount, isAdmin }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const run = (message: string, action: () => Promise<number>) => {
    if (!window.confirm(message)) return
    startTransition(async () => {
      await action()
      router.refresh()
    })
  }
  const label = `${year}年${month}月`
  const btn = "px-3 py-1.5 rounded-lg text-xs font-medium text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"

  return (
    <div className="mt-4 rounded-xl border border-gray-200 bg-white px-4 py-3">
      <p className="text-xs text-gray-500 mb-2">
        全員分をまとめて処理します（1人ずつの確認が済んでから使ってください）
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button
          disabled={isPending || openCount === 0}
          onClick={() => run(`${label}の未承認 ${openCount} 件（${people} 人分）をすべて承認します。\n承認すると、記録が計算し直されて保存されます。よろしいですか？`, () => actionApproveAllMonth(year, month))}
          className={`${btn} bg-green-600 hover:bg-green-700`}
        >
          全員を承認
        </button>
        <button
          disabled={isPending || approvedCount === 0}
          onClick={() => run(`${label}の承認済 ${approvedCount} 件（${people} 人分）をすべて未承認に戻します。よろしいですか？`, () => actionRejectAllMonth(year, month))}
          className={`${btn} bg-amber-500 hover:bg-amber-600`}
        >
          全員の承認取消
        </button>
        {isAdmin && (
          <button
            disabled={isPending || approvedCount === 0}
            onClick={() => run(`${label}の承認済 ${approvedCount} 件（${people} 人分）をすべて締めます。\n締めた記録は計算し直されなくなります（締め解除で戻せます）。よろしいですか？`, () => actionLockAllMonth(year, month))}
            className={`${btn} bg-purple-600 hover:bg-purple-700`}
          >
            全員を締め
          </button>
        )}
        {isPending && <span className="text-xs text-gray-400">処理中...（人数が多いと少し時間がかかります）</span>}
      </div>
    </div>
  )
}
