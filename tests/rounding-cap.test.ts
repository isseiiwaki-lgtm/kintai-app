/**
 * ③15分丸め と ④残業の申請上限（計画 H の具体例をそのままなぞる）
 * 定時 9:00–17:30 / ③④ON を基本とする。
 * 15分の区切りは本人の定時を起点にする（時計の :00/:15 ではない）。
 */
import { describe, it, expect } from "vitest"
import {
  applyRounding,
  calcMetrics,
  computeRecordedClockIn,
  computeRecordedClockOut,
  hasOvertimeRequest,
  needsOvertimeRequestNotice,
  pickOvertimeCapEnd,
  type OvertimeRequestLike,
} from "../lib/attendance"

function jst(h: number, mi: number, day = 5): Date {
  return new Date(Date.UTC(2026, 9, day, h, mi) - 9 * 60 * 60 * 1000)
}
/** 記録時刻を JST の HH:MM で読む */
function hm(d: Date): string {
  const j = new Date(d.getTime() + 9 * 60 * 60 * 1000)
  return `${String(j.getUTCHours()).padStart(2, "0")}:${String(j.getUTCMinutes()).padStart(2, "0")}`
}

const START = "09:00"
const END   = "17:30"
const ON    = { roundEarlyClockIn: false, roundNearClockTime: false, roundQuarterHour: true,  capOvertimeByRequest: true  }
const OFF   = { roundEarlyClockIn: false, roundNearClockTime: false, roundQuarterHour: false, capOvertimeByRequest: false }

function overtimeReq(endTime: string, createdAt: Date, status = "APPROVED"): OvertimeRequestLike {
  return { type: "OVERTIME", status, createdAt, detail: { endTime } }
}

describe("③15分丸め（出勤: 切り上げ）", () => {
  it("9:23 出勤 → 記録 9:30・遅刻30分（③OFF なら 9:23・遅刻23分）", () => {
    const on  = computeRecordedClockIn(jst(9, 23), { workStartTime: START, setting: ON,  hasEarlyStartRequest: false })
    const off = computeRecordedClockIn(jst(9, 23), { workStartTime: START, setting: OFF, hasEarlyStartRequest: false })
    expect(hm(on)).toBe("09:30")
    expect(hm(off)).toBe("09:23")
    const m = (clockIn: Date) => calcMetrics({
      clockIn, clockOut: null, workingMinutes: null, workStartTime: START, workEndTime: END, scheduledMinutes: 450,
    })
    expect(m(on).lateMinutes).toBe(30)
    expect(m(off).lateMinutes).toBe(23)
  })

  it("8:10 出勤・①OFF → 8:15（早出を15分単位で計上）", () => {
    expect(hm(computeRecordedClockIn(jst(8, 10), { workStartTime: START, setting: ON, hasEarlyStartRequest: false }))).toBe("08:15")
  })

  it("①ON なら定時前は①が先に当たり定時（8:10 → 9:00）", () => {
    const s = { ...ON, roundEarlyClockIn: true }
    expect(hm(computeRecordedClockIn(jst(8, 10), { workStartTime: START, setting: s, hasEarlyStartRequest: false }))).toBe("09:00")
  })

  it("早出申請がある日も③は効く（①②は無効）: 8:10 → 8:15", () => {
    const s = { ...ON, roundEarlyClockIn: true }
    expect(hm(computeRecordedClockIn(jst(8, 10), { workStartTime: START, setting: s, hasEarlyStartRequest: true }))).toBe("08:15")
  })

  it("区切りちょうどはそのまま（9:15 → 9:15、9:16 → 9:30）", () => {
    expect(hm(applyRounding(jst(9, 15), START, { roundEarly: false, roundNear: true, roundQuarter: true, kind: "in" }))).toBe("09:15")
    expect(hm(applyRounding(jst(9, 16), START, { roundEarly: false, roundNear: true, roundQuarter: true, kind: "in" }))).toBe("09:30")
  })

  it("JST 深夜帯でも基準日がずれない（0:30 打刻・定時 8:30）", () => {
    expect(hm(applyRounding(jst(0, 20), "08:30", { roundEarly: false, roundNear: false, roundQuarter: true, kind: "in" }))).toBe("00:30")
  })
})

