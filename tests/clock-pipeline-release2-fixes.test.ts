/**
 * リリース2レビュー指摘の修正：承認の記録が無い申請の照合・取り消し済み履歴の除外・代理打刻日の取り消し・Excel の変更欄
 */
import { describe, it, expect } from "vitest"
import {
  computeClockPipeline,
  correctionLogIdSet,
  findCorrectionLog,
  liveInputLogs,
  planAdminRevert,
  proxyFirstLogAt,
  planFieldRevert,
  planInputRevert,
  resolveInputTime,
  type InputLog,
} from "../lib/clock-pipeline"
import { effectiveChangedFields, fmtChangedPair } from "../lib/export-format"
import { DATE, SCHEDULE, hm, jst, sw } from "./helpers/pipeline"

/** 変更履歴（2026-10-06 の h 時 m 分に書いた履歴） */
const log = (id: string, newValue: string | null, h: number, oldValue: string | null = null, m = 0): InputLog =>
  ({ id, oldValue, newValue, changedAt: jst(h, m, 6) })

/** 承認済みの打刻修正を削除する操作（requests/actions.ts の revertApprovedCorrection の変更履歴まわりを再現） */
function deleteCorrection(
  logs: InputLog[],
  raw: Date | null,
  c: { correctedTime: string; createdAt: Date; approvedAts: Date[] },
  h: number,
): InputLog[] {
  const matched = findCorrectionLog(logs, c.correctedTime, c.approvedAts, c.createdAt)
  if (!matched) return logs
  const plan = planInputRevert({ date: DATE, raw, logs, removeId: matched.id })
  return [...logs, {
    id: `rev-${matched.id}`, oldValue: c.correctedTime, newValue: plan.logNewValue, changedAt: jst(h, 0, 7), revertsLogId: matched.id,
  }]
}

const inputOf = (logs: InputLog[], raw: Date | null) => resolveInputTime({ date: DATE, raw, recorded: null, logs })

describe("A：承認の記録（Approval）が無い申請の変更履歴の照合", () => {
  const createdAt = jst(8, 0, 6)
  it("承認の記録が無ければ、申請の作成以後で同じ時刻の最も早い履歴を承認由来とする", () => {
    const logs = [log("approve", "09:10", 10, "09:20"), log("admin-again", "09:10", 15, "09:40")]
    expect(findCorrectionLog(logs, "09:10", [], createdAt)?.id).toBe("approve")
  })
  it("申請の作成より前の同じ時刻の履歴は対象外（別の操作）", () => {
    const logs = [log("before", "09:10", 7, "09:20"), log("approve", "09:10", 10, "09:15")]
    expect(findCorrectionLog(logs, "09:10", [], createdAt)?.id).toBe("approve")
    expect(findCorrectionLog([log("before", "09:10", 7)], "09:10", [], createdAt)).toBeNull()
  })
  it("承認の記録が無く createdAt も渡されなければ見つけない（従来どおり）", () => {
    expect(findCorrectionLog([log("a", "09:10", 10)], "09:10", [])).toBeNull()
  })
  it("承認の記録がある申請は、時刻が離れた履歴を対象にしない", () => {
    expect(findCorrectionLog([log("a", "09:10", 10)], "09:10", [jst(13, 0, 6)], createdAt)).toBeNull()
  })
  it("承認の記録が無い承認済み申請の履歴は、承認由来の集合に入る（管理者の入力と区別できる）", () => {
    const logs = [log("approve", "09:10", 10), log("admin", "09:40", 12)]
    const ids = correctionLogIdSet(logs, [{ correctedTime: "09:10", createdAt, approvedAts: [] }])
    expect([...ids]).toEqual(["approve"])
  })
  it("申請の削除：承認の記録が無い打刻修正でも出勤の入力が実打刻へ戻る", () => {
    const raw = jst(9, 20)
    const logs = [log("approve", "09:10", 10, "09:20")]
    const after = deleteCorrection(logs, raw, { correctedTime: "09:10", createdAt, approvedAts: [] }, 11)
    expect(inputOf(after, raw).source).toBe("raw")
  })
})

