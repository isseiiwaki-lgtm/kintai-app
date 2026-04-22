"use client"

import { useTransition, useRef, useState } from "react"
import { actionImportUsers, type ImportResult } from "../actions"

export function UserImportButton() {
  const inputRef              = useRef<HTMLInputElement>(null)
  const [isPending, startTransition] = useTransition()
  const [result, setResult]   = useState<ImportResult | null>(null)

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setResult(null)
    const fd = new FormData()
    fd.append("file", file)
    startTransition(async () => {
      const res = await actionImportUsers(fd)
      setResult(res)
      // input をリセットして同じファイルを再選択できるようにする
      if (inputRef.current) inputRef.current.value = ""
    })
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <button
        onClick={() => inputRef.current?.click()}
        disabled={isPending}
        className="px-3 py-2 border border-gray-200 text-gray-600 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-40"
      >
        {isPending ? "処理中..." : "CSVインポート"}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".csv"
        className="hidden"
        onChange={handleChange}
      />

      {/* 結果表示 */}
      {result && (
        result.success ? (
          <div className="text-xs text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
            完了 — 新規登録 {result.created}件・更新 {result.updated}件
          </div>
        ) : (
          <div className="text-xs bg-red-50 border border-red-200 rounded-lg px-3 py-2 max-w-sm">
            <p className="font-medium text-red-700 mb-1">エラー（{result.errors.length}件）</p>
            <div className="space-y-0.5 max-h-40 overflow-y-auto">
              {result.errors.map((e, i) => (
                <div key={i} className="text-red-600">
                  {e.row > 0 ? `${e.row}行目` : ""} [{e.field}] {e.message}
                </div>
              ))}
            </div>
          </div>
        )
      )}
    </div>
  )
}
