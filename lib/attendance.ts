/**
 * 勤怠計算ユーティリティ
 * 承認・締め時に AttendanceRecord へ保存する集計値を計算する
 */

import { BREAK_REQUEST_MAX_MINUTES, BREAK_REQUEST_STEP_MINUTES, calcLegalBreak } from "@/config/attendance.config"

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

/**
 * 本人の休憩の長さ（分）：本人の User.breakMinutes → 無ければ会社設定の休憩時間控除ルール（Setting の break1 系・break2 系）を
 * 定時の拘束時間に当てた値。会社設定が無いときは法定休憩（config の BREAK_RULES）。段7の正社員の規定値・所定勤務時間・半休の昼休憩が使う。
 */
export function calcDefaultBreakMinutes(
  p: { userBreakMinutes: number | null | undefined; workStartTime: string | null; workEndTime: string | null },
  setting?: { break1Threshold: number; break1Minutes: number; break2Threshold: number; break2Minutes: number } | null,
): number {
  if (p.userBreakMinutes != null) return p.userBreakMinutes
  const s = parseHHMM(p.workStartTime)
  const e = parseHHMM(p.workEndTime)
  if (s === null || e === null || e <= s) return 0
  const span = e - s
  if (!setting) return calcLegalBreak(span)
  if (span > setting.break2Threshold) return setting.break2Minutes
  if (span > setting.break1Threshold) return setting.break1Minutes
  return 0
}

/**
 * 本人所定勤務時間（分）＝ 拘束時間（定時の終業−始業）− 所定休憩。workStartTime/workEndTime 未設定時は雇用形態でfallback
 * 所定休憩は本人の breakMinutes、無ければ会社設定の休憩ルール（calcDefaultBreakMinutes と同じ決め方）。
 * 例：野木さん（パート 9:00-15:00・所定休憩60）→ 300分。半休は所定の半分（150分）
 */
export function calcScheduledMinutes(
  workStartTime: string | null | undefined,
  workEndTime:   string | null | undefined,
  employmentType: string | null | undefined,
  breakOpts?: {
    userBreakMinutes?: number | null
    setting?: { break1Threshold: number; break1Minutes: number; break2Threshold: number; break2Minutes: number } | null
  },
): number {
  const startMins = parseHHMM(workStartTime)
  const endMins   = parseHHMM(workEndTime)
  if (startMins !== null && endMins !== null && endMins > startMins) {
    const brk = calcDefaultBreakMinutes(
      { userBreakMinutes: breakOpts?.userBreakMinutes, workStartTime: workStartTime ?? null, workEndTime: workEndTime ?? null },
      breakOpts?.setting,
    )
    return Math.max(0, endMins - startMins - brk)
  }
  return employmentType === "full" ? 480 : 0
}

/**
 * 旧方式（⑤OFF）の本人所定勤務時間（分）＝ 拘束時間（定時の終業−始業）− 法定休憩（6時間超45分・8時間超60分）。
 * 本番 a1d25ca の calcScheduledMinutes と同じ。本人の休憩設定・会社設定は見ない。未設定は雇用形態で fallback（正社員480・他0）
 */
