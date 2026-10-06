import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { ClockButtons } from "@/components/clock-buttons"
import { DebugClockPanel } from "@/components/debug-clock-panel"
import { OvertimeNotice } from "@/components/overtime-notice"
import { shouldShowOvertimeNotice } from "@/lib/clock-out-cap"

function todayJST(): Date {
  const now = new Date()
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000)
  return new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate()))
}

export default async function ClockPage() {
  const session = await auth()
  const userId = session!.user!.id!

  const [record, user, showNotice] = await Promise.all([
    prisma.attendanceRecord.findUnique({
      where: { userId_date: { userId, date: todayJST() } },
      select: {
        clockIn: true, clockOut: true,
        goOutAt: true, returnAt: true,
        breakStart: true, breakEnd: true,
        note: true,
      },
    }),
    prisma.user.findUnique({
      where: { id: userId },
      select: { employmentType: true },
    }),
    // 退勤直後の注意表示（当日だけ。残業申請が無いのに定時を15分以上過ぎた日）
    shouldShowOvertimeNotice(userId, todayJST()),
  ])

  const empType = user?.employmentType ?? "full"
  const isDev   = process.env.NODE_ENV === "development"

  return (
    <div className="p-4 lg:p-8 max-w-2xl mx-auto">
      <h1 className="text-lg font-semibold text-gray-900 mb-4">打刻</h1>
      {showNotice && <OvertimeNotice />}
      {isDev ? (
        <DebugClockPanel realRecord={record} realEmpType={empType} />
      ) : (
        <ClockButtons record={record} employmentType={empType} />
      )}
    </div>
  )
}
