/**
 * POST /api/admin/recalculate
 * 過去レコードを打刻パイプライン（docs/CLOCK_PIPELINE.md・lib/clock-pipeline-db.ts）で一括して計算し直す。
 * 独自の計算は持たない。ユーザーごとに recomputeRecords を呼び、記録時刻・勤務時間・残業
 * （承認済みの日は遅刻・早退も）を、打刻・承認と同じ計算で最初から出し直して保存する。
 *
 * 対象: 退勤のある記録。締め済み（LOCKED）の日は計算し直さない。
 * 入力は実打刻・承認済みの申請・記録に保存したスイッチ状態（保存値が無い記録は ③④OFF・①②は現在値）。
 */
import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { recomputeRecords } from "@/lib/clock-pipeline-db"

export async function POST() {
  const session = await auth()
  if (session?.user?.role !== "ADMIN") {
    return new NextResponse("Forbidden", { status: 403 })
  }

  const records = await prisma.attendanceRecord.findMany({
    where: { clockOut: { not: null }, status: { not: "LOCKED" } },
  })

  const byUser = new Map<string, typeof records>()
  for (const r of records) byUser.set(r.userId, [...(byUser.get(r.userId) ?? []), r])

  let updated = 0
  const errorUserIds: string[] = []
  for (const [userId, recs] of byUser) {
    try {
      await recomputeRecords(userId, recs)
      updated += recs.length
    } catch {
      errorUserIds.push(userId)
    }
  }

  return NextResponse.json({
    total: records.length,
    updated,
    errors: errorUserIds.length,
    ...(errorUserIds.length > 0 ? { errorUserIds } : {}),
  })
}
