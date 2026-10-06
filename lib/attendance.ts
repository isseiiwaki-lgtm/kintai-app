/**
 * 勤怠計算ユーティリティ
 * 承認・締め時に AttendanceRecord へ保存する集計値を計算する
 */

import { calcLegalBreak } from "@/config/attendance.config"

function toJST(dt: Date): Date {
  return new Date(dt.getTime() + 9 * 60 * 60 * 1000)
}

/** HH:MM 文字列 → その日の分数 */
function hhmm(dt: Date): number {
  const j = toJST(dt)
  return j.getUTCHours() * 60 + j.getUTCMinutes()
}

function parseHHMM(s: string | null | undefined): number | null {
  if (!s) return null
  const [h, m] = s.split(":").map(Number)
  return h * 60 + m
}

/** 本人所定勤務時間（分）。workStartTime/workEndTime 未設定時は雇用形態でfallback */
export function calcScheduledMinutes(
  workStartTime: string | null | undefined,
  workEndTime:   string | null | undefined,
  employmentType: string | null | undefined,
): number {
  const startMins = parseHHMM(workStartTime)
  const endMins   = parseHHMM(workEndTime)
  if (startMins !== null && endMins !== null && endMins > startMins) {
    const raw = endMins - startMins
    return raw - calcLegalBreak(raw)
  }
  return employmentType === "full" ? 480 : 0
}

/**
 * 実働時間（分）を計算する。外出時間を除いた在席時間から休憩を控除する。
 * part は実際の休憩打刻を、それ以外は法定休憩を控除する（既存の打刻・承認処理と同じ規則）。
 * 出勤または退勤が欠けている場合は null（未確定）。
 */
export function calcWorkingMinutes({
  clockIn,
  clockOut,
  goOutAt,
  returnAt,
  breakStart,
  breakEnd,
  employmentType,
}: {
  clockIn:    Date | null
  clockOut:   Date | null
  goOutAt:    Date | null
  returnAt:   Date | null
  breakStart: Date | null
  breakEnd:   Date | null
  employmentType: string | null | undefined
}): number | null {
  if (!clockIn || !clockOut) return null

  const totalMs = clockOut.getTime() - clockIn.getTime()
  const goOutMs = goOutAt && returnAt ? returnAt.getTime() - goOutAt.getTime() : 0
  const rawMinutes = Math.floor((totalMs - goOutMs) / 60000)

  if (employmentType === "part") {
    const breakMs = breakStart && breakEnd ? breakEnd.getTime() - breakStart.getTime() : 0
    return Math.max(0, rawMinutes - Math.floor(breakMs / 60000))
  }
  return Math.max(0, rawMinutes - calcLegalBreak(rawMinutes))
}

type CalcInput = {
  clockIn:        Date | null
  clockOut:       Date | null
  workingMinutes: number | null  // 既存の勤務時間（break 控除済み）
  workStartTime:  string | null  // "08:30"
  workEndTime:    string | null  // "17:30"
  scheduledMinutes: number       // 所定勤務時間（例: 480）
}

export type AttendanceMetrics = {
  lateMinutes:       number
  earlyLeaveMinutes: number
  overtimeMinutes:   number
}

export function calcMetrics({
  clockIn,
  clockOut,
  workingMinutes,
  workStartTime,
  workEndTime,
  scheduledMinutes,
}: CalcInput): AttendanceMetrics {
  let lateMinutes       = 0
  let earlyLeaveMinutes = 0
  let overtimeMinutes   = 0

  const startMins = parseHHMM(workStartTime)
  const endMins   = parseHHMM(workEndTime)

  if (clockIn && startMins !== null) {
    lateMinutes = Math.max(0, hhmm(clockIn) - startMins)
  }

  if (clockOut && endMins !== null) {
    const outMins = hhmm(clockOut)
    earlyLeaveMinutes = Math.max(0, endMins - outMins)
    // 退勤が所定終了を超えていれば早退ではなく残業
    if (outMins >= endMins) earlyLeaveMinutes = 0
  }

  // 残業: 実労働時間 - 所定時間
  if (workingMinutes !== null && scheduledMinutes > 0) {
    overtimeMinutes = Math.max(0, workingMinutes - scheduledMinutes)
  }

  return { lateMinutes, earlyLeaveMinutes, overtimeMinutes }
}

/**
 * 深夜労働時間（分）を計算する（22:00〜翌5:00）
 */
