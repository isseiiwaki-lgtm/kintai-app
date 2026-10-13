// One-off data fix: recompute 櫻田's records in the 2026-09-26..10-25 period with ⑤ (switchNewCalc) ON.
// Default is dry-run (no writes). Pass --apply to back up rows to JSON and write in one transaction.
import { writeFileSync, mkdirSync } from "node:fs"
import { prisma } from "@/lib/prisma"
import { loadPipelineContext, buildRecordUpdate } from "@/lib/clock-pipeline-db"

const APPLY = process.argv.includes("--apply")
const FROM = new Date(Date.UTC(2026, 8, 26))
const TO = new Date(Date.UTC(2026, 9, 25))
const BACKUP_DIR = "D:/dev/260325_勤怠アプリ/.resource/backup"
const hm = (m: unknown) => (typeof m !== "number" ? "-" : `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`)
const t = (d: unknown) => (d instanceof Date ? new Date(d.getTime() + 9 * 3600e3).toISOString().slice(11, 16) : "-")

async function main() {
  const users = await prisma.user.findMany({ where: { name: { startsWith: "櫻田" } }, select: { id: true, name: true } })
  if (users.length !== 1) throw new Error(`expected exactly 1 user, got ${users.length}`)
  const u = users[0]
  const recs = await prisma.attendanceRecord.findMany({
    where: { userId: u.id, date: { gte: FROM, lte: TO }, status: { not: "LOCKED" }, switchNewCalc: { not: true } },
    orderBy: { date: "asc" },
  })
  const ctx = await loadPipelineContext(u.id, recs)
  if (!ctx) throw new Error("no context")

  const plans = recs.map((rec) => {
    const built = buildRecordUpdate({ ...rec, switchNewCalc: true }, ctx)
    const data = { ...(built?.data ?? {}), switchNewCalc: true }
    return { rec, data }
  })
  console.log(`${u.name} records=${recs.length} mode=${APPLY ? "APPLY" : "DRY-RUN"}`)
  for (const { rec, data } of plans) {
    const d = rec.date.toISOString().slice(5, 10)
    console.log(
      `  ${d} ${rec.status} in ${t(rec.clockIn)}→${t(data.clockIn ?? rec.clockIn)} out ${t(rec.clockOut)}→${t(data.clockOut ?? rec.clockOut)}` +
      ` work ${hm(rec.workingMinutes)}→${hm(data.workingMinutes ?? rec.workingMinutes)}` +
      ` OT ${hm(rec.overtimeMinutes)}→${hm(data.overtimeMinutes ?? rec.overtimeMinutes)}` +
      ` late ${hm(rec.lateMinutes)}→${hm(data.lateMinutes ?? rec.lateMinutes)} early ${hm(rec.earlyLeaveMinutes)}→${hm(data.earlyLeaveMinutes ?? rec.earlyLeaveMinutes)}` +
      ` keys=[${Object.keys(data).join(",")}]`,
    )
  }
  if (!APPLY) return
  mkdirSync(BACKUP_DIR, { recursive: true })
  const file = `${BACKUP_DIR}/sakurada_records_before_newcalc_${Date.now()}.json`
  writeFileSync(file, JSON.stringify(recs, null, 2))
  console.log("backup:", file)
  await prisma.$transaction(plans.map(({ rec, data }) => prisma.attendanceRecord.update({ where: { id: rec.id }, data })))
  console.log("applied:", plans.length)
}
main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