export function calcLegacyScheduledMinutes(
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
 * 実働時間（分）を計算する。外出時間を除いた在席時間から、段7で決めた休憩分数を控除する。
 * 休憩分数は resolveBreakMinutes（lib/clock-pipeline.ts）が決める。ここでは雇用形態・休憩打刻を見ない。
 * 出勤または退勤が欠けている場合は null（未確定）。
 */
export function calcWorkingMinutes({
  clockIn,
  clockOut,
  goOutAt,
  returnAt,
  breakMinutes,
}: {
  clockIn:    Date | null
  clockOut:   Date | null
  goOutAt:    Date | null
  returnAt:   Date | null
  breakMinutes: number
}): number | null {
  if (!clockIn || !clockOut) return null

  const totalMs = clockOut.getTime() - clockIn.getTime()
  const goOutMs = goOutAt && returnAt ? returnAt.getTime() - goOutAt.getTime() : 0
  const rawMinutes = Math.floor((totalMs - goOutMs) / 60000)
  return Math.max(0, rawMinutes - breakMinutes)
}

/**
 * 保存済みの値から、その日の休憩（分）を求める（/records と Excel の休憩列で共通）。
 * 実働（workingMinutes）を保存した日の休憩は、その実働と食い違わないよう保存値から決める：
 *   breakMinutes → 過去の休憩打刻（開始・終了）→ 逆算（在席時間 − 外出 − 実働）
 * 保存した実働が無い日は null（呼び出し側が resolveBreakMinutes で決める）
 */
export function storedBreakMinutes(rec: {
  breakMinutes: number | null
  breakStart: Date | null
  breakEnd: Date | null
  clockIn: Date | null
  clockOut: Date | null
  goOutAt: Date | null
  returnAt: Date | null
  workingMinutes: number | null
}): number | null {
  if (rec.breakMinutes != null) return rec.breakMinutes
  if (rec.breakStart && rec.breakEnd) {
    return Math.round((rec.breakEnd.getTime() - rec.breakStart.getTime()) / 60000)
  }
  if (rec.clockIn && rec.clockOut && rec.workingMinutes != null) {
    const goOutMins = rec.goOutAt && rec.returnAt ? Math.round((rec.returnAt.getTime() - rec.goOutAt.getTime()) / 60000) : 0
    const rawMins = Math.floor((rec.clockOut.getTime() - rec.clockIn.getTime()) / 60000)
    return Math.max(0, rawMins - goOutMins - rec.workingMinutes)
  }
  return null
}

/** その日の定時（CLOCK_PIPELINE 段0の結果）。null ＝ 定時なし（休日など）。遅刻・早退・残業は付けない */
export type DaySchedule = { start: string; end: string } | null

export type AttendanceMetrics = {
  lateMinutes:       number
  earlyLeaveMinutes: number
  /** 残業 ＝ 早出（定時の始業 − 記録した出勤）＋ 残業（記録した退勤 − 定時の終業）。段8 */
  overtimeMinutes:   number
  /** 内訳：早出（定時の始業 − 記録した出勤） */
  earlyStartMinutes: number
  /** 内訳：終業後（記録した退勤 − 定時の終業） */
  afterHoursMinutes: number
}

/**
 * 遅刻・早退・残業を「記録時刻と定時の差」だけで出す（段4・段8）。
 * 差し引きした数字（実働−所定など）は使わない。定時なし（null）なら全部0。
 * - 遅刻 ＝ 記録した出勤 − 定時の始業（0未満は0）
 * - 早退 ＝ 定時の終業 − 記録した退勤（0未満は0）
 * - 残業 ＝ 早出 ＋ 終業後（それぞれ0未満は0）。出勤・退勤の両方が揃った日だけ
 * 日をまたぐ退勤も時刻の差で数える（深夜残業を落とさない）
 */
export function calcMetrics({
  clockIn,
  clockOut,
  workStartTime,
  workEndTime,
}: {
  clockIn:       Date | null
  clockOut:      Date | null
  workStartTime: string | null
  workEndTime:   string | null
}): AttendanceMetrics {
  const zero: AttendanceMetrics = { lateMinutes: 0, earlyLeaveMinutes: 0, overtimeMinutes: 0, earlyStartMinutes: 0, afterHoursMinutes: 0 }
  const startMins = parseHHMM(workStartTime)
  const endMins   = parseHHMM(workEndTime)
  if (startMins === null || endMins === null) return zero
  const ref = clockIn ?? clockOut
  if (!ref) return zero

  // 記録時刻の JST 日付を基準に、定時を分単位（秒は切り捨て）の通し値にして差を取る
  const dayStartMin = Math.floor(jstDayStartUTC(ref).getTime() / 60000)
  const toMin = (d: Date) => Math.floor(d.getTime() / 60000)
  const startMin = dayStartMin + startMins
  const endMin   = dayStartMin + endMins

  const lateMinutes       = clockIn  ? Math.max(0, toMin(clockIn)  - startMin) : 0
  const earlyLeaveMinutes = clockOut ? Math.max(0, endMin - toMin(clockOut))  : 0
  let earlyStartMinutes = 0
  let afterHoursMinutes = 0
  if (clockIn && clockOut) {
    earlyStartMinutes = Math.max(0, startMin - toMin(clockIn))
    afterHoursMinutes = Math.max(0, toMin(clockOut) - endMin)
  }
  return {
    lateMinutes,
    earlyLeaveMinutes,
    overtimeMinutes: earlyStartMinutes + afterHoursMinutes,
    earlyStartMinutes,
    afterHoursMinutes,
  }
}

/** 日時の属する JST 日付の 0:00 を UTC の Date で返す（先に +9h して日付部品を取る。JST 0:00〜8:59 のズレ防止） */
export function jstDayStartUTC(d: Date): Date {
  const jst = toJST(d)
  return new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate()) - 9 * 60 * 60 * 1000)
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

/**
 * 休憩申請（BREAK）の分数を検証して数値にする。15分刻み・0〜上限。不正なら null。
 * 0 は「休憩なし」の申請（例：社員が休憩を取らなかった日）として有効
 */
