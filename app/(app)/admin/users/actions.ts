"use server"

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { redirect } from "next/navigation"

// ── CSV パーサー ──────────────────────────────────────────
function parseCsvLine(line: string): string[] {
  const fields: string[] = []
  let current = ""
  let inQuote = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuote) {
      if (ch === '"' && line[i + 1] === '"') { current += '"'; i++ }
      else if (ch === '"') { inQuote = false }
      else { current += ch }
    } else {
      if (ch === '"') { inQuote = true }
      else if (ch === ',') { fields.push(current); current = "" }
      else { current += ch }
    }
  }
  fields.push(current)
  return fields
}

function parseCsv(text: string): string[][] {
  return text
    .replace(/^\uFEFF/, "")   // BOM除去
    .replace(/\r\n/g, "\n").replace(/\r/g, "\n")
    .split("\n")
    .filter(Boolean)
    .map(parseCsvLine)
}

// ── 値マッピング ──────────────────────────────────────────
const ROLE_MAP: Record<string, string> = {
  一般: "EMPLOYEE", EMPLOYEE: "EMPLOYEE",
  承認者: "APPROVER", APPROVER: "APPROVER",
  管理者: "ADMIN",   ADMIN: "ADMIN",
}
const EMP_MAP: Record<string, string> = {
  社員: "full", full: "full",
  パート: "part", part: "part",
  雇用者: "employer", employer: "employer",
}
const ACTIVE_MAP: Record<string, boolean> = {
  在籍中: true, true: true,
  退職: false, false: false,
}

export type ImportError   = { row: number; field: string; message: string }
export type ImportResult  =
  | { success: true;  created: number; updated: number }
  | { success: false; errors: ImportError[] }

export async function actionImportUsers(formData: FormData): Promise<ImportResult> {
  const session = await auth()
  if (session?.user?.role !== "ADMIN") throw new Error("Forbidden")

  const file = formData.get("file") as File | null
  if (!file) return { success: false, errors: [{ row: 0, field: "-", message: "ファイルが選択されていません" }] }

  const text  = await file.text()
  const rows  = parseCsv(text)
  if (rows.length < 2) return { success: false, errors: [{ row: 0, field: "-", message: "データ行がありません" }] }

  // ヘッダー行を読んでカラムインデックスを動的に取得
  const header = rows[0].map((h) => h.trim())
  const col = (name: string) => header.indexOf(name)

  const iEmail = col("メールアドレス")
  const iName  = col("氏名")
  const iRole  = col("権限")
  const iEmp   = col("雇用形態")
  const iDept  = col("部署")
  const iCode  = col("従業員コード")
  const iJob   = col("役職名")
  const iStart = col("出勤時刻")
  const iEnd   = col("退勤時刻")
  const iHire  = col("入社日")
  const iSal   = col("給与個人コード")
  const iAct   = col("在籍")

  if (iEmail === -1) return { success: false, errors: [{ row: 1, field: "ヘッダー", message: "「メールアドレス」列が見つかりません" }] }

  // バリデーション
  const errors: ImportError[] = []
  const data: {
    email: string; name: string | null; role: string; employmentType: string
    department: string | null; employeeCode: string | null; jobTitle: string | null
    workStartTime: string | null; workEndTime: string | null
    hireDate: Date | null; salaryCode: string | null; isActive: boolean
  }[] = []

  for (let i = 1; i < rows.length; i++) {
    const r   = rows[i]
    const row = i + 1 // Excel 行番号

    const email = (r[iEmail] ?? "").trim().toLowerCase()
    if (!email || !email.includes("@")) {
      errors.push({ row, field: "メールアドレス", message: "無効なメールアドレス" })
    }

    const rawRole = iRole !== -1 ? (r[iRole] ?? "").trim() : "EMPLOYEE"
    const role    = ROLE_MAP[rawRole]
    if (!role) errors.push({ row, field: "権限", message: `無効な値: "${rawRole}"` })

    const rawEmp = iEmp !== -1 ? (r[iEmp] ?? "").trim() : "full"
    const emp    = EMP_MAP[rawEmp]
    if (!emp) errors.push({ row, field: "雇用形態", message: `無効な値: "${rawEmp}"` })

    const rawAct = iAct !== -1 ? (r[iAct] ?? "").trim() : "在籍中"
    const isActive = ACTIVE_MAP[rawAct]
    if (isActive === undefined) errors.push({ row, field: "在籍", message: `無効な値: "${rawAct}"` })

    const startTime = iStart !== -1 ? (r[iStart] ?? "").trim() : ""
    const endTime   = iEnd   !== -1 ? (r[iEnd]   ?? "").trim() : ""
    if (startTime && !/^\d{2}:\d{2}$/.test(startTime)) errors.push({ row, field: "出勤時刻", message: "HH:MM形式で入力してください" })
    if (endTime   && !/^\d{2}:\d{2}$/.test(endTime))   errors.push({ row, field: "退勤時刻", message: "HH:MM形式で入力してください" })

    const hireDateStr = iHire !== -1 ? (r[iHire] ?? "").trim() : ""
    let hireDate: Date | null = null
    if (hireDateStr) {
      hireDate = new Date(hireDateStr)
      if (isNaN(hireDate.getTime())) errors.push({ row, field: "入社日", message: "日付として解釈できません" })
    }

    if (errors.length === 0 || !errors.some((e) => e.row === row)) {
      data.push({
        email,
        name:           iName !== -1 ? (r[iName] ?? "").trim() || null : null,
        role:           role!,
        employmentType: emp!,
        department:     iDept !== -1 ? (r[iDept] ?? "").trim() || null : null,
        employeeCode:   iCode !== -1 ? (r[iCode] ?? "").trim() || null : null,
        jobTitle:       iJob  !== -1 ? (r[iJob]  ?? "").trim() || null : null,
        workStartTime:  startTime || null,
        workEndTime:    endTime   || null,
        hireDate,
        salaryCode:     iSal  !== -1 ? (r[iSal]  ?? "").trim() || null : null,
        isActive:       isActive ?? true,
      })
    }
  }

  if (errors.length > 0) return { success: false, errors }

  // DB upsert（トランザクション）
  let created = 0; let updated = 0
  const existing = await prisma.user.findMany({
    where:  { email: { in: data.map((d) => d.email) } },
    select: { email: true },
  })
  const existingEmails = new Set(existing.map((u) => u.email))

  // employeeCode の UNIQUE 競合を事前解消（インポート対象外のユーザーに同コードがある場合クリア）
  const codes = data.map((d) => d.employeeCode).filter(Boolean) as string[]
  if (codes.length > 0) {
    await prisma.user.updateMany({
      where: {
        employeeCode: { in: codes },
        email: { notIn: data.map((d) => d.email) },
      },
      data: { employeeCode: null },
    })
  }

  await prisma.$transaction(
    data.map((d) => {
      if (existingEmails.has(d.email)) { updated++ } else { created++ }
      return prisma.user.upsert({
        where:  { email: d.email },
        update: { name: d.name, role: d.role as "EMPLOYEE"|"APPROVER"|"ADMIN", employmentType: d.employmentType, department: d.department, employeeCode: d.employeeCode, jobTitle: d.jobTitle, workStartTime: d.workStartTime, workEndTime: d.workEndTime, hireDate: d.hireDate, salaryCode: d.salaryCode, isActive: d.isActive },
        create: { email: d.email, name: d.name, role: d.role as "EMPLOYEE"|"APPROVER"|"ADMIN", employmentType: d.employmentType, department: d.department, employeeCode: d.employeeCode, jobTitle: d.jobTitle, workStartTime: d.workStartTime, workEndTime: d.workEndTime, hireDate: d.hireDate, salaryCode: d.salaryCode, isActive: d.isActive },
      })
    })
  )

  return { success: true, created, updated }
}

