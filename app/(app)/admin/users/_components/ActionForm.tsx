"use client"

import { useState, useTransition } from "react"

/**
 * サーバーアクションが { error } を返したとき、フォーム上部にエラーを表示するフォーム。
 * 成功時は redirect() されるのでここには戻らない。
 * （form action 属性だとエラー時に入力欄がリセットされるため、onSubmit で呼ぶ）
 */
export function ActionForm({
  action,
  className,
  children,
}: {
  action: (formData: FormData) => Promise<{ error: string } | void>
  className?: string
  children: React.ReactNode
}) {
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    setError(null)
    startTransition(async () => {
      const result = await action(formData)
      if (result && "error" in result) setError(result.error)
    })
  }

  return (
    <form onSubmit={handleSubmit} className={className} aria-busy={isPending}>
      {error && (
        <p role="alert" className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </p>
      )}
      {children}
    </form>
  )
}