describe("B：同じ項目の修正を2件とも削除すると実打刻に戻る", () => {
  const raw = jst(9, 20)
  const createdAt = jst(8, 0, 6)
  const A = { correctedTime: "09:10", createdAt, approvedAts: [jst(10, 0, 6)] }
  const Bq = { correctedTime: "09:20", createdAt, approvedAts: [jst(11, 0, 6)] }
  const base = [log("A", "09:10", 10, "09:20"), log("B", "09:20", 11, "09:10")]

  it("B → A の順に削除", () => {
    const afterB = deleteCorrection(base, raw, Bq, 12)
    expect(hm(inputOf(afterB, raw).time)).toBe("09:10")  // A はまだ有効
    const afterA = deleteCorrection(afterB, raw, A, 13)
    expect(inputOf(afterA, raw)).toMatchObject({ source: "raw" })
  })
  it("A → B の順に削除", () => {
    const afterA = deleteCorrection(base, raw, A, 12)
    expect(hm(inputOf(afterA, raw).time)).toBe("09:20")  // B が優先（A を消しても動かない）
    const afterB = deleteCorrection(afterA, raw, Bq, 13)
    expect(inputOf(afterB, raw)).toMatchObject({ source: "raw" })
  })
  it("実打刻と違う2件（9:10 → 9:30）でも同じ", () => {
    const B2 = { correctedTime: "09:30", createdAt, approvedAts: [jst(11, 0, 6)] }
    const logs = [log("A", "09:10", 10, "09:20"), log("B", "09:30", 11, "09:10")]
    const afterB = deleteCorrection(deleteCorrection(logs, raw, B2, 12), raw, A, 13)
    expect(inputOf(afterB, raw).source).toBe("raw")
    const afterA = deleteCorrection(deleteCorrection(logs, raw, A, 12), raw, B2, 13)
    expect(inputOf(afterA, raw).source).toBe("raw")
  })
  it("取り消し済みの履歴と取り消しの履歴は有効な履歴に数えない", () => {
    const logs = deleteCorrection(base, raw, Bq, 12)
    expect(liveInputLogs(logs).map((l) => l.id)).toEqual(["A"])
  })
  it("管理者の修正を取り消したあとで、その前の打刻修正を削除 → 実打刻", () => {
    const logs = [log("A", "09:10", 10, "09:20"), log("L", "09:40", 12, "09:10")]
    const adminDate = jst(9, 40)
    const plan = planAdminRevert({
      date: DATE, raw, admin: adminDate, logs,
      correctionLogIds: new Set(["A"]), dayHasRawPunch: true, firstLogAt: logs[0].changedAt,
    })
    expect(plan).toEqual({ kind: "clearAdmin", logNewValue: "09:10", noInput: false, targetId: "L" })
    const cleared = [...logs, { id: "R", oldValue: "09:40", newValue: "09:10", changedAt: jst(13, 0, 6), revertsLogId: "L" }]
    expect(hm(inputOf(cleared, raw).time)).toBe("09:10")
    const after = deleteCorrection(cleared, raw, A, 14)
    expect(inputOf(after, raw).source).toBe("raw")
  })
})

