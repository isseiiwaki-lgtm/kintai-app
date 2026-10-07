/**
 * リリース2の追加分：④ONなら①も効く・定時後出勤の遅刻・打刻修正の入力・併記判定（入力と記録の日付）
 */
import { describe, it, expect } from "vitest"
import { findCorrectionLog, isClockInCapped, isClockOutCapped, isLatestInputLog, planInputRevert, resolveInputTime } from "../lib/clock-pipeline"
import { DATE, SCHEDULE, earlyReq, hm, jst, run, sw } from "./helpers/pipeline"

describe("結論1：申請が無い日の早出は④ONで定時に打ち切る（④ONなら①も効く）", () => {
  it("④ON・①OFF・申請なし：8:10 出勤 → 9:00・残業0", () => {
    const r = run({ in: jst(8, 10), out: jst(17, 30), switches: sw({ capOvertime: true }) })
    expect(hm(r.clockIn)).toBe("09:00")
    expect(r.earlyStartMinutes).toBe(0)
    expect(r.overtimeMinutes).toBe(0)
  })
  it("④OFF・①OFF：8:10 出勤はそのまま（早出50分）", () => {
    const r = run({ in: jst(8, 10), out: jst(17, 30) })
    expect(hm(r.clockIn)).toBe("08:10")
    expect(r.earlyStartMinutes).toBe(50)
  })
  it("④ON・遅刻側は丸めない：9:10 出勤は 9:10", () => {
    expect(hm(run({ in: jst(9, 10), switches: sw({ capOvertime: true }) }).clockIn)).toBe("09:10")
  })
  it("早出申請がある日は従来どおり申請の開始で切る（④ON・8:00 申請・7:40 → 8:00）", () => {
    const r = run({ in: jst(7, 40), switches: sw({ capOvertime: true }), requests: [earlyReq("08:00")] })
    expect(hm(r.clockIn)).toBe("08:00")
  })
  it("早出申請が無効（有効な開始が定時以降）になった日も定時で打ち切る", () => {
    // 申請 9:00 は定時と同じ＝無効。8:30 出勤は④ONなら定時に
    const r = run({ in: jst(8, 30), switches: sw({ capOvertime: true }), requests: [earlyReq("09:00")] })
    expect(hm(r.clockIn)).toBe("09:00")
  })
  it("isClockInCapped：④ONで申請なしの早出を切った日は true（一般社員の画面に実打刻を出さない）", () => {
    const base = { inputClockIn: jst(8, 10), schedule: SCHEDULE, requests: [] }
    expect(isClockInCapped({ ...base, switches: sw({ capOvertime: true }) })).toBe(true)
    // ④OFF なら切っていない
    expect(isClockInCapped({ ...base, switches: sw() })).toBe(false)
    // ①ON なら④の有無で結果が同じ（①の丸め。従来どおり併記する）
    expect(isClockInCapped({ ...base, switches: sw({ roundEarly: true, capOvertime: true }) })).toBe(false)
  })
})

describe("結論4：定時後に出勤し④で勤務0分の日の遅刻は時刻の差", () => {
  it("定時 9:00〜17:30、18:00 出勤・19:00 退勤・④ON・申請なし → 遅刻540・勤務0分・残業0", () => {
    const r = run({ in: jst(18, 0), out: jst(19, 0), switches: sw({ capOvertime: true }) })
    expect(r.capBeforeClockIn).toBe(true)
    expect(hm(r.clockIn)).toBe("18:00")
    expect(hm(r.clockOut)).toBe("18:00")
    expect(r.lateMinutes).toBe(540)
    expect(r.earlyLeaveMinutes).toBe(0)
    expect(r.overtimeMinutes).toBe(0)
  })
})

describe("要修正7：打刻修正で入れた時刻は実打刻より早くても入力になる", () => {
  it("実打刻 9:20 を 9:00 へ修正（修正のほうが早い時刻）→ 9:00", () => {
    const r = resolveInputTime({
      date: DATE, raw: jst(9, 20), recorded: jst(9, 0),
      logs: [{ newValue: "09:00", changedAt: jst(9, 0, 6) }],
    })
    expect(r.source).toBe("corrected")
    expect(hm(r.time)).toBe("09:00")
  })
  it("実打刻 18:10 を 17:30 へ修正（翌日に承認）→ 17:30", () => {
    const r = resolveInputTime({
      date: DATE, raw: jst(18, 10), recorded: null,
      logs: [{ newValue: "17:30", changedAt: jst(10, 0, 6) }],
    })
    expect(r.source).toBe("corrected")
    expect(hm(r.time)).toBe("17:30")
  })
})

