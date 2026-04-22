import { Suspense } from "react"
import { LinkContent } from "./LinkContent"

export default function LinkPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-sm text-gray-400">読み込み中...</p>
      </div>
    }>
      <LinkContent />
    </Suspense>
  )
}