export function parseBreakRequestMinutes(v: unknown): number | null {
  if (typeof v !== "string" && typeof v !== "number") return null
  const s = String(v).trim()
  if (!/^\d{1,3}$/.test(s)) return null
  const n = Number(s)
  if (n % BREAK_REQUEST_STEP_MINUTES !== 0 || n > BREAK_REQUEST_MAX_MINUTES) return null
  return n
}

/**
 * 休憩の申告がある申請か。あれば申告の分数を返す（無ければ null）。
 * - 休憩申請（BREAK）：detail.minutes
 * - 早退申請（ABSENCE・absenceType=early）：detail.breakMinutes（正社員が申請時に答える「休憩を取りましたか」。0＝取らなかった）
 * 承認されると、どちらも同じしくみ（承認前の値 prevBreakMinutes・適用順 breakAppliedAt）でその日の breakMinutes に入る
 */
export function breakAnswerMinutes(req: { type: string; detail: unknown }): number | null {
  const d = (req.detail ?? {}) as { minutes?: unknown; breakMinutes?: unknown; absenceType?: unknown }
  if (req.type === "BREAK") return parseBreakRequestMinutes(d.minutes)
  if (req.type === "ABSENCE" && d.absenceType === "early" && d.breakMinutes !== undefined) return parseBreakRequestMinutes(d.breakMinutes)
  return null
}

/** 早退申請フォームへのリンク（退勤直後の知らせ用。対象日・種別・退勤時刻を入れておく） */
export function earlyLeaveRequestHref(dateKey: string, time: string): string {
  return `/requests/new?type=ABSENCE&absenceType=early&date=${dateKey}&time=${time}`
}

/**
 * 定時前に退勤した正社員への「早退申請を出してください」の知らせの判定。
 * 出すなら申請フォームの初期時刻（退勤時刻を申請の刻みで切り下げた HH:MM）、出さないなら null。
 * - パートは対象外（休憩ボタンがあるため）／定時なしの日（休日など）は対象外
 * - 退勤が定時の終業より前／その日の早退申請（審査中・承認済み）がまだ無い
 * 当日だけ出す（呼び出し側が当日を渡す）。要確認の状態・件数には入れない
 */
export function earlyLeaveNudgeTime(p: {
  employmentType: string | null | undefined
  /** 記録の日付（JST の暦日の UTC 0時）。日をまたぐ退勤を早退と取り違えないために使う */
  date: Date
  schedule: DaySchedule
  clockOut: Date | null
  hasEarlyLeaveRequest: boolean
  stepMinutes?: number
}): string | null {
  if (p.employmentType === "part" || !p.schedule || !p.clockOut || p.hasEarlyLeaveRequest) return null
  const end = parseHHMM(p.schedule.end)
  if (end === null) return null
  const out = Math.floor((p.clockOut.getTime() - (p.date.getTime() - 9 * 60 * 60 * 1000)) / 60000)
  if (out >= end || out < 0) return null
  const step = p.stepMinutes ?? 15
  const floored = Math.floor(out / step) * step
  return `${String(Math.floor(floored / 60)).padStart(2, "0")}:${String(floored % 60).padStart(2, "0")}`
}

/** 6時間（分）。パートの休憩申請漏れの判定（実働がこれを超えたら休憩の記録が要る） */
const BREAK_NOTICE_WORK_MINUTES = 360

/**
 * パートの休憩申請漏れの判定（CLOCK_PIPELINE「知らせる」）。次のどちらかで、休憩の記録が無い日
 * ① 所定休憩（User.breakMinutes）が設定されている（0より大きい）
 * ② 実働（外出を除く在席時間）が6時間を超えた
 * 休憩の記録 ＝ その日の breakMinutes（休憩ボタン・承認済みの休憩申請。0分を含む）か、過去の休憩打刻（開始・終了）。
 * 審査中の休憩申請がある日は、申請済みなので出さない。退勤まで済んだ日だけ判定する。要確認の状態・件数には入れない
 */
export function needsBreakRecordNotice(p: {
  employmentType: string | null | undefined
  userBreakMinutes: number | null | undefined
  breakMinutes: number | null | undefined
  breakStart?: Date | null
  breakEnd?: Date | null
  clockIn: Date | null
  clockOut: Date | null
  goOutAt?: Date | null
  returnAt?: Date | null
  hasPendingBreakRequest?: boolean
}): boolean {
  if (p.employmentType !== "part") return false
  if (!p.clockIn || !p.clockOut) return false
  if (p.breakMinutes != null || (p.breakStart && p.breakEnd)) return false
  if (p.hasPendingBreakRequest) return false
  if ((p.userBreakMinutes ?? 0) > 0) return true
  const goOutMs = p.goOutAt && p.returnAt ? p.returnAt.getTime() - p.goOutAt.getTime() : 0
  const presence = Math.floor((p.clockOut.getTime() - p.clockIn.getTime() - goOutMs) / 60000)
  return presence > BREAK_NOTICE_WORK_MINUTES
}

