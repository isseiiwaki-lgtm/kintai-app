"use client"

import { useTransition } from "react"
import { actionDeleteUser } from "../../actions"

export function DeleteUserButton({ userId }: { userId: string }) {
  const [isPending, startTransition] = useTransition()

  function handleDelete() {
    if (!confirm("このユーザーを削除しますか？\n（打刻・申請データがある場合は削除できません）")) return
    startTransition(async () => {
      try {
        const result = await actionDeleteUser(userId)
        if (result?.error) alert(result.error)
      } catch (e) {
        // redirect() は NEXT_REDIRECT を throw する正常フロー
        if (String(e).includes("NEXT_REDIRECT")) return
        alert("削除に失敗しました: " + String(e))
      }
    })
  }

  return (
    <button
      type="button"
      onClick={handleDelete}
      disabled={isPending}
      className="w-full py-2.5 border border-red-200 text-red-600 hover:bg-red-50 text-sm font-medium rounded-lg transition-colors disabled:opacity-40"
    >
      {isPending ? "削除中..." : "ユーザーを削除"}
    </button>
  )
}