export function calcNightMinutes(clockIn: Date | null, clockOut: Date | null): number {
  if (!clockIn || !clockOut) return 0

  const inMins  = hhmm(clockIn)
  let outMins   = hhmm(clockOut)
  if (outMins < inMins) outMins += 24 * 60  // 日をまたぐ場合

  const NIGHT_START = 22 * 60  // 1320
  const NIGHT_END   = 29 * 60  // 1740（翌5:00 = 24+5 = 29時）
  const EARLY_END   =  5 * 60  //  300

  let night = 0

  // 22:00 以降の深夜部分
  if (outMins > NIGHT_START) {
    const s = Math.max(inMins, NIGHT_START)
    const e = Math.min(outMins, NIGHT_END)
    if (e > s) night += e - s
  }

  // 深夜残業で翌 5:00 まで続く部分（上の式で NIGHT_END=29:00 でキャップ済み）
  // さらに翌朝 5:00 前出勤の早朝分
  if (inMins < EARLY_END) {
    const e = Math.min(outMins, EARLY_END)
    if (e > inMins) night += e - inMins
  }

  return Math.max(0, night)
}

/** 要確認の理由（遅刻・早退・退勤漏れ）。calcNeedsReview の判定条件を理由ごとに分解したもの */
export type ReviewReasons = { late: boolean; early: boolean; missingOut: boolean }

/**
 * 「要確認」の理由を返す（条件は calcNeedsReview と同一）
 * - late: 遅刻（clockIn > workStartTime + 1分）。今日も対象
 * - missingOut: 昨日以前で退勤なし
 * - early: 昨日以前で早退（clockOut < workEndTime - 1分）
 * 今日以降の退勤未打刻・早退は問題なし。打刻なしは理由なし。
 */
export function calcReviewReasons({
  clockIn,
  clockOut,
  date,
  today,
  workStartTime,
  workEndTime,
}: {
  clockIn:       Date | null
  clockOut:      Date | null
  date:          Date          // レコードの日付（UTC 00:00）
  today:         Date          // 今日の日付（UTC 00:00）
  workStartTime: string | null // "09:00"
  workEndTime:   string | null // "17:30"
}): ReviewReasons {
  const reasons: ReviewReasons = { late: false, early: false, missingOut: false }
  if (!clockIn) return reasons

  // 遅刻: 今日も含めて判定
  if (workStartTime) {
    const startMins = parseHHMM(workStartTime)
    if (startMins !== null && hhmm(clockIn) > startMins + 1) reasons.late = true
  }

  // 今日以降: 退勤未打刻・早退は問題なし
  if (date >= today) return reasons

  // 昨日以前で退勤打刻なし
  if (!clockOut) {
    reasons.missingOut = true
    return reasons
  }

  // 早退: clockOut < workEndTime - 1分
  if (workEndTime) {
    const endMins = parseHHMM(workEndTime)
    if (endMins !== null && hhmm(clockOut) < endMins - 1) reasons.early = true
  }

  return reasons
}

/**
 * 「要確認」判定（理由のどれか1つでもあれば true）
 * 管理者向け画面（承認詳細・勤務状況一覧）で使う。申請状態は考慮しない。
 */
export function calcNeedsReview(args: Parameters<typeof calcReviewReasons>[0]): boolean {
  const r = calcReviewReasons(args)
  return r.late || r.early || r.missingOut
}

type RequestStatus = "PENDING" | "APPROVED" | "REJECTED"
/** 遅刻申請・早退申請それぞれの最新状態 */
export type LateEarlyTypeStatus = { late?: RequestStatus; early?: RequestStatus }

/**
 * 従業員向けの要確認判定（理由ごとに遅刻早退申請で打ち消す）
 * - 遅刻申請の承認は遅刻だけ、早退申請の承認は早退だけを打ち消す。退勤漏れは申請では消えない
 * - 審査中の申請は、その理由について「申請中」扱い（pending）
 * - 却下・申請なしは理由が残る（needsReview）
 * ホームの件数・/records のステータスと修正依頼ボタンはすべてこの結果を使う
 */
export function resolveEmployeeReview(
  reasons: ReviewReasons,
  typeStatus?: LateEarlyTypeStatus | null,
): { needsReview: boolean; pending: boolean } {
  let needsReview = reasons.missingOut
  let pending = false
  const judge = (on: boolean, st?: RequestStatus) => {
    if (!on || st === "APPROVED") return
    if (st === "PENDING") pending = true
    else needsReview = true
  }
  judge(reasons.late, typeStatus?.late)
  judge(reasons.early, typeStatus?.early)
  return { needsReview, pending }
}

