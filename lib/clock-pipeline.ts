/**
 * 打刻パイプライン（docs/CLOCK_PIPELINE.md）
 *
 * 記録時刻（出勤・退勤）・遅刻・早退・残業を、毎回同じ計算で最初から出し直す純粋関数。
 * 打刻・申請の承認／却下／削除／編集・打刻修正・管理者の直接編集・代理打刻・勤怠承認は、
 * すべてこの関数（lib/clock-pipeline-db.ts 経由）を通す。経路ごとに別の直し方をしない。
 *
 * 入力：実打刻（打刻修正で直した時刻を含む）・承認済みの申請・その日の記録に保存したスイッチ状態・その日の定時（段0の結果）
 * 出力：記録時刻・遅刻・早退・残業
 * 実打刻（rawClockIn/Out）は書き換えない。DB の読み書きはここに持たない。
 */

import {
  applyRounding,
  calcDefaultBreakMinutes,
  calcLegacyScheduledMinutes,
  calcMetrics,
  hhmmToUTCDate,
  isNormalOvertime,
  jstDayStartUTC,
  pickOvertimeCapEnd,
  type DaySchedule,
  type OvertimeRequestLike,
} from "@/lib/attendance"
import { REQUEST_TIME_STEP_MINUTES, calcLegalBreak } from "@/config/attendance.config"

// 段7の規定値は lib/attendance.ts に置く（所定勤務時間の計算と共有し、循環 import を避ける）
export { calcDefaultBreakMinutes }

/**
 * 画面・Excel が resolveDayMetrics に渡す「⑤旧方式の残業の求め方」。記録に保存した⑤がONなら undefined（新しい式）。
 * 保存した⑤（無ければ resolveSwitches の規則）に従い、現在の設定には従わない
 */
export function legacyOvertimeInput(
  rec: SavedSwitches & { workingMinutes: number | null },
  setting: SwitchSetting | null | undefined,
  user: { workStartTime: string | null; workEndTime: string | null; employmentType: string | null } | null | undefined,
): { workingMinutes: number | null; legacyScheduledMinutes: number } | undefined {
  if (resolveSwitches(rec, setting).newCalc) return undefined
  return {
    workingMinutes: rec.workingMinutes,
    legacyScheduledMinutes: calcLegacyScheduledMinutes(user?.workStartTime, user?.workEndTime, user?.employmentType),
  }
}

/**
 * 段8：残業分数（⑤で式が変わる）
 * ⑤ON：早出＋終業後（pipelineOvertime。記録時刻と定時の差だけで出した値）
 * ⑤OFF：旧方式。実働（休憩控除後）− 本人の所定勤務時間（calcLegacyScheduledMinutes）、0未満は0。所定が0なら0。
 *   定時なしの日（休日で休日出勤申請が無い日）は旧方式でも残業を付けない（ここは誤りの修正として新旧共通）
 */
export function resolveOvertimeMinutes(p: {
  newCalc: boolean
  pipelineOvertime: number
  workingMinutes: number | null
  legacyScheduledMinutes: number
  hasSchedule: boolean
}): number {
  if (p.newCalc) return p.pipelineOvertime
  if (!p.hasSchedule || p.workingMinutes == null || p.legacyScheduledMinutes <= 0) return 0
  return Math.max(0, p.workingMinutes - p.legacyScheduledMinutes)
}

// ---------------------------------------------------------------------------
// スイッチ
// ---------------------------------------------------------------------------

/** ①〜⑤のスイッチ状態（打刻時点のもの。記録に保存し、計算し直すときもこれを使う） */
export type PipelineSwitches = {
  roundEarly:   boolean  // ① 申請が無い日、定時前の出勤を定時にする
  roundNear:    boolean  // ② 定時から14分以内の早出・残業側の端数を定時にする（申請の有無に関係なく効く）
  roundQuarter: boolean  // ③ 全体の15分丸め
  capOvertime:  boolean  // ④ 早出・残業を申請の時刻で打ち切る
  newCalc:      boolean  // ⑤ 新しい計算方式：正社員の休憩の規定値（定時から決める）と残業の式（早出＋終業後）。OFF＝旧方式
}

/** 会社設定（Setting）のうちスイッチに関わる部分 */
export type SwitchSetting = {
  roundEarlyClockIn?:    boolean | null
  roundNearClockTime?:   boolean | null
  roundQuarterHour?:     boolean | null
  capOvertimeByRequest?: boolean | null
  newCalcMethod?:        boolean | null
}

/** AttendanceRecord に保存したスイッチ状態（null＝保存値なし） */
export type SavedSwitches = {
  switchRoundEarly?:   boolean | null
  switchRoundNear?:    boolean | null
  switchRoundQuarter?: boolean | null
  switchCapOvertime?:  boolean | null
  switchNewCalc?:      boolean | null
}

/** 現在の設定をスイッチ状態にする（出勤打刻時に記録へ保存する値） */
export function switchesFromSetting(setting: SwitchSetting | null | undefined): PipelineSwitches {
  return {
    roundEarly:   setting?.roundEarlyClockIn    ?? false,
    roundNear:    setting?.roundNearClockTime   ?? false,
    roundQuarter: setting?.roundQuarterHour     ?? false,
    capOvertime:  setting?.capOvertimeByRequest ?? false,
    newCalc:      setting?.newCalcMethod        ?? false,
  }
}

/** スイッチ状態を AttendanceRecord の保存列の形にする */
export function switchesToColumns(sw: PipelineSwitches) {
  return {
    switchRoundEarly:   sw.roundEarly,
    switchRoundNear:    sw.roundNear,
    switchRoundQuarter: sw.roundQuarter,
    switchCapOvertime:  sw.capOvertime,
    switchNewCalc:      sw.newCalc,
  }
}

/**
 * 計算に使うスイッチ状態を決める（原則5：遡及しない）。
 * 記録に保存値があればそれを使う。保存値が無い既存の記録は「③④OFF・①②⑤は現在値」。
 * ⑤だけ保存値が無く①〜④の保存値がある記録は、⑤導入前の記録なので旧方式（OFF）。
 */
