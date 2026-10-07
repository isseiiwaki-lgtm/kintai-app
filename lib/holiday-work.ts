/**
 * 休日出勤申請（HOLIDAY_WORK）の純粋関数（docs/CLOCK_PIPELINE.md「休日出勤・振休・代休」）
 *
 * 申請の detail：{ startTime, endTime, restDate?, restKind? }
 * - startTime〜endTime：休日出勤する予定の時刻。承認された日は、これがその日の定時の代わりになる（段0）
 * - restDate：代わりに休む日（"YYYY-MM-DD"）。空欄でも申請できる
 * - breakMinutes：休憩（分。0〜240・15分刻み）。必須（旧い申請は無し）。承認されるとその日の breakMinutes に入る（休憩申請と同じ連鎖。
 *   休日は上長が確認して承認したときに初めて有効になる＝審査中は差し引かない）
 * - restKind：振休か代休か。**システムが決める**。休む日を申請と一緒に決めた＝"furikyu"（振休）、後で決めた＝"daikyu"（代休）。
 *   休む日が休日出勤の前でも後でもよい（区別は「いつ決めたか」）。一度決まった区別は、休む日を直しても変えない
 * 代休の残り時間は管理しない。代休は休日出勤申請1件にひも付く（restDate をその申請に持つ）
 */

import { calcLegalBreak } from "@/config/attendance.config"

export type RestKind = "furikyu" | "daikyu"

export type HolidayWorkDetail = {
  startTime?: string
  endTime?: string
  restDate?: string
  restKind?: RestKind
  breakMinutes?: string
}

const HHMM = /^\d{1,2}:\d{2}$/
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/

/** "HH:MM" を分にする。不正なら null */
function toMinutes(v: string | undefined): number | null {
  if (!v || !HHMM.test(v)) return null
  const [h, m] = v.split(":").map(Number)
  if (h > 24 || m > 59) return null
  return h * 60 + m
}

/** 予定の開始〜終了の検証。問題なければ null、あればエラーメッセージ */
export function validateHolidayWorkTimes(startTime: string | undefined, endTime: string | undefined): string | null {
  const s = toMinutes(startTime)
  const e = toMinutes(endTime)
  if (s === null || e === null) return "予定の開始・終了時刻を選んでください"
  if (e <= s) return "終了時刻は開始時刻より後にしてください"
  return null
}

/**
 * 休日出勤申請フォームの「休憩（分）」の初期値の目安：予定の開始〜終了の長さに旧い法定休憩の規則を当てる（6時間超45分・8時間超60分）。
 * 開始・終了が不正なら 0。あくまで目安で、本人が15分刻みで直せる
 */
export function defaultHolidayBreakMinutes(startTime: string | undefined, endTime: string | undefined): number {
  const s = toMinutes(startTime)
  const e = toMinutes(endTime)
  if (s === null || e === null || e <= s) return 0
  return calcLegalBreak(e - s)
}

/** 休む日の検証（空欄は許可）。休日出勤の日と同じ日は不可。問題なければ null */
export function validateRestDate(restDate: string | undefined, workDate: string): string | null {
  if (!restDate) return null
  if (!DATE_KEY.test(restDate) || Number.isNaN(Date.parse(`${restDate}T00:00:00Z`))) return "休む日の日付が正しくありません"
  if (restDate === workDate) return "休む日は休日出勤の日と別の日にしてください"
  return null
}

/** "YYYY-MM-DD" を UTC 0時からの通し日数にする */
function dayNumber(key: string): number {
  const [y, m, d] = key.split("-").map(Number)
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000)
}

/**
 * 2つの日付が同じ週か。週の起算日は会社設定（Setting.weekStartDay。0=日曜〜6=土曜）。
 * 休む日が休日出勤と別の週のとき、時間外の割増の可能性を知らせる確認に使う
 */
export function isSameWeek(a: string, b: string, weekStartDay: number): boolean {
  // 1970-01-01 は木曜（=4）。(通し日数 + 4) が曜日の7周期。起算日の曜日で週が切り替わるようにずらす
  const week = (key: string) => Math.floor((dayNumber(key) + 4 - weekStartDay) / 7)
  return week(a) === week(b)
}

/**
 * 振休か代休かを決める。休む日が空なら区別なし。
 * すでに区別が決まっているときは、休む日を直しても変えない。
 * 初めて休む日が入るとき：申請と一緒（本人の申請時）なら振休、後から（管理者が足したとき）なら代休
 */
