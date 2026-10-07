/**
 * GET /api/admin/anomaly-check?date=YYYY-MM-DD
 * 指定日（省略時は JST 昨日）の打刻異常を抽出して JSON で返す。
 *
 * 検知項目:
 *   1. missing_clock_out    — 出勤打刻あり・退勤打刻なし
 *   2. missing_break        — パートの休憩申請漏れ（所定休憩が設定されているのに休憩の記録が無い／実働6時間超で記録が無い。
 *                             画面の知らせと同じ条件 needsBreakRecordNotice。審査中の休憩申請がある日は除く）
 *   3. null_working_minutes — 退勤済みなのに workingMinutes 未計算
 *   4. missing_return       — 外出打刻あり・戻り打刻なし
 *
 * 認証（いずれか）:
 *   - ADMIN セッション（管理画面から）
 *   - Authorization: Bearer <ANOMALY_CHECK_TOKEN>（n8n 等の日次バッチ用。env 未設定なら無効）
 *
 * n8n 連携例: Schedule Trigger（毎朝）→ HTTP Request（本API・Bearer付与）→ anomalies が空でなければ通知
 */
import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { needsBreakRecordNotice } from "@/lib/attendance"

// 一覧・承認・Excel と同じ除外基準（経営者レベル=管理系部署）
const EXCLUDED_DEPARTMENTS = ["管理者", "管理職"]

type Anomaly = {
  type: "missing_clock_out" | "missing_break" | "null_working_minutes" | "missing_return"
  label: string
  userId: string
  name: string | null
  employeeCode: string | null
  department: string | null
  detail: string
}

/** JST 昨日の日付（UTC 0:00 の Date）を返す */
function yesterdayJST(): Date {
  const jst = new Date(Date.now() + 9 * 60 * 60 * 1000)
  return new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate() - 1))
}

export async function GET(req: NextRequest) {
  // 認証: ADMIN セッション or バッチ用トークン
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "")
  const tokenOk = !!process.env.ANOMALY_CHECK_TOKEN && bearer === process.env.ANOMALY_CHECK_TOKEN
  if (!tokenOk) {
    const session = await auth()
    if (session?.user?.role !== "ADMIN") {
      return new NextResponse("Forbidden", { status: 403 })
    }
  }

  // 対象日（?date=YYYY-MM-DD、省略時 JST 昨日）
  const dateParam = req.nextUrl.searchParams.get("date")
  let target: Date
  if (dateParam) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
      return new NextResponse("Bad Request: date は YYYY-MM-DD 形式", { status: 400 })
    }
    target = new Date(`${dateParam}T00:00:00Z`)
  } else {
    target = yesterdayJST()
  }

  const records = await prisma.attendanceRecord.findMany({
    where: {
      date: target,
      isAbsent: false,
      user: {
        isActive: true,
        department: { notIn: EXCLUDED_DEPARTMENTS },
      },
    },
    select: {
      userId: true,
      clockIn: true,
      clockOut: true,
      goOutAt: true,
      returnAt: true,
      breakStart: true,
      breakEnd: true,
      breakMinutes: true,
      workingMinutes: true,
      user: {
        select: { name: true, employeeCode: true, department: true, employmentType: true, breakMinutes: true },
      },
    },
  })
  // 審査中の休憩申請がある人（申請済みなので休憩の記録なしの知らせから外す）
  const pendingBreak = await prisma.request.findMany({
    where: { type: "BREAK", status: "PENDING", targetDate: target },
    select: { userId: true },
  })
  const pendingBreakUsers = new Set(pendingBreak.map((q) => q.userId))

  const anomalies: Anomaly[] = []
  for (const r of records) {
    const who = {
      userId: r.userId,
      name: r.user.name,
      employeeCode: r.user.employeeCode,
      department: r.user.department,
    }

    if (r.clockIn && !r.clockOut) {
      anomalies.push({
        ...who,
        type: "missing_clock_out",
        label: "退勤打刻なし",
        detail: "出勤打刻はあるが退勤打刻がない。workingMinutes 未確定",
      })
      continue // 退勤なしの場合、以降のチェックは意味がないためスキップ
    }

    if (r.goOutAt && !r.returnAt) {
      anomalies.push({
        ...who,
        type: "missing_return",
        label: "戻り打刻なし",
        detail: "外出打刻はあるが戻り打刻がない。外出控除が効かず workingMinutes 過大の恐れ",
      })
    }

    if (r.clockIn && r.clockOut) {
      // パートの休憩申請漏れ（所定休憩が設定されているのに記録が無い／実働6時間超で記録が無い）。休憩の記録は休憩ボタン・承認済みの休憩申請
      if (needsBreakRecordNotice({
        employmentType: r.user.employmentType, userBreakMinutes: r.user.breakMinutes,
        breakMinutes: r.breakMinutes, breakStart: r.breakStart, breakEnd: r.breakEnd,
        clockIn: r.clockIn, clockOut: r.clockOut, goOutAt: r.goOutAt, returnAt: r.returnAt,
        hasPendingBreakRequest: pendingBreakUsers.has(r.userId),
      })) {
        const goOutMs = r.goOutAt && r.returnAt ? r.returnAt.getTime() - r.goOutAt.getTime() : 0
        const rawMinutes = Math.floor((r.clockOut.getTime() - r.clockIn.getTime() - goOutMs) / 60000)
        anomalies.push({
          ...who,
          type: "missing_break",
          label: "休憩の記録なし（パート）",
          detail: `在席${rawMinutes}分${(r.user.breakMinutes ?? 0) > 0 ? `・所定休憩${r.user.breakMinutes}分` : ""}。休憩の記録（休憩ボタン・休憩申請）が無く、休憩を差し引いていない`,
        })
      }

      if (r.workingMinutes === null) {
        anomalies.push({
          ...who,
          type: "null_working_minutes",
          label: "勤務時間未計算",
          detail: "退勤済みだが workingMinutes が NULL。POST /api/admin/recalculate で補正可",
        })
      }
    }
  }

  return NextResponse.json({
    date: target.toISOString().slice(0, 10),
    checkedRecords: records.length,
    anomalyCount: anomalies.length,
    anomalies,
  })
}
