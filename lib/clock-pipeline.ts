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
  calcMetrics,
  hhmmToUTCDate,
  isNormalOvertime,
  jstDayStartUTC,
  pickOvertimeCapEnd,
  type DaySchedule,
  type OvertimeRequestLike,
} from "@/lib/attendance"
import { REQUEST_TIME_STEP_MINUTES, calcLegalBreak } from "@/config/attendance.config"

// ---------------------------------------------------------------------------
// スイッチ
// ---------------------------------------------------------------------------

/** ①〜④のスイッチ状態（打刻時点のもの。記録に保存し、計算し直すときもこれを使う） */
export type PipelineSwitches = {
  roundEarly:   boolean  // ① 申請が無い日、定時前の出勤を定時にする
  roundNear:    boolean  // ② 定時から14分以内の早出・残業側の端数を定時にする（申請の有無に関係なく効く）
  roundQuarter: boolean  // ③ 全体の15分丸め
  capOvertime:  boolean  // ④ 早出・残業を申請の時刻で打ち切る
}

/** 会社設定（Setting）のうちスイッチに関わる部分 */
export type SwitchSetting = {
  roundEarlyClockIn?:    boolean | null
  roundNearClockTime?:   boolean | null
  roundQuarterHour?:     boolean | null
  capOvertimeByRequest?: boolean | null
}

/** AttendanceRecord に保存したスイッチ状態（null＝保存値なし） */
export type SavedSwitches = {
  switchRoundEarly?:   boolean | null
  switchRoundNear?:    boolean | null
  switchRoundQuarter?: boolean | null
  switchCapOvertime?:  boolean | null
}

/** 現在の設定をスイッチ状態にする（出勤打刻時に記録へ保存する値） */
export function switchesFromSetting(setting: SwitchSetting | null | undefined): PipelineSwitches {
  return {
    roundEarly:   setting?.roundEarlyClockIn    ?? false,
    roundNear:    setting?.roundNearClockTime   ?? false,
    roundQuarter: setting?.roundQuarterHour     ?? false,
    capOvertime:  setting?.capOvertimeByRequest ?? false,
  }
}

/** スイッチ状態を AttendanceRecord の保存列の形にする */
export function switchesToColumns(sw: PipelineSwitches) {
  return {
    switchRoundEarly:   sw.roundEarly,
    switchRoundNear:    sw.roundNear,
    switchRoundQuarter: sw.roundQuarter,
    switchCapOvertime:  sw.capOvertime,
  }
}

/**
 * 計算に使うスイッチ状態を決める（原則5：遡及しない）。
 * 記録に保存値があればそれを使う。保存値が無い既存の記録は「③④OFF・①②は現在値」。
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
    }
  }
  return {
    roundEarly:   setting?.roundEarlyClockIn  ?? false,
    roundNear:    setting?.roundNearClockTime ?? false,
    roundQuarter: false,
    capOvertime:  false,
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
 * 本人の休憩の長さ（分）。段7の担当が正式な決め方を作るまでの既存の算出：
 * 本人の User.breakMinutes → 無ければ会社設定の休憩時間控除ルール（Setting の break1 系・break2 系）を定時の拘束時間に当てた値。
 * 会社設定が無いときは法定休憩（config の BREAK_RULES）。
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
   * 承認済みの休日出勤申請の「開始〜終了」。定時の代わりになる。
   * 休日出勤申請は後続の担当が作る。ここは差し込み口（今は常に null を渡す）
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
    // 休日出勤の印がある日も定時なし。休日出勤申請による差し替えは後続担当（holidayWork の差し込み口）
    isRestDay: !!p.isHolidayWork || isRestDay(p.date, p.user, p.isHoliday),
    halfDay: pickHalfDay(p.requests),
    holidayWork: null,
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
): { clockIn: Date; earlyRequestApplied: boolean } {
  // ③ONなら②も実効ON
  const near = sw.roundNear || sw.roundQuarter
  const dayStart = jstDayStartUTC(raw)
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
  return {
    clockIn: applyRounding(raw, schedule.start, {
      roundEarly: sw.roundEarly,
      roundNear: near,
      roundQuarter: sw.roundQuarter,
      kind: "in",
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
): { clockOut: Date; capBeforeClockIn: boolean } {
  // ②は申請の有無に関係なく効く。③ONなら②も実効ON
  const rounded = applyRounding(raw, schedule.end, {
    roundEarly: false,
    roundNear: sw.roundNear || sw.roundQuarter,
    roundQuarter: sw.roundQuarter,
    kind: "out",
  })
  if (!sw.capOvertime) return { clockOut: rounded, capBeforeClockIn: false }

  // 段6：④。上限 ＝ 承認済みの残業申請（早出申請を除く）のうち最後に出した申請の終了時刻。無ければ定時
  const capHHMM = pickOvertimeCapEnd(requests.filter((r) => r.status === "APPROVED")) ?? schedule.end
  const cap = hhmmToUTCDate(capHHMM, jstDayStartUTC(rounded))
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
 * 段7（休憩）は勤務時間側（calcWorkingMinutes）の担当。ここには口だけ（後続が差し込む）。
 */