/** HH:MM 文字列を当日の UTC Date に変換（打刻丸め用） */
export function hhmmToUTCDate(hhmm: string, todayUTC: Date): Date {
  const [h, m] = hhmm.split(":").map(Number)
  return new Date(todayUTC.getTime() + (h * 60 + m) * 60 * 1000)
}

/**
 * 打刻丸め: 設定に従い clockIn/clockOut を補正して返す
 * - roundEarly: 定時前打刻 → 定時扱い（出勤のみ）
 * - roundNear:  定時を超えて働いた側の14分以内 → 定時きっかり（方向限定）
 *   - 出勤(kind="in"):  定時前14分以内のみ丸める。定時後（遅刻側）は丸めない
 *   - 退勤(kind="out"): 定時後14分以内のみ丸める。定時前（早退側）は丸めない
 *   遅刻・早退を丸めで消さないため、2026-08-19 に前後対称から方向限定へ変更
 * - roundQuarter: ③全体の15分丸め（出勤は切り上げ・退勤は切り捨て）。①②の結果に対して最後に適用する
 *   **15分の区切りは本人の定時を起点に刻む**（出勤は始業時刻から、退勤は終業時刻から15分ずつ）。
 *   時計の :00/:15/:30/:45 で刻むと、定時が区切りに乗らない人で定時を越えて丸まり、架空の早退・遅刻が出るため。
 *   例: 終業 17:40 の人が 17:43 に退勤 → 17:40（時計刻みだと 17:30 になり早退10分が生まれてしまう）
 *   ③ONなら②も効いているものとして扱う（呼び出し側が roundNear に ② または ③ を渡す）。
 *   早出・残業申請がある日も③は効かせる（①②だけ呼び出し側が無効にする）
 */
export function applyRounding(
  actual: Date,
  scheduled: string | null,
  opts: { roundEarly: boolean; roundNear: boolean; roundQuarter?: boolean; kind: "in" | "out" },
): Date {
  if (!scheduled) return actual
  // JST の日付 0:00 を UTC で表した基準日を算出
  // 注意: 先に +9h して JST の日付部品を取ること。actual.getUTCDate() を直接使うと
  // JST 0:00〜8:59 の打刻（UTC では前日）で基準日が1日ズレ、丸めが不発になる
  const jst = new Date(actual.getTime() + 9 * 60 * 60 * 1000)
  const todayUTC = new Date(
    Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate())
    - 9 * 60 * 60 * 1000,
  )
  const scheduledDate = hhmmToUTCDate(scheduled, todayUTC)
  const diffMin = Math.round((actual.getTime() - scheduledDate.getTime()) / 60000)

  // ①→②の順に評価（どちらかが当たれば定時きっかりになる）
  let result = actual
  if (opts.roundEarly && diffMin < 0) {
    result = scheduledDate
  } else if (opts.roundNear) {
    // 出勤は定時前、退勤は定時後の14分以内だけを定時へ寄せる（遅刻・早退側は丸めない）
    if (opts.kind === "in"  && diffMin < 0 && diffMin >= -14) result = scheduledDate
    if (opts.kind === "out" && diffMin > 0 && diffMin <=  14) result = scheduledDate
  }

  // ③15分丸め: ①②の結果を、定時を起点にした15分の区切りへ寄せる
  // 秒は落として分単位で数える（画面に出る HH:MM と同じ基準）
  if (opts.roundQuarter) {
    const minutesFromScheduled = Math.floor((result.getTime() - scheduledDate.getTime()) / 60000)
    const steps = opts.kind === "in"
      ? Math.ceil(minutesFromScheduled / 15)   // 出勤: 切り上げ（8:10 → 8:15、9:23 → 9:30）
      : Math.floor(minutesFromScheduled / 15)  // 退勤: 切り捨て
    return new Date(scheduledDate.getTime() + steps * 15 * 60000)
  }
  return result
}

type RoundingSetting = {
  roundEarlyClockIn?:   boolean | null
  roundNearClockTime?:  boolean | null
  roundQuarterHour?:    boolean | null
  capOvertimeByRequest?: boolean | null
}

/**
 * 出勤の記録時刻を求める（打刻時・早出申請却下時の再丸めで共通）
 * 早出申請（申請中・承認済）がある日は①②を無効にする。③は申請があっても効かせる
 */
