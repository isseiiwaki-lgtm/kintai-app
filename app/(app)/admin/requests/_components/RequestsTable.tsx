"use client"

import { useState, useTransition } from "react"
import {
  actionApproveRequest,
  actionForceApproveRequest,
  actionRejectRequest,
  actionUpdateRequest,
  actionDeleteRequest,
} from "../actions"

const TYPE_LABEL: Record<string, string> = {
  OVERTIME:   "残業申請",
  ABSENCE:    "遅刻・早退",
  LEAVE:      "休暇申請",
  CORRECTION: "打刻修正",
  COMMENT:    "修正依頼",
  OTHER:      "その他",
}

function typeLabel(type: string, detail: Record<string, string> | null): string {
  if (type === "ABSENCE"  && detail?.absenceType  === "absent")     return "欠勤"
  if (type === "OVERTIME" && detail?.overtimeType  === "earlyStart") return "早出申請"
  return TYPE_LABEL[type] ?? type
}

const STATUS_LABEL: Record<string, { label: string; className: string }> = {
  PENDING:  { label: "審査中", className: "bg-yellow-100 text-yellow-700" },
  APPROVED: { label: "承認済", className: "bg-green-100  text-green-700"  },
  REJECTED: { label: "却下",   className: "bg-red-100    text-red-600"    },
}

