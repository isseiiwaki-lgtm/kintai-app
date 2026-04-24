import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import Link from "next/link"

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

  const now     = toJST(new Date())
  const setting = await prisma.setting.findUnique({ where: { id: 1 } })
  const closingDay = setting?.closingDay ?? 25

  // 締め日考慮のデフォルト月算出（締め日翌日から翌月扱い）
  const todayDate = now.getUTCDate()
  const defaultYear  = todayDate > closingDay
    ? (now.getUTCMonth() === 11 ? now.getUTCFullYear() + 1 : now.getUTCFullYear())
    : now.getUTCFullYear()
  const defaultMonth = todayDate > closingDay
    ? (now.getUTCMonth() + 2 > 12 ? 1 : now.getUTCMonth() + 2)
    : now.getUTCMonth() + 1

  const year  = Number(params.year  ?? defaultYear)
  const month = Number(params.month ?? defaultMonth)

  // 集計期間: 前月(closingDay+1) 〜 当月(closingDay)
  const firstDay = new Date(Date.UTC(year, month - 2, closingDay + 1))
  const lastDay  = new Date(Date.UTC(year, month - 1, closingDay))

  const [records, user] = await Promise.all([
    prisma.attendanceRecord.findMany({
      where: { userId, date: { gte: firstDay, lte: lastDay } },
      orderBy: { date: "asc" },
    }),
    prisma.user.findUnique({
      where: { id: userId },
      select: { workStartTime: true },
    }),
  ])

  // 遅刻・打刻漏れ判定（個別フラグ）
  function getCorrectionFlags(rec: typeof records[number]) {
    if (rec.status !== "OPEN" || !rec.clockIn) {
      return { isLate: false, missingClockOut: false, needsButton: false }
    }
    const recDate = new Date(Date.UTC(year, month - 1, rec.date ? toJST(rec.date).getUTCDate() : 0))
    const isBeforeToday = recDate < new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
    const missingClockOut = !rec.clockOut && isBeforeToday
    let isLate = false
    if (user?.workStartTime) {
      const [sh, sm] = user.workStartTime.split(":").map(Number)
      const jst = toJST(rec.clockIn)
      isLate = jst.getUTCHours() * 60 + jst.getUTCMinutes() > sh * 60 + sm
    }
    return { isLate, missingClockOut, needsButton: isLate || missingClockOut }
  }

  // 月次サマリー
  type Rec = typeof records[number]
  const workDays     = records.filter((r: Rec) => r.clockIn).length
  const totalMinutes = records.reduce((s: number, r: Rec) => s + (r.workingMinutes ?? 0), 0)

  // 前月・翌月のリンク用
  const prevMonth = month === 1 ? 12 : month - 1
  const prevYear  = month === 1 ? year - 1 : year
  const nextMonth = month === 12 ? 1 : month + 1
  const nextYear  = month === 12 ? year + 1 : year
  const prevLink  = `/records?year=${prevYear}&month=${prevMonth}`
  const nextLink  = `/records?year=${nextYear}&month=${nextMonth}`

  // 集計期間の表示用
  const periodStart = `${firstDay.getUTCMonth() + 1}/${firstDay.getUTCDate()}`
  const periodEnd   = `${lastDay.getUTCMonth() + 1}/${lastDay.getUTCDate()}`

  // レコードを日付キーで引けるようにする（"YYYY-M-D" キー）
  const recordMap = new Map(
    records.map((r) => {
      const jst = toJST(r.date)
      return [`${jst.getUTCFullYear()}-${jst.getUTCMonth() + 1}-${jst.getUTCDate()}`, r]
    })
  )

  // 集計期間の全日程を生成
  const days: { year: number; month: number; day: number }[] = []
  const cur = new Date(firstDay)
  while (cur <= lastDay) {
    const jst = toJST(cur)
    days.push({ year: jst.getUTCFullYear(), month: jst.getUTCMonth() + 1, day: jst.getUTCDate() })
    cur.setUTCDate(cur.getUTCDate() + 1)
  }

  // 提出状態の判定

  return (
    <div className="p-4 lg:p-6">
      {/* 月ナビ */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-1">
          <Link href={prevLink} className="p-2 rounded-lg hover:bg-gray-100 text-gray-500">◀</Link>
          <div className="text-center">
            <h1 className="text-base font-semibold text-gray-900">{year}年{month}月</h1>
            <p className="text-[10px] text-gray-400">{periodStart}〜{periodEnd}</p>
          </div>
          <Link href={nextLink} className="p-2 rounded-lg hover:bg-gray-100 text-gray-500">▶</Link>
        </div>
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
              <th className="px-3 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {days.map(({ year: dy, month: dm, day: d }) => {
              const dt  = new Date(Date.UTC(dy, dm - 1, d))
              const dow = dt.getUTCDay()
              const rec = recordMap.get(`${dy}-${dm}-${d}`)
              const isWeekend = dow === 0 || dow === 6
              const flags = rec ? getCorrectionFlags(rec) : { isLate: false, missingClockOut: false, needsButton: false }
              const dateStr = `${dy}-${String(dm).padStart(2, "0")}-${String(d).padStart(2, "0")}`
              return (
                <tr
                  key={dateStr}
                  className={`border-b border-gray-50 last:border-0 ${
                    isWeekend ? "bg-gray-50/60" : "hover:bg-gray-50"
                  }`}
                >
                  <td className="px-4 py-2.5">
                    <span className={dow === 0 ? "text-red-500" : dow === 6 ? "text-blue-500" : "text-gray-800"}>
                      {dm}/{d}（{WEEKDAY[dow]}）
                    </span>
                  </td>
                  <td className={`px-3 py-2.5 text-center font-mono ${flags.isLate ? "text-amber-600 font-semibold" : "text-gray-700"}`}>
                    {formatTime(rec?.clockIn)}
                  </td>
                  <td className={`px-3 py-2.5 text-center font-mono ${flags.missingClockOut ? "text-amber-600 font-semibold" : "text-gray-700"}`}>
                    {formatTime(rec?.clockOut)}
                  </td>
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
                  <td className="px-3 py-2.5 text-center">
                    {flags.needsButton && (
                      <Link
                        href={`/requests/new?date=${dateStr}&mode=correction`}
                        className="inline-block text-xs px-2.5 py-1 rounded border border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100 whitespace-nowrap"
                      >
                        修正依頼
                      </Link>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* SP: カードリスト */}
      <div className="lg:hidden space-y-2">
        {days.map(({ year: dy, month: dm, day: d }) => {
          const dt  = new Date(Date.UTC(dy, dm - 1, d))
          const dow = dt.getUTCDay()
          const rec = recordMap.get(`${dy}-${dm}-${d}`)
          if (!rec?.clockIn && !rec?.isAbsent) return null // SP は打刻あり or 欠勤のみ表示
          const flags = rec ? getCorrectionFlags(rec) : { isLate: false, missingClockOut: false, needsButton: false }
          const dateStr = `${dy}-${String(dm).padStart(2, "0")}-${String(d).padStart(2, "0")}`
          return (
            <div key={dateStr} className="bg-white rounded-xl border border-gray-200 shadow-sm px-4 py-3">
              <div className="flex items-center justify-between mb-2">
                <span className={`text-sm font-medium ${dow === 0 ? "text-red-500" : dow === 6 ? "text-blue-500" : "text-gray-800"}`}>
                  {dm}/{d}（{WEEKDAY[dow]}）
                </span>
                <div className="flex items-center gap-2">
                  {flags.needsButton && (
                    <Link
                      href={`/requests/new?date=${dateStr}&mode=correction`}
                      className="text-xs px-2 py-0.5 rounded border border-amber-300 bg-amber-50 text-amber-700 whitespace-nowrap"
                    >
                      修正依頼
                    </Link>
                  )}
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
              </div>
              {!rec.isAbsent && (
                <div className="grid grid-cols-3 gap-2 text-center text-xs">
                  <div>
                    <p className="text-gray-400">出勤</p>
                    <p className={`font-mono ${flags.isLate ? "text-amber-600 font-semibold" : "text-gray-800"}`}>{formatTime(rec.clockIn)}</p>
                  </div>
                  <div>
                    <p className="text-gray-400">退勤</p>
                    <p className={`font-mono ${flags.missingClockOut ? "text-amber-600 font-semibold" : "text-gray-800"}`}>{formatTime(rec.clockOut)}</p>
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
