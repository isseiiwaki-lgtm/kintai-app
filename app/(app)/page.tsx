import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import Link from "next/link"

/** UTC の Date を JST の同じ日付の 00:00:00 UTC に変換 */
function todayJST(): Date {
  const now = new Date()
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000)
  return new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate()))
}

function formatTime(dt: Date | null | undefined): string {
  if (!dt) return "--:--"
  const jst = new Date(dt.getTime() + 9 * 60 * 60 * 1000)
  return `${String(jst.getUTCHours()).padStart(2, "0")}:${String(jst.getUTCMinutes()).padStart(2, "0")}`
}

function formatMinutes(min: number): string {
  if (min === 0) return "0時間00分"
  return `${Math.floor(min / 60)}時間${String(min % 60).padStart(2, "0")}分`
}

export default async function DashboardPage() {
  const session = await auth()
  const userId = session!.user!.id!

  const today   = todayJST()
  const setting = await prisma.setting.findUnique({ where: { id: 1 } })
  const closingDay = setting?.closingDay ?? 25

  // 締め日基準の当月集計期間
  const todayDate  = today.getUTCDate()
  const periodYear  = todayDate > closingDay
    ? (today.getUTCMonth() === 11 ? today.getUTCFullYear() + 1 : today.getUTCFullYear())
    : today.getUTCFullYear()
  const periodMonth = todayDate > closingDay
    ? (today.getUTCMonth() + 2 > 12 ? 1 : today.getUTCMonth() + 2)
    : today.getUTCMonth() + 1
  const firstDay = new Date(Date.UTC(periodYear, periodMonth - 2, closingDay + 1))
  const lastDay  = new Date(Date.UTC(periodYear, periodMonth - 1, closingDay))

  const [userInfo, todayRecord, monthRecords, pendingRequests, rejectedRequests, missedClockOut] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { name: true, employeeCode: true },
    }),
    prisma.attendanceRecord.findUnique({
      where: { userId_date: { userId, date: today } },
    }),
    prisma.attendanceRecord.findMany({
      where: { userId, date: { gte: firstDay, lte: lastDay }, clockIn: { not: null } },
      select: { workingMinutes: true, clockIn: true, status: true },
    }),
    // 審査中の申請
    prisma.request.findMany({
      where: { userId, status: "PENDING" },
      select: { id: true, type: true, targetDate: true },
      orderBy: { createdAt: "desc" },
    }),
    // 却下された申請
    prisma.request.findMany({
      where: { userId, status: "REJECTED" },
      select: { id: true, type: true, targetDate: true },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
    // 退勤漏れ: 昨日以前 + clockIn あり + clockOut なし
    prisma.attendanceRecord.findMany({
      where: {
        userId,
        date:     { gte: firstDay, lt: today },
        clockIn:  { not: null },
        clockOut: null,
      },
      select: { date: true },
      orderBy: { date: "desc" },
      take: 5,
    }),
  ])

  const workDays     = monthRecords.length
  const totalMinutes = monthRecords.reduce((s: number, r: { workingMinutes: number | null }) => s + (r.workingMinutes ?? 0), 0)
  const openCount    = monthRecords.filter((r) => r.status === "OPEN").length

  const dateLabel = today.toLocaleDateString("ja-JP", {
    timeZone: "UTC",
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  })

  // 打刻状態ラベル
  const clockStatus = !todayRecord?.clockIn
    ? { label: "未出勤", color: "text-gray-400" }
    : !todayRecord.clockOut
    ? { label: "出勤中", color: "text-green-600" }
    : { label: "退勤済", color: "text-blue-600" }

  return (
    <div className="p-4 lg:p-8 max-w-3xl mx-auto space-y-4">
      {/* ユーザー情報 */}
      {userInfo && (
        <div className="flex items-center gap-2">
          {userInfo.employeeCode && (
            <span className="text-xs text-gray-400 font-mono">{userInfo.employeeCode}</span>
          )}
          <span className="text-sm font-medium text-gray-700">{userInfo.name ?? "—"}</span>
        </div>
      )}

      {/* 今日の打刻カード */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
        <div className="flex items-start justify-between mb-4">
          <div>
            <p className="text-xs text-gray-400 mb-0.5">{dateLabel}</p>
            <h2 className="text-base font-semibold text-gray-900">今日の勤務</h2>
          </div>
          <span className={`text-sm font-medium ${clockStatus.color}`}>{clockStatus.label}</span>
        </div>

        <div className="grid grid-cols-3 gap-3 text-center mb-5">
          <div className="bg-gray-50 rounded-lg py-3">
            <p className="text-xs text-gray-400 mb-1">出勤</p>
            <p className="text-xl font-mono font-semibold text-gray-800">
              {formatTime(todayRecord?.clockIn)}
            </p>
          </div>
          <div className="bg-gray-50 rounded-lg py-3">
            <p className="text-xs text-gray-400 mb-1">退勤</p>
            <p className="text-xl font-mono font-semibold text-gray-800">
              {formatTime(todayRecord?.clockOut)}
            </p>
          </div>
          <div className="bg-gray-50 rounded-lg py-3">
            <p className="text-xs text-gray-400 mb-1">勤務時間</p>
            <p className="text-sm font-semibold text-gray-800">
              {formatMinutes(todayRecord?.workingMinutes ?? 0)}
            </p>
          </div>
        </div>

        <Link
          href="/clock"
          className="block w-full text-center bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 rounded-lg text-sm transition-colors"
        >
          打刻する
        </Link>
      </div>

      {/* 今月サマリー */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
        <h2 className="text-base font-semibold text-gray-900 mb-4">今月の実績</h2>
        <div className="grid grid-cols-2 gap-4">
          <div className="text-center bg-gray-50 rounded-lg py-4">
            <p className="text-xs text-gray-400 mb-1">出勤日数</p>
            <p className="text-3xl font-bold text-gray-800">
              {workDays}
              <span className="text-sm font-normal text-gray-400 ml-1">日</span>
            </p>
          </div>
          <div className="text-center bg-gray-50 rounded-lg py-4">
            <p className="text-xs text-gray-400 mb-1">合計勤務時間</p>
            <p className="text-xl font-bold text-gray-800">{formatMinutes(totalMinutes)}</p>
          </div>
        </div>
      </div>

      {/* インフォメーション欄 */}
      {(missedClockOut.length > 0 || rejectedRequests.length > 0 || openCount > 0 || pendingRequests.length > 0) && (
        <div className="space-y-2">
          {/* 退勤漏れ */}
          {missedClockOut.map((r) => {
            const jst = new Date(r.date.getTime() + 9 * 60 * 60 * 1000)
            const label = `${jst.getUTCMonth() + 1}/${jst.getUTCDate()}`
            return (
              <div key={r.date.toISOString()} className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
                <span className="text-red-500 mt-0.5 text-base leading-none">⚠</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-red-700">{label} 退勤打刻がありません</p>
                  <p className="text-xs text-red-400 mt-0.5">打刻漏れの可能性があります</p>
                </div>
                <Link href={`/requests/new?date=${jst.getUTCFullYear()}-${String(jst.getUTCMonth() + 1).padStart(2, "0")}-${String(jst.getUTCDate()).padStart(2, "0")}&mode=correction`}
                  className="text-xs text-red-600 hover:underline whitespace-nowrap self-center">
                  修正依頼
                </Link>
              </div>
            )
          })}

          {/* 却下された申請 */}
          {rejectedRequests.length > 0 && (
            <div className="flex items-start gap-3 bg-orange-50 border border-orange-200 rounded-xl px-4 py-3">
              <span className="text-orange-500 mt-0.5 text-base leading-none">!</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-orange-700">却下された申請が {rejectedRequests.length} 件あります</p>
                <p className="text-xs text-orange-400 mt-0.5">内容を確認してください</p>
              </div>
              <Link href="/requests" className="text-xs text-orange-600 hover:underline whitespace-nowrap self-center">
                申請一覧
              </Link>
            </div>
          )}

          {/* 未確認の勤怠記録 */}
          {openCount > 0 && (
            <div className="flex items-start gap-3 bg-yellow-50 border border-yellow-200 rounded-xl px-4 py-3">
              <span className="text-yellow-500 mt-0.5 text-base leading-none">📋</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-yellow-700">今月 {openCount} 日分の勤怠が未確認です</p>
                <p className="text-xs text-yellow-400 mt-0.5">勤怠記録を確認・提出してください</p>
              </div>
              <Link href={`/records?year=${periodYear}&month=${periodMonth}`} className="text-xs text-yellow-600 hover:underline whitespace-nowrap self-center">
                記録を確認
              </Link>
            </div>
          )}

          {/* 審査中の申請 */}
          {pendingRequests.length > 0 && (
            <div className="flex items-start gap-3 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3">
              <span className="text-blue-400 mt-0.5 text-base leading-none">🕐</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-blue-700">審査中の申請が {pendingRequests.length} 件あります</p>
              </div>
              <Link href="/requests" className="text-xs text-blue-500 hover:underline whitespace-nowrap self-center">
                申請一覧
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