export function resolveSwitches(saved: SavedSwitches | null | undefined, setting: SwitchSetting | null | undefined): PipelineSwitches {
  const has = saved
    && saved.switchRoundEarly   != null
    && saved.switchRoundNear    != null
    && saved.switchRoundQuarter != null
    && saved.switchCapOvertime  != null
  if (has) {
    return {
      roundEarly:   saved.switchRoundEarly!,
      roundNear:    saved.switchRoundNear!,
      roundQuarter: saved.switchRoundQuarter!,
      capOvertime:  saved.switchCapOvertime!,
      newCalc:      saved.switchNewCalc ?? false,
    }
  }
  return {
    roundEarly:   setting?.roundEarlyClockIn  ?? false,
    roundNear:    setting?.roundNearClockTime ?? false,
    roundQuarter: false,
    capOvertime:  false,
    newCalc:      setting?.newCalcMethod ?? false,
  }
}

// ---------------------------------------------------------------------------
// 段0：その日の定時を決める
// ---------------------------------------------------------------------------

function parseHHMM(s: string | null | undefined): number | null {
  if (!s || !/^\d{1,2}:\d{2}$/.test(s)) return null
  const [h, m] = s.split(":").map(Number)
  return h * 60 + m
}

function formatHHMM(mins: number): string {
  return `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`
}

/**
 * 段7：その日の休憩分数（上から順に決める）
 * 1. その日の breakMinutes に値がある（パートの休憩ボタン・承認済みの休憩申請）→ その値（0を含む）
 * 2. 値が無く、過去の休憩打刻（開始・終了）が両方ある → 打刻の差（休憩ボタン導入前の記録。再計算で実働が増えないように）
 * 3. パート → 0（休憩申請漏れの知らせの対象になりうる）
 * 4. 半休の日 → 0
 * 5. 正社員 → 規定値。⑤ON（新しい計算方式）：本人の User.breakMinutes、無ければ会社設定の休憩ルールを定時の拘束時間に当てた値。
 *    ⑤OFF（旧方式。リリース2より前の規則）：在席時間（外出を除く）に法定休憩（6時間超45分・8時間超60分）を当てた値
 * 1・2 は事実（休憩ボタン・承認済みの休憩申請・早退申請の休憩の申告・過去の休憩打刻）なので、⑤ON/OFF どちらでも同じ
 * 審査中の休憩申請は差し引かない（承認されて breakMinutes に入った時点で反映される）。
 * daySchedule は段0の結果。休日出勤の日はその申請の開始〜終了を拘束時間にする。
 * 定時なし（休日で休日出勤申請が無い日）は、本人の所定休憩が無ければ「在席時間」（presenceMinutes）に会社の休憩ルールを当てる
 * （休日に半日だけ出た人に、平日の定時ぶんの休憩を引かない）。所定休憩が設定されていればそれを使う
 */
export function resolveBreakMinutes(p: {
  savedBreakMinutes: number | null | undefined
  breakStart?: Date | null
  breakEnd?: Date | null
  halfDay: "am" | "pm" | null
  employmentType: string | null | undefined
  userBreakMinutes: number | null | undefined
  workStartTime: string | null
  workEndTime: string | null
  daySchedule: DaySchedule
  /** 外出を除いた在席時間（分）。定時なしの日の規定値に使う */
  presenceMinutes?: number | null
  setting?: { break1Threshold: number; break1Minutes: number; break2Threshold: number; break2Minutes: number } | null
  /** ⑤（記録に保存した値）。省略は ON（新しい計算方式）。本番の呼び出しは必ず渡す */
  newCalc?: boolean
}): number {
  if (p.savedBreakMinutes != null) return p.savedBreakMinutes
  if (p.breakStart && p.breakEnd) {
    return Math.max(0, Math.floor((p.breakEnd.getTime() - p.breakStart.getTime()) / 60000))
  }
  if (p.employmentType === "part") return 0
  if (p.halfDay) return 0
  // ⑤OFF：旧方式。在席時間に法定休憩を当てる（定時・本人の所定休憩・会社設定は見ない）
  if (p.newCalc === false) return calcLegalBreak(Math.max(0, p.presenceMinutes ?? 0))
  if (!p.daySchedule && p.userBreakMinutes == null && p.presenceMinutes != null) {
    return calcDefaultBreakMinutes(
      { userBreakMinutes: null, workStartTime: "00:00", workEndTime: formatHHMM(Math.max(0, p.presenceMinutes)) },
      p.setting,
    )
  }
  return calcDefaultBreakMinutes(
    {
      userBreakMinutes: p.userBreakMinutes,
      workStartTime: p.daySchedule?.start ?? p.workStartTime,
      workEndTime: p.daySchedule?.end ?? p.workEndTime,
    },
    p.setting,
  )
}

/** 承認済みの休日出勤申請（複数あれば最後に出した申請）の開始〜終了。段0で定時の代わりにする */
export function pickHolidayWorkSchedule(
  requests: { type: string; status: string; createdAt: Date; detail?: unknown }[],
): { start: string; end: string } | null {
  const req = pickHolidayWorkRequest(requests)
  if (!req) return null
  const d = req.detail as { startTime: string; endTime: string }
  return { start: d.startTime.padStart(5, "0"), end: d.endTime.padStart(5, "0") }
}

/**
 * その日に有効な休日出勤申請（承認済みで開始・終了が正しいもののうち、最後に出した申請）。
 * 段0の定時（pickHolidayWorkSchedule）と Excel の「休む日」「振休・代休」の列が、同じ申請を選ぶための共通の選び方
 */
export function pickHolidayWorkRequest<T extends { type: string; status: string; createdAt: Date; detail?: unknown }>(
  requests: T[],
): T | null {
  const ok = (v: unknown): v is string => typeof v === "string" && /^\d{1,2}:\d{2}$/.test(v)
  const list = requests
    .filter((r) => r.type === "HOLIDAY_WORK" && r.status === "APPROVED")
    .filter((r) => {
      const d = r.detail as { startTime?: string; endTime?: string } | null | undefined
      return ok(d?.startTime) && ok(d?.endTime)
    })
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
  return list[0] ?? null
}

export type ScheduleParams = {
  workStartTime:  string | null
  workEndTime:    string | null
  employmentType: string | null | undefined
  /** 本人の休憩の長さ（分）。昼休憩の終わり＝開始＋これ */
  breakMinutes:   number
  /** 昼休憩の開始時刻（Setting.lunchStartTime） */
  lunchStartTime: string | null | undefined
  /** 休日（休日カレンダー・本人の休みの曜日）で、労働日になる振替でない日 */
  isRestDay:      boolean
  /** 承認済み LEAVE の halfDay（"am"/"pm"）。無ければ null。パートには半休が無いので無視する */
  halfDay:        "am" | "pm" | null
  /**
   * 承認済みの休日出勤申請の「開始〜終了」。定時の代わりになる（pickHolidayWorkSchedule）
   */
  holidayWork?:   DaySchedule
}