export function computeRecordedClockIn(
  raw: Date,
  p: { workStartTime: string | null; setting: RoundingSetting | null | undefined; hasEarlyStartRequest: boolean },
): Date {
  const s = p.setting
  return applyRounding(raw, p.workStartTime, {
    roundEarly:   p.hasEarlyStartRequest ? false : (s?.roundEarlyClockIn ?? false),
    // ③ONなら②も効いているものとして扱う（実効の② ＝ ② または ③）
    roundNear:    p.hasEarlyStartRequest ? false : ((s?.roundNearClockTime ?? false) || (s?.roundQuarterHour ?? false)),
    roundQuarter: s?.roundQuarterHour ?? false,
    kind: "in",
  })
}

/** 申請の最小形（残業申請の判定・上限の決定に使う） */
export type OvertimeRequestLike = {
  type:      string
  status:    string
  createdAt: Date
  detail?:   unknown
}

function isNormalOvertime(r: OvertimeRequestLike): boolean {
  if (r.type !== "OVERTIME") return false
  const d = r.detail as { overtimeType?: string } | null | undefined
  return d?.overtimeType !== "earlyStart"  // 早出申請は残業ではない
}

/** 残業申請（早出申請を除く）が申請中・承認済で存在するか。②の無効化と注意表示の判定に使う */
export function hasOvertimeRequest(requests: OvertimeRequestLike[]): boolean {
  return requests.some((r) => isNormalOvertime(r) && (r.status === "PENDING" || r.status === "APPROVED"))
}

/**
 * ④の上限にする終了時刻（"HH:MM"）。承認済みの残業申請（早出申請を除く）のうち
 * **最後に出した申請（createdAt が最新）**の終了時刻。無ければ null（＝定時が上限）
 */
export function pickOvertimeCapEnd(requests: OvertimeRequestLike[]): string | null {
  const approved = requests
    .filter((r) => isNormalOvertime(r) && r.status === "APPROVED")
    .filter((r) => /^\d{1,2}:\d{2}$/.test(String((r.detail as { endTime?: string } | null)?.endTime ?? "")))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
  if (approved.length === 0) return null
  return (approved[0].detail as { endTime: string }).endTime
}

/**
 * 退勤の記録時刻を求める（打刻時・残業申請の承認／削除後の計算し直しで共通）
 * ①→②→③ を applyRounding で適用し、④ON なら min(③まで適用した退勤, 上限) にする。
 * - 残業申請（申請中・承認済）がある日は②を無効にする（③は効かせる）
 * - ④の上限 ＝ capEndTime（承認済み残業申請の終了）、無ければ定時
 * - 上限が出勤時刻以前になる場合は上限を掛けない（勤務時間が負になるため）
 * 実打刻（raw）は書き換えない。呼び出し側は raw を rawClockOut に保存する
 */
export function computeRecordedClockOut(
  raw: Date,
  p: {
    workEndTime: string | null
    clockIn: Date | null
    setting: RoundingSetting | null | undefined
    hasOvertimeRequest: boolean
    capEndTime: string | null
  },
): Date {
  const s = p.setting
  const rounded = applyRounding(raw, p.workEndTime, {
    roundEarly:   false,
    roundNear:    p.hasOvertimeRequest ? false : ((s?.roundNearClockTime ?? false) || (s?.roundQuarterHour ?? false)),
    roundQuarter: s?.roundQuarterHour ?? false,
    kind: "out",
  })
  if (!s?.capOvertimeByRequest) return rounded

  const capHHMM = p.capEndTime ?? p.workEndTime
  if (!capHHMM) return rounded
  const jst = toJST(rounded)
  const dayStartUTC = Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate()) - 9 * 60 * 60 * 1000
  const cap = hhmmToUTCDate(capHHMM, new Date(dayStartUTC))
  if (p.clockIn && cap.getTime() <= p.clockIn.getTime()) return rounded
  return rounded.getTime() > cap.getTime() ? cap : rounded
}

/**
 * 「残業申請が無いのに定時を15分以上過ぎて打刻した日」の注意表示の判定
 * - 実打刻（rawClockOut）が定時＋15分以上、かつ残業申請（申請中・承認済、早出申請を除く）が無い
 * - ④ONのときだけ（④OFFなら何も削らないので注意の対象にしない）
 * - 定時から14分以内は②で定時に吸収されるいつもの運用なので対象外
 * 要確認の状態・件数には入れない。本人向けは削った時間を出さない（内訳は管理者画面のみ）
 */
export function needsOvertimeRequestNotice(p: {
  rawClockOut: Date | null
  workEndTime: string | null
  hasOvertimeRequest: boolean
  capEnabled: boolean
}): boolean {
  if (!p.capEnabled || !p.rawClockOut || p.hasOvertimeRequest) return false
  const endMins = parseHHMM(p.workEndTime)
  if (endMins === null) return false
  return hhmm(p.rawClockOut) >= endMins + 15
}