const TIME_OPTIONS = Array.from({ length: 96 }, (_, i) => {
  const h = Math.floor(i / 4)
  const m = (i % 4) * 15
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`
})

function detailSummary(type: string, detail: Record<string, string> | null): string {
  const d = detail
  if (!d) return ""
  switch (type) {
    case "OVERTIME": {
      if (d.overtimeType === "earlyStart") {
        const scheduled = d.scheduledStartTime ? `（定時 ${d.scheduledStartTime}）` : ""
        return d.startTime ? `早出開始 ${d.startTime}${scheduled}` : ""
      }
      const scheduled = d.scheduledEndTime ? `（定時 ${d.scheduledEndTime}）` : ""
      return d.endTime ? `残業終了 ${d.endTime}${scheduled}` : ""
    }
    case "ABSENCE":
      if (d.absenceType === "absent") return "欠勤（全日）"
      return `${d.absenceType === "late" ? "遅刻" : "早退"} ${d.time ?? ""}`
    case "LEAVE": {
      const lt = d.leaveType === "substitute" ? "振休" : "有給"
      const hd = d.halfDay === "am" ? "（午前）" : d.halfDay === "pm" ? "（午後）" : ""
      const wb = d.workDate ? ` ← ${d.workDate}` : ""
      return `${lt}${hd}${wb}`
    }
    case "CORRECTION": {
      const fieldLabel: Record<string, string> = {
        clockIn: "出勤", clockOut: "退勤", goOutAt: "外出",
        returnAt: "戻り", breakStart: "休憩開始", breakEnd: "休憩終了",
      }
      const field = d.targetField ? (fieldLabel[d.targetField] ?? d.targetField) : ""
      if (!field || !d.correctedTime) return field
      const before = d.originalValue ? `${d.originalValue} → ` : "（記録なし）→ "
      return `${field} ${before}${d.correctedTime}`
    }
    default: return ""
  }
}

function formatDate(isoString: string) {
  const d = new Date(isoString)
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000)
  return `${jst.getUTCFullYear()}/${String(jst.getUTCMonth() + 1).padStart(2, "0")}/${String(jst.getUTCDate()).padStart(2, "0")}`
}

function toInputDate(isoString: string) {
  const d = new Date(isoString)
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000)
  return `${jst.getUTCFullYear()}-${String(jst.getUTCMonth() + 1).padStart(2, "0")}-${String(jst.getUTCDate()).padStart(2, "0")}`
}

export type ReqRow = {
  id: string
  type: string
  status: string
  targetDate: string
  createdAt: string
  reason: string | null
  detail: Record<string, string> | null
  user: { name: string | null; email: string }
  // 多段階承認（申請者の部署に承認経路がある場合のみ設定される）
  approvalDone?:  number | null // 消化済みステップ数
  approvalTotal?: number | null // 総ステップ数
  canApprove?: boolean          // 現在ステップの担当承認者 or ADMIN
  canForce?: boolean            // 飛び越し承認可（ADMIN・残り2ステップ以上）
}

type EditState = {
  id: string
  type: string
  targetDate: string
  reason: string
  detail: Record<string, string>
}

type DeleteState = {
  id: string
  info: string
}

const inputClass = "w-full border border-gray-200 rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:border-blue-400"
const labelClass = "block text-xs text-gray-500 mb-1"

function DetailFields({ type, detail }: { type: string; detail: Record<string, string> }) {
  if (type === "OVERTIME") {
    return (
      <div>
        <label className={labelClass}>終了時刻</label>
        <select name="endTime" defaultValue={detail.endTime ?? ""} className={inputClass}>
          <option value="">未設定</option>
          {TIME_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
    )
  }
  if (type === "ABSENCE") {
    return (
      <>
        <div>
          <label className={labelClass}>種類</label>
          <select name="absenceType" defaultValue={detail.absenceType ?? "late"} className={inputClass}>
            <option value="late">遅刻</option>
            <option value="early">早退</option>
          </select>
        </div>
        <div>
          <label className={labelClass}>時刻</label>
          <select name="time" defaultValue={detail.time ?? ""} className={inputClass}>
            <option value="">未設定</option>
            {TIME_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
      </>
    )
  }
  if (type === "LEAVE") {
    return (
      <>
        <div>
          <label className={labelClass}>休暇種別</label>
          <select name="leaveType" defaultValue={detail.leaveType ?? "annual"} className={inputClass}>
            <option value="annual">有給</option>
            <option value="substitute">振休</option>
          </select>
        </div>
        <div>
          <label className={labelClass}>半日</label>
          <select name="halfDay" defaultValue={detail.halfDay ?? "full"} className={inputClass}>
            <option value="full">全日</option>
            <option value="am">午前</option>
            <option value="pm">午後</option>
          </select>
        </div>
        <div>
          <label className={labelClass}>振替出勤日（振休の場合）</label>
          <input type="date" name="workDate" defaultValue={detail.workDate ?? ""} className={inputClass} />
        </div>
      </>
    )
  }
  return null
}

const TableHeader = () => (
  <tr className="border-b border-gray-100 text-xs text-gray-400 bg-gray-50">
    <th className="text-left px-4 py-3 font-medium">申請者</th>
    <th className="text-left px-3 py-3 font-medium">種別</th>
    <th className="text-left px-3 py-3 font-medium">申請日</th>
    <th className="text-left px-3 py-3 font-medium">対象日</th>
    <th className="text-left px-3 py-3 font-medium">内容</th>
    <th className="text-left px-3 py-3 font-medium">理由</th>
    <th className="text-center px-3 py-3 font-medium">状態</th>
    <th className="px-3 py-3 w-[120px]"></th>
  </tr>
)

import Link from "next/link"

type ProcessedNav = { year: number; month: number; prevLink: string; nextLink: string }

export function RequestsTable({
  pending,
  processed,
  processedNav,
}: {
  pending:      ReqRow[]
  processed:    ReqRow[]
  processedNav: ProcessedNav
}) {
  const [editTarget, setEditTarget]     = useState<EditState | null>(null)
  const [editType, setEditType]         = useState("")
  const [deleteTarget, setDeleteTarget] = useState<DeleteState | null>(null)
  const [isPending, startTransition]    = useTransition()

  function openEdit(r: ReqRow) {
    setEditType(r.type)
    setEditTarget({
      id:         r.id,
      type:       r.type,
      targetDate: toInputDate(r.targetDate),
      reason:     r.reason ?? "",
      detail:     r.detail ?? {},
    })
  }

  function openDelete(r: ReqRow) {
    const info = `${r.user.name ?? r.user.email} / ${TYPE_LABEL[r.type] ?? r.type} / ${formatDate(r.targetDate)}`
    setDeleteTarget({ id: r.id, info })
  }

  function handleUpdate(formData: FormData) {
    if (!editTarget) return
    startTransition(async () => {
      await actionUpdateRequest(editTarget.id, formData)
      setEditTarget(null)
    })
  }

  function handleDelete() {
    if (!deleteTarget) return
    startTransition(async () => {
      await actionDeleteRequest(deleteTarget.id)
      setDeleteTarget(null)
    })
  }

  function handleForceApprove(r: ReqRow) {
    const who = r.user.name ?? r.user.email
    if (!window.confirm(`${who} の申請を飛び越し承認しますか？\n（未消化の承認ステップをスキップして承認を確定します）`)) return
    startTransition(async () => {
      await actionForceApproveRequest(r.id)
    })
  }

  const Row = ({ r, showApproveActions }: { r: ReqRow; showApproveActions: boolean }) => {
    const status = STATUS_LABEL[r.status] ?? STATUS_LABEL.PENDING
    // 多段階承認の進捗（審査中 1/2 のように表示）
    const progress = r.status === "PENDING" && r.approvalTotal ? ` ${r.approvalDone}/${r.approvalTotal}` : ""
    return (
      <tr className="border-b border-gray-50 last:border-0 hover:bg-gray-50">
        <td className="px-4 py-2.5 text-gray-800 font-medium">{r.user.name ?? r.user.email}</td>
        <td className="px-3 py-2.5 text-gray-700">{typeLabel(r.type, r.detail)}</td>
        <td className="px-3 py-2.5 text-gray-500 font-mono text-xs whitespace-nowrap">{formatDate(r.createdAt)}</td>
        <td className="px-3 py-2.5 text-gray-600 font-mono text-xs whitespace-nowrap">{formatDate(r.targetDate)}</td>
        <td className="px-3 py-2.5 text-gray-500 text-xs min-w-[120px]">{detailSummary(r.type, r.detail)}</td>
        <td className="px-3 py-2.5 text-gray-500 text-xs min-w-[160px]">{r.reason ?? ""}</td>
        <td className="px-3 py-2.5 text-center">
          <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${status.className}`}>
            {status.label}{progress}
          </span>
        </td>
        <td className="px-3 py-2.5 w-[120px]">
          <div className="flex gap-1.5">
            {showApproveActions ? (
              r.canApprove === false ? (
                // 他ステップの承認者担当分（自分は操作不可）
                <span className="text-xs text-gray-400 whitespace-nowrap">他の承認者待ち</span>
              ) : (
              <>
                <form action={actionApproveRequest.bind(null, r.id)}>
                  <button type="submit" className="px-2.5 py-1 rounded text-xs font-medium bg-green-600 hover:bg-green-700 text-white transition-colors whitespace-nowrap">
                    承認
                  </button>
                </form>
                <form action={actionRejectRequest.bind(null, r.id)}>
                  <button type="submit" className="px-2.5 py-1 rounded text-xs font-medium bg-red-500 hover:bg-red-600 text-white transition-colors whitespace-nowrap">
                    却下
                  </button>
                </form>
                {r.canForce && (
                  <button
                    type="button"
                    onClick={() => handleForceApprove(r)}
                    disabled={isPending}
                    title="未消化の承認ステップをスキップして承認を確定（ADMIN専用）"
                    className="px-2.5 py-1 rounded text-xs font-medium bg-white border border-green-400 hover:bg-green-50 text-green-700 transition-colors whitespace-nowrap disabled:opacity-50"
                  >
                    飛越承認
                  </button>
                )}
              </>
              )
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => openEdit(r)}
                  className="px-2.5 py-1 rounded text-xs font-medium bg-gray-100 hover:bg-gray-200 text-gray-700 transition-colors whitespace-nowrap"
                >
                  修正
                </button>
                <button
                  type="button"
                  onClick={() => openDelete(r)}
                  className="px-2.5 py-1 rounded text-xs font-medium bg-white border border-red-300 hover:bg-red-50 text-red-500 transition-colors whitespace-nowrap"
                >
                  削除
                </button>
              </>
            )}
          </div>
        </td>
      </tr>
    )
  }

  return (
    <>
      <h2 className="text-sm font-medium text-gray-700 mb-2">審査中 ({pending.length}件)</h2>
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto mb-6">
        <table className="w-full text-sm min-w-[800px]">
          <thead><TableHeader /></thead>
          <tbody>
            {pending.length === 0
              ? <tr><td colSpan={8} className="px-4 py-6 text-center text-sm text-gray-400">審査中の申請はありません</td></tr>
              : pending.map(r => <Row key={r.id} r={r} showApproveActions={true} />)
            }
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-medium text-gray-700">
          処理済み — {processedNav.year}年{processedNav.month}月 ({processed.length}件)
        </h2>
        <div className="flex items-center gap-1">
          <Link href={processedNav.prevLink} className="p-1.5 rounded hover:bg-gray-100 text-gray-500 text-xs">◀</Link>
          <Link href={processedNav.nextLink} className="p-1.5 rounded hover:bg-gray-100 text-gray-500 text-xs">▶</Link>
        </div>
      </div>
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
        <table className="w-full text-sm min-w-[800px]">
          <thead><TableHeader /></thead>
          <tbody>
            {processed.length === 0
              ? <tr><td colSpan={8} className="px-4 py-6 text-center text-sm text-gray-400">この月の処理済み申請はありません</td></tr>
              : processed.map(r => <Row key={r.id} r={r} showApproveActions={false} />)
            }
          </tbody>
        </table>
      </div>

      {/* 修正モーダル */}
      {editTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => setEditTarget(null)}
        >
          <div
            className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 max-h-[90vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-900">申請を修正</h2>
              <button type="button" onClick={() => setEditTarget(null)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
            </div>
            <form action={handleUpdate} className="px-5 py-4 space-y-3">
              <div>
                <label className={labelClass}>種別</label>
                <select
                  name="type"
                  value={editType}
                  onChange={e => setEditType(e.target.value)}
                  className={inputClass}
                >
                  {Object.entries(TYPE_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClass}>対象日</label>
                <input type="date" name="targetDate" defaultValue={editTarget.targetDate} className={inputClass} />
              </div>
              <div key={editType}>
                <DetailFields
                  type={editType}
                  detail={editType === editTarget.type ? editTarget.detail : {}}
                />
              </div>
              <div>
                <label className={labelClass}>理由</label>
                <textarea name="reason" defaultValue={editTarget.reason} rows={3} className={inputClass} />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditTarget(null)}
                  className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800"
                >
                  キャンセル
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className="px-4 py-1.5 text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-50 transition-colors"
                >
                  {isPending ? "保存中..." : "保存"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 削除確認モーダル */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm mx-4">
            <div className="px-5 py-4 border-b border-gray-100">
              <h2 className="text-sm font-semibold text-gray-900">申請を削除</h2>
            </div>
            <div className="px-5 py-4 space-y-3">
              <p className="text-sm text-gray-700">{deleteTarget.info}</p>
              <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-700">
                一度削除すると取り消せません。必要に応じて内容を記録してから実施してください。
              </div>
            </div>
            <div className="px-5 py-3 border-t border-gray-100 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={isPending}
                className="px-4 py-1.5 text-sm font-medium bg-red-600 hover:bg-red-700 text-white rounded-lg disabled:opacity-50 transition-colors whitespace-nowrap"
              >
                {isPending ? "削除中..." : "削除する"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