/**
 * 段0：その日の定時。null ＝ 定時なし（遅刻・早退・残業は付けない）
 * - 承認済みの休日出勤申請がある日 → 申請の開始〜終了（後続担当の差し込み口）
 * - 休日で休日出勤申請が無い日 → 定時なし
 * - 正社員の半休 → 昼休憩を除いた前半か後半
 *   午前半休 ＝ （昼休憩の終わり）〜終業、午後半休 ＝ 始業〜（昼休憩の開始）。昼休憩の終わり ＝ 開始 ＋ 本人の休憩の長さ
 * - 通常の日 → 本人の定時
 */
export function resolveDaySchedule(p: ScheduleParams): DaySchedule {
  if (p.holidayWork) return p.holidayWork
  if (p.isRestDay) return null
  const s = parseHHMM(p.workStartTime)
  const e = parseHHMM(p.workEndTime)
  if (s === null || e === null) return null
  if (p.employmentType === "full" && p.halfDay) {
    const lunchStart = parseHHMM(p.lunchStartTime) ?? 12 * 60
    const lunchEnd = lunchStart + p.breakMinutes
    if (p.halfDay === "am") return { start: formatHHMM(lunchEnd), end: formatHHMM(e) }
    return { start: formatHHMM(s), end: formatHHMM(lunchStart) }
  }
  return { start: formatHHMM(s), end: formatHHMM(e) }
}

/** 本人の休みの曜日（workSun〜workSat）と休日カレンダーから、その日が休日か。date は UTC 0時＝その日（JST の暦日） */
export function isRestDay(
  date: Date,
  user: { workSun: boolean; workMon: boolean; workTue: boolean; workWed: boolean; workThu: boolean; workFri: boolean; workSat: boolean },
  isHoliday: boolean,
  isSubstituteWorkday = false,
): boolean {
  if (isSubstituteWorkday) return false  // 振替で労働日になった休日は、通常の労働日（本人の定時）
  if (isHoliday) return true
  const flags = [user.workSun, user.workMon, user.workTue, user.workWed, user.workThu, user.workFri, user.workSat]
  return !flags[date.getUTCDay()]
}

/**
 * 段0（呼び出し側の入口）：ユーザー・会社設定・休日カレンダー・その日の申請から、その日の定時を出す。
 * パイプラインの計算し直し（clock-pipeline-db）と、画面・Excel の保存値が無いときの計算が同じ定時を使うための共通関数。
 * requests はその日の申請（承認済み以外は無視する）。
 */
export function resolveScheduleForDate(p: {
  date: Date
  user: {
    workStartTime: string | null; workEndTime: string | null; employmentType: string | null | undefined; breakMinutes: number | null | undefined
    workSun: boolean; workMon: boolean; workTue: boolean; workWed: boolean; workThu: boolean; workFri: boolean; workSat: boolean
  }
  setting: {
    lunchStartTime?: string | null
    break1Threshold: number; break1Minutes: number; break2Threshold: number; break2Minutes: number
  } | null | undefined
  isHoliday: boolean
  /** 休日出勤の印がある日（代理打刻の休日出勤チェック） */
  isHolidayWork?: boolean
  requests: { type: string; status: string; createdAt: Date; detail?: unknown }[]
}): DaySchedule {
  const breakMinutes = calcDefaultBreakMinutes(
    { userBreakMinutes: p.user.breakMinutes, workStartTime: p.user.workStartTime, workEndTime: p.user.workEndTime },
    p.setting,
  )
  return resolveDaySchedule({
    workStartTime: p.user.workStartTime,
    workEndTime: p.user.workEndTime,
    employmentType: p.user.employmentType,
    breakMinutes,
    lunchStartTime: p.setting?.lunchStartTime,
    // 休日出勤の印がある日も定時なし。承認済みの休日出勤申請があれば、その開始〜終了が定時の代わりになる（holidayWork）
    isRestDay: !!p.isHolidayWork || isRestDay(p.date, p.user, p.isHoliday),
    halfDay: pickHalfDay(p.requests),
    holidayWork: pickHolidayWorkSchedule(p.requests),
  })
}

/** 承認済み LEAVE（全種別）の halfDay を拾う。複数あれば最後に出した申請 */
export function pickHalfDay(requests: { type: string; status: string; createdAt: Date; detail?: unknown }[]): "am" | "pm" | null {
  const list = requests
    .filter((r) => r.type === "LEAVE" && r.status === "APPROVED")
    .filter((r) => {
      const h = (r.detail as { halfDay?: string } | null | undefined)?.halfDay
      return h === "am" || h === "pm"
    })
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
  if (list.length === 0) return null
  return (list[0].detail as { halfDay: "am" | "pm" }).halfDay
}

// ---------------------------------------------------------------------------
// パイプライン本体
// ---------------------------------------------------------------------------

export type PipelineRequest = OvertimeRequestLike

export type PipelineInput = {
  /** 段1：入力の出勤時刻（実打刻。打刻修正で直した時刻があればそれ） */
  inputClockIn:  Date | null
  /** 段1：入力の退勤時刻 */
  inputClockOut: Date | null
  /** 出退勤の入力が実打刻でも修正でもない（出どころ不明の既存の記録）ときは、丸めず記録時刻をそのまま使う */
  clockInIsFinal?:  boolean
  clockOutIsFinal?: boolean
  /** 段6.5：管理者の確定修正。段0〜6の結果を最後に上書きする（丸め・④を通さない）。遅刻・早退・残業は上書き後の時刻から出す */
  adminClockIn?:  Date | null
  adminClockOut?: Date | null
  /** 記録の日付（UTC 0時＝その日の JST 暦日）。日をまたぐ退勤でも定時・上限は記録の日付のものを使う。省略時は入力の出勤（無ければ退勤）の日 */
  date?: Date
  /** 段0の結果 */
  schedule: DaySchedule
  /** 打刻時点のスイッチ状態 */
  switches: PipelineSwitches
  /** その日の承認済みの残業申請・早出申請（承認済み以外は渡しても無視する） */
  requests: PipelineRequest[]
}

