// READ-ONLY survey: compare stored overtime vs ⑤OFF recompute vs ⑤ON recompute for current closing period.
import { prisma } from "@/lib/prisma"
import { loadPipelineContext, buildRecordUpdate } from "@/lib/clock-pipeline-db"

const FROM = new Date(Date.UTC(2026, 8, 26))
const TO = new Date(Date.UTC(2026, 9, 25))
const hm = (m: number | null | undefined) => (m == null ? "-" : `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`)

async function main() {
  const recs = await prisma.attendanceRecord.findMany({
    where: { date: { gte: FROM, lte: TO }, clockIn: { not: null }, clockOut: { not: null } },
    orderBy: [{ userId: "asc" }, { date: "asc" }],
  })
  const setting = await prisma.setting.findUnique({ where: { id: 1 } })
  const byUser = new Map<string, typeof recs>()
  for (const r of recs) byUser.set(r.userId, [...(byUser.get(r.userId) ?? []), r])

  const users = await prisma.user.findMany({
    where: { id: { in: [...byUser.keys()] } },
    select: { id: true, name: true, employeeCode: true, department: true, employmentType: true, workStartTime: true, workEndTime: true },
  })
  const tot = { recs: 0, otOffDiff: 0, otOnDiff: 0, workOnDiff: 0, statuses: {} as Record<string, number>, savedNewCalc: {} as Record<string, number> }
  const rows: string[] = []
  const details: string[] = []
  for (const u of users.sort((a, b) => String(a.employeeCode).localeCompare(String(b.employeeCode)))) {
    const list = byUser.get(u.id)!
    const ctx = await loadPipelineContext(u.id, list)
    if (!ctx) continue
    let n = 0, offDiff = 0, onDiff = 0, workDiff = 0, sumCur = 0, sumOff = 0, sumOn = 0
    for (const rec of list) {
      tot.statuses[rec.status] = (tot.statuses[rec.status] ?? 0) + 1
      const k = String(rec.switchNewCalc)
      tot.savedNewCalc[k] = (tot.savedNewCalc[k] ?? 0) + 1
      const off = buildRecordUpdate(rec, ctx)
      const onRec = { ...rec, switchNewCalc: true }
      if (onRec.switchRoundEarly == null) {
        Object.assign(onRec, {
          switchRoundEarly: setting?.roundEarlyClockIn ?? false, switchRoundNear: setting?.roundNearClockTime ?? false,
          switchRoundQuarter: false, switchCapOvertime: false,
        })
      }
      const on = buildRecordUpdate(onRec, ctx)
      if (!off || !on) continue
      n++
      const cur = rec.overtimeMinutes ?? 0
      const o = (off.data.overtimeMinutes as number) ?? 0
      const p = (on.data.overtimeMinutes as number) ?? 0
      const wOff = off.data.workingMinutes as number
      const wOn = on.data.workingMinutes as number
      sumCur += cur; sumOff += o; sumOn += p
      if (cur !== o) offDiff++
      if (cur !== p) onDiff++
      if (wOff !== wOn) workDiff++
      if (cur !== o || cur !== p || wOff !== wOn) {
        const d = new Date(rec.date.getTime()).toISOString().slice(5, 10)
        details.push(`  ${u.name}\t${d}\t${rec.status}\twork cur=${hm(rec.workingMinutes)} off=${hm(wOff)} on=${hm(wOn)}\tOT cur=${hm(cur)} off=${hm(o)} on=${hm(p)}`)
      }
    }
    tot.recs += n; tot.otOffDiff += offDiff; tot.otOnDiff += onDiff; tot.workOnDiff += workDiff
    if (offDiff || onDiff || workDiff) {
      rows.push(`${u.employeeCode}\t${u.name}\t${u.department}\t${u.employmentType}\t${u.workStartTime}-${u.workEndTime}\trecs=${n}\tOT(cur→off)diff=${offDiff}\tOT(cur→on)diff=${onDiff}\twork(off≠on)=${workDiff}\tΣOT cur=${hm(sumCur)} off=${hm(sumOff)} on=${hm(sumOn)}`)
    }
  }
  console.log("setting newCalcMethod:", setting?.newCalcMethod, "users:", users.length)
  console.log("totals:", JSON.stringify(tot))
  console.log("--- users with any difference ---")
  console.log(rows.join("\n"))
  console.log("--- record details ---")
  console.log(details.join("\n"))
  await prisma.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
