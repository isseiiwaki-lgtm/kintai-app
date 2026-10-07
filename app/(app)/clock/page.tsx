import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { ClockButtons } from "@/components/clock-buttons"
import { DebugClockPanel } from "@/components/debug-clock-panel"
import { DayNoticeList } from "@/components/day-notices"
import { loadDayNotices } from "@/lib/clock-out-cap"

function todayJST(): Date {
  const now = new Date()
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000)
  return new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate()))
}

export default async function ClockPage() {
  const session = await auth()
  const userId = session!.user!.id!

  const [record, user, notices] = await Promise.all([
    prisma.attendanceRecord.findUnique({
      where: { userId_date: { userId, date: todayJST() } },
      select: {
        clockIn: true, clockOut: true,
        goOutAt: true, returnAt: true,
        breakMinutes: true,
        note: true,
      },
    }),
    prisma.user.findUnique({
      where: { id: userId },
      select: { employmentType: true },
    }),
    // 当日の注意表示（残業申請なし・パートの休憩申請漏れ・休日出勤申請なし。当日だけ）
    loadDayNotices(userId, todayJST()),
  ])

  const empType = user?.employmentType ?? "full"
  const isDev   = process.env.NODE_ENV === "development"

  return (
    <div className="p-4 lg:p-8 max-w-2xl mx-auto">
      <h1 className="text-lg font-semibold text-gray-900 mb-4">打刻</h1>
      <DayNoticeList notices={notices} />
      {isDev ? (
        <DebugClockPanel realRecord={record} realEmpType={empType} />
      ) : (
        <ClockButtons record={record} employmentType={empType} />
      )}
    </div>
  )
}