export type PipelineOutput = {
  clockIn:  Date | null
  clockOut: Date | null
  lateMinutes:       number
  earlyLeaveMinutes: number
  /** 段8：早出 ＋ 終業後 */
  overtimeMinutes:   number
  earlyStartMinutes: number
  afterHoursMinutes: number
  /** 段2：早出申請が有効に働いた日 */
  earlyStartRequestApplied: boolean
  /** 段6：④の上限が出勤より前になった（定時後に出勤して申請なし等）。勤務0分・注意表示の対象 */
  capBeforeClockIn: boolean
}

/** 早出申請（承認済み）の開始時刻。複数あれば最後に出した申請 */
export function pickEarlyStartTime(requests: PipelineRequest[]): string | null {
  const list = requests
    .filter((r) => r.type === "OVERTIME" && r.status === "APPROVED" && !isNormalOvertime(r))
    .filter((r) => {
      const d = r.detail as { overtimeType?: string; startTime?: string } | null | undefined
      return d?.overtimeType === "earlyStart" && /^\d{1,2}:\d{2}$/.test(String(d.startTime ?? ""))
    })
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
  if (list.length === 0) return null
  return (list[0].detail as { startTime: string }).startTime
}

/** 秒を落として「申請の時刻の刻み」へ切り上げる（時計の 0:00 起点）。例：7:40 → 7:45 */
export function ceilToRequestStep(d: Date, stepMinutes: number = REQUEST_TIME_STEP_MINUTES): Date {
  const base = jstDayStartUTC(d).getTime()
  const minutes = Math.floor((d.getTime() - base) / 60000)  // 画面の HH:MM と同じ基準（秒は落とす）
  return new Date(base + Math.ceil(minutes / stepMinutes) * stepMinutes * 60000)
}

/** 段2・段3・段5：出勤の記録時刻 */
function computeClockIn(
  raw: Date,
  schedule: NonNullable<DaySchedule>,
  sw: PipelineSwitches,
  requests: PipelineRequest[],
  dayStart: Date,
): { clockIn: Date; earlyRequestApplied: boolean } {
  // ③ONなら②も実効ON
  const near = sw.roundNear || sw.roundQuarter
  const scheduledStart = hhmmToUTCDate(schedule.start, dayStart)

  // 段2：早出申請がある日
  // 有効な開始 ＝ max(申請の開始, 実打刻を申請の刻みで切り上げ→②③で丸めた時刻)。④OFF なら申請の開始で打ち切らない
  const earlyStart = pickEarlyStartTime(requests)
  if (earlyStart) {
    // 切り上げは④ON のとき（申請の開始で打ち切る形のとき）だけ。④OFF は何も削らないので実打刻を②③で丸めるだけ
    const base = sw.capOvertime ? ceilToRequestStep(raw) : raw
    let effective = applyRounding(base, schedule.start, {
      roundEarly: false,  // 申請がある日は①を使わない
      roundNear: near,
      roundQuarter: sw.roundQuarter,
      kind: "in",
      dayStart,
    })
    if (sw.capOvertime) {
      const requested = hhmmToUTCDate(earlyStart, dayStart)
      if (effective.getTime() < requested.getTime()) effective = requested
    }
    // 有効な開始が定時以降になれば早出申請は無効。申請が無い日と同じ扱いにする
    if (effective.getTime() < scheduledStart.getTime()) {
      return { clockIn: effective, earlyRequestApplied: true }
    }
  }

  // 段2（申請が無い日）・段3・段5：①→②→③
  // ④ONなら①も実効ON（③ONなら②も効くのと同じ形）。申請が無い日の早出は④で定時に打ち切る
  return {
    clockIn: applyRounding(raw, schedule.start, {
      roundEarly: sw.roundEarly || sw.capOvertime,
      roundNear: near,
      roundQuarter: sw.roundQuarter,
      kind: "in",
      dayStart,
    }),
    earlyRequestApplied: false,
  }
}

/** 段3・段5・段6：退勤の記録時刻 */
function computeClockOut(
  raw: Date,
  clockIn: Date | null,
  schedule: NonNullable<DaySchedule>,
  sw: PipelineSwitches,
  requests: PipelineRequest[],
  dayStart: Date,
): { clockOut: Date; capBeforeClockIn: boolean } {
  // ②は申請の有無に関係なく効く。③ONなら②も実効ON
  const rounded = applyRounding(raw, schedule.end, {
    roundEarly: false,
    roundNear: sw.roundNear || sw.roundQuarter,
    roundQuarter: sw.roundQuarter,
    kind: "out",
    dayStart,
  })
  if (!sw.capOvertime) return { clockOut: rounded, capBeforeClockIn: false }

  // 段6：④。上限 ＝ 承認済みの残業申請（早出申請を除く）のうち最後に出した申請の終了時刻。無ければ定時
  const capHHMM = pickOvertimeCapEnd(requests.filter((r) => r.status === "APPROVED")) ?? schedule.end
  const cap = hhmmToUTCDate(capHHMM, dayStart)
  // 上限が出勤より前（定時後に出勤し、申請なしで働いた日など）は勤務0分。退勤を出勤に揃える
  if (clockIn && cap.getTime() <= clockIn.getTime()) {
    return { clockOut: clockIn, capBeforeClockIn: true }
  }
  return { clockOut: rounded.getTime() > cap.getTime() ? cap : rounded, capBeforeClockIn: false }
}

/**
 * 打刻パイプライン本体。段の番号は docs/CLOCK_PIPELINE.md のもの。
 *   段0 定時（schedule として受け取る）→ 段1 入力 → 段2 早出 → 段3 ② → 段5 ③ → 段6 ④ → 段4 遅刻・早退 → 段8 残業
 *   （遅刻・早退は丸めた記録時刻の差で出すため、計算順は 段4 が 段5・段6 の後ろになる）
 * 段7（休憩）は resolveBreakMinutes で決め、勤務時間（calcWorkingMinutes）が控除する（clock-pipeline-db の buildRecordUpdate）。
 */
