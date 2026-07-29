/**
 * 代理打刻（打刻ゼロの日への管理者後日打刻）の計算検証
 * 合意した具体例をそのままなぞる。休日出勤フラグによる遅刻・早退の抑止が主眼。
 */
import { describe, it, expect } from "vitest"
import { calcWorkingMinutes, calcMetrics, calcScheduledMinutes } from "../lib/attendance"

/** JST の日付・時刻から UTC の Date を作る（サーバーアクションの toUTC と同じ） */
function jst(dateISO: string, hhmm: string): Date {
  const [y, m, d] = dateISO.split("-").map(Number)
  const [hh, mm]  = hhmm.split(":").map(Number)
  return new Date(Date.UTC(y, m - 1, d, hh - 9, mm))
}

/** サーバーアクション actionAdminCreateRecord の保存値を再現する */
function proxyPunch(opts: {
  dateISO: string
  clockIn: string
  clockOut?: string
  goOutAt?: string
  returnAt?: string
  breakStart?: string
  breakEnd?: string
  workStartTime: string
  workEndTime: string
  employmentType: string
  isHolidayWork?: boolean
}) {
  const t = (v?: string) => (v ? jst(opts.dateISO, v) : null)
  const clockIn  = t(opts.clockIn)!
  const clockOut = t(opts.clockOut)

  const workingMinutes = calcWorkingMinutes({
    clockIn,
    clockOut,
    goOutAt:    t(opts.goOutAt),
    returnAt:   t(opts.returnAt),
    breakStart: t(opts.breakStart),
    breakEnd:   t(opts.breakEnd),
    employmentType: opts.employmentType,
  })

  const scheduledMinutes = calcScheduledMinutes(opts.workStartTime, opts.workEndTime, opts.employmentType)
  const metrics = calcMetrics({
    clockIn, clockOut, workingMinutes,
    workStartTime: opts.workStartTime,
    workEndTime:   opts.workEndTime,
    scheduledMinutes,
  })

  return {
    workingMinutes,
    lateMinutes:       opts.isHolidayWork ? 0 : metrics.lateMinutes,
    earlyLeaveMinutes: opts.isHolidayWork ? 0 : metrics.earlyLeaveMinutes,
    overtimeMinutes:   metrics.overtimeMinutes,
  }
}

const FULL = { workStartTime: "08:30", workEndTime: "17:30", employmentType: "full" }

describe("代理打刻の集計値", () => {
  it("(a) 平日 08:30〜17:30 は実働480分・遅刻早退なし", () => {
    expect(proxyPunch({ dateISO: "2026-07-28", clockIn: "08:30", clockOut: "17:30", ...FULL }))
      .toEqual({ workingMinutes: 480, lateMinutes: 0, earlyLeaveMinutes: 0, overtimeMinutes: 0 })
  })

  // 注: overtimeMinutes が 0 なのは「実働300分 − 所定480分」が負になるための結果であり、
  // 休日労働の割増を意図した仕様ではない（STATUS.md 未完了タスク「休日労働の割増計上」参照）
  it("(b) 休日出勤 10:00〜15:00 は遅刻・早退を計上しない", () => {
    expect(proxyPunch({ dateISO: "2026-08-02", clockIn: "10:00", clockOut: "15:00", isHolidayWork: true, ...FULL }))
      .toEqual({ workingMinutes: 300, lateMinutes: 0, earlyLeaveMinutes: 0, overtimeMinutes: 0 })
  })

  it("(b') 同じ打刻でも休日出勤チェックなしなら遅刻90分・早退150分（フラグが効いていることの裏取り）", () => {
    expect(proxyPunch({ dateISO: "2026-08-02", clockIn: "10:00", clockOut: "15:00", ...FULL }))
      .toEqual({ workingMinutes: 300, lateMinutes: 90, earlyLeaveMinutes: 150, overtimeMinutes: 0 })
  })

  it("(e) パートは休憩打刻がなければ法定休憩を控除しない", () => {
    // 実働は在席時間そのまま420分。一方 scheduledMinutes は所定7hから法定休憩45分を引いた375分のため
    // 差分45分が残業に出る（通常打刻でも起きる既存挙動。STATUS.md 懸念事項「パート休憩打刻漏れ」と同根）
    expect(proxyPunch({
      dateISO: "2026-07-28", clockIn: "09:00", clockOut: "16:00",
      workStartTime: "09:00", workEndTime: "16:00", employmentType: "part",
    })).toEqual({ workingMinutes: 420, lateMinutes: 0, earlyLeaveMinutes: 0, overtimeMinutes: 45 })
  })

  it("パートの休憩打刻ありは実休憩分だけ控除する", () => {
    expect(proxyPunch({
      dateISO: "2026-07-28", clockIn: "09:00", clockOut: "16:00",
      breakStart: "12:00", breakEnd: "12:45",
      workStartTime: "09:00", workEndTime: "16:00", employmentType: "part",
    }).workingMinutes).toBe(375)
  })

  it("フルタイムは外出時間を除いた在席時間で法定休憩を判定する（6h境界）", () => {
    // 09:00〜16:00（420分）から外出60分を引くと360分ちょうど＝6h超えないので控除0
    expect(proxyPunch({
      dateISO: "2026-07-28", clockIn: "09:00", clockOut: "16:00",
      goOutAt: "12:00", returnAt: "13:00", ...FULL,
    }).workingMinutes).toBe(360)
  })

  it("退勤未入力なら実働は未確定（null）", () => {
    expect(proxyPunch({ dateISO: "2026-07-28", clockIn: "08:30", ...FULL }).workingMinutes).toBeNull()
  })

  it("JST深夜帯の日付でもUTCへ正しく変換される（0:00打刻）", () => {
    // JST 2026-07-28 00:00 = UTC 2026-07-27 15:00
    expect(jst("2026-07-28", "00:00").toISOString()).toBe("2026-07-27T15:00:00.000Z")
  })
})