describe("C：代理打刻の日の管理者の修正の取り消し", () => {
  const proxyAt = (id: string, v: string) => log(id, v, 9)  // 代理打刻は同じ保存で書くので同じ時刻
  const none = new Set<string>()

  it("代理打刻 8:50/17:30 → 出勤を 9:10 に修正 → 取り消し：出勤は 8:50（admin 列へ戻す）、退勤は触らない", () => {
    const logs = [proxyAt("pin", "08:50"), proxyAt("pout", "17:30"), log("edit", "09:10", 12, "08:50")]
    const inLogs = logs.filter((l) => l.id !== "pout")
    const outLogs = logs.filter((l) => l.id === "pout")
    const first = proxyAt("x", "").changedAt
    const planIn = planAdminRevert({ date: DATE, raw: null, admin: jst(9, 10), logs: inLogs, correctionLogIds: none, dayHasRawPunch: false, firstLogAt: first })
    expect(planIn).toEqual({ kind: "restoreAdmin", value: "08:50", targetId: "edit" })
    const planOut = planAdminRevert({ date: DATE, raw: null, admin: jst(17, 30), logs: outLogs, correctionLogIds: none, dayHasRawPunch: false, firstLogAt: first })
    expect(planOut).toEqual({ kind: "none" })
  })
  it("戻した 8:50 は丸めない（①②③ON でも管理者の入力のまま）", () => {
    const out = computeClockPipeline({
      inputClockIn: jst(8, 50), inputClockOut: jst(17, 30),
      adminClockIn: jst(8, 50), adminClockOut: jst(17, 30),
      date: DATE, schedule: SCHEDULE,
      switches: sw({ roundEarly: true, roundNear: true, roundQuarter: true }), requests: [],
    })
    expect(hm(out.clockIn)).toBe("08:50")
    expect(hm(out.clockOut)).toBe("17:30")
  })
  it("戻したあとは代理打刻のまま：もう一度は取り消せない（none）", () => {
    const logs = [proxyAt("pin", "08:50"), log("edit", "09:10", 12, "08:50"),
      { id: "R", oldValue: "09:10", newValue: "08:50", changedAt: jst(13, 0, 6), revertsLogId: "edit" }]
    const plan = planAdminRevert({ date: DATE, raw: null, admin: jst(8, 50), logs, correctionLogIds: none, dayHasRawPunch: false, firstLogAt: proxyAt("x", "").changedAt })
    expect(plan).toEqual({ kind: "none" })
  })
  it("代理打刻のまま直していない日は取り消すものが無い（出勤も退勤も none）", () => {
    const first = proxyAt("x", "").changedAt
    for (const [admin, v] of [[jst(9, 0), "09:00"], [jst(17, 30), "17:30"]] as const) {
      const plan = planAdminRevert({ date: DATE, raw: null, admin, logs: [proxyAt("p", v)], correctionLogIds: none, dayHasRawPunch: false, firstLogAt: first })
      expect(plan.kind).toBe("none")
    }
  })
  it("代理打刻のあとで足した退勤は、取り消すと空に戻る", () => {
    const logs = [log("late", "17:30", 12)]
    const plan = planAdminRevert({ date: DATE, raw: null, admin: jst(17, 30), logs, correctionLogIds: none, dayHasRawPunch: false, firstLogAt: proxyAt("x", "").changedAt })
    expect(plan).toEqual({ kind: "clearAdmin", logNewValue: null, noInput: true, targetId: "late" })
  })
  it("移行で admin 列に入った値：1つ前も管理者の入力ならその値へ、打刻修正の承認なら admin 列を空にして修正の時刻へ", () => {
    const raw = jst(9, 20)
    const logs = [log("a1", "09:00", 10, "09:20"), log("a2", "09:05", 11, "09:00")]
    const first = logs[0].changedAt
    expect(planAdminRevert({ date: DATE, raw, admin: jst(9, 5), logs, correctionLogIds: none, dayHasRawPunch: true, firstLogAt: first }))
      .toEqual({ kind: "restoreAdmin", value: "09:00", targetId: "a2" })
    expect(planAdminRevert({ date: DATE, raw, admin: jst(9, 5), logs, correctionLogIds: new Set(["a1"]), dayHasRawPunch: true, firstLogAt: first }))
      .toEqual({ kind: "clearAdmin", logNewValue: "09:00", noInput: false, targetId: "a2" })
  })
  it("通常の日（実打刻あり・直前の履歴なし）は実打刻へ戻す。実打刻の無い項目は記録時刻の列を空にする", () => {
    const first = log("x", "09:00", 10).changedAt
    expect(planAdminRevert({ date: DATE, raw: jst(9, 20), admin: jst(9, 0), logs: [log("a", "09:00", 10)], correctionLogIds: none, dayHasRawPunch: true, firstLogAt: first }))
      .toEqual({ kind: "clearAdmin", logNewValue: null, noInput: false, targetId: "a" })
    expect(planAdminRevert({ date: DATE, raw: null, admin: jst(17, 30), logs: [log("o", "17:30", 11)], correctionLogIds: none, dayHasRawPunch: true, firstLogAt: first }))
      .toEqual({ kind: "clearAdmin", logNewValue: null, noInput: true, targetId: "o" })
  })
  it("実打刻より前の履歴は戻し先にしない", () => {
    const raw = jst(9, 20, 6)  // 履歴（10-06 9:00）より後に打刻
    const plan = planAdminRevert({ date: DATE, raw: new Date(raw.getTime() + 24 * 3600 * 1000), admin: jst(9, 5), logs: [log("old", "09:00", 9), log("adm", "09:05", 10)], correctionLogIds: none, dayHasRawPunch: true, firstLogAt: log("x", "", 9).changedAt })
    expect(plan.kind).toBe("clearAdmin")
  })
})