export function computeClockPipeline(input: PipelineInput): PipelineOutput {
  const { schedule, switches, requests } = input
  let clockIn = input.inputClockIn
  let clockOut = input.inputClockOut
  let earlyStartRequestApplied = false
  let capBeforeClockIn = false
  // 定時・④の上限は記録の日付のもの（日をまたぐ退勤で翌日の定時に置かない）
  const ref = input.inputClockIn ?? input.inputClockOut
  const dayStart = input.date ? new Date(input.date.getTime() - 9 * 60 * 60 * 1000) : ref ? jstDayStartUTC(ref) : new Date(0)

  // 定時なし（休日など）は丸める基準が無いので記録時刻＝入力。遅刻・早退・残業も付けない
  if (schedule) {
    if (clockIn && !input.clockInIsFinal) {
      const r = computeClockIn(clockIn, schedule, switches, requests, dayStart)
      clockIn = r.clockIn
      earlyStartRequestApplied = r.earlyRequestApplied
    }
    if (clockOut && !input.clockOutIsFinal) {
      const r = computeClockOut(clockOut, clockIn, schedule, switches, requests, dayStart)
      clockOut = r.clockOut
      capBeforeClockIn = r.capBeforeClockIn
    }
  }

  // 段6.5：管理者の確定修正が最後に勝つ（段0〜6の結果を上書き）
  if (input.adminClockIn) {
    clockIn = input.adminClockIn
    earlyStartRequestApplied = false
  }
  if (input.adminClockOut) {
    clockOut = input.adminClockOut
    capBeforeClockIn = false
  }

  // 段4・段8：時刻の差だけで出す
  const m = calcMetrics({
    clockIn,
    clockOut,
    workStartTime: schedule?.start ?? null,
    workEndTime: schedule?.end ?? null,
  })
  return {
    clockIn,
    clockOut,
    lateMinutes: m.lateMinutes,
    earlyLeaveMinutes: m.earlyLeaveMinutes,
    // 勤務0分の日は残業を付けない
    overtimeMinutes: capBeforeClockIn ? 0 : m.overtimeMinutes,
    earlyStartMinutes: capBeforeClockIn ? 0 : m.earlyStartMinutes,
    afterHoursMinutes: capBeforeClockIn ? 0 : m.afterHoursMinutes,
    earlyStartRequestApplied,
    capBeforeClockIn,
  }
}

/**
 * 出勤の記録時刻が段2の④（早出申請の開始時刻で切った）で遅らされたか。画面で実打刻を併記するかの判定に使う。
 * ④ありとなしの記録時刻を比べ、④ありのほうが遅ければ切られている。
 */
export function isClockInCapped(p: {
  /** 記録の日付（UTC 0時＝その日）。省略時は入力の出勤の日 */
  date?: Date
  /** パイプラインへの入力の出勤（実打刻。打刻修正で直した日はその時刻）。resolveInputTime の結果 */
  inputClockIn: Date | null
  schedule: DaySchedule
  switches: PipelineSwitches
  requests: PipelineRequest[]
}): boolean {
  if (!p.switches.capOvertime || !p.schedule || !p.inputClockIn) return false
  const base = { date: p.date, inputClockIn: p.inputClockIn, inputClockOut: null, schedule: p.schedule, requests: p.requests }
  const withCap = computeClockPipeline({ ...base, switches: p.switches }).clockIn
  const withoutCap = computeClockPipeline({ ...base, switches: { ...p.switches, capOvertime: false } }).clockIn
  return !!withCap && !!withoutCap && withCap.getTime() > withoutCap.getTime()
}

/**
 * 退勤の記録時刻が④（申請の時刻での打ち切り）で削られたか。画面で実打刻を併記するかの判定に使う
 * （④で打ち切った退勤には実打刻を併記しない。①〜③の丸めの差は従来どおり併記する）。
 * 実打刻を入力にして、④ありとなしの記録時刻を比べる。
 */
export function isClockOutCapped(p: {
  /** 記録の日付（UTC 0時＝その日）。出勤が無い日またぎの退勤のみの行でも、記録の日付の定時・上限で判定する */
  date?: Date
  recordedClockIn: Date | null
  /** パイプラインへの入力の退勤（実打刻。打刻修正で直した日はその時刻）。resolveInputTime の結果 */
  inputClockOut: Date | null
  schedule: DaySchedule
  switches: PipelineSwitches
  requests: PipelineRequest[]
}): boolean {
  if (!p.switches.capOvertime || !p.schedule || !p.inputClockOut) return false
  const base = {
    date: p.date,
    inputClockIn: p.recordedClockIn,
    clockInIsFinal: true,
    inputClockOut: p.inputClockOut,
    schedule: p.schedule,
    requests: p.requests,
  }
  const withCap = computeClockPipeline({ ...base, switches: p.switches }).clockOut
  const withoutCap = computeClockPipeline({ ...base, switches: { ...p.switches, capOvertime: false } }).clockOut
  return !!withCap && !!withoutCap && withCap.getTime() < withoutCap.getTime()
}

// ---------------------------------------------------------------------------
// 段1：入力の時刻（実打刻、打刻修正で直した時刻があればそれ）
// ---------------------------------------------------------------------------

export type InputSource = "raw" | "corrected" | "recorded"

/**
 * 段1：パイプラインに入れる時刻を決める。
 * - 打刻修正・管理者の直接編集・代理打刻で入れた時刻（変更履歴 AttendanceChangeLog の最新の新しい値）が実打刻より新しければ、それが入力
 *   （修正した時刻にも以降の段の丸めをかける。記録時刻 clockIn/Out は出力なので入力に使わない）
 * - 変更履歴が無ければ実打刻（rawClockIn/Out）
 * - 新しい値が空（null）の変更履歴は「取り消しの印」。その時刻より前の変更履歴は入力に使わない
 *   （管理者の修正の取り消し・承認済みの打刻修正申請の削除で、修正前の状態に戻すときに書く）
 * - どちらも無い既存の記録は、記録時刻をそのまま入力にし、丸めない（source = "recorded"）
 * date は記録の日付（UTC 0時＝その日の JST 暦日）。変更履歴の値は "HH:MM"（JST）
 */