async function checkAdmin() {
  const session = await auth()
  if (session?.user?.role !== "ADMIN") throw new Error("Forbidden")
}

export async function actionUpdateUser(formData: FormData) {
  await checkAdmin()

  const id             = formData.get("id")             as string
  const name           = formData.get("name")           as string
  const employeeCode   = formData.get("employeeCode")   as string
  const jobTitle       = formData.get("jobTitle")       as string
  const hireDateStr    = formData.get("hireDate")       as string
  const salaryCode     = formData.get("salaryCode")     as string
  const role           = formData.get("role")           as string
  const employmentType = formData.get("employmentType") as string
  const department     = formData.get("department")     as string
  const workStartTime  = formData.get("workStartTime")  as string
  const workEndTime    = formData.get("workEndTime")    as string
  const isActive       = formData.get("isActive") === "true"

  await prisma.user.update({
    where: { id },
    data: {
      name:           name           || null,
      employeeCode:   employeeCode   || null,
      jobTitle:       jobTitle       || null,
      hireDate:       hireDateStr    ? new Date(hireDateStr) : null,
      salaryCode:     salaryCode     || null,
      role:           role as "EMPLOYEE" | "APPROVER" | "ADMIN",
      employmentType,
      department:     department     || null,
      workStartTime:  workStartTime  || null,
      workEndTime:    workEndTime    || null,
      isActive,
    },
  })

  redirect("/admin/users")
}

export async function actionDeleteUser(id: string): Promise<{ error: string } | void> {
  await checkAdmin()

  // 関連レコード確認
  const [attendanceCount, requestCount, approvalCount] = await Promise.all([
    prisma.attendanceRecord.count({ where: { userId: id } }),
    prisma.request.count({ where: { userId: id } }),
    prisma.approval.count({ where: { approverId: id } }),
  ])

  if (attendanceCount > 0 || requestCount > 0 || approvalCount > 0) {
    return {
      error: `削除できません（打刻${attendanceCount}件・申請${requestCount}件・承認ログ${approvalCount}件が存在します）`,
    }
  }

  // LeaveBalance も削除（FK未定義だが同userId。テーブル未作成の場合はスキップ）
  await prisma.leaveBalance.deleteMany({ where: { userId: id } }).catch(() => {})
  await prisma.user.delete({ where: { id } })

  redirect("/admin/users")
}

export async function actionCreateUser(formData: FormData): Promise<{ error: string } | void> {
  await checkAdmin()

  const email          = (formData.get("email")          as string).trim().toLowerCase()
  const name           = (formData.get("name")           as string).trim()
  const role           = formData.get("role")            as string
  const employmentType = formData.get("employmentType")  as string
  const department     = formData.get("department")      as string
  const workStartTime  = formData.get("workStartTime")   as string
  const workEndTime    = formData.get("workEndTime")     as string

  if (!email) return { error: "メールアドレスは必須です" }

  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) {
    // すでに存在する場合は編集ページへ
    redirect(`/admin/users/${existing.id}/edit`)
  }

  await prisma.user.create({
    data: {
      email,                          // 会社メール（リンク前は email = companyEmail）
      companyEmail: email,            // 永続保存
      name:           name           || null,
      role:           role as "EMPLOYEE" | "APPROVER" | "ADMIN",
      employmentType: employmentType || "full",
      department:     department     || null,
      workStartTime:  workStartTime  || null,
      workEndTime:    workEndTime    || null,
    },
  })

  redirect("/admin/users")
}
