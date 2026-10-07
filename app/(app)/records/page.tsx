import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import Link from "next/link"
import { calcReviewReasons, resolveEmployeeReview, getDisplayStatus, buildLateEarlyStatusMap, resolveDayMetrics, calcNightMinutes, calcScheduledMinutes, storedBreakMinutes } from "@/lib/attendance"
import { isClockInCapped, isClockOutCapped, resolveInputTime, resolveScheduleForDate, resolveSwitches } from "@/lib/clock-pipeline"
import { loadScheduleInputs } from "@/lib/clock-pipeline-db"
import { getClosingPeriod, getDefaultClosingMonth } from "@/lib/closing"

type SearchParams = Promise<{ year?: string; month?: string }>

function toJST(dt: Date): Date {
  return new Date(dt.getTime() + 9 * 60 * 60 * 1000)
}
function hhmm(dt: Date): number {
  const j = toJST(dt)
  return j.getUTCHours() * 60 + j.getUTCMinutes()
}
function parseHHMM(s: string | null | undefined): number | null {
  if (!s) return null
  const [h, m] = s.split(":").map(Number)
  return h * 60 + m
}

function formatTime(dt: Date | null | undefined): string {
  if (!dt) return "--:--"
  const jst = toJST(dt)
  return `${String(jst.getUTCHours()).padStart(2, "0")}:${String(jst.getUTCMinutes()).padStart(2, "0")}`
}
function fmtDur(min: number | null | undefined): string {
  if (!min || min <= 0) return "--"
  return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, "0")}`
}

/** 生打刻（丸め前）が記録時刻と異なる場合のみ小さく併記する */
// hide: ④（申請の時刻での打ち切り）で削った退勤には併記しない（一般社員の画面に④で削った内訳を出さない）
function RawTime({ recorded, raw, hide }: { recorded: Date | null | undefined; raw: Date | null | undefined; hide?: boolean }) {
  if (hide || !recorded || !raw) return null
  const label = formatTime(raw)
  if (label === formatTime(recorded)) return null
  return <span className="block text-[10px] text-gray-400 leading-tight">実 {label}</span>
}

const WEEKDAY = ["日", "月", "火", "水", "木", "金", "土"]

export default async function RecordsPage({ searchParams }: { searchParams: SearchParams }) {
  const session = await auth()
  const userId  = session!.user!.id!
  const params  = await searchParams

  const now        = toJST(new Date())
  const setting    = await prisma.setting.findUnique({ where: { id: 1 } })
  const closingDay = setting?.closingDay ?? 25

  const def   = getDefaultClosingMonth(closingDay)
  const year  = Number(params.year  ?? def.year)
  const month = Number(params.month ?? def.month)

  const { firstDay, lastDay } = getClosingPeriod(year, month, closingDay)

  const [records, user, correctionRequests, absenceRequests] = await Promise.all([
    prisma.attendanceRecord.findMany({
      where: { userId, date: { gte: firstDay, lte: lastDay } },
      orderBy: { date: "asc" },
    }),
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        workStartTime: true, workEndTime: true, employmentType: true, breakMinutes: true,
        workSun: true, workMon: true, workTue: true, workWed: true, workThu: true, workFri: true, workSat: true,
      },
    }),
    prisma.request.findMany({
      where: { userId, type: "CORRECTION", targetDate: { gte: firstDay, lte: lastDay } },
      select: { targetDate: true, status: true },
      orderBy: { createdAt: "desc" },
    }),
    // 遅刻・早退申請（PENDING/APPROVED の場合は修正依頼ボタンを抑制）
    prisma.request.findMany({
      where: { userId, type: "ABSENCE", targetDate: { gte: firstDay, lte: lastDay } },
      select: { targetDate: true, status: true, detail: true },
      orderBy: { createdAt: "desc" },
    }),
  ])

  // 日付文字列 → 打刻修正申請ステータス（最新のみ）
  const correctionMap = new Map<string, "PENDING" | "APPROVED" | "REJECTED">()
  for (const req of correctionRequests) {
    const jst = toJST(req.targetDate)
    const key = `${jst.getUTCFullYear()}-${jst.getUTCMonth() + 1}-${jst.getUTCDate()}`
    if (!correctionMap.has(key)) {
      correctionMap.set(key, req.status as "PENDING" | "APPROVED" | "REJECTED")
    }
  }

  // 日付文字列 → 遅刻申請・早退申請それぞれの最新状態（欠勤を除く）。要確認の理由ごとの打ち消しに使う
  const dateKey = (d: Date) => {
    const jst = toJST(d)
    return `${jst.getUTCFullYear()}-${jst.getUTCMonth() + 1}-${jst.getUTCDate()}`
  }
  const lateEarlyMap = buildLateEarlyStatusMap(absenceRequests, dateKey)

  const todayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))

  // 段0（休日・半休を反映した定時）の材料。保存値が無いときの遅刻・早退・残業の計算に使う
  const sched = await loadScheduleInputs([userId], firstDay, lastDay)
  // 所定勤務時間 ＝ 拘束時間 − 所定休憩（本人の所定休憩 → 会社設定の休憩ルール）
  const scheduledMins = calcScheduledMinutes(user?.workStartTime, user?.workEndTime, user?.employmentType, {
    userBreakMinutes: user?.breakMinutes, setting: sched.setting,
  })
  // 段1の入力（打刻修正で直した日はその時刻）を出すための出退勤の変更履歴。④の併記判定に使う
  const changeLogs = await prisma.attendanceChangeLog.findMany({
    where: { recordId: { in: records.map((r) => r.id) }, fieldName: { in: ["clockIn", "clockOut"] } },
    select: { recordId: true, fieldName: true, newValue: true, changedAt: true },
  })

  type Rec = typeof records[number]

  // 各レコードの表示用計算値を返す
  function buildRowData(rec: Rec) {
    // 段0：その日の定時（休日は定時なし・半休は前半/後半）。要確認の遅刻・早退の判定もこの定時で行う
    const dayRequests = sched.requestsOf(userId, rec.date)
    const schedule = user
      ? resolveScheduleForDate({
          date: rec.date, user, setting: sched.setting,
          isHoliday: sched.isHoliday(rec.date), isHolidayWork: rec.isHolidayWork, requests: dayRequests,
        })
      : null
    // 要確認の理由（遅刻・早退・退勤漏れ）を、遅刻早退申請の種別ごとに打ち消す。ホーム・修正依頼ボタンと同じ判定
    const review = rec.status === "OPEN"
      ? resolveEmployeeReview(
          calcReviewReasons({
            clockIn: rec.clockIn, clockOut: rec.clockOut, date: rec.date, today: todayUTC,
            workStartTime: schedule?.start ?? null, workEndTime: schedule?.end ?? null,
          }),
          lateEarlyMap.get(dateKey(rec.date)),
        )
      : { needsReview: false, pending: false }
    const needsReview = review.needsReview

    // 中抜け（分）
    const goOutMins = rec.goOutAt && rec.returnAt
      ? Math.round((rec.returnAt.getTime() - rec.goOutAt.getTime()) / 60000)
      : 0

    // 休憩（分）：保存済みの値から（Excel と同じ storedBreakMinutes）。保存した実働が無い日は 0
    const breakMins = storedBreakMinutes(rec) ?? 0

    // 残業・遅刻・早退: 保存値 or 記録時刻と定時の差から計算（CLOCK_PIPELINE 段4・段8。定時は段0の結果）
    const { overtimeMinutes: overtime, lateMinutes: late, earlyLeaveMinutes: earlyLeave } = resolveDayMetrics(rec, schedule)
    // ④で打ち切った出勤（段2：早出申請の開始で切った）・退勤（段6）には実打刻を併記しない（一般社員の画面に④の内訳を出さない）。
    // 管理者が確定した時刻は④を通していないので対象外。退勤側は originalClockOut の有無に関係なく判定する
    const switches = resolveSwitches(rec, sched.setting)
    // 判定の入力はパイプラインと同じ（実打刻、打刻修正の日は修正した時刻）。記録の日付も渡す（出勤なし・日またぎの退勤のみの行）
    const logsOf = (field: string) => changeLogs.filter((l) => l.recordId === rec.id && l.fieldName === field)
    const inputIn  = resolveInputTime({ date: rec.date, raw: rec.rawClockIn,  recorded: null, logs: logsOf("clockIn") }).time
    const inputOut = resolveInputTime({ date: rec.date, raw: rec.rawClockOut, recorded: null, logs: logsOf("clockOut") }).time
    const outCapped = !rec.adminClockOut && isClockOutCapped({
      date: rec.date, recordedClockIn: rec.clockIn, inputClockOut: inputOut, schedule, switches, requests: dayRequests,
    })
    const inCapped = !rec.adminClockIn && isClockInCapped({
      date: rec.date, inputClockIn: inputIn, schedule, switches, requests: dayRequests,
    })
    const night      = calcNightMinutes(rec.clockIn, rec.clockOut)

    return { needsReview, reviewPending: review.pending, goOutMins, breakMins, overtime, late, earlyLeave, night, outCapped, inCapped }
  }

  // 月次サマリー
  const workDays     = records.filter((r: Rec) => r.clockIn).length
  const totalMinutes = records.reduce((s: number, r: Rec) => s + (r.workingMinutes ?? 0), 0)
  const totalOvertime = records.reduce((s: number, r: Rec) => s + buildRowData(r).overtime, 0)

  const prevMonth = month === 1 ? 12 : month - 1
  const prevYear  = month === 1 ? year - 1 : year
  const nextMonth = month === 12 ? 1 : month + 1
  const nextYear  = month === 12 ? year + 1 : year
  const prevLink  = `/records?year=${prevYear}&month=${prevMonth}`
  const nextLink  = `/records?year=${nextYear}&month=${nextMonth}`
  const periodStart = `${firstDay.getUTCMonth() + 1}/${firstDay.getUTCDate()}`
  const periodEnd   = `${lastDay.getUTCMonth() + 1}/${lastDay.getUTCDate()}`

  const recordMap = new Map(
    records.map((r) => {
      const jst = toJST(r.date)
      return [`${jst.getUTCFullYear()}-${jst.getUTCMonth() + 1}-${jst.getUTCDate()}`, r]
    })
  )

  const days: { year: number; month: number; day: number }[] = []
  const cur = new Date(firstDay)
  while (cur <= lastDay) {
    const jst = toJST(cur)
    days.push({ year: jst.getUTCFullYear(), month: jst.getUTCMonth() + 1, day: jst.getUTCDate() })
    cur.setUTCDate(cur.getUTCDate() + 1)
  }

  return (
    <div className="p-4 lg:p-6">
      {/* 月ナビ */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-1">
          <Link href={prevLink} className="p-2 rounded-lg hover:bg-gray-100 text-gray-500">◀</Link>
          <div className="text-center">
            <h1 className="text-base font-semibold text-gray-900">{year}年{month}月</h1>
            <p className="text-[10px] text-gray-400">{periodStart}〜{periodEnd}</p>
          </div>
          <Link href={nextLink} className="p-2 rounded-lg hover:bg-gray-100 text-gray-500">▶</Link>
        </div>
      </div>

      {/* 月次サマリー */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 text-center">
          <p className="text-xs text-gray-400 mb-1">出勤日数</p>
          <p className="text-2xl font-bold text-gray-800">
            {workDays}<span className="text-sm font-normal text-gray-400 ml-1">日</span>
          </p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 text-center">
          <p className="text-xs text-gray-400 mb-1">合計勤務</p>
          <p className="text-xl font-bold text-gray-800">
            {Math.floor(totalMinutes / 60)}<span className="text-sm font-normal text-gray-400 ml-0.5">h</span>
            {String(totalMinutes % 60).padStart(2, "0")}<span className="text-xs font-normal text-gray-400 ml-0.5">m</span>
          </p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 text-center">
          <p className="text-xs text-gray-400 mb-1">残業合計</p>
          <p className="text-xl font-bold text-gray-800">
            {Math.floor(totalOvertime / 60)}<span className="text-sm font-normal text-gray-400 ml-0.5">h</span>
            {String(totalOvertime % 60).padStart(2, "0")}<span className="text-xs font-normal text-gray-400 ml-0.5">m</span>
          </p>
        </div>
      </div>

      {/* PC: テーブル */}
      <div className="hidden lg:block bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
        <table className="w-full text-sm min-w-[1080px]">
          <thead>
            <tr className="border-b border-gray-100 text-xs text-gray-400 bg-gray-50">
              <th className="text-left px-4 py-3 font-medium">日付</th>
              <th className="text-center px-2 py-3 font-medium">出勤</th>
              <th className="text-center px-2 py-3 font-medium">退勤</th>
              <th className="text-center px-2 py-3 font-medium">労働</th>
              <th className="text-center px-2 py-3 font-medium">休憩</th>
              <th className="text-center px-2 py-3 font-medium">中抜</th>
              <th className="text-center px-2 py-3 font-medium">所定</th>
              <th className="text-center px-2 py-3 font-medium">残業</th>
              <th className="text-center px-2 py-3 font-medium">深夜</th>
              <th className="text-center px-2 py-3 font-medium">遅刻</th>
              <th className="text-center px-2 py-3 font-medium">早退</th>
              <th className="text-center px-3 py-3 font-medium">状態</th>
              <th className="px-2 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {days.map(({ year: dy, month: dm, day: d }) => {
              const dt      = new Date(Date.UTC(dy, dm - 1, d))
              const dow     = dt.getUTCDay()
              const rec     = recordMap.get(`${dy}-${dm}-${d}`)
              const isWeekend = dow === 0 || dow === 6
              const dateStr = `${dy}-${String(dm).padStart(2, "0")}-${String(d).padStart(2, "0")}`
              const data    = rec ? buildRowData(rec) : null
              const needsReview = data?.needsReview ?? false
              const correctionStatus = correctionMap.get(`${dy}-${dm}-${d}`) ?? null
              // 修正依頼リンクの表示条件: 要確認（遅刻早退申請で打ち消されていない理由が残る）かつ CORRECTION申請中でない
              const showCorrection = needsReview && correctionStatus !== "PENDING"

              return (
                <tr
                  key={dateStr}
                  className={`border-b border-gray-50 last:border-0 ${isWeekend ? "bg-gray-50/60" : "hover:bg-gray-50"}`}
                >
                  <td className="px-4 py-2 text-xs">
                    <span className={dow === 0 ? "text-red-500" : dow === 6 ? "text-blue-500" : "text-gray-800"}>
                      {dm}/{d}（{WEEKDAY[dow]}）
                    </span>
                  </td>
                  <td className={`px-2 py-2 text-center font-mono text-xs ${needsReview && !correctionStatus ? "text-amber-600 font-semibold" : "text-gray-700"}`}>
                    {formatTime(rec?.clockIn)}
                    <RawTime recorded={rec?.clockIn} raw={rec?.rawClockIn} hide={data?.inCapped} />
                  </td>
                  <td className={`px-2 py-2 text-center font-mono text-xs ${needsReview && !rec?.clockOut && !correctionStatus ? "text-amber-600 font-semibold" : "text-gray-700"}`}>
                    {formatTime(rec?.clockOut)}
                    <RawTime recorded={rec?.clockOut} raw={rec?.rawClockOut} hide={data?.outCapped} />
                  </td>
                  <td className="px-2 py-2 text-center font-mono text-xs text-gray-700">{fmtDur(rec?.workingMinutes)}</td>
                  <td className="px-2 py-2 text-center font-mono text-xs text-gray-500">{data ? fmtDur(data.breakMins) : "--"}</td>
                  <td className="px-2 py-2 text-center font-mono text-xs text-gray-500">{data ? fmtDur(data.goOutMins) : "--"}</td>
                  <td className="px-2 py-2 text-center font-mono text-xs text-gray-500">{rec?.clockIn ? fmtDur(scheduledMins) : "--"}</td>
                  <td className="px-2 py-2 text-center font-mono text-xs text-blue-600">{data ? fmtDur(data.overtime) : "--"}</td>
                  <td className="px-2 py-2 text-center font-mono text-xs text-purple-600">{data ? fmtDur(data.night) : "--"}</td>
                  <td className="px-2 py-2 text-center font-mono text-xs text-amber-600">{data ? fmtDur(data.late) : "--"}</td>
                  <td className="px-2 py-2 text-center font-mono text-xs text-amber-600">{data ? fmtDur(data.earlyLeave) : "--"}</td>
                  <td className="px-3 py-2 text-center">
                    {rec?.isAbsent ? (
                      <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-700">欠勤</span>
                    ) : rec ? (
                      (() => {
                        const s = getDisplayStatus(rec.status, needsReview, correctionStatus, data?.reviewPending)
                        return <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${s.className}`}>{s.label}</span>
                      })()
                    ) : null}
                  </td>
                  <td className="px-2 py-2 text-center">
                    {showCorrection && (
                      <Link
                        href={`/requests/new?date=${dateStr}&mode=correction`}
                        className="inline-block text-xs px-2 py-0.5 rounded border border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100 whitespace-nowrap"
                      >
                        修正依頼
                      </Link>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* SP: カードリスト */}
      <div className="lg:hidden space-y-2">
        {days.map(({ year: dy, month: dm, day: d }) => {
          const dt      = new Date(Date.UTC(dy, dm - 1, d))
          const dow     = dt.getUTCDay()
          const rec     = recordMap.get(`${dy}-${dm}-${d}`)
          if (!rec?.clockIn && !rec?.isAbsent) return null
          const dateStr = `${dy}-${String(dm).padStart(2, "0")}-${String(d).padStart(2, "0")}`
          const data    = rec ? buildRowData(rec) : null
          const needsReview = data?.needsReview ?? false
          const correctionStatus = correctionMap.get(`${dy}-${dm}-${d}`) ?? null
          // 修正依頼ボタンの表示条件: 要確認（遅刻早退申請で打ち消されていない理由が残る）かつ CORRECTION申請中でない
          const showCorrection = needsReview && correctionStatus !== "PENDING"

          return (
            <div key={dateStr} className="bg-white rounded-xl border border-gray-200 shadow-sm px-4 py-3">
              <div className="flex items-center justify-between mb-2">
                <span className={`text-sm font-medium ${dow === 0 ? "text-red-500" : dow === 6 ? "text-blue-500" : "text-gray-800"}`}>
                  {dm}/{d}（{WEEKDAY[dow]}）
                </span>
                <div className="flex items-center gap-2">
                  {showCorrection && (
                    <Link
                      href={`/requests/new?date=${dateStr}&mode=correction`}
                      className="text-xs px-2 py-0.5 rounded border border-amber-300 bg-amber-50 text-amber-700 whitespace-nowrap"
                    >
                      修正依頼
                    </Link>
                  )}
                  {rec.isAbsent ? (
                    <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-700">欠勤</span>
                  ) : (
                    (() => {
                      const s = getDisplayStatus(rec.status, needsReview, correctionStatus, data?.reviewPending)
                      return <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${s.className}`}>{s.label}</span>
                    })()
                  )}
                </div>
              </div>
              {!rec.isAbsent && (
                <>
                  <div className="grid grid-cols-3 gap-2 text-center text-xs mb-1.5">
                    <div>
                      <p className="text-gray-400">出勤</p>
                      <p className={`font-mono ${needsReview && !correctionStatus ? "text-amber-600 font-semibold" : "text-gray-800"}`}>
                        {formatTime(rec.clockIn)}
                        <RawTime recorded={rec.clockIn} raw={rec.rawClockIn} hide={data?.inCapped} />
                      </p>
                    </div>
                    <div>
                      <p className="text-gray-400">退勤</p>
                      <p className={`font-mono ${needsReview && !rec.clockOut && !correctionStatus ? "text-amber-600 font-semibold" : "text-gray-800"}`}>
                        {formatTime(rec.clockOut)}
                        <RawTime recorded={rec.clockOut} raw={rec.rawClockOut} hide={data?.outCapped} />
                      </p>
                    </div>
                    <div>
                      <p className="text-gray-400">労働</p>
                      <p className="font-mono text-gray-800">{fmtDur(rec.workingMinutes)}</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-4 gap-2 text-center text-xs text-gray-500">
                    <div>
                      <p className="text-gray-400">所定</p>
                      <p className="font-mono">{fmtDur(scheduledMins)}</p>
                    </div>
                    <div>
                      <p className="text-gray-400">残業</p>
                      <p className="font-mono text-blue-600">{fmtDur(data?.overtime)}</p>
                    </div>
                    {(data?.late ?? 0) > 0 && (
                      <div>
                        <p className="text-gray-400">遅刻</p>
                        <p className="font-mono text-amber-600">{fmtDur(data?.late)}</p>
                      </div>
                    )}
                    {(data?.earlyLeave ?? 0) > 0 && (
                      <div>
                        <p className="text-gray-400">早退</p>
                        <p className="font-mono text-amber-600">{fmtDur(data?.earlyLeave)}</p>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )
        })}
        {records.filter((r) => r.clockIn).length === 0 && (
          <p className="text-center text-sm text-gray-400 py-8">打刻記録がありません</p>
        )}
      </div>
    </div>
  )
}