export function resolveInputTime(p: {
  date: Date
  raw: Date | null
  recorded: Date | null
  logs: { newValue: string | null; changedAt: Date }[]
}): { time: Date | null; source: InputSource } {
  // 取り消しの印より前の履歴は無かったことにする（印と同時刻の履歴は印より前に書かれたものとみなす）
  const resetAt = p.logs.reduce((m, l) => (l.newValue === null ? Math.max(m, l.changedAt.getTime()) : m), -Infinity)
  const latest = p.logs
    .filter((l) => l.newValue && /^\d{1,2}:\d{2}$/.test(l.newValue) && l.changedAt.getTime() > resetAt)
    .sort((a, b) => b.changedAt.getTime() - a.changedAt.getTime())[0]
  if (latest && (!p.raw || p.raw.getTime() <= latest.changedAt.getTime())) {
    const [hh, mm] = latest.newValue!.split(":").map(Number)
    const time = new Date(Date.UTC(p.date.getUTCFullYear(), p.date.getUTCMonth(), p.date.getUTCDate(), hh - 9, mm))
    return { time, source: "corrected" }
  }
  if (p.raw) return { time: p.raw, source: "raw" }
  return { time: p.recorded, source: "recorded" }
}

/** 変更履歴の1件（出勤・退勤の1項目ぶん） */
export type InputLog = {
  id: string
  oldValue: string | null
  newValue: string | null
  changedAt: Date
  /** 取り消しで書いた履歴のとき、取り消した履歴の id（通常の履歴は null / 省略） */
  revertsLogId?: string | null
}

/**
 * 有効な履歴：取り消された履歴（revertsLogId で指されたもの）と、取り消しの履歴そのものを除く。
 * 取り消しの履歴は「戻した時刻」を新しい値として書き直すので、読み手（resolveInputTime）は最新の値を読むだけで済む。
 * 一方、次の取り消しの「戻し先」を求めるときは、取り消し済みの申請・管理者の修正の履歴を拾ってはいけない
 */
export function liveInputLogs<T extends InputLog>(logs: T[]): T[] {
  const dead = new Set(logs.map((l) => l.revertsLogId).filter((v): v is string => !!v))
  return logs.filter((l) => !l.revertsLogId && !dead.has(l.id))
}

/** 変更履歴の時刻と承認の記録の時刻が一致とみなす幅（承認の記録のあとに同じ操作で変更履歴を書くため） */
const APPROVAL_LOG_WINDOW_MS = 2 * 60 * 1000

const isValidTime = (v: string | null | undefined): v is string => !!v && /^\d{1,2}:\d{2}$/.test(v)

/**
 * 打刻修正申請の承認で書かれた変更履歴を探す（取り消し済みの履歴は対象外）。
 * 変更履歴には「誰が・何の操作で」の区別が無いので、次の規則で見分ける
 * - 承認の記録（Approval）がある申請：同じ新しい値で、承認の記録の時刻の前後2分以内の履歴（複数あれば最新）
 * - 承認の記録が1件も無い申請（承認の記録は 2026-07-06 以降しか無く、それ以前に承認したもの）：
 *   同じ新しい値で、申請の作成（createdAt）以後に書かれた履歴のうち最も早い1件。
 *   承認は申請の作成後に行われ、同じ時刻を管理者があとから入れ直した履歴は承認より遅いので、最も早い履歴を承認由来とみなす。
 *   同じ項目・同じ時刻の申請が複数あるときは1対1で割り当てる：申請を作成順に並べ、それぞれが
 *   「他の申請に割り当て済みでない履歴」のうち最も早い1件を取る（earlierSameTimeCreatedAts に、この申請より前の申請の作成日時を渡す）。
 *   これで2件目の承認の履歴が、1件目と同じ履歴に重なって管理者の修正と誤判定されることを防ぐ
 * 見つからなければ null
 */
export function findCorrectionLog(
  logs: InputLog[],
  correctedTime: string,
  approvedAts: Date[],
  /** 申請の作成日時。承認の記録が無い申請の照合に使う */
  createdAt?: Date,
  /** 承認の記録が無い申請の照合用：同じ項目・同じ時刻で、この申請より前に作成された承認の記録が無い申請の作成日時（作成順） */
  earlierSameTimeCreatedAts: Date[] = [],
): InputLog | null {
  const live = liveInputLogs(logs).filter((l) => l.newValue === correctedTime)
  if (approvedAts.length > 0) {
    const hit = live
      .filter((l) => approvedAts.some((a) => Math.abs(a.getTime() - l.changedAt.getTime()) <= APPROVAL_LOG_WINDOW_MS))
      .sort((a, b) => b.changedAt.getTime() - a.changedAt.getTime())
    return hit[0] ?? null
  }
  if (!createdAt) return null
  const sorted = [...live].sort((a, b) => a.changedAt.getTime() - b.changedAt.getTime() || a.id.localeCompare(b.id))
  const taken = new Set<string>()
  for (const c of earlierSameTimeCreatedAts) {
    const hit = sorted.find((l) => !taken.has(l.id) && l.changedAt.getTime() >= c.getTime())
    if (hit) taken.add(hit.id)
  }
  return sorted.find((l) => !taken.has(l.id) && l.changedAt.getTime() >= createdAt.getTime()) ?? null
}

/** 承認済みの打刻修正申請（1項目ぶん）。変更履歴のどれが承認由来かを見分ける材料 */
export type ApprovedCorrection = { correctedTime: string; createdAt: Date; approvedAts: Date[] }

/** 承認済みの打刻修正の変更履歴の id の集合（残りは管理者の入力・代理打刻の履歴とみなす） */
export function correctionLogIdSet(logs: InputLog[], corrections: ApprovedCorrection[]): Set<string> {
  const ids = new Set<string>()
  // 承認の記録が無い申請は1対1で割り当てる（同じ時刻の申請は作成順。findCorrectionLog 参照）
  const ordered = [...corrections].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
  ordered.forEach((c, i) => {
    const earlier = c.approvedAts.length > 0
      ? []
      : ordered.slice(0, i).filter((e) => e.approvedAts.length === 0 && e.correctedTime === c.correctedTime).map((e) => e.createdAt)
    const hit = findCorrectionLog(logs, c.correctedTime, c.approvedAts, c.createdAt, earlier)
    if (hit) ids.add(hit.id)
  })
  return ids
}

/** その履歴が、有効な履歴のうち最新か（これより後に入力を変える履歴が無いか） */
export function isLatestInputLog(logs: InputLog[], target: InputLog): boolean {
  return !logs.some((l) => l.id !== target.id && isValidTime(l.newValue) && l.changedAt.getTime() > target.changedAt.getTime())
}