describe("要修正10：併記判定は記録の日付とパイプラインの入力で行う", () => {
  it("出勤なし・日またぎ退勤（翌1:00）：記録の日付の上限（17:30）で打ち切られた → true", () => {
    expect(isClockOutCapped({
      date: DATE, recordedClockIn: null, inputClockOut: jst(1, 0, 6), schedule: SCHEDULE, switches: sw({ capOvertime: true }), requests: [],
    })).toBe(true)
  })
  it("打刻修正の日は修正した時刻で判定する（修正 17:20 は上限内 → false）", () => {
    const input = resolveInputTime({
      date: DATE, raw: jst(19, 51), recorded: null,
      logs: [{ newValue: "17:20", changedAt: jst(10, 0, 6) }],
    }).time
    expect(isClockOutCapped({
      date: DATE, recordedClockIn: jst(9, 0), inputClockOut: input, schedule: SCHEDULE, switches: sw({ capOvertime: true }), requests: [],
    })).toBe(false)
  })
})

describe("結論5・6：修正の取り消し（取り消しの印と、1つ前の入力への戻し方）", () => {
  const log = (id: string, newValue: string | null, h: number, oldValue: string | null = null) =>
    ({ id, oldValue, newValue, changedAt: jst(h, 0, 6) })

  it("取り消しの印（新しい値が空）より前の履歴は入力に使わない → 実打刻に戻る", () => {
    const r = resolveInputTime({
      date: DATE, raw: jst(9, 20), recorded: jst(9, 0),
      logs: [log("a", "09:00", 10), log("m", null, 11)],
    })
    expect(r.source).toBe("raw")
    expect(hm(r.time)).toBe("09:20")
  })
  it("印のあとに書いた履歴は有効（印 → 8:55 の再入力）", () => {
    const r = resolveInputTime({
      date: DATE, raw: jst(9, 20), recorded: null,
      logs: [log("a", "09:00", 10), log("m", null, 11), log("b", "08:55", 12)],
    })
    expect(hm(r.time)).toBe("08:55")
  })
  it("管理者の修正を取り消す：1つ前の打刻修正があればその時刻を書き直す", () => {
    const logs = [log("c", "09:05", 9), log("adm", "09:00", 10)]
    const p = planInputRevert({ date: DATE, raw: jst(9, 20), logs, removeId: "adm" })
    expect(p).toEqual({ logNewValue: "09:05", noInput: false })
  })
  it("管理者の修正を取り消す：1つ前が実打刻なら取り消しの印（空）", () => {
    const p = planInputRevert({ date: DATE, raw: jst(9, 20), logs: [log("adm", "09:00", 10)], removeId: "adm" })
    expect(p).toEqual({ logNewValue: null, noInput: false })
  })
  it("実打刻も他の履歴も無い日（代理打刻）は noInput：記録時刻の列を戻す必要がある", () => {
    const p = planInputRevert({ date: DATE, raw: null, logs: [log("adm", "09:00", 10)], removeId: "adm" })
    expect(p).toEqual({ logNewValue: null, noInput: true })
  })
  it("戻したあとの入力：再入力の履歴で1つ前の時刻、印で実打刻", () => {
    const logs = [log("c", "09:05", 9), log("adm", "09:00", 10), log("re", "09:05", 11)]
    expect(hm(resolveInputTime({ date: DATE, raw: jst(9, 20), recorded: null, logs }).time)).toBe("09:05")
    const logs2 = [log("adm", "09:00", 10), log("m", null, 11)]
    expect(hm(resolveInputTime({ date: DATE, raw: jst(9, 20), recorded: null, logs: logs2 }).time)).toBe("09:20")
  })
  it("承認済みの打刻修正の変更履歴は、承認の記録の前後2分以内の同じ値で見つける", () => {
    const logs = [log("x", "09:00", 9), { id: "y", oldValue: "09:20", newValue: "09:00", changedAt: new Date(jst(12, 0, 6).getTime() + 30000) }]
    const approvedAt = jst(12, 0, 6)
    expect(findCorrectionLog(logs, "09:00", [approvedAt])?.id).toBe("y")
    expect(findCorrectionLog(logs, "09:10", [approvedAt])).toBeNull()
    // 承認の記録から離れた履歴（管理者の編集など）は対象外
    expect(findCorrectionLog([log("x", "09:00", 9)], "09:00", [approvedAt])).toBeNull()
  })
  it("あとの履歴がある修正は最新ではない（戻しても時刻を動かさない）", () => {
    const a = log("a", "09:00", 9), b = log("b", "09:30", 10)
    expect(isLatestInputLog([a, b], a)).toBe(false)
    expect(isLatestInputLog([a, b], b)).toBe(true)
  })
})
