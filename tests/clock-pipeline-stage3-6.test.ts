/**
 * 段3：② / 段4：遅刻・早退 / 段5：③ / 段6：④（docs/CLOCK_PIPELINE.md）
 */
import { describe, it, expect } from "vitest"
import { applyRounding, hasOvertimeRequest, needsOvertimeRequestNotice, pickOvertimeCapEnd } from "../lib/attendance"
import { isClockOutCapped } from "../lib/clock-pipeline"
import { OFF, ON34, SCHEDULE, earlyReq, hm, jst, overtimeReq, run, sw } from "./helpers/pipeline"

describe("段3：②の端数処理（申請の有無に関係なく効く）", () => {
  const near = sw({ roundNear: true })
  it("定時から14分以内の早出側：8:50 → 9:00、8:46 → 9:00、8:45 → 8:45", () => {
    expect(hm(run({ in: jst(8, 50), switches: near }).clockIn)).toBe("09:00")
    expect(hm(run({ in: jst(8, 46), switches: near }).clockIn)).toBe("09:00")
    expect(hm(run({ in: jst(8, 45), switches: near }).clockIn)).toBe("08:45")
  })
  it("定時から14分以内の残業側：17:43 → 17:30、17:44 → 17:30、17:50 → 17:50", () => {
    expect(hm(run({ out: jst(17, 43), switches: near }).clockOut)).toBe("17:30")
    expect(hm(run({ out: jst(17, 44), switches: near }).clockOut)).toBe("17:30")
    expect(hm(run({ out: jst(17, 50), switches: near }).clockOut)).toBe("17:50")
  })
  it("遅刻・早退側は丸めない：9:10 出勤は 9:10、17:20 退勤は 17:20", () => {
    expect(hm(run({ in: jst(9, 10), switches: near }).clockIn)).toBe("09:10")
    expect(hm(run({ out: jst(17, 20), switches: near }).clockOut)).toBe("17:20")
  })
  it("残業申請（承認済み）がある日も②は効く（H の「申請日は②無効」をやめた）：17:40 退勤 → 17:30", () => {
    expect(hm(run({ out: jst(17, 40), switches: near, requests: [overtimeReq("19:00")] }).clockOut)).toBe("17:30")
  })
  it("早出申請がある日も②は効く：申請 8:00・④OFF・8:50 → 申請無効のうえ ② で 9:00", () => {
    expect(hm(run({ in: jst(8, 50), switches: near, requests: [earlyReq("08:00")] }).clockIn)).toBe("09:00")
  })
  it("③ONなら②も実効ON（③ON・②OFF でも 17:40 → 17:30）", () => {
    expect(hm(run({ out: jst(17, 40), switches: sw({ roundQuarter: true }) }).clockOut)).toBe("17:30")
  })
})

describe("段4：遅刻・早退は記録時刻と定時の差だけで出す", () => {
  it("③OFF は1分単位：9:23 出勤 → 遅刻23分、17:07 退勤 → 早退23分", () => {
    const r = run({ in: jst(9, 23), out: jst(17, 7) })
    expect(r.lateMinutes).toBe(23)
    expect(r.earlyLeaveMinutes).toBe(23)
  })
  it("③ON は15単位：9:23 → 記録 9:30・遅刻30分。17:20 → 記録 17:15・早退15分", () => {
    const r = run({ in: jst(9, 23), out: jst(17, 20), switches: ON34 })
    expect(hm(r.clockIn)).toBe("09:30")
    expect(r.lateMinutes).toBe(30)
    expect(hm(r.clockOut)).toBe("17:15")
    expect(r.earlyLeaveMinutes).toBe(15)
  })
  it("定時後の退勤は早退0（残業側）", () => {
    expect(run({ in: jst(9, 0), out: jst(18, 0) }).earlyLeaveMinutes).toBe(0)
  })
  it("退勤前（出勤だけ）は遅刻だけ", () => {
    expect(run({ in: jst(9, 20) })).toMatchObject({ lateMinutes: 20, earlyLeaveMinutes: 0 })
  })
  it("遅刻・早退の申請は記録時刻を上書きしない（申請は入力に入らない）：時刻は実打刻のまま", () => {
    const requests = [{ type: "ABSENCE", status: "APPROVED", createdAt: new Date(), detail: { absenceType: "late", time: "09:30" } }]
    expect(hm(run({ in: jst(9, 50), requests }).clockIn)).toBe("09:50")
  })
  it("早出して早退した日は、早出（残業）と早退をそれぞれ出す（差し引きしない）", () => {
    const r = run({ in: jst(8, 0), out: jst(16, 0) })
    expect(r.earlyStartMinutes).toBe(60)
    expect(r.earlyLeaveMinutes).toBe(90)
    expect(r.overtimeMinutes).toBe(60)
  })
})