/**
 * 休日出勤申請が無いまま休日に打刻があった日の判定（CLOCK_PIPELINE「知らせる」）
 * - 休日（休日カレンダー・本人の休みの曜日）で、打刻がある
 * - 休日出勤の印（承認済みの休日出勤申請・代理打刻の休日出勤チェック）が無く、審査中・承認済みの休日出勤申請も無い
 * 要確認の状態・件数には入れない
 */
export function needsHolidayWorkNotice(p: {
  isRestDay: boolean
  hasPunch: boolean
  isHolidayWork: boolean
  hasHolidayWorkRequest: boolean
}): boolean {
  return p.isRestDay && p.hasPunch && !p.isHolidayWork && !p.hasHolidayWorkRequest
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
  opts: { roundEarly: boolean; roundNear: boolean; roundQuarter?: boolean; kind: "in" | "out"; dayStart?: Date },
): Date {
  if (!scheduled) return actual
  // JST の日付 0:00 を UTC で表した基準日を算出
  // 注意: 先に +9h して JST の日付部品を取ること。actual.getUTCDate() を直接使うと
  // JST 0:00〜8:59 の打刻（UTC では前日）で基準日が1日ズレ、丸めが不発になる
  const jst = new Date(actual.getTime() + 9 * 60 * 60 * 1000)
  // dayStart: 記録の日付の JST 0:00。日をまたぐ退勤（翌1:00 など）でも定時は記録の日付のものを使うため、呼び出し側が渡す
  const todayUTC = opts.dayStart ?? new Date(
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

/** 申請の最小形（残業申請の判定・上限の決定に使う） */
export type OvertimeRequestLike = {
  type:      string
  status:    string
  createdAt: Date
  detail?:   unknown
}

export function isNormalOvertime(r: OvertimeRequestLike): boolean {
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
  /** 記録の日付（UTC 0時＝その日の JST 暦日）。日をまたぐ退勤でも記録の日付の定時で判定する。省略時は退勤した日 */
  date?: Date
}): boolean {
  if (!p.capEnabled || !p.rawClockOut || p.hasOvertimeRequest) return false
  const endMins = parseHHMM(p.workEndTime)
  if (endMins === null) return false
  // workEndTime は段0の定時（半休・休日を反映したもの。休日は null）
  const dayStart = p.date ? p.date.getTime() - 9 * 60 * 60 * 1000 : jstDayStartUTC(p.rawClockOut).getTime()
  const minutesFromDayStart = Math.floor((p.rawClockOut.getTime() - dayStart) / 60000)
  return minutesFromDayStart >= endMins + 15
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
 * 遅刻・早退・残業（分）: 保存値があればそれを、無ければ記録時刻と定時の差から計算する（段4・段8）。
 * 画面（/records・承認詳細）と Excel で同じ結果にするための共通関数。
 * schedule は段0の結果（休日・半休を反映した定時）。null なら定時なしで全部0。
 */
export function resolveDayMetrics(
  rec: {
    clockIn: Date | null
    clockOut: Date | null
    lateMinutes: number | null
    earlyLeaveMinutes: number | null
    overtimeMinutes: number | null
  },
  schedule: DaySchedule,
  /**
   * ⑤旧方式（記録に保存した⑤がOFF）の残業の求め方。保存値が無い日の画面計算にだけ使う。
   * 省略は新しい式（早出＋終業後）。workingMinutes は保存した実働、legacyScheduledMinutes は calcLegacyScheduledMinutes
   */
  legacy?: { workingMinutes: number | null; legacyScheduledMinutes: number },
): { lateMinutes: number; earlyLeaveMinutes: number; overtimeMinutes: number } {
  const metrics = calcMetrics({
    clockIn: rec.clockIn,
    clockOut: rec.clockOut,
    workStartTime: schedule?.start ?? null,
    workEndTime: schedule?.end ?? null,
  })
  return {
    lateMinutes: rec.lateMinutes ?? metrics.lateMinutes,
    earlyLeaveMinutes: rec.earlyLeaveMinutes ?? metrics.earlyLeaveMinutes,
    overtimeMinutes: rec.overtimeMinutes ?? (legacy
      ? (schedule && legacy.workingMinutes != null && legacy.legacyScheduledMinutes > 0
          ? Math.max(0, legacy.workingMinutes - legacy.legacyScheduledMinutes)
          : 0)
      : metrics.overtimeMinutes),
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