describe("外出・戻り・休憩の修正の取り消し（planFieldRevert）", () => {
  it("最新の修正を取り消す：1つ前の有効な履歴の値へ", () => {
    const logs = [log("A", "12:00", 9, "11:50"), log("B", "12:15", 10, "12:00")]
    expect(planFieldRevert({ logs, removeId: "B" })).toEqual({ value: "12:00", changeColumn: true })
  })
  it("あとの修正がある修正を取り消す：列は動かさない", () => {
    const logs = [log("A", "12:00", 9, "11:50"), log("B", "12:15", 10, "12:00")]
    expect(planFieldRevert({ logs, removeId: "A" })).toEqual({ value: "12:15", changeColumn: false })
  })
  it("先に A を取り消してから B を取り消す：A の前の値（11:50）へ", () => {
    const logs = [log("A", "12:00", 9, "11:50"), log("B", "12:15", 10, "12:00"),
      { id: "rA", oldValue: "12:00", newValue: "12:15", changedAt: jst(11, 0, 6), revertsLogId: "A" }]
    expect(planFieldRevert({ logs, removeId: "B" })).toEqual({ value: "11:50", changeColumn: true })
  })
})

describe("Excel：取り消して実打刻に戻った日は変更欄を出さない", () => {
  const rec = (rawIn: Date | null, rawOut: Date | null) => ({ date: DATE, rawClockIn: rawIn, rawClockOut: rawOut })
  const fl = (fieldName: string, l: InputLog) => ({ fieldName, newValue: l.newValue, changedAt: l.changedAt })

  it("修正した日は変更あり（直した側）", () => {
    expect(effectiveChangedFields(rec(jst(9, 20), jst(17, 30)), [fl("clockIn", log("a", "09:10", 10))])).toEqual(["clockIn"])
  })
  it("修正して取り消した（印）日は変更なし → 変更欄は - / -", () => {
    const logs = [fl("clockIn", log("a", "09:10", 10)), fl("clockIn", { ...log("r", null, 11), revertsLogId: "a" })]
    const fields = effectiveChangedFields(rec(jst(9, 20), jst(17, 30)), logs)
    expect(fields).toEqual([])
    const r = { clockIn: jst(9, 20), clockOut: jst(17, 30), rawClockIn: jst(9, 20), rawClockOut: jst(17, 30) }
    expect(fmtChangedPair(r, fields)).toEqual({ changedIn: "-", changedOut: "-" })
  })
  it("修正した時刻が実打刻と同じ日（9:10 → 9:20 に戻した）は変更なし", () => {
    const logs = [fl("clockIn", log("a", "09:10", 10)), fl("clockIn", { ...log("b", "09:20", 11), revertsLogId: "a" })]
    expect(effectiveChangedFields(rec(jst(9, 20), null), logs)).toEqual([])
  })
  it("片方だけ取り消した日は、残っている側だけ変更あり", () => {
    const logs = [
      fl("clockIn", log("a", "09:10", 10)), fl("clockIn", log("r", null, 11)),
      fl("clockOut", log("o", "17:00", 10)),
    ]
    expect(effectiveChangedFields(rec(jst(9, 20), jst(17, 30)), logs)).toEqual(["clockOut"])
  })
  it("代理打刻の日（実打刻なし）は履歴があれば変更あり", () => {
    expect(effectiveChangedFields(rec(null, null), [fl("clockIn", log("p", "08:50", 9))])).toEqual(["clockIn"])
  })
})