describe("段5：③の15分丸め（出勤は切り上げ・退勤は切り捨て。区切りは定時が起点）", () => {
  const q = sw({ roundQuarter: true })
  it("9:23 出勤 → 9:30（③OFF なら 9:23）", () => {
    expect(hm(run({ in: jst(9, 23), switches: q }).clockIn)).toBe("09:30")
    expect(hm(run({ in: jst(9, 23) }).clockIn)).toBe("09:23")
  })
  it("8:10 出勤・①OFF → 8:15（早出を15分単位で計上）", () => {
    expect(hm(run({ in: jst(8, 10), switches: q }).clockIn)).toBe("08:15")
  })
  it("①ON なら定時前は①が先に当たり定時（8:10 → 9:00）", () => {
    expect(hm(run({ in: jst(8, 10), switches: sw({ roundQuarter: true, roundEarly: true }) }).clockIn)).toBe("09:00")
  })
  it("区切りちょうどはそのまま（9:15 → 9:15、9:16 → 9:30）", () => {
    expect(hm(run({ in: jst(9, 15), switches: q }).clockIn)).toBe("09:15")
    expect(hm(run({ in: jst(9, 16), switches: q }).clockIn)).toBe("09:30")
  })
  it("退勤は切り捨て：17:20 → 17:15、18:07 → 18:00", () => {
    expect(hm(run({ out: jst(17, 20), switches: q }).clockOut)).toBe("17:15")
    expect(hm(run({ out: jst(18, 7), switches: q }).clockOut)).toBe("18:00")
  })
  it("定時が区切り外（終業 17:40）：17:43 退勤 → 17:40（時計刻みの 17:30 にならない）、17:58 → 17:55", () => {
    const schedule = { start: "09:10", end: "17:40" }
    expect(hm(run({ out: jst(17, 43), switches: q, schedule }).clockOut)).toBe("17:40")
    expect(hm(run({ out: jst(17, 58), switches: q, schedule }).clockOut)).toBe("17:55")
  })
  it("定時が区切り外の出勤（始業 9:10）：9:12 → 9:25（始業から15分刻み）", () => {
    expect(hm(run({ in: jst(9, 12), switches: q, schedule: { start: "09:10", end: "17:40" } }).clockIn)).toBe("09:25")
  })
  it("早出・残業申請がある日も効く：残業申請 19:00・18:07 退勤 → 18:00（残業30分）", () => {
    const r = run({ in: jst(9, 0), out: jst(18, 7), switches: q, requests: [overtimeReq("19:00")] })
    expect(hm(r.clockOut)).toBe("18:00")
    expect(r.overtimeMinutes).toBe(30)
  })
  it("JST 深夜帯でも基準日がずれない（0:20 打刻・定時 8:30・③ → 0:30）", () => {
    expect(hm(applyRounding(jst(0, 20), "08:30", { roundEarly: false, roundNear: false, roundQuarter: true, kind: "in" }))).toBe("00:30")
  })
})

