/**
 * GET /api/admin/export-xlsx
 * 個人別日別勤務報告書（Excel形式）
 * 1ファイル・人別シート構成で月次データを出力する。
 */
import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { calcLegalBreak } from "@/config/attendance.config"
import ExcelJS from "exceljs"

// JST変換
function toJST(dt: Date) {
  return new Date(dt.getTime() + 9 * 60 * 60 * 1000)
}

// HH:MM形式（打刻時刻表示用）
function fmtTime(dt: Date | null | undefined): string {
  if (!dt) return ""
  const j = toJST(dt)
  return `${String(j.getUTCHours()).padStart(2, "0")}:${String(j.getUTCMinutes()).padStart(2, "0")}`
}

// 分 → H:MM 形式（0以下は空欄）
function fmtMin(min: number | null | undefined): string {
  if (!min || min <= 0) return ""
  const h = Math.floor(min / 60)
  const m = min % 60
  return `${h}:${String(m).padStart(2, "0")}`
}

const STATUS_LABEL: Record<string, string> = {
  OPEN: "未承認", SUBMITTED: "提出済", APPROVED: "承認済", LOCKED: "締め済",
}

const HEADERS = [
  "日付", "承認", "勤務", "休日", "振替日",
  "勤務時間", "時間内", "休憩時間", "中抜け時間",
  "残業時間", "法定内残業時間", "法定外残業時間",
  "時間外（深夜）", "時間内（深夜）",
  "法定休日出勤\n（時間内）", "法定休日出勤\n（時間外）",
  "法定休日出勤\n（時間内（深夜））", "法定休日出勤\n（時間外(深夜)）",
  "休日出勤\n（時間内）", "休日出勤\n（時間内（深夜））", "休日出勤\n（時間外）", "休日出勤\n（時間外（深夜））",
  "有給休暇\n（日）", "有給休暇\n（時間）", "特別休暇\n（有給）", "特別休暇\n（無給）", "代休",
  "遅刻／早退", "欠勤", "出勤", "退勤", "変更出勤", "変更退勤",
]

// 列幅設定（HEADERS と同順）
const COL_WIDTHS = [
  8,  6,  4, 12,  6,  // 日付〜振替日
  8,  8,  8,  8,      // 勤務時間〜中抜け
  8, 10, 10,          // 残業〜法定外残業
  10, 10,             // 深夜2列
  14, 14, 16, 16,     // 法定休日4列
  14, 16, 14, 16,     // 休日出勤4列
  8,  8, 10, 10,  6,  // 有給日・有給時間・特別有給・特別無給・代休
  8,  6,  7,  7,  8,  8, // 遅刻早退〜変更退勤
]

