import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { resolveDayMetrics } from "@/lib/attendance"
import { resolveScheduleForDate } from "@/lib/clock-pipeline"
import { loadScheduleInputs } from "@/lib/clock-pipeline-db"

function toJST(dt: Date) {
  return new Date(dt.getTime() + 9 * 60 * 60 * 1000)
}
function fmtTime(dt: Date | null | undefined) {
  if (!dt) return ""
  const j = toJST(dt)
  return `${String(j.getUTCHours()).padStart(2, "0")}:${String(j.getUTCMinutes()).padStart(2, "0")}`
}
function fmtDate(dt: Date) {
  const j = toJST(dt)
  return `${j.getUTCFullYear()}/${String(j.getUTCMonth() + 1).padStart(2, "0")}/${String(j.getUTCDate()).padStart(2, "0")}`
}

const STATUS_LABEL: Record<string, string> = {
  OPEN: "未確認", SUBMITTED: "提出済", APPROVED: "承認済", LOCKED: "締め済",
}

export async function GET(req: NextRequest) {
  const session = await auth()
  const role    = session?.user?.role
  if (role !== "ADMIN" && role !== "APPROVER") {
    return new NextResponse("Forbidden", { status: 403 })
  }

  const { searchParams } = req.nextUrl
  const now   = toJST(new Date())
  const year  = Number(searchParams.get("year")  ?? now.getUTCFullYear())
  const month = Number(searchParams.get("month") ?? now.getUTCMonth() + 1)

  const firstDay = new Date(Date.UTC(year, month - 1, 1))
  const lastDay  = new Date(Date.UTC(year, month,     0))

  const users = await prisma.user.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
    select: {
      id: true, name: true, email: true, employmentType: true, department: true,
      workStartTime: true, workEndTime: true, breakMinutes: true,
      workSun: true, workMon: true, workTue: true, workWed: true, workThu: true, workFri: true, workSat: true,
      attendanceRecords: {
        where: { date: { gte: firstDay, lte: lastDay } },
        orderBy: { date: "asc" },
        select: {
          date: true, clockIn: true, clockOut: true,
          goOutAt: true, returnAt: true,
          workingMinutes: true, overtimeMinutes: true, note: true, status: true,
          isHolidayWork: true, lateMinutes: true, earlyLeaveMinutes: true,
        },
      },
    },
  })

  // 段0：その日の定時（休日は定時なし・半休は前半/後半）。保存値が無い日の残業の計算に使う
  const sched = await loadScheduleInputs(users.map((u) => u.id), firstDay, lastDay)

  const header = ["氏名", "部署", "雇用形態", "日付", "出勤時刻", "退勤時刻", "外出", "戻り", "勤務時間(分)", "残業時間(分)", "備考", "状態"]
  const rows: string[][] = []

  for (const u of users) {
    for (const r of u.attendanceRecords) {
      if (!r.clockIn) continue // 打刻なし日はスキップ
      // 残業 ＝ 早出（定時の始業 − 記録した出勤）＋ 残業（記録した退勤 − 定時の終業）。保存値があればそれ、無ければ同じ式で計算（CLOCK_PIPELINE 段8）
      const schedule = resolveScheduleForDate({
        date: r.date, user: u, setting: sched.setting,
        isHoliday: sched.isHoliday(r.date), isHolidayWork: r.isHolidayWork, requests: sched.requestsOf(u.id, r.date),
      })
      const overtime = resolveDayMetrics(r, schedule).overtimeMinutes
      rows.push([
        u.name ?? u.email ?? "",
        u.department ?? "",
        u.employmentType === "full" ? "社員" : u.employmentType === "part" ? "パート" : "雇用者",
        fmtDate(r.date),
        fmtTime(r.clockIn),
        fmtTime(r.clockOut),
        fmtTime(r.goOutAt),
        fmtTime(r.returnAt),
        String(r.workingMinutes ?? ""),
        overtime > 0 ? String(overtime) : "",  // 0分の場合は空欄
        r.note ?? "",
        STATUS_LABEL[r.status] ?? r.status,
      ])
    }
  }

  const escape = (v: string) => `"${v.replace(/"/g, '""')}"`
  const csv = [header, ...rows].map((row) => row.map(escape).join(",")).join("\r\n")

  // UTF-8 BOM 付き（Excel 文字化け対策）
  const bom  = "\uFEFF"
  const body = bom + csv

  const filename = `kintai_${year}_${String(month).padStart(2, "0")}.csv`
  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  })
}