export function computeClockPipeline(input: PipelineInput): PipelineOutput {
  const { schedule, switches, requests } = input
  let clockIn = input.inputClockIn
  let clockOut = input.inputClockOut
  let earlyStartRequestApplied = false
  let capBeforeClockIn = false

  // 定時なし（休日など）は丸める基準が無いので記録時刻＝入力。遅刻・早退・残業も付けない
  if (schedule) {
    if (clockIn && !input.clockInIsFinal) {
      const r = computeClockIn(clockIn, schedule, switches, requests)
      clockIn = r.clockIn
      earlyStartRequestApplied = r.earlyRequestApplied
    }
    if (clockOut && !input.clockOutIsFinal) {
      const r = computeClockOut(clockOut, clockIn, schedule, switches, requests)
      clockOut = r.clockOut
      capBeforeClockIn = r.capBeforeClockIn
    }
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
 * 退勤の記録時刻が④（申請の時刻での打ち切り）で削られたか。画面で実打刻を併記するかの判定に使う
 * （④で打ち切った退勤には実打刻を併記しない。①〜③の丸めの差は従来どおり併記する）。
 * 実打刻を入力にして、④ありとなしの記録時刻を比べる。
 */
export function isClockOutCapped(p: {
  recordedClockIn: Date | null
  rawClockOut: Date | null
  schedule: DaySchedule
  switches: PipelineSwitches
  requests: PipelineRequest[]
}): boolean {
  if (!p.switches.capOvertime || !p.schedule || !p.rawClockOut) return false
  const base = {
    inputClockIn: p.recordedClockIn,
    clockInIsFinal: true,
    inputClockOut: p.rawClockOut,
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
 * - どちらも無い既存の記録は、記録時刻をそのまま入力にし、丸めない（source = "recorded"）
 * date は記録の日付（UTC 0時＝その日の JST 暦日）。変更履歴の値は "HH:MM"（JST）
 */
export function resolveInputTime(p: {
  date: Date
  raw: Date | null
  recorded: Date | null
  logs: { newValue: string | null; changedAt: Date }[]
}): { time: Date | null; source: InputSource } {
  const latest = p.logs
    .filter((l) => l.newValue && /^\d{1,2}:\d{2}$/.test(l.newValue))
    .sort((a, b) => b.changedAt.getTime() - a.changedAt.getTime())[0]
  if (latest && (!p.raw || p.raw.getTime() <= latest.changedAt.getTime())) {
    const [hh, mm] = latest.newValue!.split(":").map(Number)
    const time = new Date(Date.UTC(p.date.getUTCFullYear(), p.date.getUTCMonth(), p.date.getUTCDate(), hh - 9, mm))
    return { time, source: "corrected" }
  }
  if (p.raw) return { time: p.raw, source: "raw" }
  return { time: p.recorded, source: "recorded" }
}
