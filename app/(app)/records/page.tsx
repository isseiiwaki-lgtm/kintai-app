import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import Link from "next/link"
import { SubmitMonthButton } from "./submit-button"

type SearchParams = Promise<{ year?: string; month?: string }>

function toJST(dt: Date): Date {
  return new Date(dt.getTime() + 9 * 60 * 60 * 1000)
}

function formatTime(dt: Date | null | undefined): string {
  if (!dt) return "--:--"
  const jst = toJST(dt)
  return `${String(jst.getUTCHours()).padStart(2, "0")}:${String(jst.getUTCMinutes()).padStart(2, "0")}`
}

function formatMinutes(min: number | null | undefined): string {
  if (!min) return "--"
  return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, "0")}`
}

const STATUS_LABEL: Record<string, { label: string; className: string }> = {
  OPEN:      { label: "未確認", className: "bg-gray-100 text-gray-500" },
  SUBMITTED: { label: "確認済", className: "bg-blue-100 text-blue-700" },
  APPROVED:  { label: "承認済", className: "bg-green-100 text-green-700" },
  LOCKED:    { label: "締め済", className: "bg-purple-100 text-purple-700" },
}

const WEEKDAY = ["日", "月", "火", "水", "木", "金", "土"]

export default async function RecordsPage({ searchParams }: { searchParams: SearchParams }) {
  const session = await auth()
  const userId  = session!.user!.id!
  const params  = await searchParams

  const now   = toJST(new Date())
  const year  = Number(params.year  ?? now.getUTCFullYear())
  const month = Number(params.month ?? now.getUTCMonth() + 1)

  const firstDay = new Date(Date.UTC(year, month - 1, 1))
  const lastDay  = new Date(Date.UTC(year, month,     0))

  const records = await prisma.attendanceRecord.findMany({
    where: { userId, date: { gte: firstDay, lte: lastDay } },
    orderBy: { date: "asc" },
  })

  // 月次サマリー
  type Rec = typeof records[number]
  const workDays     = records.filter((r: Rec) => r.clockIn).length
  const totalMinutes = records.reduce((s: number, r: Rec) => s + (r.workingMinutes ?? 0), 0)

  // 前月・翌月のリンク用
  const prevDate = new Date(Date.UTC(year, month - 2, 1))
  const nextDate = new Date(Date.UTC(year, month,     1))
  const prevLink = `/records?year=${prevDate.getUTCFullYear()}&month=${prevDate.getUTCMonth() + 1}`
  const nextLink = `/records?year=${nextDate.getUTCFullYear()}&month=${nextDate.getUTCMonth() + 1}`

  // レコードを日付キーで引けるようにする
  const recordMap = new Map(
    records.map((r) => [toJST(r.date).getUTCDate(), r])
  )

  // 月の全日程を生成
  const days = Array.from({ length: lastDay.getUTCDate() }, (_, i) => i + 1)

  // 提出状態の判定
  const workRecords  = records.filter((r: Rec) => r.clockIn)
  const hasRecords   = workRecords.length > 0
  const allSubmitted = hasRecords && workRecords.every((r: Rec) => r.status !== "OPEN")
  const anyLocked    = workRecords.some((r: Rec) => r.status === "LOCKED" || r.status === "APPROVED")

  return (
    <div className="p-4 lg:p-6">
      {/* 月ナビ */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-1">
          <Link href={prevLink} className="p-2 rounded-lg hover:bg-gray-100 text-gray-500">◀</Link>
          <h1 className="text-base font-semibold text-gray-900">{year}年{month}月</h1>
          <Link href={nextLink} className="p-2 rounded-lg hover:bg-gray-100 text-gray-500">▶</Link>
        </div>
        {hasRecords && !anyLocked && (
          <SubmitMonthButton
            userId={userId}
            year={year}
            month={month}
            isSubmitted={allSubmitted}
          />
        )}
      </div>

      {/* 月次サマリー */}
      <div className="grid grid-cols-2 gap-3 mb-5">
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 text-center">
          <p className="text-xs text-gray-400 mb-1">出勤日数</p>
          <p className="text-2xl font-bold text-gray-800">
            {workDays}<span className="text-sm font-normal text-gray-400 ml-1">日</span>
          </p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 text-center">
          <p className="text-xs text-gray-400 mb-1">合計勤務</p>
          <p className="text-2xl font-bold text-gray-800">
            {Math.floor(totalMinutes / 60)}<span className="text-sm font-normal text-gray-400 ml-1">h</span>
            {String(totalMinutes % 60).padStart(2, "0")}<span className="text-sm font-normal text-gray-400 ml-0.5">m</span>
          </p>
        </div>
      </div>

      {/* PC: テーブル */}
      <div className="hidden lg:block bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-xs text-gray-400 bg-gray-50">
              <th className="text-left px-4 py-3 font-medium">日付</th>
              <th className="text-center px-3 py-3 font-medium">出勤</th>
              <th className="text-center px-3 py-3 font-medium">退勤</th>
              <th className="text-center px-3 py-3 font-medium">外出</th>
              <th className="text-center px-3 py-3 font-medium">戻り</th>
              <th className="text-center px-3 py-3 font-medium">勤務時間</th>
              <th className="text-center px-3 py-3 font-medium">状態</th>
            </tr>
          </thead>
          <tbody>
            {days.map((d) => {
              const dt  = new Date(Date.UTC(year, month - 1, d))
              const dow = dt.getUTCDay()
              const rec = recordMap.get(d)
              const isWeekend = dow === 0 || dow === 6
              return (
                <tr
                  key={d}
                  className={`border-b border-gray-50 last:border-0 ${
                    isWeekend ? "bg-gray-50/60" : "hover:bg-gray-50"
                  }`}
                >
                  <td className="px-4 py-2.5">
                    <span className={dow === 0 ? "text-red-500" : dow === 6 ? "text-blue-500" : "text-gray-800"}>
                      {month}/{d}（{WEEKDAY[dow]}）
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-center font-mono text-gray-700">{formatTime(rec?.clockIn)}</td>
                  <td className="px-3 py-2.5 text-center font-mono text-gray-700">{formatTime(rec?.clockOut)}</td>
                  <td className="px-3 py-2.5 text-center font-mono text-gray-500 text-xs">{formatTime(rec?.goOutAt)}</td>
                  <td className="px-3 py-2.5 text-center font-mono text-gray-500 text-xs">{formatTime(rec?.returnAt)}</td>
                  <td className="px-3 py-2.5 text-center font-mono text-gray-700">
                    {rec?.workingMinutes ? formatMinutes(rec.workingMinutes) : "--"}
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    {rec?.isAbsent ? (
                      <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-700">
                        欠勤
                      </span>
                    ) : rec ? (
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_LABEL[rec.status].className}`}>
                        {STATUS_LABEL[rec.status].label}
                      </span>
                    ) : null}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* SP: カードリスト */}
      <div className="lg:hidden space-y-2">
        {days.map((d) => {
          const dt  = new Date(Date.UTC(year, month - 1, d))
          const dow = dt.getUTCDay()
          const rec = recordMap.get(d)
          if (!rec?.clockIn && !rec?.isAbsent) return null // SP は打刻あり or 欠勤のみ表示
          const isWeekend = dow === 0 || dow === 6
          return (
            <div key={d} className="bg-white rounded-xl border border-gray-200 shadow-sm px-4 py-3">
              <div className="flex items-center justify-between mb-2">
                <span className={`text-sm font-medium ${dow === 0 ? "text-red-500" : dow === 6 ? "text-blue-500" : "text-gray-800"}`}>
                  {month}/{d}（{WEEKDAY[dow]}）
                </span>
                {rec.isAbsent ? (
                  <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-700">
                    欠勤
                  </span>
                ) : (
                  <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_LABEL[rec.status].className}`}>
                    {STATUS_LABEL[rec.status].label}
                  </span>
                )}
              </div>
              {!rec.isAbsent && (
                <div className="grid grid-cols-3 gap-2 text-center text-xs">
                  <div>
                    <p className="text-gray-400">出勤</p>
                    <p className="font-mono text-gray-800">{formatTime(rec.clockIn)}</p>
                  </div>
                  <div>
                    <p className="text-gray-400">退勤</p>
                    <p className="font-mono text-gray-800">{formatTime(rec.clockOut)}</p>
                  </div>
                  <div>
                    <p className="text-gray-400">勤務時間</p>
                    <p className="font-mono text-gray-800">{formatMinutes(rec.workingMinutes)}</p>
                  </div>
                </div>
              )}
            </div>
          )
        })}
        {records.filter((r) => r.clockIn).length === 0 && (
          <p className="text-center text-sm text-gray-400 py-8">打刻記録がありません</p>
        )}
      </div>
    </div>
  )
}
