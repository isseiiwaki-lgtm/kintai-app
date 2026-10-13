// Paid-leave minutes in 2026-09-26..10-25: compare stored vs ⑤ON value for everyone (read-only),
// and with --apply fix 櫻田's records (set all switches, ⑤ON, recompute paidLeaveMinutes).
import { writeFileSync } from "node:fs"
import { prisma } from "@/lib/prisma"
import { paidLeaveMinutesFor, pickHalfDay, switchesFromSetting, switchesToColumns } from "@/lib/clock-pipeline"

const APPLY = process.argv.includes("--apply")
const FROM = new Date(Date.UTC(2026, 8, 26))
const TO = new Date(Date.UTC(2026, 9, 25))

async function main() {
  const setting = await prisma.setting.findUnique({ where: { id: 1 } })
  const recs = await prisma.attendanceRecord.findMany({
    where: { date: { gte: FROM, lte: TO }, paidLeaveMinutes: { gt: 0 } },
    include: { user: { select: { name: true, workStartTime: true, workEndTime: true, employmentType: true, breakMinutes: true } } },
    orderBy: [{ userId: "asc" }, { date: "asc" }],
  })
  const fixes: { id: string; data: Record<string, unknown>; before: unknown }[] = []
  for (const r of recs) {
    const reqs = await prisma.request.findMany({
      where: { userId: r.userId, targetDate: r.date, type: "LEAVE", status: "APPROVED" },
      select: { type: true, status: true, createdAt: true, detail: true },
    })
    const halfDay = pickHalfDay(reqs)
    const savedOn = { ...r, switchNewCalc: true }
    const on = paidLeaveMinutesFor({ user: r.user, setting, saved: savedOn, halfDay })
    const off = paidLeaveMinutesFor({ user: r.user, setting, saved: { ...r, switchNewCalc: false }, halfDay })
    const flag = r.paidLeaveMinutes !== on ? "  <-- differs from ⑤ON" : ""
    console.log(`${r.user.name}\t${r.date.toISOString().slice(5, 10)}\t${r.status}\thalf=${halfDay}\tsaved⑤=${r.switchNewCalc}\tstored=${r.paidLeaveMinutes}\toff=${off}\ton=${on}${flag}`)
    if (r.user.name?.startsWith("櫻田") && r.status !== "LOCKED") {
      const cols = r.switchRoundEarly == null ? { ...switchesToColumns(switchesFromSetting(setting)), switchRoundQuarter: false, switchCapOvertime: false } : {}
      const fixed = paidLeaveMinutesFor({ user: r.user, setting, saved: { ...r, ...cols, switchNewCalc: true }, halfDay })
      fixes.push({ id: r.id, before: r, data: { ...cols, switchNewCalc: true, paidLeaveMinutes: fixed } })
    }
    // 野﨑 10/21：リリース2前に承認された午後半休（打刻なし）。有給の分数だけ今の計算に合わせる
    if (r.user.name?.startsWith("野﨑") && r.date.toISOString().startsWith("2026-10-21") && r.status !== "LOCKED" && !r.clockIn && !r.clockOut) {
      fixes.push({ id: r.id, before: r, data: { paidLeaveMinutes: on } })
    }
  }
  console.log("planned fixes:", JSON.stringify(fixes.map((f) => ({ id: f.id, data: f.data }))))
  if (!APPLY || fixes.length === 0) return
  const file = `D:/dev/260325_勤怠アプリ/.resource/backup/sakurada_leave_before_newcalc_${Date.now()}.json`
  writeFileSync(file, JSON.stringify(fixes.map((f) => f.before), null, 2))
  console.log("backup:", file)
  await prisma.$transaction(fixes.map((f) => prisma.attendanceRecord.update({ where: { id: f.id }, data: f.data })))
  console.log("applied:", fixes.length)
}
main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