/**
 * ある変更履歴（管理者の修正・承認済みの打刻修正）を取り消して、入力を1つ前の状態に戻すために書く変更履歴の「新しい値」を決める。
 * - 1つ前に有効な履歴があれば、その値を書き直す（"HH:MM"）
 * - 1つ前が実打刻、または無ければ null（取り消しの印。入力は実打刻に戻る）
 * noInput が true のときは実打刻も他の履歴も無く、記録時刻の列そのものを呼び出し側が戻す必要がある。
 * 戻す値は noInputValue（取り消し済みの修正の履歴をさかのぼった、最初の修正の前の値。無ければ null＝空）
 */
export function planInputRevert(p: {
  date: Date
  raw: Date | null
  logs: InputLog[]
  /** 取り消す履歴の id。特定できなければ null（全履歴を残して1つ前を求める） */
  removeId: string | null
}): { logNewValue: string | null; noInput: boolean; noInputValue: string | null } {
  // 取り消し済みの申請・管理者の修正の履歴は戻し先にしない（有効な履歴だけから探す）
  const rest = liveInputLogs(p.logs).filter((l) => l.id !== p.removeId)
  const prior = resolveInputTime({ date: p.date, raw: p.raw, recorded: null, logs: rest })
  if (prior.source === "corrected" && prior.time) {
    const j = new Date(prior.time.getTime() + 9 * 60 * 60 * 1000)
    const hhmm = `${String(j.getUTCHours()).padStart(2, "0")}:${String(j.getUTCMinutes()).padStart(2, "0")}`
    return { logNewValue: hhmm, noInput: false, noInputValue: null }
  }
  const noInput = prior.source === "recorded"
  const target = p.removeId ? p.logs.find((l) => l.id === p.removeId) : undefined
  return { logNewValue: null, noInput, noInputValue: noInput && target ? walkBackOldValue(p.logs, target) : null }
}

/**
 * 取り消す履歴の「修正前の値」。その値を新しい値として書いた、先に取り消し済みの履歴があれば、その前の値までさかのぼる
 * （例：9:00 → 8:50 と2回修正して、9:00 の修正を先に取り消したあと 8:50 の修正を取り消すと、戻し先は 9:00 ではなく空）。
 * 取り消しの履歴（revertsLogId あり）と有効な履歴は、たどる対象にしない
 */
function walkBackOldValue(logs: InputLog[], target: InputLog): string | null {
  const liveIds = new Set(liveInputLogs(logs).map((l) => l.id))
  const deadOnes = logs.filter((l) => !l.revertsLogId && !liveIds.has(l.id) && l.id !== target.id)
  let v = target.oldValue ?? null
  const seen = new Set<string>()
  while (v) {
    const d = deadOnes
      .filter((l) => l.newValue === v && !seen.has(l.id) && l.changedAt.getTime() < target.changedAt.getTime())
      .sort((a, b) => b.changedAt.getTime() - a.changedAt.getTime())[0]
    if (!d) break
    seen.add(d.id)
    v = d.oldValue
  }
  return v
}

const jstHHMM = (d: Date): string => {
  const j = new Date(d.getTime() + 9 * 60 * 60 * 1000)
  return `${String(j.getUTCHours()).padStart(2, "0")}:${String(j.getUTCMinutes()).padStart(2, "0")}`
}

/** 管理者の修正の取り消し方（出勤・退勤それぞれ） */
export type AdminRevertPlan =
  /** 取り消すものが無い（代理打刻で入れたままの項目など） */
  | { kind: "none" }
  /** admin 列に対応する履歴を特定できない（履歴が無い・消えている）。取り消しの印を書けないので取り消しを拒否する */
  | { kind: "unidentified" }
  /** 1つ前の値も管理者・代理打刻の入力：その値へ admin 列ごと戻す（丸めない） */
  | { kind: "restoreAdmin"; value: string; targetId: string }
  /** admin 列を空にして、1つ前の打刻修正の時刻・実打刻（パイプラインを通す）へ戻す。noInput なら記録時刻の列も空にする */
  | { kind: "clearAdmin"; logNewValue: string | null; noInput: boolean; targetId: string }

/**
 * 管理者の確定修正（admin 列）を取り消すときの戻し先を決める（出勤・退勤のどちらか1項目ぶん）。
 * - 管理者の修正の履歴 ＝ admin 列と同じ新しい値の、有効な履歴のうち最新（特定できなければ unidentified ＝ 取り消しを拒否する）
 * - 戻し先 ＝ それを除いた有効な履歴のうち最新（実打刻より前のものは使わない）
 *   - 打刻修正の承認の履歴ではない（管理者の入力・代理打刻・リリース2より前の移行分）なら、その値へ admin 列ごと戻す
 *     （管理者が入れた時刻なので丸めない。代理打刻の時刻を直した日は、代理打刻の時刻に戻る）
 *   - 打刻修正の承認の履歴なら、admin 列を空にしてその時刻へ（パイプラインを通す）
 *   - 履歴が無ければ実打刻へ。実打刻も無い日は次のとおり
 *     - 他の項目に実打刻がある日（退勤の打ち忘れに管理者が入れた等）：記録時刻の列を空にして戻す
 *     - 打刻ゼロの日（代理打刻）：代理打刻と同時に入れた最初の履歴だけの項目は、あとから直していないので取り消さない（none）。
 *       あとから足した項目（最初の履歴より後に書かれたもの）は、空に戻す
 */
export function planAdminRevert(p: {
  date: Date
  raw: Date | null
  /** admin 列の時刻 */
  admin: Date
  /** この項目の変更履歴（取り消しの履歴を含めて渡す） */
  logs: InputLog[]
  /** 打刻修正の承認で書かれた履歴の id（correctionLogIdSet） */
  correctionLogIds: Set<string>
  /** その日に実打刻（出勤・退勤のどちらか）があるか */
  dayHasRawPunch: boolean
  /** その日の出勤・退勤の変更履歴のうち最も早い書き込み時刻（代理打刻の最初の履歴の判定に使う） */
  firstLogAt: Date | null
}): AdminRevertPlan {
  const adminHHMM = jstHHMM(p.admin)
  const live = liveInputLogs(p.logs).filter((l) => isValidTime(l.newValue))
  const desc = (a: InputLog, b: InputLog) => b.changedAt.getTime() - a.changedAt.getTime()
  const target = live.filter((l) => l.newValue === adminHHMM).sort(desc)[0] ?? null
  const prior = live
    .filter((l) => l.id !== target?.id && (!p.raw || p.raw.getTime() <= l.changedAt.getTime()))
    .sort(desc)[0] ?? null
  // 対象の履歴が特定できないと、取り消しの履歴が取り消しの印（revertsLogId）を持てず、あとで有効な履歴に数えられてしまう
  if (!target) return { kind: "unidentified" }
  const targetId = target.id
  if (prior) {
    return p.correctionLogIds.has(prior.id)
      ? { kind: "clearAdmin", logNewValue: prior.newValue, noInput: false, targetId }
      : { kind: "restoreAdmin", value: prior.newValue!, targetId }
  }
  if (p.raw) return { kind: "clearAdmin", logNewValue: null, noInput: false, targetId }
  if (p.dayHasRawPunch) return { kind: "clearAdmin", logNewValue: null, noInput: true, targetId }
  // 打刻ゼロの日（代理打刻）：代理打刻と同時に書いた最初の履歴だけの項目は触らない
  if (p.firstLogAt && target.changedAt.getTime() - p.firstLogAt.getTime() <= PROXY_BATCH_WINDOW_MS) {
    return { kind: "none" }
  }
  return { kind: "clearAdmin", logNewValue: null, noInput: true, targetId }
}