export async function GET(req: NextRequest) {
  const session = await auth()
  const role = session?.user?.role
  if (role !== "ADMIN" && role !== "APPROVER") {
    return new NextResponse("Forbidden", { status: 403 })
  }

  const { searchParams } = req.nextUrl
  const now   = toJST(new Date())
  const year  = Number(searchParams.get("year")  ?? now.getUTCFullYear())
  const month = Number(searchParams.get("month") ?? now.getUTCMonth() + 1)

  const firstDay = new Date(Date.UTC(year, month - 1, 1))
  const lastDay  = new Date(Date.UTC(year, month, 0))

  // 休日マップ（dateKey → 休日名）
  const holidays = await prisma.holiday.findMany({
    where: { date: { gte: firstDay, lte: lastDay } },
  })
  const holidayMap = new Map(holidays.map(h => [h.date.toISOString().slice(0, 10), h.name]))

  const users = await prisma.user.findMany({
    where: {
      isActive: true,
      role: { notIn: ["ADMIN", "APPROVER"] },
      employmentType: { in: ["full", "part"] },
    },
    orderBy: { employeeCode: "asc" },
    select: {
      id: true, name: true, email: true,
      department: true, employeeCode: true, employmentType: true, salaryCode: true,
      attendanceRecords: {
        where: { date: { gte: firstDay, lte: lastDay } },
        orderBy: { date: "asc" },
      },
      requests: {
        where: {
          targetDate: { gte: firstDay, lte: lastDay },
          type: { in: ["LEAVE", "ABSENCE"] },
          status: "APPROVED",
        },
        select: { targetDate: true, type: true, detail: true },
      },
    },
  })

  // employeeCode が文字列型のため JS 側で数値昇順ソート（例: "1","2","10" → 1,2,10）
  users.sort((a, b) => {
    const na = parseInt(a.employeeCode ?? "", 10)
    const nb = parseInt(b.employeeCode ?? "", 10)
    if (!isNaN(na) && !isNaN(nb)) return na - nb
    return (a.employeeCode ?? "").localeCompare(b.employeeCode ?? "")
  })

  const workbook = new ExcelJS.Workbook()
  workbook.creator = "kintai"
  workbook.created = new Date()

  const empLabel = (t: string) =>
    t === "full" ? "社員" : t === "part" ? "パート" : t
  const periodLabel = `${year}年${month}月`
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()

  // ヘッダー行のスタイル定数
  const headerFill: ExcelJS.Fill = {
    type: "pattern", pattern: "solid", fgColor: { argb: "FFD0D8E4" },
  }
  const holidayFill: ExcelJS.Fill = {
    type: "pattern", pattern: "solid", fgColor: { argb: "FFFCE4E4" },
  }
  const thinBorder = (color = "FFCCCCCC"): Partial<ExcelJS.Borders> => ({
    top: { style: "thin", color: { argb: color } },
    bottom: { style: "thin", color: { argb: color } },
    left: { style: "thin", color: { argb: color } },
    right: { style: "thin", color: { argb: color } },
  })

  for (const user of users) {
    const sheetName = (user.name ?? user.email ?? user.id).slice(0, 31)
    const sheet = workbook.addWorksheet(sheetName)

    // --- 情報ヘッダー（2行）---
    sheet.mergeCells("A1:AG1")
    const titleCell = sheet.getCell("A1")
    titleCell.value = "個人別日別勤務報告書"
    titleCell.font = { bold: true, size: 13, name: "Arial" }
    titleCell.alignment = { horizontal: "center", vertical: "middle" }
    sheet.getRow(1).height = 22

    const infoRow = sheet.getRow(2)
    infoRow.height = 16
    const infoData: [string, string, string, string][] = [
      ["氏名", user.name ?? user.email ?? "", "部署", user.department ?? ""],
    ]
    const infoMore: [string, string, string, string][] = [
      ["従業員コード", user.employeeCode ?? "", "雇用形態", empLabel(user.employmentType)],
    ]
    // 1行目: 氏名・部署
    sheet.getCell("A2").value = "氏名"; sheet.getCell("A2").font = { bold: true }
    sheet.getCell("B2").value = user.name ?? user.email ?? ""
    sheet.mergeCells("B2:D2")
    sheet.getCell("E2").value = "部署"; sheet.getCell("E2").font = { bold: true }
    sheet.getCell("F2").value = user.department ?? ""
    sheet.mergeCells("F2:H2")
    sheet.getCell("I2").value = "従業員コード"; sheet.getCell("I2").font = { bold: true }
    sheet.getCell("J2").value = user.employeeCode ?? ""
    sheet.getCell("K2").value = "雇用形態"; sheet.getCell("K2").font = { bold: true }
    sheet.getCell("L2").value = empLabel(user.employmentType)
    sheet.getCell("M2").value = "対象期間"; sheet.getCell("M2").font = { bold: true }
    sheet.getCell("N2").value = periodLabel

    sheet.getRow(3).height = 4  // 空白行

    // --- 列ヘッダー（4行目）---
    const colHeaderRow = sheet.getRow(4)
    colHeaderRow.height = 36
    HEADERS.forEach((h, i) => {
      const cell = colHeaderRow.getCell(i + 1)
      cell.value = h
      cell.font = { bold: true, size: 9, name: "Arial" }
      cell.fill = headerFill
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true }
      cell.border = thinBorder("FF999999")
    })

    // 申請マップ（dateKey → { type, detail }）
    const leaveMap = new Map<string, { type: string; detail: unknown }>()
    for (const req of user.requests) {
      leaveMap.set(req.targetDate.toISOString().slice(0, 10), {
        type: req.type, detail: req.detail,
      })
    }
    // 打刻マップ
    const recordMap = new Map(
      user.attendanceRecords.map(r => [r.date.toISOString().slice(0, 10), r])
    )

    // --- データ行（5行目〜）---
    for (let d = 1; d <= daysInMonth; d++) {
      const dateKey = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`
      const rec = recordMap.get(dateKey)
      const holidayName = holidayMap.get(dateKey) ?? ""
      const leave = leaveMap.get(dateKey)
      const dayOfWeek = new Date(Date.UTC(year, month - 1, d)).getUTCDay()
      const isHoliday = !!holidayName || dayOfWeek === 0 || dayOfWeek === 6

      // 勤務時間計算
      let rawMinutes = 0
      let workingMinutes = 0
      let breakMinutes = 0
      let goOutMinutes = 0

      if (rec?.clockIn && rec?.clockOut) {
        const totalMs = rec.clockOut.getTime() - rec.clockIn.getTime()
        const goOutMs = rec.goOutAt && rec.returnAt
          ? rec.returnAt.getTime() - rec.goOutAt.getTime()
          : 0
        rawMinutes    = Math.floor((totalMs - goOutMs) / 60000)
        goOutMinutes  = Math.floor(goOutMs / 60000)

        if (user.employmentType === "part") {
          const breakMs = rec.breakStart && rec.breakEnd
            ? rec.breakEnd.getTime() - rec.breakStart.getTime()
            : 0
          breakMinutes    = Math.floor(breakMs / 60000)
          workingMinutes  = rec.workingMinutes ?? Math.max(0, rawMinutes - breakMinutes)
        } else {
          breakMinutes    = calcLegalBreak(rawMinutes)
          workingMinutes  = rec.workingMinutes ?? Math.max(0, rawMinutes - breakMinutes)
        }
      }

      const overtime   = rec?.overtimeMinutes ?? Math.max(0, workingMinutes - 480)
      const regular    = Math.max(0, workingMinutes - overtime)
      const lateEarly  = (rec?.lateMinutes ?? 0) + (rec?.earlyLeaveMinutes ?? 0)

      // 休暇申請の分類
      let paidLeaveDays = "", paidLeaveTime = ""
      let specialPaid = "", specialUnpaid = "", subLeave = ""
      if (leave?.type === "LEAVE") {
        const d = leave.detail as Record<string, unknown>
        if (d?.leaveType === "paid") {
          paidLeaveDays = d?.halfDay ? "0.5" : "1"
        } else if (d?.leaveType === "special") {
          if (d?.isPaid !== false) specialPaid = "1"
          else specialUnpaid = "1"
        } else if (d?.leaveType === "substitute") {
          subLeave = "1"
        }
      }

      const absent = rec?.isAbsent ? "1" : ""

      const rowData = [
        `${month}/${d}`,                        // 日付
        rec ? (STATUS_LABEL[rec.status] ?? rec.status) : "", // 承認
        rec?.clockIn ? "○" : "",                // 勤務
        holidayName,                             // 休日
        "",                                      // 振替日
        fmtMin(rawMinutes),                      // 勤務時間
        fmtMin(regular),                         // 時間内
        fmtMin(breakMinutes),                    // 休憩時間
        fmtMin(goOutMinutes),                    // 中抜け時間
        fmtMin(overtime),                        // 残業時間
        "",  "",                                 // 法定内/外残業（未実装）
        "",  "",                                 // 深夜2列（未実装）
        "",  "",  "",  "",                       // 法定休日4列（未実装）
        "",  "",  "",  "",                       // 休日出勤4列（未実装）
        paidLeaveDays, paidLeaveTime,            // 有給日・時間
        specialPaid, specialUnpaid,              // 特別休暇
        subLeave,                                // 代休
        fmtMin(lateEarly),                       // 遅刻／早退
        absent,                                  // 欠勤
        fmtTime(rec?.clockIn),                   // 出勤
        fmtTime(rec?.clockOut),                  // 退勤
        fmtTime(rec?.originalClockIn),           // 変更出勤
        fmtTime(rec?.originalClockOut),          // 変更退勤
      ]

      const row = sheet.addRow(rowData)
      row.height = 14

      row.eachCell((cell, colNum) => {
        cell.font = { size: 9, name: "Arial" }
        cell.border = thinBorder()
        // 数値・時間列は中央揃え
        if (colNum >= 6 && colNum <= 29) {
          cell.alignment = { horizontal: "center" }
        } else if (colNum === 1 || colNum === 2 || colNum === 3) {
          cell.alignment = { horizontal: "center" }
        }
        if (isHoliday) {
          cell.fill = holidayFill
        }
      })
    }

    // 列幅適用
    COL_WIDTHS.forEach((w, i) => {
      sheet.getColumn(i + 1).width = w
    })

    // 1〜3行目は列幅固定用ロック解除不要。印刷設定
    sheet.pageSetup = {
      paperSize: 9,           // A4
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
    }
  }

  const buffer = await workbook.xlsx.writeBuffer()
  const filename = `個人別日別勤務報告書_${year}_${String(month).padStart(2, "0")}.xlsx`

  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  })
}
