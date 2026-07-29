import { defineConfig } from "vitest/config"
import path from "node:path"

// tsconfig の paths（"@/*" → プロジェクトルート）を vitest でも解決させる。
// これがないと lib/attendance.ts の `@/config/attendance.config` 参照で丸め・集計テストが実行不能になる
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
})