/**
 * 遅刻早退申請（ABSENCE）から「日付キー → 遅刻申請/早退申請それぞれの最新状態」マップを作る。
 * 欠勤（absent）は対象外。requests は createdAt 降順（先頭が最新）で渡すこと。
 * keyOf は targetDate → 日付キーの変換。
 */
export function buildLateEarlyStatusMap(
  requests: { targetDate: Date; status: string; detail?: unknown }[],
  keyOf: (d: Date) => string,
): Map<string, LateEarlyTypeStatus> {
  const map = new Map<string, LateEarlyTypeStatus>()
  for (const req of requests) {
    const detail = req.detail as { absenceType?: string } | null | undefined
    const t = detail?.absenceType
    if (t !== "late" && t !== "early") continue
    if (req.status !== "PENDING" && req.status !== "APPROVED" && req.status !== "REJECTED") continue
    const key = keyOf(req.targetDate)
    const cur = map.get(key) ?? {}
    if (!cur[t]) cur[t] = req.status
    map.set(key, cur)
  }
  return map
}

/**
 * 遅刻・早退（分）: 保存値があればそれを、無ければ記録時刻から計算する。
 * 画面（/records・承認詳細）と Excel で同じ結果にするための共通関数。
 * 承認前の日は保存値が無いので、表示時に calcMetrics で計算する。
 */
export function resolveLateEarlyMinutes(
  rec: {
    clockIn: Date | null
    clockOut: Date | null
    workingMinutes: number | null
    lateMinutes: number | null
    earlyLeaveMinutes: number | null
  },
  user: { workStartTime: string | null; workEndTime: string | null; employmentType: string | null },
): { lateMinutes: number; earlyLeaveMinutes: number } {
  const metrics = calcMetrics({
    clockIn: rec.clockIn,
    clockOut: rec.clockOut,
    workingMinutes: rec.workingMinutes,
    workStartTime: user.workStartTime,
    workEndTime: user.workEndTime,
    scheduledMinutes: calcScheduledMinutes(user.workStartTime, user.workEndTime, user.employmentType),
  })
  return {
    lateMinutes: rec.lateMinutes ?? metrics.lateMinutes,
    earlyLeaveMinutes: rec.earlyLeaveMinutes ?? metrics.earlyLeaveMinutes,
  }
}

/**
 * DBステータス + 要確認判定 → 表示用ラベル・クラス
 * reviewPending: 要確認の理由のうち遅刻早退申請が審査中のものがある（resolveEmployeeReview の pending）。
 * 従業員向け画面だけが渡す（管理者向けは渡さない）。
 */
export function getDisplayStatus(
  status: string,
  needsReview: boolean,
  correctionStatus?: "PENDING" | "APPROVED" | "REJECTED" | null,
  reviewPending?: boolean,
): { label: string; className: string } {
  if (status === "LOCKED")    return { label: "締め済", className: "bg-purple-100 text-purple-700" }
  if (status === "APPROVED") {
    // 打刻修正承認済みは「修正済」で区別
    if (correctionStatus === "APPROVED") return { label: "修正済", className: "bg-teal-100 text-teal-700" }
    return { label: "承認済", className: "bg-green-100 text-green-700" }
  }
  if (status === "SUBMITTED") return { label: "確認済", className: "bg-blue-100 text-blue-700" }
  // OPEN
  // 申請中（CORRECTION申請が審査中）
  if (correctionStatus === "PENDING") return { label: "申請中", className: "bg-blue-100 text-blue-600" }
  // 申請で解消されていない理由が残っていれば要確認（審査中の理由があっても対応が必要なものを優先）
  if (needsReview) return { label: "要確認", className: "bg-red-100 text-red-600" }
  // 残る理由がすべて審査中の遅刻早退申請 → 申請中
  if (reviewPending) return { label: "申請中", className: "bg-blue-100 text-blue-600" }
  return { label: "打刻済", className: "bg-gray-100 text-gray-500" }
}

/** HH:MM 形式の文字列を返す（ChangeLog 保存用）*/
export function formatHHMMfromDate(dt: Date | null | undefined): string | null {
  if (!dt) return null
  const j = toJST(dt)
  return `${String(j.getUTCHours()).padStart(2, "0")}:${String(j.getUTCMinutes()).padStart(2, "0")}`
}
