/**
 * 代理打刻（打刻ゼロの日への管理者後日打刻）の計算検証
 * 代理打刻の時刻は段1の入力になり、打刻パイプラインを通る。休日出勤フラグの日は定時なしで遅刻・早退が付かない。
 */
import { describe, it, expect } from "vitest"
import { calcWorkingMinutes, calcScheduledMinutes } from "../lib/attendance"
import { computeClockPipeline, resolveBreakMinutes } from "../lib/clock-pipeline"
import { OFF } from "./helpers/pipeline"

/** JST の日付・時刻から UTC の Date を作る（サーバーアクションの toUTC と同じ） */
function jst(dateISO: string, hhmm: string): Date {
  const [y, m, d] = dateISO.split("-").map(Number)
  const [hh, mm]  = hhmm.split(":").map(Number)
  return new Date(Date.UTC(y, m - 1, d, hh - 9, mm))
}

/** サーバーアクション actionAdminCreateRecord の保存値を再現する（スイッチは全OFFの既存の記録と同じ） */
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
  // 休日出勤の印がある日は定時なし（段0）
  const schedule = opts.isHolidayWork ? null : { start: opts.workStartTime, end: opts.workEndTime }
  const out = computeClockPipeline({
    inputClockIn: t(opts.clockIn), inputClockOut: t(opts.clockOut), schedule, switches: OFF, requests: [],
  })
  const workingMinutes = calcWorkingMinutes({
    clockIn: out.clockIn,
    clockOut: out.clockOut,
    goOutAt:    t(opts.goOutAt),
    returnAt:   t(opts.returnAt),
    // 段7：休憩分数（過去の休憩打刻は打刻の差、無ければ パート0／正社員は定時の拘束時間から求めた規定値）
    breakMinutes: resolveBreakMinutes({
      savedBreakMinutes: null,
      breakStart: t(opts.breakStart), breakEnd: t(opts.breakEnd),
      halfDay: null, employmentType: opts.employmentType, userBreakMinutes: null,
      workStartTime: opts.workStartTime, workEndTime: opts.workEndTime, daySchedule: schedule, isRestDay: !!opts.isHolidayWork,
      presenceMinutes: out.clockIn && out.clockOut
        ? Math.floor((out.clockOut.getTime() - out.clockIn.getTime() - (t(opts.goOutAt) && t(opts.returnAt) ? t(opts.returnAt)!.getTime() - t(opts.goOutAt)!.getTime() : 0)) / 60000)
        : null,
    }),
  })
  return {
    workingMinutes,
    lateMinutes:       out.lateMinutes,
    earlyLeaveMinutes: out.earlyLeaveMinutes,
    overtimeMinutes:   out.overtimeMinutes,
  }
}

const FULL = { workStartTime: "08:30", workEndTime: "17:30", employmentType: "full" }

describe("代理打刻の集計値", () => {
  it("(a) 平日 08:30〜17:30 は実働480分・遅刻早退なし", () => {
    expect(proxyPunch({ dateISO: "2026-07-28", clockIn: "08:30", clockOut: "17:30", ...FULL }))
      .toEqual({ workingMinutes: 480, lateMinutes: 0, earlyLeaveMinutes: 0, overtimeMinutes: 0 })
  })

  // 休日出勤の残業の計上（休日労働の割増）は後続の担当。定時なしの日は残業を付けない
  it("(b) 休日出勤 10:00〜15:00 は遅刻・早退を計上しない", () => {
    expect(proxyPunch({ dateISO: "2026-08-02", clockIn: "10:00", clockOut: "15:00", isHolidayWork: true, ...FULL }))
      .toEqual({ workingMinutes: 300, lateMinutes: 0, earlyLeaveMinutes: 0, overtimeMinutes: 0 })
  })

  it("(b') 同じ打刻でも休日出勤チェックなしなら遅刻90分・早退150分（フラグが効いていることの裏取り）", () => {
    expect(proxyPunch({ dateISO: "2026-08-02", clockIn: "10:00", clockOut: "15:00", ...FULL }))
      .toEqual({ workingMinutes: 240, lateMinutes: 90, earlyLeaveMinutes: 150, overtimeMinutes: 0 }) // 定時の日の正社員は拘束時間（9h）から規定の休憩60分を引く（段7）
  })

  it("(e) パートは休憩打刻がなければ法定休憩を控除しない。残業は定時との差なので 0（実働−所定の差し引きではない）", () => {
    expect(proxyPunch({
      dateISO: "2026-07-28", clockIn: "09:00", clockOut: "16:00",
      workStartTime: "09:00", workEndTime: "16:00", employmentType: "part",
    })).toEqual({ workingMinutes: 420, lateMinutes: 0, earlyLeaveMinutes: 0, overtimeMinutes: 0 })
  })

  it("パートの休憩打刻ありは実休憩分だけ控除する", () => {
    expect(proxyPunch({
      dateISO: "2026-07-28", clockIn: "09:00", clockOut: "16:00",
      breakStart: "12:00", breakEnd: "12:45",
      workStartTime: "09:00", workEndTime: "16:00", employmentType: "part",
    }).workingMinutes).toBe(375)
  })

  it("フルタイムの休憩は在席時間ではなく定時の拘束時間から決める（段7。8:30〜17:30＝9h → 60分）", () => {
    // 09:00〜16:00（420分）− 外出60分 − 規定の休憩60分 ＝ 300分（従来は在席360分の法定判定で控除0だった）
    expect(proxyPunch({
      dateISO: "2026-07-28", clockIn: "09:00", clockOut: "16:00",
      goOutAt: "12:00", returnAt: "13:00", ...FULL,
    }).workingMinutes).toBe(300)
  })

  it("退勤未入力なら実働は未確定（null）", () => {
    expect(proxyPunch({ dateISO: "2026-07-28", clockIn: "08:30", ...FULL }).workingMinutes).toBeNull()
  })

  it("JST深夜帯の日付でもUTCへ正しく変換される（0:00打刻）", () => {
    // JST 2026-07-28 00:00 = UTC 2026-07-27 15:00
    expect(jst("2026-07-28", "00:00").toISOString()).toBe("2026-07-27T15:00:00.000Z")
  })

  it("所定勤務時間（calcScheduledMinutes）＝ 拘束時間 − 所定休憩（残業の計算には使わない）", () => {
    expect(calcScheduledMinutes("08:30", "17:30", "full")).toBe(480)
  })
})