describe("R2-1：実打刻の無い項目で打刻修正を2件削除（noInput の戻し値）", () => {
  // 出勤の打ち忘れ：C1（9:00）を承認 → C2（8:50）を承認（C2 の修正前は 9:00）
  const c1 = { correctedTime: "09:00", createdAt: jst(8, 0, 6), approvedAts: [] as Date[] }
  const c2 = { correctedTime: "08:50", createdAt: jst(8, 30, 6), approvedAts: [] as Date[] }
  const base = [log("C1", "09:00", 10, null), log("C2", "08:50", 11, "09:00")]

  /** 申請 c を削除する：変更履歴に取り消しの印を書き、noInput なら記録時刻の列に戻す値を返す */
  function del(logs: InputLog[], c: typeof c1, h: number) {
    const matched = findCorrectionLog(logs, c.correctedTime, c.approvedAts, c.createdAt)!
    const plan = planInputRevert({ date: DATE, raw: null, logs, removeId: matched.id })
    const next = [...logs, { id: `rev-${matched.id}`, oldValue: c.correctedTime, newValue: plan.logNewValue, changedAt: jst(h, 0, 7), revertsLogId: matched.id }]
    return { plan, next }
  }

  it("C1 → C2 の順に削除：最後は空（C2 の修正前 09:00 は C1 で、C1 は取り消し済み）", () => {
    const first = del(base, c1, 12)
    expect(first.plan).toMatchObject({ logNewValue: "08:50", noInput: false })
    const second = del(first.next, c2, 13)
    expect(second.plan).toEqual({ logNewValue: null, noInput: true, noInputValue: null })
  })
  it("C2 → C1 の順に削除：C2 の削除で 09:00 に戻り、C1 の削除で空", () => {
    const first = del(base, c2, 12)
    expect(first.plan).toMatchObject({ logNewValue: "09:00", noInput: false })
    const second = del(first.next, c1, 13)
    expect(second.plan).toEqual({ logNewValue: null, noInput: true, noInputValue: null })
  })
  it("取り消し済みの履歴が無ければ、修正前の値へ戻す（1件だけの削除）", () => {
    const logs = [log("C2", "08:50", 11, "09:00")]
    const plan = planInputRevert({ date: DATE, raw: null, logs, removeId: "C2" })
    expect(plan).toEqual({ logNewValue: null, noInput: true, noInputValue: "09:00" })
  })
})

describe("R2-2：代理打刻の最初の書き込み時刻（取り消し済みの履歴を含めない）", () => {
  const fl = (fieldName: string, l: InputLog) => ({ ...l, fieldName })
  it("打刻修正の承認 → 削除 → 代理打刻 → 退勤を修正：出勤（代理打刻のまま）は取り消せない", () => {
    const zOut = log("Z", "18:00", 8)
    const marker: InputLog = { id: "rZ", oldValue: "18:00", newValue: null, changedAt: jst(9, 0, 6), revertsLogId: "Z" }
    const pIn = log("pin", "09:00", 10)
    const pOut = log("pout", "18:00", 10)
    const edit = log("edit", "18:30", 12, "18:00")
    const dayLogs = [fl("clockOut", zOut), fl("clockOut", marker), fl("clockIn", pIn), fl("clockOut", pOut), fl("clockOut", edit)]
    const firstLogAt = proxyFirstLogAt(dayLogs)
    expect(firstLogAt?.getTime()).toBe(pIn.changedAt.getTime())
    const plan = planAdminRevert({
      date: DATE, raw: null, admin: jst(9, 0), logs: [pIn], correctionLogIds: new Set<string>(),
      dayHasRawPunch: false, firstLogAt,
    })
    expect(plan.kind).toBe("none")
  })
  it("履歴が無ければ null", () => {
    expect(proxyFirstLogAt([])).toBeNull()
  })
})

describe("R2-3：承認の記録が無い同じ時刻の申請は履歴を1対1で割り当てる", () => {
  const q1 = jst(8, 0, 6)
  const q2 = jst(8, 5, 6)
  const logs = [log("L1", "09:10", 10), log("L2", "09:10", 10, null, 5)]
  it("2件目の申請は1件目が使った履歴を取らない", () => {
    expect(findCorrectionLog(logs, "09:10", [], q1)?.id).toBe("L1")
    expect(findCorrectionLog(logs, "09:10", [], q2, [q1])?.id).toBe("L2")
  })
  it("correctionLogIdSet は両方の履歴を承認由来にする（2件目の履歴が管理者の修正に見えない）", () => {
    const ids = correctionLogIdSet(logs, [
      { correctedTime: "09:10", createdAt: q2, approvedAts: [] },
      { correctedTime: "09:10", createdAt: q1, approvedAts: [] },
    ])
    expect([...ids].sort()).toEqual(["L1", "L2"])
  })
  it("履歴が1件しか無ければ2件目は見つからない（取り合わない）", () => {
    expect(findCorrectionLog([logs[0]], "09:10", [], q2, [q1])).toBeNull()
  })
})

describe("R2-4：管理者の修正の履歴を特定できない項目は取り消さない", () => {
  it("admin 列と同じ値の履歴が無ければ unidentified", () => {
    const plan = planAdminRevert({
      date: DATE, raw: jst(9, 20), admin: jst(9, 40), logs: [log("a", "09:10", 10)], correctionLogIds: new Set<string>(),
      dayHasRawPunch: true, firstLogAt: null,
    })
    expect(plan).toEqual({ kind: "unidentified" })
  })
})
