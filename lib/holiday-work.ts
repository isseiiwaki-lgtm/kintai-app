/**
 * 休日出勤申請（HOLIDAY_WORK）の純粋関数（docs/CLOCK_PIPELINE.md「休日出勤・振休・代休」）
 *
 * 申請の detail：{ startTime, endTime, restDate?, restKind? }
 * - startTime〜endTime：休日出勤する予定の時刻。承認された日は、これがその日の定時の代わりになる（段0）
 * - restDate：代わりに休む日（"YYYY-MM-DD"）。空欄でも申請できる
 * - restKind：振休か代休か。**システムが決める**。休む日を申請と一緒に決めた＝"furikyu"（振休）、後で決めた＝"daikyu"（代休）。
 *   休む日が休日出勤の前でも後でもよい（区別は「いつ決めたか」）。一度決まった区別は、休む日を直しても変えない
 * 代休の残り時間は管理しない。代休は休日出勤申請1件にひも付く（restDate をその申請に持つ）
 */

export type RestKind = "furikyu" | "daikyu"

export type HolidayWorkDetail = {
  startTime?: string
  endTime?: string
  restDate?: string
  restKind?: RestKind
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

/** 申請一覧・承認画面の内容欄の文言。例：「休日出勤 9:00〜15:00・振休 10/12」「…・休む日未定」 */
export function holidayWorkSummary(detail: HolidayWorkDetail | null | undefined): string {
  if (!detail) return ""
  const time = detail.startTime && detail.endTime ? `休日出勤 ${detail.startTime}〜${detail.endTime}` : "休日出勤"
  if (!detail.restDate) return `${time}・休む日未定`
  const kind = detail.restKind ? REST_KIND_LABEL[detail.restKind] : "休む日"
  return `${time}・${kind} ${fmtRestDate(detail.restDate)}`
}
