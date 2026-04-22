"use client"

import { useState, useTransition } from "react"
import { useSearchParams } from "next/navigation"
import { actionFindByCompanyEmail, actionLinkAccount, type LinkState } from "./actions"

type Step = "input" | "confirm" | "done"

export function LinkContent() {
  const params = useSearchParams()
  const [step, setStep]             = useState<Step>("input")
  const [companyEmail, setEmail]    = useState("")
  const [found, setFound]           = useState<{ name: string | null; department: string | null } | null>(null)
  const [error, setError]           = useState("")
  const [isPending, startTransition] = useTransition()

  const rawState = params.get("state") ?? ""
  let state: LinkState | null = null
  try {
    // params.get() は %xx デコード済み・+ → スペース変換なし（base64 標準で安全）
    state = JSON.parse(Buffer.from(rawState, "base64").toString())
  } catch {
    // state が不正
  }

  if (!state) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 max-w-sm w-full text-center">
          <p className="text-sm text-red-500">無効なリンクです。最初からやり直してください。</p>
          <a href="/login" className="mt-4 inline-block text-sm text-blue-600 hover:underline">ログインページへ</a>
        </div>
      </div>
    )
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    startTransition(async () => {
      const result = await actionFindByCompanyEmail(companyEmail.trim().toLowerCase())
      if (!result) {
        setError("このメールアドレスは登録されていません")
        return
      }
      setFound(result)
      setStep("confirm")
    })
  }

  function handleConfirm() {
    if (!state) return
    startTransition(async () => {
      await actionLinkAccount(state!, companyEmail.trim().toLowerCase())
      setStep("done")
      // 登録完了後はログインページへ（OAuth cookie 競合を避けるため再起動はしない）
      setTimeout(() => {
        window.location.href = "/login"
      }, 2000)
    })
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 max-w-sm w-full">
        <h1 className="text-base font-semibold text-gray-900 mb-1">アカウントの紐づけ</h1>
        <p className="text-xs text-gray-500 mb-5">
          Googleアカウント（{state.googleEmail}）を登録済みの従業員情報に紐づけます。
        </p>

        {step === "input" && (
          <form onSubmit={handleSearch} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                会社のメールアドレス
              </label>
              <input
                type="email"
                required
                value={companyEmail}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="yamada@iwaki-i.com"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
            </div>
            <button
              type="submit"
              disabled={isPending}
              className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-40"
            >
              {isPending ? "検索中..." : "検索"}
            </button>
          </form>
        )}

        {step === "confirm" && found && (
          <div className="space-y-4">
            <div className="bg-gray-50 rounded-lg p-4">
              <p className="text-xs text-gray-500 mb-1">以下の従業員として登録します</p>
              <p className="font-medium text-gray-900">{found.name ?? "（氏名未設定）"}</p>
              {found.department && <p className="text-xs text-gray-500 mt-0.5">{found.department}</p>}
              <p className="text-xs text-gray-400 mt-1">{companyEmail}</p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => { setStep("input"); setFound(null) }}
                className="flex-1 py-2.5 border border-gray-200 text-gray-600 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
              >
                戻る
              </button>
              <button
                onClick={handleConfirm}
                disabled={isPending}
                className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-40"
              >
                {isPending ? "処理中..." : "はい、登録します"}
              </button>
            </div>
          </div>
        )}

        {step === "done" && (
          <div className="text-center space-y-3">
            <div className="text-green-600 text-3xl">✓</div>
            <p className="text-sm font-medium text-gray-800">紐づけが完了しました</p>
            <p className="text-xs text-gray-500">ログインページへ移動します...</p>
          </div>
        )}
      </div>
    </div>
  )
}