describe("段6：④の打ち切り（退勤 ＝ min(段5までの退勤, 上限)）", () => {
  const out = (raw: Date, requests = [] as ReturnType<typeof overtimeReq>[], switches = ON34, clockIn = jst(9, 0)) =>
    run({ in: clockIn, out: raw, switches, requests })
  const req1930 = [overtimeReq("19:30")]

  it("申請 19:30・19:16 退勤 → 19:15", () => expect(hm(out(jst(19, 16), req1930).clockOut)).toBe("19:15"))
  it("申請 19:30・19:36 退勤 → 19:30", () => expect(hm(out(jst(19, 36), req1930).clockOut)).toBe("19:30"))
  it("申請 19:30・19:51 退勤 → 19:30（上限）", () => expect(hm(out(jst(19, 51), req1930).clockOut)).toBe("19:30"))
  it("申請なし・18:40 退勤 → 17:30（上限＝定時）・残業0分", () => {
    const r = out(jst(18, 40))
    expect(hm(r.clockOut)).toBe("17:30")
    expect(r.overtimeMinutes).toBe(0)
  })
  it("申請なし・17:40 退勤 → 17:30（②で吸収）", () => expect(hm(out(jst(17, 40)).clockOut)).toBe("17:30"))
  it("④OFF なら打ち切らない（③ON のみ・18:40 → 18:30）", () => {
    expect(hm(out(jst(18, 40), [], sw({ roundQuarter: true })).clockOut)).toBe("18:30")
  })
  it("早出申請は上限に使わない（残業申請なし扱い → 定時）", () => {
    const early = earlyReq("08:00")
    expect(pickOvertimeCapEnd([early])).toBeNull()
    expect(hasOvertimeRequest([early])).toBe(false)
    expect(hm(out(jst(18, 40), [early]).clockOut)).toBe("17:30")
  })
  it("承認済み残業申請が複数：最後に出した申請の終了時刻が上限（短く出し直した場合も反映）", () => {
    const reqs = [overtimeReq("20:00", new Date("2026-10-01T00:00:00Z")), overtimeReq("19:00", new Date("2026-10-02T00:00:00Z"))]
    expect(pickOvertimeCapEnd(reqs)).toBe("19:00")
    expect(hm(out(jst(19, 50), reqs).clockOut)).toBe("19:00")
  })
  it("審査中・却下の申請は上限に使わない（承認されるまで定時が上限）", () => {
    expect(hm(out(jst(19, 0), [overtimeReq("19:30", undefined, "PENDING")]).clockOut)).toBe("17:30")
    expect(hm(out(jst(19, 0), [overtimeReq("19:30", undefined, "REJECTED")]).clockOut)).toBe("17:30")
  })
  it("実打刻は書き換えない（入力の Date はそのまま）", () => {
    const raw = jst(19, 51)
    const before = raw.getTime()
    out(raw, req1930)
    expect(raw.getTime()).toBe(before)
  })
  it("上限が出勤より前（定時後に出勤・申請なし）なら勤務0分：18:00 出勤・20:00 退勤 → 退勤は出勤に揃え、残業0・注意表示の対象", () => {
    const r = out(jst(20, 0), [], ON34, jst(18, 0))
    expect(r.capBeforeClockIn).toBe(true)
    expect(hm(r.clockOut)).toBe("18:00")
    expect(r.overtimeMinutes).toBe(0)
  })
  it("④OFF なら上限が出勤より前でも何もしない（20:00 のまま）", () => {
    const r = out(jst(20, 0), [], sw({ roundQuarter: true }), jst(18, 0))
    expect(r.capBeforeClockIn).toBe(false)
    expect(hm(r.clockOut)).toBe("20:00")
  })

  it("④で打ち切られたか（/records で実打刻を併記するかの判定）", () => {
    const base = { recordedClockIn: jst(9, 0), schedule: SCHEDULE, requests: [] as ReturnType<typeof overtimeReq>[] }
    // 19:51 退勤・申請なし・④ON → 17:30 に打ち切り → 併記しない
    expect(isClockOutCapped({ ...base, inputClockOut: jst(19, 51), switches: ON34 })).toBe(true)
    // ③の丸めだけで変わった（17:20 → 17:15）は打ち切りではない → 従来どおり併記
    expect(isClockOutCapped({ ...base, inputClockOut: jst(17, 20), switches: ON34 })).toBe(false)
    // ④OFF は打ち切りなし
    expect(isClockOutCapped({ ...base, inputClockOut: jst(19, 51), switches: sw({ roundQuarter: true }) })).toBe(false)
    // 申請 19:30 の範囲内（19:16 → 19:15）は打ち切りではない
    expect(isClockOutCapped({ ...base, inputClockOut: jst(19, 16), switches: ON34, requests: [overtimeReq("19:30")] })).toBe(false)
  })
})

describe("残業申請が無い日の注意表示の判定（④ON のときだけ）", () => {
  const base = { workEndTime: "17:30", capEnabled: true }
  it("実打刻が定時を15分以上過ぎ・申請なし → 対象（17:45）", () => {
    expect(needsOvertimeRequestNotice({ ...base, rawClockOut: jst(17, 45), hasOvertimeRequest: false })).toBe(true)
  })
  it("14分以内（17:44）は②で吸収されるいつもの運用なので対象外", () => {
    expect(needsOvertimeRequestNotice({ ...base, rawClockOut: jst(17, 44), hasOvertimeRequest: false })).toBe(false)
  })
  it("残業申請があれば対象外／④OFF なら対象外／退勤未打刻は対象外", () => {
    expect(needsOvertimeRequestNotice({ ...base, rawClockOut: jst(19, 0), hasOvertimeRequest: true })).toBe(false)
    expect(needsOvertimeRequestNotice({ ...base, capEnabled: false, rawClockOut: jst(19, 0), hasOvertimeRequest: false })).toBe(false)
    expect(needsOvertimeRequestNotice({ ...base, rawClockOut: null, hasOvertimeRequest: false })).toBe(false)
  })
})

describe("全スイッチ OFF なら記録時刻＝実打刻（申請が無い日）", () => {
  it("8:10〜19:51 のまま", () => {
    const r = run({ in: jst(8, 10), out: jst(19, 51), switches: OFF })
    expect(hm(r.clockIn)).toBe("08:10")
    expect(hm(r.clockOut)).toBe("19:51")
  })
})