describe("③15分丸め（退勤: 切り捨て）と④申請上限", () => {
  const out = (raw: Date, reqs: OvertimeRequestLike[], setting = ON, clockIn = jst(9, 0)) =>
    hm(computeRecordedClockOut(raw, {
      workEndTime: END, clockIn, setting,
      hasOvertimeRequest: hasOvertimeRequest(reqs),
      capEndTime: pickOvertimeCapEnd(reqs),
    }))

  const req1930 = [overtimeReq("19:30", new Date("2026-10-01T00:00:00Z"))]

  it("申請 19:30・19:16 退勤 → 19:15", () => expect(out(jst(19, 16), req1930)).toBe("19:15"))
  it("申請 19:30・19:36 退勤 → 19:30", () => expect(out(jst(19, 36), req1930)).toBe("19:30"))
  it("申請 19:30・19:51 退勤 → 19:30（上限）", () => expect(out(jst(19, 51), req1930)).toBe("19:30"))

  it("申請なし・18:40 退勤 → 17:30（上限＝定時）・残業0分", () => {
    expect(out(jst(18, 40), [])).toBe("17:30")
    const rec = computeRecordedClockOut(jst(18, 40), {
      workEndTime: END, clockIn: jst(9, 0), setting: ON, hasOvertimeRequest: false, capEndTime: null,
    })
    const m = calcMetrics({ clockIn: jst(9, 0), clockOut: rec, workingMinutes: 450, workStartTime: START, workEndTime: END, scheduledMinutes: 450 })
    expect(m.overtimeMinutes).toBe(0)
  })

  it("申請なし・17:40 退勤 → 17:30（②で吸収）", () => expect(out(jst(17, 40), [])).toBe("17:30"))

  it("③④OFF・②ON・17:43 退勤 → 17:30／17:50 退勤 → 17:50", () => {
    const s = { ...OFF, roundNearClockTime: true }
    expect(out(jst(17, 43), [], s)).toBe("17:30")
    expect(out(jst(17, 50), [], s)).toBe("17:50")
  })

  it("定時が区切り外（終業 17:40）・17:43 退勤・③ON → 17:40（17:30 にならない）", () => {
    // 15分の区切りは本人の定時（17:40）を起点に刻む。時計刻みだと 17:30 になり早退10分が生まれる
    const t = hm(computeRecordedClockOut(jst(17, 43), {
      workEndTime: "17:40", clockIn: jst(9, 10),
      setting: { ...OFF, roundQuarterHour: true }, hasOvertimeRequest: false, capEndTime: null,
    }))
    expect(t).toBe("17:40")
    // 17:55 → 17:55（17:40 + 15）。時計刻みの 17:45 にはならない
    const t2 = hm(computeRecordedClockOut(jst(17, 58), {
      workEndTime: "17:40", clockIn: jst(9, 10),
      setting: { ...OFF, roundQuarterHour: true }, hasOvertimeRequest: false, capEndTime: null,
    }))
    expect(t2).toBe("17:55")
  })

  it("定時が区切り外の出勤（始業 9:10）: 9:12 出勤 → 9:25（始業から15分刻み）", () => {
    expect(hm(computeRecordedClockIn(jst(9, 12), { workStartTime: "09:10", setting: ON, hasEarlyStartRequest: false }))).toBe("09:25")
  })

  it("早退側も切り捨て: 17:20 退勤（定時 17:30）→ 17:15（早退15分）", () => {
    expect(out(jst(17, 20), [])).toBe("17:15")
  })

  it("残業申請がある日も③は効く: 17:30〜18:07 → 18:00・残業30分", () => {
    const reqs = [overtimeReq("19:00", new Date("2026-10-01T00:00:00Z"))]
    expect(out(jst(18, 7), reqs)).toBe("18:00")
  })

  it("早出申請は上限に使わない（残業申請なし扱い → 定時）", () => {
    const early: OvertimeRequestLike = {
      type: "OVERTIME", status: "APPROVED", createdAt: new Date("2026-10-01T00:00:00Z"),
      detail: { overtimeType: "earlyStart", startTime: "08:00" },
    }
    expect(pickOvertimeCapEnd([early])).toBeNull()
    expect(hasOvertimeRequest([early])).toBe(false)
    expect(out(jst(18, 40), [early])).toBe("17:30")
  })

  it("承認済み残業申請が複数: 最後に出した申請の終了時刻が上限（短く出し直した場合も反映）", () => {
    const reqs = [
      overtimeReq("20:00", new Date("2026-10-01T00:00:00Z")),
      overtimeReq("19:00", new Date("2026-10-02T00:00:00Z")),  // 後から出した（短い）
    ]
    expect(pickOvertimeCapEnd(reqs)).toBe("19:00")
    expect(out(jst(19, 50), reqs)).toBe("19:00")
  })

  it("審査中の申請は上限に使わない（承認されるまで定時が上限）が、②は無効にする", () => {
    const pending = [overtimeReq("19:30", new Date("2026-10-01T00:00:00Z"), "PENDING")]
    expect(pickOvertimeCapEnd(pending)).toBeNull()
    expect(hasOvertimeRequest(pending)).toBe(true)
    expect(out(jst(19, 0), pending)).toBe("17:30")
  })

  it("却下された申請は無かったことになる", () => {
    const rejected = [overtimeReq("19:30", new Date("2026-10-01T00:00:00Z"), "REJECTED")]
    expect(hasOvertimeRequest(rejected)).toBe(false)
    expect(pickOvertimeCapEnd(rejected)).toBeNull()
  })

  it("実打刻は書き換えない（raw は別引数のまま、返すのは記録時刻だけ）", () => {
    const raw = jst(19, 51)
    const before = raw.getTime()
    computeRecordedClockOut(raw, { workEndTime: END, clockIn: jst(9, 0), setting: ON, hasOvertimeRequest: true, capEndTime: "19:30" })
    expect(raw.getTime()).toBe(before)
  })

  it("上限が出勤時刻以前になるときは上限を掛けない（勤務時間が負にならない）", () => {
    // 18:00 に出勤した人（定時 17:30）が 20:00 退勤: 上限 17:30 は出勤より前
    expect(out(jst(20, 0), [], ON, jst(18, 0))).toBe("20:00")
  })

  it("④だけOFF（③ON）なら上限を掛けない", () => {
    const s = { ...ON, capOvertimeByRequest: false }
    expect(out(jst(18, 40), [], s)).toBe("18:30")
  })
})

