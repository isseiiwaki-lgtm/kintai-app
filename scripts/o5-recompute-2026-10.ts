// O5：今月分（2026-09-26〜10-25）の記録を新しいコード（リリース3）で計算し直す。
// 既定はドライラン（書き込みなし）。人ごとの差分と、記録ごとの変化を出す。
//   npx tsx --tsconfig tsconfig.json scripts/o5-recompute-2026-10.ts                 … 全員の差分（ドライラン）
//   npx tsx --tsconfig tsconfig.json scripts/o5-recompute-2026-10.ts --user 櫻田     … 1人分の記録ごとの差分（ドライラン）
//   npx tsx --tsconfig tsconfig.json scripts/o5-recompute-2026-10.ts --user 櫻田 --apply … 1人分を書き込む（先に .resource/backup/ へ JSON 退避）
// 計算は本番と同じ buildRecordUpdate（記録に保存したスイッチのまま）。締め済（LOCKED）の記録は対象外。
import { mkdirSync, writeFileSync } from "node:fs"
import { prisma } from "@/lib/prisma"
import { buildRecordUpdate, loadPipelineContext } from "@/lib/clock-pipeline-db"

const FROM = new Date(Date.UTC(2026, 8, 26))
const TO = new Date(Date.UTC(2026, 9, 25))
const BACKUP_DIR = "D:/dev/260325_勤怠アプリ/.resource/backup"
const args = process.argv.slice(2)
const userArg = args.includes("--user") ? args[args.indexOf("--user") + 1] : null
const APPLY = args.includes("--apply")
const hm = (m: unknown) => (typeof m !== "number" ? "-" : `${m < 0 ? "-" : ""}${Math.floor(Math.abs(m) / 60)}:${String(Math.abs(m) % 60).padStart(2, "0")}`)
const t = (d: unknown) => (d instanceof Date ? new Date(d.getTime() + 9 * 3600e3).toISOString().slice(11, 16) : "-")
const FIELDS = ["clockIn", "clockOut", "workingMinutes", "overtimeMinutes", "lateMinutes", "earlyLeaveMinutes"] as const

async function main() {
  if (APPLY && !userArg) throw new Error("--apply は --user と一緒に使う（1人ずつ書き込む）")
  const locked = await prisma.attendanceRecord.count({ where: { date: { gte: FROM, lte: TO }, status: "LOCKED" } })
  console.log(`今月分の締め済（対象外）: ${locked} 件`)
  const users = await prisma.user.findMany({
    where: userArg ? { name: { startsWith: userArg } } : {},
    select: { id: true, name: true, employmentType: true },
    orderBy: { employeeCode: "asc" },
  })
  if (userArg && users.length !== 1) throw new Error(`--user ${userArg} に一致する人が ${users.length} 人`)
  for (const u of users) {
    const recs = await prisma.attendanceRecord.findMany({
      where: { userId: u.id, date: { gte: FROM, lte: TO }, status: { not: "LOCKED" } },
      orderBy: { date: "asc" },
    })
    const ctx = await loadPipelineContext(u.id, recs)
    if (!ctx) continue
    const plans: { rec: (typeof recs)[number]; data: Record<string, unknown> }[] = []
    let sumW = 0, sumW2 = 0, sumO = 0, sumO2 = 0
    const lines: string[] = []
    for (const rec of recs) {
      const built = buildRecordUpdate(rec, ctx)
      if (!built) continue
      const d = built.data as Record<string, unknown>
      sumW += rec.workingMinutes ?? 0; sumW2 += (d.workingMinutes as number | undefined) ?? rec.workingMinutes ?? 0
      sumO += rec.overtimeMinutes ?? 0; sumO2 += (d.overtimeMinutes as number | undefined) ?? rec.overtimeMinutes ?? 0
      const changed = FIELDS.filter((f) => f in d && String((rec as Record<string, unknown>)[f] instanceof Date ? ((rec as Record<string, unknown>)[f] as Date).getTime() : (rec as Record<string, unknown>)[f]) !== String(d[f] instanceof Date ? (d[f] as Date).getTime() : d[f]))
      if (changed.length === 0) continue
      plans.push({ rec, data: d })
      lines.push(`  ${rec.date.toISOString().slice(5, 10)} ${rec.status}`
        + ` 出勤 ${t(rec.clockIn)}→${t(d.clockIn ?? rec.clockIn)} 退勤 ${t(rec.clockOut)}→${t(d.clockOut ?? rec.clockOut)}`
        + ` 実働 ${hm(rec.workingMinutes)}→${hm(d.workingMinutes ?? rec.workingMinutes)} 残業 ${hm(rec.overtimeMinutes)}→${hm(d.overtimeMinutes ?? rec.overtimeMinutes)}`
        + ("lateMinutes" in d ? ` 遅刻 ${hm(rec.lateMinutes)}→${hm(d.lateMinutes)} 早退 ${hm(rec.earlyLeaveMinutes)}→${hm(d.earlyLeaveMinutes)}` : "")
        + ` 休憩記録=${rec.breakMinutes ?? "なし"}`)
    }
    if (plans.length === 0 && !userArg) continue
    console.log(`${u.name}（${u.employmentType}）変わる記録 ${plans.length} 件／実働合計 ${hm(sumW)}→${hm(sumW2)}（${hm(sumW2 - sumW)}）残業合計 ${hm(sumO)}→${hm(sumO2)}（${hm(sumO2 - sumO)}）`)
    if (userArg) for (const l of lines) console.log(l)
    if (APPLY && plans.length > 0) {
      mkdirSync(BACKUP_DIR, { recursive: true })
      const file = `${BACKUP_DIR}/o5_${u.id}_${Date.now()}.json`
      writeFileSync(file, JSON.stringify(plans.map((p) => p.rec), null, 2))
      await prisma.$transaction(plans.map((p) => prisma.attendanceRecord.update({ where: { id: p.rec.id }, data: p.data })))
      console.log(`  書き込み ${plans.length} 件（退避 ${file}）`)
    }
  }
  await prisma.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