/**
 * 代理打刻の最初の書き込み時刻（planAdminRevert の firstLogAt）：その日の出勤・退勤の有効な履歴のうち最も早い書き込み時刻。
 * 取り消し済みの履歴・取り消しの履歴は含めない（含めると、取り消し済みの打刻修正の履歴が基準になり、
 * 代理打刻のまま直していない項目まで空にしてしまう）。actions.ts と page.tsx で共有する
 */
export function proxyFirstLogAt(dayLogs: (InputLog & { fieldName: string })[]): Date | null {
  // 出勤・退勤を別々に有効判定する（取り消しの履歴は同じ項目の履歴を指すため）
  const byField = new Map<string, InputLog[]>()
  for (const l of dayLogs) {
    byField.set(l.fieldName, [...(byField.get(l.fieldName) ?? []), l])
  }
  const live = [...byField.values()].flatMap((ls) => liveInputLogs(ls))
  return live.length > 0 ? new Date(Math.min(...live.map((l) => l.changedAt.getTime()))) : null
}

/** 代理打刻は1回の保存で出勤・退勤の履歴を書く。同じ保存とみなす書き込み時刻の幅 */
const PROXY_BATCH_WINDOW_MS = 1000

/**
 * 外出・戻り・休憩の打刻修正（承認済み）を取り消すときの、列へ戻す値を決める。
 * - これより後に別の有効な履歴（別の修正・管理者の編集）があれば、それが優先なので列は動かさない（changeColumn = false）
 *   取り消しの履歴には現在の値（最新の有効な履歴の値）を書く
 * - 最新なら、1つ前の有効な履歴の値へ。無ければ修正前の値（取り消し済みの履歴をたどって、最初の修正の前の値）へ
 */
export function planFieldRevert(p: {
  logs: InputLog[]
  removeId: string
}): { value: string | null; changeColumn: boolean } {
  const target = p.logs.find((l) => l.id === p.removeId)
  const live = liveInputLogs(p.logs).filter((l) => isValidTime(l.newValue))
  const desc = (a: InputLog, b: InputLog) => b.changedAt.getTime() - a.changedAt.getTime()
  const latest = live.sort(desc)[0]
  if (latest && latest.id !== p.removeId) return { value: latest.newValue, changeColumn: false }
  const prior = live.filter((l) => l.id !== p.removeId)[0]
  if (prior) return { value: prior.newValue, changeColumn: true }
  // 戻し先の履歴が無い：修正前の値。先に取り消した修正の履歴があれば、その前の値までさかのぼる
  return { value: target ? walkBackOldValue(p.logs, target) : null, changeColumn: true }
}

// ---------------------------------------------------------------------------
// 段6.5：管理者の入力画面の時刻の選択肢
// ---------------------------------------------------------------------------

/** 選択肢を決めるための、その日の条件（画面に渡せるよう Date を含まない） */
export type AdminTimeConstraint = {
  schedule: DaySchedule
  switches: PipelineSwitches
  /** 承認済みの早出申請の開始時刻（"HH:MM"）。無ければ null */
  earlyStartTime: string | null
  /** 承認済みの残業申請（最後に出した申請）の終了時刻。無ければ null（＝定時が上限） */
  overtimeCapEnd: string | null
}

const OPTION_BASE = Date.UTC(2026, 0, 5) - 9 * 60 * 60 * 1000  // 判定用の基準日の JST 0:00（日付に意味は無い）

/**
 * 管理者の入力画面（編集モーダル・代理打刻フォーム）の時刻の選択肢（"HH:MM" の配列）。
 * - 出勤・退勤：その時刻をパイプラインに通しても変わらない時刻だけ（③ON なら15分刻み、④ON なら退勤は上限まで、など）
 * - それ以外の項目（外出・戻り・休憩）：パイプラインに影響しないので申請の刻みの時刻
 * - unrestricted（「制限なしで入力する」）：全項目・1分単位・全時間帯
 */
export function buildAdminTimeOptions(
  kind: "clockIn" | "clockOut" | "other",
  c: AdminTimeConstraint,
  unrestricted: boolean,
): string[] {
  const fmt = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`
  if (unrestricted) return Array.from({ length: 1440 }, (_, m) => fmt(m))
  if (kind === "other") {
    const out: string[] = []
    for (let m = 0; m < 1440; m += REQUEST_TIME_STEP_MINUTES) out.push(fmt(m))
    return out
  }
  const requests: PipelineRequest[] = []
  const at = new Date("2026-01-01T00:00:00Z")
  if (c.earlyStartTime) requests.push({ type: "OVERTIME", status: "APPROVED", createdAt: at, detail: { overtimeType: "earlyStart", startTime: c.earlyStartTime } })
  if (c.overtimeCapEnd) requests.push({ type: "OVERTIME", status: "APPROVED", createdAt: at, detail: { endTime: c.overtimeCapEnd } })
  const result: string[] = []
  for (let m = 0; m < 1440; m++) {
    const t = new Date(OPTION_BASE + m * 60000)
    const o = computeClockPipeline({
      inputClockIn: kind === "clockIn" ? t : null,
      inputClockOut: kind === "clockOut" ? t : null,
      schedule: c.schedule, switches: c.switches, requests,
    })
    const got = kind === "clockIn" ? o.clockIn : o.clockOut
    if (got && got.getTime() === t.getTime()) result.push(fmt(m))
  }
  return result
}