describe("遅刻・早退は記録時刻から出す（③に連動・実打刻から出さない）", () => {
  it("③ON: 9:23 → 9:30 で遅刻30分。退勤 17:20 → 17:15 で早退15分", () => {
    const clockIn  = computeRecordedClockIn(jst(9, 23), { workStartTime: START, setting: ON, hasEarlyStartRequest: false })
    const clockOut = computeRecordedClockOut(jst(17, 20), {
      workEndTime: END, clockIn, setting: ON, hasOvertimeRequest: false, capEndTime: null,
    })
    const m = calcMetrics({ clockIn, clockOut, workingMinutes: 400, workStartTime: START, workEndTime: END, scheduledMinutes: 450 })
    expect(m.lateMinutes).toBe(30)
    expect(m.earlyLeaveMinutes).toBe(15)
  })
})

describe("残業申請が無い日の注意表示の判定", () => {
  const base = { workEndTime: END, capEnabled: true }
  it("実打刻が定時を15分以上過ぎ・申請なし → 対象（17:45）", () => {
    expect(needsOvertimeRequestNotice({ ...base, rawClockOut: jst(17, 45), hasOvertimeRequest: false })).toBe(true)
  })
  it("14分以内（17:44）は②で吸収されるいつもの運用なので対象外", () => {
    expect(needsOvertimeRequestNotice({ ...base, rawClockOut: jst(17, 44), hasOvertimeRequest: false })).toBe(false)
  })
  it("残業申請（申請中・承認済）があれば対象外", () => {
    expect(needsOvertimeRequestNotice({ ...base, rawClockOut: jst(19, 0), hasOvertimeRequest: true })).toBe(false)
  })
  it("④OFF なら対象外（何も削らない）", () => {
    expect(needsOvertimeRequestNotice({ ...base, capEnabled: false, rawClockOut: jst(19, 0), hasOvertimeRequest: false })).toBe(false)
  })
  it("退勤未打刻・定時未設定は対象外", () => {
    expect(needsOvertimeRequestNotice({ ...base, rawClockOut: null, hasOvertimeRequest: false })).toBe(false)
    expect(needsOvertimeRequestNotice({ ...base, workEndTime: null, rawClockOut: jst(19, 0), hasOvertimeRequest: false })).toBe(false)
  })
})
