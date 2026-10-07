"use client"

import { useMemo } from "react"
import { buildAdminTimeOptions, type AdminTimeConstraint } from "@/lib/clock-pipeline"

/**
 * 管理者の入力画面の時刻セレクト（CLOCK_PIPELINE 段6.5）。
 * 基本はスイッチの結果としてあり得る時刻だけ。「制限なしで入力する」で1分単位・全時間帯。
 * 現在の値が選択肢に無くても（過去の値など）消えないよう先頭側に足す。
 */
export function AdminTimeSelect({
  name, kind, constraint, unrestricted, current, required, className,
}: {
  name: string
  kind: "clockIn" | "clockOut" | "other"
  constraint: AdminTimeConstraint
  unrestricted: boolean
  current: string | null
  required?: boolean
  className?: string
}) {
  const options = useMemo(() => {
    const base = buildAdminTimeOptions(kind, constraint, unrestricted)
    if (current && !base.includes(current)) return [...base, current].sort()
    return base
  }, [kind, constraint, unrestricted, current])

  return (
    <select name={name} defaultValue={current ?? ""} required={required} className={className}>
      <option value="">—</option>
      {options.map((t) => (
        <option key={t} value={t}>{t}</option>
      ))}
    </select>
  )
}