export function resolveRestKind(p: {
  prevRestDate?: string | null
  prevRestKind?: string | null
  nextRestDate: string | null | undefined
  /** true：申請と一緒に決めた（本人の申請時）。false：後から決めた（管理者が足した） */
  decidedWithRequest: boolean
}): RestKind | undefined {
  if (!p.nextRestDate) return undefined
  if (p.prevRestDate && (p.prevRestKind === "furikyu" || p.prevRestKind === "daikyu")) return p.prevRestKind
  return p.decidedWithRequest ? "furikyu" : "daikyu"
}

export const REST_KIND_LABEL: Record<RestKind, string> = { furikyu: "振休", daikyu: "代休" }

/** "2026-10-12" → "10/12" */
export function fmtRestDate(key: string): string {
  const [, m, d] = key.split("-").map(Number)
  return `${m}/${d}`
}

/**
 * 振休・代休で休む日の行の表示。例：「振休（10/12 出勤分）」「代休（10/12 出勤分）」（10/12 は休日出勤した日）。
 * 欠勤に見えないよう、Excel・/records・管理者の承認詳細の休む日の行で同じ文言を使う
 */
export function restDayLabel(kind: RestKind | string | undefined, workDateKey: string): string {
  const k = kind === "daikyu" ? "daikyu" : "furikyu"
  return `${REST_KIND_LABEL[k]}（${fmtRestDate(workDateKey)} 出勤分）`
}

/**
 * 期間内の休む日（restDate）を持つ休日出勤申請を DB から絞るための "YYYY-MM" の接頭辞（期間にかかる月）。
 * 休む日は申請の detail（JSON）にあり、休日出勤した日（targetDate）は期間の外のこともあるので、休む日で引く
 */
export function restDateMonthPrefixes(firstDay: Date, lastDay: Date): string[] {
  const out: string[] = []
  const d = new Date(Date.UTC(firstDay.getUTCFullYear(), firstDay.getUTCMonth(), 1))
  const end = Date.UTC(lastDay.getUTCFullYear(), lastDay.getUTCMonth(), 1)
  while (d.getTime() <= end) {
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`)
    d.setUTCMonth(d.getUTCMonth() + 1)
  }
  return out
}

/**
 * 承認済みの休日出勤申請から、休む日（"YYYY-MM-DD"）→ 表示ラベル（「振休（10/12 出勤分）」）の対応を作る。
 * 同じ休む日に複数あれば最後に出した申請。休む日が無い申請は対象外。
 * targetDate は休日出勤した日（UTC 0時の通し日）。Excel・/records の休む日の行で使う
 */
export function buildRestDayLabels(
  requests: { targetDate: Date; createdAt: Date; detail?: unknown }[],
): Map<string, string> {
  const sorted = [...requests].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
  const map = new Map<string, string>()
  for (const r of sorted) {
    const d = r.detail as HolidayWorkDetail | null | undefined
    if (!d?.restDate || !DATE_KEY.test(d.restDate)) continue
    map.set(d.restDate, restDayLabel(d.restKind, r.targetDate.toISOString().slice(0, 10)))
  }
  return map
}

/**
 * 休む日のラベルがあるのに勤怠記録が無い日（"YYYY-MM-DD"）を、期間内（firstKey〜lastKey を含む）で昇順に返す。
 * 管理者の承認詳細で、記録の無い休む日にもラベルだけの行を出すのに使う（日付キーは同じ書式の文字列比較）
 */
export function labelOnlyRestDates(
  labels: Map<string, string>,
  recordDateKeys: Set<string>,
  firstKey: string,
  lastKey: string,
): string[] {
  return [...labels.keys()]
    .filter((k) => k >= firstKey && k <= lastKey && !recordDateKeys.has(k))
    .sort()
}

/** 申請一覧・承認画面の内容欄の文言。例：「休日出勤 9:00〜15:00・振休 10/12」「…・休む日未定」 */
export function holidayWorkSummary(detail: HolidayWorkDetail | null | undefined): string {
  if (!detail) return ""
  const brk = detail.breakMinutes != null && detail.breakMinutes !== "" ? `（休憩 ${detail.breakMinutes}分）` : ""
  const time = (detail.startTime && detail.endTime ? `休日出勤 ${detail.startTime}〜${detail.endTime}` : "休日出勤") + brk
  if (!detail.restDate) return `${time}・休む日未定`
  const kind = detail.restKind ? REST_KIND_LABEL[detail.restKind] : "休む日"
  return `${time}・${kind} ${fmtRestDate(detail.restDate)}`
}
