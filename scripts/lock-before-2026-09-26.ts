// 9/25 以前の記録を、計算し直さずに今の数字のまま「締め済（LOCKED）」にする（2026-10-26 熊谷さん了承）。
// 画面の締めは承認済だけが対象で、承認すると新しいコードで計算し直されるため、スクリプトで状態だけ変える。
// 既定はドライラン（件数だけ）。--apply で書き込む（先に対象の id と元の状態を .resource/backup/ に JSON 退避）。
// 変更履歴（status の変更）は残さない（大量になるため。経緯は docs/STATUS.md）。
import { mkdirSync, writeFileSync } from "node:fs"
import { prisma } from "@/lib/prisma"

const BEFORE = new Date(Date.UTC(2026, 8, 26)) // この日より前（9/25 以前）
const APPLY = process.argv.includes("--apply")
const BACKUP_DIR = "D:/dev/260325_勤怠アプリ/.resource/backup"

async function main() {
  const where = { date: { lt: BEFORE }, status: { not: "LOCKED" as const } }
  const groups = await prisma.attendanceRecord.groupBy({ by: ["status"], where, _count: true })
  const range = await prisma.attendanceRecord.aggregate({ where, _min: { date: true }, _max: { date: true } })
  const already = await prisma.attendanceRecord.count({ where: { date: { lt: BEFORE }, status: "LOCKED" } })
  console.log(`対象（9/25 以前・締め済以外）：${groups.map((g) => `${g.status} ${g._count}件`).join("、")}`)
  console.log(`範囲：${range._min.date?.toISOString().slice(0, 10)} 〜 ${range._max.date?.toISOString().slice(0, 10)}／すでに締め済：${already}件`)
  if (!APPLY) { await prisma.$disconnect(); return }
  const rows = await prisma.attendanceRecord.findMany({ where, select: { id: true, status: true } })
  mkdirSync(BACKUP_DIR, { recursive: true })
  const file = `${BACKUP_DIR}/lock_before_20260926_${Date.now()}.json`
  writeFileSync(file, JSON.stringify(rows))
  const res = await prisma.attendanceRecord.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { status: "LOCKED" } })
  console.log(`締め済にした：${res.count}件（退避 ${file}）`)
  await prisma.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
