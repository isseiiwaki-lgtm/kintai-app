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

  const today = todayJST()
  const firstOfMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1))

  const [todayRecord, monthRecords] = await Promise.all([
    prisma.attendanceRecord.findUnique({
      where: { userId_date: { userId, date: today } },
    }),
    prisma.attendanceRecord.findMany({
      where: {
        userId,
        date: { gte: firstOfMonth },
        clockIn: { not: null },
      },
      select: { workingMinutes: true, clockIn: true },
    }),
  ])

  const workDays = monthRecords.length
  const totalMinutes = monthRecords.reduce((s, r) => s + (r.workingMinutes ?? 0), 0)

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
    </div>
  )
}
