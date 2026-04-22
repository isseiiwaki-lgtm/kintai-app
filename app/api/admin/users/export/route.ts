import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

const ROLE_LABEL: Record<string, string> = {
  EMPLOYEE: "一般", APPROVER: "承認者", ADMIN: "管理者",
}

function esc(v: string) { return `"${v.replace(/"/g, '""')}"` }

export async function GET() {
  const session = await auth()
  if (session?.user?.role !== "ADMIN") {
    return new NextResponse("Forbidden", { status: 403 })
  }

  const users = await prisma.user.findMany({
    orderBy: [{ isActive: "desc" }, { employeeCode: "asc" }, { name: "asc" }],
    select: {
      employeeCode: true, name: true, email: true,
      role: true, employmentType: true, department: true,
      jobTitle: true, workStartTime: true, workEndTime: true,
      hireDate: true, salaryCode: true, isActive: true,
    },
  })

  const header = [
    "従業員コード", "氏名", "メールアドレス", "権限", "雇用形態",
    "部署", "役職名", "出勤時刻", "退勤時刻", "入社日", "給与個人コード", "在籍",
  ]

  const rows = users.map((u: typeof users[number]) => {
    const hireStr = u.hireDate
      ? (() => { const d = new Date(u.hireDate!.getTime() + 9 * 60 * 60 * 1000); return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,"0")}-${String(d.getUTCDate()).padStart(2,"0")}` })()
      : ""
    return [
      u.employeeCode ?? "",
      u.name         ?? "",
      u.email,
      ROLE_LABEL[u.role] ?? u.role,
      u.employmentType === "full" ? "社員" : u.employmentType === "part" ? "パート" : "雇用者",
      u.department   ?? "",
      u.jobTitle     ?? "",
      u.workStartTime ?? "",
      u.workEndTime   ?? "",
      hireStr,
      u.salaryCode   ?? "",
      u.isActive ? "在籍中" : "退職",
    ]
  })

  const csv = [header, ...rows].map((r) => r.map(esc).join(",")).join("\r\n")

  return new NextResponse("\uFEFF" + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": "attachment; filename*=UTF-8''users.csv",
    },
  })
}
